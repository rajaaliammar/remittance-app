import prisma from '../utils/prisma.js';
import { ensureDefaultFaqs } from '../utils/ensureDefaultFaqs.js';

/**
 * GET /api/faqs - List all FAQs (public, for app and portal)
 */
export const getFaqs = async (req, res) => {
  try {
    await ensureDefaultFaqs();
    const faqs = await prisma.fAQ.findMany({
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({ success: true, data: faqs });
  } catch (error) {
    console.error('[FAQ] getFaqs error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch FAQs' });
  }
};

/**
 * GET /api/faqs/:id - Get one FAQ (for portal edit)
 */
export const getFaqById = async (req, res) => {
  try {
    const { id } = req.params;
    const faq = await prisma.fAQ.findUnique({ where: { id } });
    if (!faq) {
      return res.status(404).json({ success: false, message: 'FAQ not found' });
    }
    res.json({ success: true, data: faq });
  } catch (error) {
    console.error('[FAQ] getFaqById error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch FAQ' });
  }
};

/**
 * POST /api/faqs - Create FAQ (portal)
 */
export const createFaq = async (req, res) => {
  try {
    const { question, answer, order } = req.body || {};
    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ success: false, message: 'question is required' });
    }
    if (!answer || typeof answer !== 'string') {
      return res.status(400).json({ success: false, message: 'answer is required' });
    }
    const faq = await prisma.fAQ.create({
      data: {
        question: question.trim(),
        answer: (answer || '').trim(),
        order: typeof order === 'number' ? order : parseInt(order, 10) || 0,
      },
    });
    res.status(201).json({ success: true, data: faq });
  } catch (error) {
    console.error('[FAQ] createFaq error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to create FAQ' });
  }
};

/**
 * PUT /api/faqs/:id - Update FAQ (portal)
 */
export const updateFaq = async (req, res) => {
  try {
    const { id } = req.params;
    const { question, answer, order } = req.body || {};
    const existing = await prisma.fAQ.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'FAQ not found' });
    }
    const data = {};
    if (typeof question === 'string') data.question = question.trim();
    if (typeof answer === 'string') data.answer = answer.trim();
    if (typeof order === 'number') data.order = order;
    if (order !== undefined && typeof order !== 'number') data.order = parseInt(order, 10) || 0;
    const faq = await prisma.fAQ.update({
      where: { id },
      data,
    });
    res.json({ success: true, data: faq });
  } catch (error) {
    console.error('[FAQ] updateFaq error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to update FAQ' });
  }
};

/**
 * DELETE /api/faqs/:id - Delete FAQ (portal)
 */
export const deleteFaq = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.fAQ.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'FAQ not found' });
    }
    await prisma.fAQ.delete({ where: { id } });
    res.json({ success: true, message: 'FAQ deleted' });
  } catch (error) {
    console.error('[FAQ] deleteFaq error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to delete FAQ' });
  }
};
