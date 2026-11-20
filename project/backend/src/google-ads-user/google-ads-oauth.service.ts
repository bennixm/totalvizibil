import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { AppConfig } from '../config/env';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { GoogleAdsUserClient } from './google-ads-user-client';
import { TokenCrypto } from './token-crypto';

const SCOPES = ['https://www.googleapis.com/auth/adwords', 'openid', 'email'];

/**
 * Google's official OAuth 2.0 web-server flow for customers connecting
 * their own Google Ads account: consent with the `adwords` scope, offline
 * access (refresh token), `state` checked against a stored hash. The OAuth
 * client id/secret come from the admin panel (platform settings) with the
 * `GOOGLE_ADS_OAUTH_CLIENT_ID/SECRET` env vars as fallback; the refresh
 * token is stored encrypted (TokenCrypto, key from env only).
 */
@Injectable()
export class GoogleAdsOAuthService {
  readonly crypto: TokenCrypto;
  private readonly frontendOrigin: string;

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly settings: PlatformSettingsService,
  ) {
    this.crypto = new TokenCrypto(config.get('googleAdsTokenKey', { infer: true }));
    this.frontendOrigin = config.get('frontendOrigin', { infer: true });
  }

  /** The URL registered as "Authorized redirect URI" in Google Cloud. The
   *  frontend origin proxies /api to the backend in every environment. */
  get redirectUri(): string {
    return `${this.frontendOrigin}/api/v1/google-ads-user/oauth/callback`;
  }

  private async credentials(): Promise<{ clientId: string; clientSecret: string }> {
    const [id, secret] = await Promise.all([
      this.settings.googleAdsOauthClientId(),
      this.settings.googleAdsOauthClientSecret(),
    ]);
    return {
      clientId: id || this.config.get('googleAdsOauthClientId', { infer: true }),
      clientSecret: secret || this.config.get('googleAdsOauthClientSecret', { infer: true }),
    };
  }

  /** What is missing for customers to be able to connect, or [] when ready. */
  async missingConfig(): Promise<string[]> {
    const c = await this.credentials();
    const missing: string[] = [];
    if (!c.clientId) missing.push('oauth_client_id');
    if (!c.clientSecret) missing.push('oauth_client_secret');
    if (!this.crypto.configured) missing.push('token_key');
    return missing;
  }

  private async client(): Promise<OAuth2Client> {
    const c = await this.credentials();
    return new OAuth2Client({
      clientId: c.clientId,
      clientSecret: c.clientSecret,
      redirectUri: this.redirectUri,
    });
  }

  async authUrl(state: string): Promise<string> {
    return (await this.client()).generateAuthUrl({
      access_type: 'offline',
      // Always show consent so Google returns a refresh token every time.
      prompt: 'consent',
      include_granted_scopes: true,
      scope: SCOPES,
      state,
    });
  }

  /** Exchanges the consent code. Returns the encrypted refresh token and the
   *  Google account email (from the verified ID token). */
  async exchange(code: string): Promise<{ refreshTokenEnc: string; email: string | null }> {
    const client = await this.client();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) throw new Error('no_refresh_token');
    if (!tokens.scope?.includes('adwords')) throw new Error('adwords_scope_missing');
    let email: string | null = null;
    if (tokens.id_token) {
      const { clientId } = await this.credentials();
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
      email = ticket.getPayload()?.email ?? null;
    }
    return { refreshTokenEnc: this.crypto.encrypt(tokens.refresh_token), email };
  }

  /** Best-effort revoke at Google when a customer disconnects. */
  async revoke(refreshTokenEnc: string): Promise<void> {
    const client = await this.client();
    await client.revokeToken(this.crypto.decrypt(refreshTokenEnc)).catch(() => undefined);
  }

  /** A Google Ads client acting as the customer, for one of their accounts. */
  async adsClient(
    refreshTokenEnc: string,
    customerId: string,
    loginCustomerId: string | null,
  ): Promise<GoogleAdsUserClient> {
    const client = await this.client();
    client.setCredentials({ refresh_token: this.crypto.decrypt(refreshTokenEnc) });
    return new GoogleAdsUserClient(client, customerId, loginCustomerId, this.writesAllowed);
  }

  /** Same production-only write guard as the platform's own client. */
  get writesAllowed(): boolean {
    if (process.env.GOOGLE_ADS_ALLOW_WRITES?.trim().toLowerCase() === 'true') return true;
    return this.config.get('nodeEnv', { infer: true }) === 'production';
  }
}
