/**
 * LiveEx Digital Onboarding decision (onBoardStatusId).
 * @see https://amlhlep.com — customer.submit-kyc / customer.details
 *
 * 1 = Profile Pending
 * 2 = In Review
 * 3 = Completed
 * 4 = Rejected
 */

export const LIVEEX_ONBOARD_STATUS = {
  PROFILE_PENDING: 1,
  IN_REVIEW: 2,
  COMPLETED: 3,
  REJECTED: 4,
};

export const LIVEEX_ONBOARD_LABELS = {
  1: 'Pending',
  2: 'In Review',
  3: 'Completed',
  4: 'Rejected',
};

/** @param {unknown} digitalOnboarding */
export function parseOnBoardStatusId(digitalOnboarding) {
  if (!digitalOnboarding || typeof digitalOnboarding !== 'object') return null;

  const direct = Number(digitalOnboarding.onBoardStatusId);
  if (Number.isFinite(direct) && direct >= 1 && direct <= 4) return direct;

  const fromSubmit = Number(
    digitalOnboarding.lastSubmitKycResponse?.onBoardStatusId,
  );
  if (Number.isFinite(fromSubmit) && fromSubmit >= 1 && fromSubmit <= 4) {
    return fromSubmit;
  }

  const fromDetails = Number(
    digitalOnboarding.lastDetailsResponse?.onBoardStatusId,
  );
  if (Number.isFinite(fromDetails) && fromDetails >= 1 && fromDetails <= 4) {
    return fromDetails;
  }

  return null;
}

/** @param {number | null | undefined} onBoardStatusId */
export function resolveOnboardDecision(onBoardStatusId) {
  switch (onBoardStatusId) {
    case LIVEEX_ONBOARD_STATUS.PROFILE_PENDING:
      return {
        label: LIVEEX_ONBOARD_LABELS[1],
        accountStatus: 'pending',
        canTransact: false,
        kycDocStatus: 'pending',
      };
    case LIVEEX_ONBOARD_STATUS.IN_REVIEW:
      return {
        label: LIVEEX_ONBOARD_LABELS[2],
        accountStatus: 'pending',
        canTransact: false,
        kycDocStatus: 'pending',
      };
    case LIVEEX_ONBOARD_STATUS.COMPLETED:
      return {
        label: LIVEEX_ONBOARD_LABELS[3],
        accountStatus: 'approved',
        canTransact: true,
        kycDocStatus: 'approved',
      };
    case LIVEEX_ONBOARD_STATUS.REJECTED:
      return {
        label: LIVEEX_ONBOARD_LABELS[4],
        accountStatus: 'rejected',
        canTransact: false,
        kycDocStatus: 'rejected',
      };
    default:
      return null;
  }
}

/** Only LiveEx onboard Completed (3) clears the customer for transactions. */
export function shouldAutoApproveFromLiveex(digitalOnboarding) {
  return parseOnBoardStatusId(digitalOnboarding) === LIVEEX_ONBOARD_STATUS.COMPLETED;
}

export function shouldRejectFromLiveex(digitalOnboarding) {
  return parseOnBoardStatusId(digitalOnboarding) === LIVEEX_ONBOARD_STATUS.REJECTED;
}

export function isOnboardPendingReview(digitalOnboarding) {
  const id = parseOnBoardStatusId(digitalOnboarding);
  return (
    id === LIVEEX_ONBOARD_STATUS.PROFILE_PENDING ||
    id === LIVEEX_ONBOARD_STATUS.IN_REVIEW
  );
}
