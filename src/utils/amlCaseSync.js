import prisma from './prisma.js';
import {
  resolveAmlClientNumber,
  amlClearCustomerCase,
  amlGetCustomerStatus,
  mapAmlCustomerStatus,
} from '../services/amlProvider.service.js';
import { customerHasApprovedKyc } from './kycApproval.js';

/**
 * When portal KYC is approved but AML is still "Pending Compliance", clear the AML case
 * so the customer can send money (status should move to Onboarded).
 */
export async function tryClearAmlCaseAfterKycApproval(
  customerId,
  remarks = 'KYC approved in OneZaPay portal',
) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, kycData: true },
  });
  if (!customer || !customerHasApprovedKyc(customer.kycData)) {
    return { cleared: false, reason: 'no_approved_kyc' };
  }

  const clientNumber = resolveAmlClientNumber(customer);
  if (!clientNumber) {
    return { cleared: false, reason: 'no_client_number' };
  }

  let statusBefore;
  try {
    statusBefore = mapAmlCustomerStatus(await amlGetCustomerStatus(clientNumber));
  } catch (error) {
    console.warn('[AML] case-clear skipped — status check failed:', error.message);
    return { cleared: false, reason: 'status_unavailable', error: error.message };
  }

  if (statusBefore.isOnboarded) {
    return { cleared: true, alreadyOnboarded: true, mapped: statusBefore, clientNumber };
  }

  if (statusBefore.isBlocked) {
    return { cleared: false, reason: 'blocked', mapped: statusBefore, clientNumber };
  }

  try {
    await amlClearCustomerCase(clientNumber, remarks);
  } catch (error) {
    console.warn('[AML] case-clear failed:', error.message);
    return { cleared: false, reason: 'clear_failed', error: error.message, clientNumber };
  }

  try {
    const statusAfter = mapAmlCustomerStatus(await amlGetCustomerStatus(clientNumber));
    console.log(
      `[AML] case-clear after KYC approval | customerId=${customerId} | ${statusBefore.statusLabel} → ${statusAfter.statusLabel}`,
    );
    return {
      cleared: statusAfter.isOnboarded,
      mapped: statusAfter,
      previous: statusBefore,
      clientNumber,
    };
  } catch (error) {
    console.warn('[AML] case-clear succeeded but status re-check failed:', error.message);
    return { cleared: true, clientNumber, statusCheckFailed: true };
  }
}
