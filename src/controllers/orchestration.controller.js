import prisma from '../utils/prisma.js';

/**
 * Admin API for orchestration status/config.
 * Orchestration runs before every remittance transaction.
 */
export const getOrchestrationStatus = async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: {
        enabled: true,
        description: 'Orchestration runs before every remittance transaction. It validates context and can enforce policies, compliance checks, or logging. Jobs and events are stored in orchestration_jobs and orchestration_events.',
        runBefore: 'createRemittanceTransaction',
      },
    });
  } catch (error) {
    console.error('Error fetching orchestration status:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch orchestration status',
    });
  }
};

/**
 * List orchestration jobs (paginated).
 */
export const listOrchestrationJobs = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;
    const status = req.query.status; // optional: completed, failed, running, pending
    const type = req.query.type; // optional: pre_transaction, etc.

    const where = {};
    if (status) where.status = status;
    if (type) where.type = type;

    const [jobs, total] = await Promise.all([
      prisma.orchestrationJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { events: { orderBy: { createdAt: 'asc' }, take: 20 } },
      }),
      prisma.orchestrationJob.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: jobs,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Error listing orchestration jobs:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to list orchestration jobs',
    });
  }
};

/**
 * Get a single orchestration job by id (for View Details).
 */
export const getOrchestrationJobById = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await prisma.orchestrationJob.findUnique({
      where: { id },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }
    res.status(200).json({ success: true, data: job });
  } catch (error) {
    console.error('Error fetching orchestration job:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch job',
    });
  }
};

/**
 * List orchestration events (paginated).
 */
export const listOrchestrationEvents = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;
    const jobId = req.query.jobId;
    const eventType = req.query.eventType;

    const where = {};
    if (jobId) where.jobId = jobId;
    if (eventType) where.eventType = eventType;

    const [events, total] = await Promise.all([
      prisma.orchestrationEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.orchestrationEvent.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: events,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Error listing orchestration events:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to list orchestration events',
    });
  }
};
