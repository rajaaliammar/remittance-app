import prisma from '../utils/prisma.js';
import {
  CacheKeys,
  REFERENCE_TTL_SECONDS,
  getOrSet,
  invalidateLegalDocumentsCache,
} from '../utils/cache.js';

const DOC_TYPES = ['privacy', 'terms', 'compliance'];

const DEFAULT_SECTIONS = {
  privacy: {
    title: 'Privacy Policy',
    sections: [
      {
        h: '1. What we collect',
        p: 'We collect information you provide when you sign up, verify your identity, or send a transfer — including your name, address, ID, contact details, and payment information. We also collect device and usage data to keep your account secure.',
      },
      {
        h: '2. How we use it',
        p: 'Your data is used to provide our service, verify identity, prevent fraud, comply with anti–money-laundering laws, and improve OneZaPay. We never sell your personal data to third parties.',
      },
      {
        h: '3. Sharing',
        p: 'We share data only with payment partners, banks, regulators, and law-enforcement agencies when required by law. All partners are bound by strict confidentiality agreements.',
      },
      {
        h: '4. Your rights',
        p: 'You can access, correct, or delete your personal data at any time from Settings → Account. You may also request a copy of all data we hold about you.',
      },
    ],
  },
  terms: {
    title: 'Terms & Conditions',
    sections: [
      {
        h: '1. Account & eligibility',
        p: 'You must be at least 18 years old to use OneZaPay. By creating an account you agree to provide accurate information and keep your credentials secure.',
      },
      {
        h: '2. Transfers',
        p: 'All transfers are subject to verification, limits, and applicable fees shown before you confirm. Once a transfer is collected or deposited it cannot be reversed unless required by law.',
      },
      {
        h: '3. Fees & exchange rates',
        p: 'Fees and exchange rates are disclosed before each transfer. Rates are locked once a transaction is confirmed. Cancelled transfers are refunded at the original rate.',
      },
      {
        h: '4. Prohibited use',
        p: 'You may not use OneZaPay for any illegal activity, including fraud, money laundering, terrorism financing, or transactions involving sanctioned persons.',
      },
      {
        h: '5. Liability',
        p: 'OneZaPay is not liable for losses arising from incorrect recipient details supplied by you, network outages, or events outside our reasonable control.',
      },
    ],
  },
  compliance: {
    title: 'Compliance · AML & KYC',
    sections: [
      {
        h: 'Licensed & regulated',
        p: 'OneZaPay is a registered Money Services Business (MSB) with FinCEN (#31000231828) and licensed across all U.S. states where we operate. In the UK we are authorized by the FCA (#900012).',
      },
      {
        h: 'Know Your Customer (KYC)',
        p: 'All customers complete identity verification before sending. We verify your name, date of birth, address, and government ID against trusted data sources. Higher transfer limits unlock after enhanced verification.',
      },
      {
        h: 'Anti-Money Laundering (AML)',
        p: 'We monitor transactions for unusual patterns and screen all senders and recipients against sanctions lists (OFAC, UN, EU, HMT). Suspicious activity is reported to authorities as required by law.',
      },
      {
        h: 'Transaction limits',
        p: 'Daily limit: $5,000 • Monthly limit: $25,000 for verified accounts. Limits may be higher for fully-enhanced KYC. Limits exist to protect you from fraud and to comply with regulators.',
      },
      {
        h: 'Reporting & cooperation',
        p: 'We cooperate fully with law enforcement and respond to lawful requests for information. We never share data without proper legal process.',
      },
    ],
  },
};

function normalizeSections(sections) {
  if (!Array.isArray(sections)) return [];
  return sections
    .filter((s) => s && (s.h || s.p))
    .map((s) => ({
      h: String(s.h ?? '').trim(),
      p: String(s.p ?? '').trim(),
    }))
    .filter((s) => s.h || s.p);
}

export async function ensureLegalDocumentDefaults() {
  for (const docType of DOC_TYPES) {
    const existing = await prisma.legalDocument.findUnique({ where: { docType } });
    if (existing) continue;
    const def = DEFAULT_SECTIONS[docType];
    await prisma.legalDocument.create({
      data: {
        docType,
        title: def.title,
        sections: def.sections,
        effectiveDate: new Date('2026-05-01'),
        contactEmail: 'legal@onezapay.com',
        status: 'published',
      },
    });
  }
}

/**
 * GET /api/legal-documents — published docs for app; all docs for admin (Bearer token)
 */
export const getLegalDocuments = async (req, res) => {
  try {
    const isAdmin = Boolean(req.user);

    if (isAdmin) {
      await ensureLegalDocumentDefaults();
      const docs = await prisma.legalDocument.findMany({
        where: {},
        orderBy: { docType: 'asc' },
      });
      return res.json({ success: true, data: docs });
    }

    const docs = await getOrSet(CacheKeys.legalDocumentsPublished(), REFERENCE_TTL_SECONDS, async () => {
      await ensureLegalDocumentDefaults();
      return prisma.legalDocument.findMany({
        where: { status: 'published' },
        orderBy: { docType: 'asc' },
      });
    });

    res.set('Cache-Control', 'public, max-age=60');
    res.json({ success: true, data: docs });
  } catch (error) {
    console.error('[LegalDocument] getLegalDocuments error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch legal documents' });
  }
};

/**
 * GET /api/legal-documents/:docType — single doc (privacy | terms | compliance)
 */
export const getLegalDocumentByType = async (req, res) => {
  try {
    const { docType } = req.params;
    if (!DOC_TYPES.includes(docType)) {
      return res.status(400).json({ success: false, message: 'Invalid document type' });
    }

    const isAdmin = Boolean(req.user);
    const cacheKey = CacheKeys.legalDocumentByType(docType);

    const doc = isAdmin
      ? await (async () => {
          await ensureLegalDocumentDefaults();
          return prisma.legalDocument.findUnique({ where: { docType } });
        })()
      : await getOrSet(cacheKey, REFERENCE_TTL_SECONDS, async () => {
          await ensureLegalDocumentDefaults();
          const row = await prisma.legalDocument.findUnique({ where: { docType } });
          if (!row || row.status !== 'published') return null;
          return row;
        });

    if (!doc) {
      return res.status(404).json({ success: false, message: 'Legal document not found' });
    }

    if (!isAdmin && doc.status !== 'published') {
      return res.status(404).json({ success: false, message: 'Legal document not found' });
    }

    res.set('Cache-Control', isAdmin ? 'no-store' : 'public, max-age=60');
    res.json({ success: true, data: doc });
  } catch (error) {
    console.error('[LegalDocument] getLegalDocumentByType error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch legal document' });
  }
};

/**
 * PUT /api/legal-documents/:docType — create or update (admin)
 */
export const upsertLegalDocument = async (req, res) => {
  try {
    const { docType } = req.params;
    if (!DOC_TYPES.includes(docType)) {
      return res.status(400).json({ success: false, message: 'Invalid document type' });
    }
    const { title, sections, effectiveDate, contactEmail, status } = req.body || {};
    const def = DEFAULT_SECTIONS[docType];

    const data = {
      title:
        typeof title === 'string' && title.trim()
          ? title.trim()
          : def.title,
      sections: sections !== undefined ? normalizeSections(sections) : def.sections,
      contactEmail:
        typeof contactEmail === 'string' && contactEmail.trim()
          ? contactEmail.trim()
          : 'legal@onezapay.com',
      status: status === 'draft' ? 'draft' : 'published',
    };

    if (effectiveDate !== undefined && effectiveDate !== null && effectiveDate !== '') {
      const parsed = new Date(effectiveDate);
      if (!Number.isNaN(parsed.getTime())) data.effectiveDate = parsed;
    }

    const doc = await prisma.legalDocument.upsert({
      where: { docType },
      create: { docType, ...data },
      update: data,
    });
    res.json({ success: true, data: doc });
    void invalidateLegalDocumentsCache();
  } catch (error) {
    console.error('[LegalDocument] upsertLegalDocument error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to save legal document' });
  }
};

/**
 * DELETE /api/legal-documents/:docType — set to draft with empty sections (admin)
 */
export const clearLegalDocument = async (req, res) => {
  try {
    const { docType } = req.params;
    if (!DOC_TYPES.includes(docType)) {
      return res.status(400).json({ success: false, message: 'Invalid document type' });
    }
    const doc = await prisma.legalDocument.upsert({
      where: { docType },
      create: {
        docType,
        title: DEFAULT_SECTIONS[docType].title,
        sections: [],
        status: 'draft',
        contactEmail: 'legal@onezapay.com',
      },
      update: {
        sections: [],
        status: 'draft',
      },
    });
    res.json({ success: true, data: doc, message: 'Document cleared and set to draft' });
    void invalidateLegalDocumentsCache();
  } catch (error) {
    console.error('[LegalDocument] clearLegalDocument error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to clear legal document' });
  }
};
