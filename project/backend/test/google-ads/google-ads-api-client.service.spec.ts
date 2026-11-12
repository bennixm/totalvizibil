import { JWT } from 'google-auth-library';
import { GoogleAdsApiClient } from 'src/google-ads/google-ads-api-client.service';

/**
 * Verifies the request/response shape against a mocked `fetch`, since a
 * mistranslation here either silently mistargets real ad spend or crashes
 * the caller on a shape it didn't expect. `JWT.prototype.getAccessToken` is
 * mocked too — the real implementation signs a JWT assertion with the
 * service-account private key and round-trips it to Google's OAuth token
 * endpoint, neither of which belongs in a unit test.
 *
 * Credentials are admin-settable (`PlatformSettingsService`, DB-backed)
 * with the `GOOGLE_ADS_*` env vars as a fallback — `onModuleInit()` is what
 * actually loads them (constructor injection only, no I/O), so every test
 * that needs a configured client awaits it first.
 */
function fakeConfig(values: {
  googleAdsServiceAccountKeyBase64?: string;
  googleAdsCustomerId?: string;
  googleAdsLoginCustomerId?: string;
}) {
  return {
    get: (key: string) => (values as Record<string, string | undefined>)[key] ?? '',
  } as never;
}

function fakeSettings(
  values: { keyBase64?: string; customerId?: string; loginCustomerId?: string } = {},
) {
  return {
    googleAdsServiceAccountKeyBase64: jest.fn().mockResolvedValue(values.keyBase64 ?? ''),
    googleAdsCustomerId: jest.fn().mockResolvedValue(values.customerId ?? ''),
    googleAdsLoginCustomerId: jest.fn().mockResolvedValue(values.loginCustomerId ?? ''),
  } as never;
}

const VALID_KEY_BASE64 = Buffer.from(
  JSON.stringify({ client_email: 'svc@example.iam.gserviceaccount.com', private_key: 'fake-key' }),
).toString('base64');

async function configuredClient(): Promise<GoogleAdsApiClient> {
  const client = new GoogleAdsApiClient(
    fakeConfig({}),
    fakeSettings({
      keyBase64: VALID_KEY_BASE64,
      customerId: '1234567890',
      loginCustomerId: '9999999999',
    }),
  );
  await client.onModuleInit();
  return client;
}

describe('GoogleAdsApiClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is not configured without a key/customer id, and never calls fetch', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const client = new GoogleAdsApiClient(fakeConfig({}), fakeSettings({}));
    await client.onModuleInit();
    expect(client.configured).toBe(false);
    await expect(client.search('SELECT 1')).rejects.toThrow(/not configured/i);
    await expect(client.mutate([{ campaignOperation: { create: {} } }])).rejects.toThrow(
      /not configured/i,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is not configured when the key is not valid base64 JSON', async () => {
    const client = new GoogleAdsApiClient(
      fakeConfig({}),
      fakeSettings({ keyBase64: 'not-base64-json', customerId: '123' }),
    );
    await client.onModuleInit();
    expect(client.configured).toBe(false);
  });

  it('is not configured when the key JSON is missing client_email/private_key', async () => {
    const badKey = Buffer.from(JSON.stringify({ client_email: 'only-email@example.com' })).toString(
      'base64',
    );
    const client = new GoogleAdsApiClient(
      fakeConfig({}),
      fakeSettings({ keyBase64: badKey, customerId: '123' }),
    );
    await client.onModuleInit();
    expect(client.configured).toBe(false);
  });

  it('falls back to the env vars when no DB setting is configured', async () => {
    const client = new GoogleAdsApiClient(
      fakeConfig({
        googleAdsServiceAccountKeyBase64: VALID_KEY_BASE64,
        googleAdsCustomerId: '555',
        googleAdsLoginCustomerId: '666',
      }),
      fakeSettings({}),
    );
    await client.onModuleInit();
    expect(client.configured).toBe(true);
    expect(client.customerId).toBe('555');
  });

  it('prefers the DB-configured value over the env var when both are set', async () => {
    const client = new GoogleAdsApiClient(
      fakeConfig({
        googleAdsServiceAccountKeyBase64: VALID_KEY_BASE64,
        googleAdsCustomerId: 'env-customer',
      }),
      fakeSettings({ keyBase64: VALID_KEY_BASE64, customerId: 'db-customer' }),
    );
    await client.onModuleInit();
    expect(client.customerId).toBe('db-customer');
  });

  it('exposes the configured service account email for the admin preview', async () => {
    const client = await configuredClient();
    expect(client.serviceAccountEmail).toBe('svc@example.iam.gserviceaccount.com');
  });

  it('search() sends the GAQL query with bearer auth + login-customer-id, and returns results', async () => {
    jest.spyOn(JWT.prototype, 'getAccessToken').mockResolvedValue({ token: 'mock-token' } as never);
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ metrics: { costMicros: '5000000', clicks: '2' } }] }),
    } as Response);

    const client = await configuredClient();
    const results = await client.search('SELECT metrics.clicks FROM campaign');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://googleads.googleapis.com/v25/customers/1234567890/googleAds:search');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer mock-token');
    expect(headers['login-customer-id']).toBe('9999999999');
    expect(headers['developer-token']).toBeUndefined();
    expect(JSON.parse(init?.body as string)).toEqual({ query: 'SELECT metrics.clicks FROM campaign' });
    expect(results).toEqual([{ metrics: { costMicros: '5000000', clicks: '2' } }]);
  });

  it('search() throws with the API error message on a non-ok response', async () => {
    jest.spyOn(JWT.prototype, 'getAccessToken').mockResolvedValue({ token: 'mock-token' } as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Invalid query' } }),
    } as Response);

    const client = await configuredClient();
    await expect(client.search('SELECT bad')).rejects.toThrow(/400.*Invalid query/);
  });

  it('mutate() posts mutateOperations with partialFailure:false, and parses the results', async () => {
    jest.spyOn(JWT.prototype, 'getAccessToken').mockResolvedValue({ token: 'mock-token' } as never);
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        mutateOperationResponses: [
          { campaignBudgetResult: { resourceName: 'customers/1234567890/campaignBudgets/1' } },
          { campaignResult: { resourceName: 'customers/1234567890/campaigns/2' } },
        ],
      }),
    } as Response);

    const client = await configuredClient();
    const ops = [
      { campaignBudgetOperation: { create: { name: 'budget', amountMicros: '1000000' } } },
      {
        campaignOperation: {
          create: { name: 'camp', campaignBudget: 'customers/1234567890/campaignBudgets/-1' },
        },
      },
    ];
    const results = await client.mutate(ops);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://googleads.googleapis.com/v25/customers/1234567890/googleAds:mutate');
    const body = JSON.parse(init?.body as string);
    expect(body.partialFailure).toBe(false);
    expect(body.mutateOperations).toEqual(ops);
    expect(results).toEqual([
      { campaignBudgetResult: { resourceName: 'customers/1234567890/campaignBudgets/1' } },
      { campaignResult: { resourceName: 'customers/1234567890/campaigns/2' } },
    ]);
  });

  it('mutate() with no operations returns [] without calling fetch', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const client = await configuredClient();
    await expect(client.mutate([])).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('mutate() throws with the API error message on a non-ok response', async () => {
    jest.spyOn(JWT.prototype, 'getAccessToken').mockResolvedValue({ token: 'mock-token' } as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: 'PERMISSION_DENIED' } }),
    } as Response);

    const client = await configuredClient();
    await expect(client.mutate([{ campaignOperation: { create: {} } }])).rejects.toThrow(
      /403.*PERMISSION_DENIED/,
    );
  });

  it('throws when the token mint returns no token', async () => {
    jest.spyOn(JWT.prototype, 'getAccessToken').mockResolvedValue({ token: undefined } as never);
    const client = await configuredClient();
    await expect(client.search('SELECT 1')).rejects.toThrow(/no access token/i);
  });
});
