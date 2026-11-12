import { notifyAdminsOfFailedGoogleAdsAgentRun } from 'src/google-ads/google-ads-agent-alerts';

function fakeNotifications(notify: jest.Mock = jest.fn().mockResolvedValue(undefined)) {
  return { notify } as never;
}

function fakePrisma(admins: { userId: string }[] = [{ userId: 'admin-1' }, { userId: 'admin-2' }]) {
  return {
    platformRoleAssignment: { findMany: jest.fn().mockResolvedValue(admins) },
  } as never;
}

describe('notifyAdminsOfFailedGoogleAdsAgentRun', () => {
  it('notifies every admin, in-panel only, with the error summary', async () => {
    const notify = jest.fn().mockResolvedValue(undefined);
    const notifications = fakeNotifications(notify);
    const prisma = fakePrisma();

    await notifyAdminsOfFailedGoogleAdsAgentRun(notifications, prisma, 'structural', 'boom');

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        type: 'google_ads_agent_run_failed',
        body: 'boom',
        channels: { panel: true },
      }),
    );
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'admin-2' }));
  });

  it('truncates a very long error summary', async () => {
    const notify = jest.fn().mockResolvedValue(undefined);
    const notifications = fakeNotifications(notify);
    const prisma = fakePrisma([{ userId: 'admin-1' }]);

    await notifyAdminsOfFailedGoogleAdsAgentRun(notifications, prisma, 'content', 'x'.repeat(1000));

    const body = notify.mock.calls[0][0].body as string;
    expect(body.length).toBe(500);
  });

  it('never throws when the lookup or notify call fails', async () => {
    const prisma = {
      platformRoleAssignment: { findMany: jest.fn().mockRejectedValue(new Error('db down')) },
    } as never;
    await expect(
      notifyAdminsOfFailedGoogleAdsAgentRun(fakeNotifications(), prisma, 'intelligence', 'boom'),
    ).resolves.toBeUndefined();
  });
});
