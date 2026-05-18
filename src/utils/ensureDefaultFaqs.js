import prisma from './prisma.js';

const DEFAULT_FAQS = [
  {
    question: 'How do I register on the app?',
    answer:
      'Download the app, enter your details, verify your phone or email with the OTP we send, then complete KYC verification to start sending money.',
    order: 1,
  },
  {
    question: 'What documents are required for KYC verification?',
    answer:
      'You may need a valid government ID (passport or national ID) and a selfie. Requirements can vary by country and transfer amount.',
    order: 2,
  },
  {
    question: 'How long do transfers take?',
    answer:
      'Most transfers are processed within minutes. Bank and wallet delivery times depend on the destination country and payout partner.',
    order: 3,
  },
  {
    question: 'How can I contact support?',
    answer:
      'Open Help and Support from your profile to use live chat, email, or phone support.',
    order: 4,
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
