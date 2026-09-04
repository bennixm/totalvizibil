/**
 * A business delete request takes the listing down at once but only wipes the
 * record — site, campaign, leads, everything — after this window. The owner can
 * cancel any time before it elapses.
 */
export const COMPANY_DELETE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A draft business (never had an active campaign, never paid to unlock the
 * advanced builder) sitting untouched this long gets swept into the same
 * deletion-request flow as if the owner had asked for it themselves — still
 * reversible via the normal `COMPANY_DELETE_GRACE_MS` cancel window. See
 * `CompaniesService.sweepStaleDrafts`.
 */
export const STALE_DRAFT_AGE_MS = 60 * 24 * 60 * 60 * 1000;
