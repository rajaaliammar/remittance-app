import prisma from './prisma.js';

/** Default FAQs shown in the mobile app Help & Support screen until portal adds custom ones. */
const DEFAULT_FAQS = [
  {
    question: 'How long do transfers take?',
    answer:
      'Bank transfers usually arrive in 1–3 business days. Cash pickups and mobile wallet transfers are typically instant.',
    order: 1,
  },
  {
    question: 'What fees does OneZaPay charge?',
    answer:
      'Fees depend on the corridor and method. You always see the total before you confirm. Your first transfer is fee-free.',
    order: 2,
  },
  {
    question: 'Is my money safe?',
    answer:
      'Yes. We are licensed and regulated, your card details are encrypted with bank-grade security, and funds are protected by partner-bank custody.',
    order: 3,
  },
  {
    question: 'Can I cancel a transfer?',
    answer:
      'You can cancel a transfer for a full refund any time before it is collected or deposited. Go to Activity → tap the transfer → Cancel.',
    order: 4,
  },
  {
    question: 'My transfer says pending — what should I do?',
    answer:
      'Most pending transfers complete within an hour. You do not need to retry — we will notify you the moment it lands.',
    order: 5,
  },
  {
    question: 'How do I verify my identity (KYC)?',
    answer:
      'Open Profile → Identity Verification, and upload a government ID and a selfie. Most users are verified within 5 minutes.',
    order: 6,
  },
];

/**
 * Ensures at least one FAQ exists (dev/local DBs often start empty).
 * Portal-created FAQs are never removed — only seeds when count is zero.
 */
export async function ensureDefaultFaqs() {
  try {
    const count = await prisma.fAQ.count();
    if (count > 0) {
      return count;
    }
    for (const faq of DEFAULT_FAQS) {
      await prisma.fAQ.create({ data: faq });
    }
    console.log(`✅ Seeded ${DEFAULT_FAQS.length} default FAQs`);
    return DEFAULT_FAQS.length;
  } catch (err) {
    console.warn('[FAQ] ensureDefaultFaqs failed:', err?.message || err);
    return 0;
  }
}
