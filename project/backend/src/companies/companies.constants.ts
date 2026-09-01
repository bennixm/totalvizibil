/**
 * A business delete request takes the listing down at once but only wipes the
 * record — site, campaign, leads, everything — after this window. The owner can
 * cancel any time before it elapses.
 */
export const COMPANY_DELETE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
