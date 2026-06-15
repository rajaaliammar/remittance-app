import prisma from '../utils/prisma.js';

const PENDING_STATUSES = new Set([
  'processing',
  'hold',
  'manual_review',
  'awaiting',
  'pending',
]);

const COMPLETED_STATUSES = new Set(['completed', 'succeeded', 'success']);

const toNumber = (value) => {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const startOfMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

const ANALYTICS_MONTH_COUNT = 12;

const monthKeyFromDate = (createdAt) => {
  const d = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${month}`;
};

/** Last N calendar months including the current month (YYYY-MM). */
const buildRecentMonthKeys = (count = ANALYTICS_MONTH_COUNT) => {
  const keys = [];
  const cursor = new Date();
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);
  cursor.setMonth(cursor.getMonth() - (count - 1));
  for (let i = 0; i < count; i += 1) {
    const month = String(cursor.getMonth() + 1).padStart(2, '0');
    keys.push(`${cursor.getFullYear()}-${month}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
};

const normalizeStatus = (status) => String(status || '').toLowerCase().trim();

const classifyChannel = (tx) => {
  const transferType = String(tx.transferType || 'bank').toLowerCase();
  const recipientInfo =
    tx.recipientInfo && typeof tx.recipientInfo === 'object' ? tx.recipientInfo : {};
  const paymentFields =
    tx.paymentFieldValues && typeof tx.paymentFieldValues === 'object'
      ? tx.paymentFieldValues
      : {};
  const hay = JSON.stringify({ ...recipientInfo, ...paymentFields }).toLowerCase();

  if (hay.includes('airtime')) return 'airtime';
  if (
    hay.includes('cash pick') ||
    hay.includes('cashpickup') ||
    hay.includes('pick-up') ||
    hay.includes('pickup')
  ) {
    return 'cashPickup';
  }
  if (transferType === 'wallet') return 'mobileMoney';
  return 'bankTransfer';
};

const countryPairKey = (tx) => {
  const recipientInfo =
    tx.recipientInfo && typeof tx.recipientInfo === 'object' ? tx.recipientInfo : {};
  const paymentFields =
    tx.paymentFieldValues && typeof tx.paymentFieldValues === 'object'
      ? tx.paymentFieldValues
      : {};

  const sendCode = String(
    paymentFields.sendingCountryCode ||
      paymentFields.senderCountryCode ||
      recipientInfo.sendingCountryCode ||
      recipientInfo.senderCountry ||
      '—',
  )
    .trim()
    .toUpperCase()
    .slice(0, 3);

  const receiveCode = String(
    recipientInfo.receivingCountryCode ||
      recipientInfo.receivingBranchCountryCode ||
      recipientInfo.countryCode ||
      recipientInfo.country ||
      '—',
  )
    .trim()
    .toUpperCase()
    .slice(0, 3);

  if (sendCode === '—' && receiveCode === '—') return null;
  return `${sendCode}-${receiveCode}`;
};

/**
 * GET /api/dashboard/stats — portal dashboard metrics from live database.
 * Uses aggregate()/groupBy() and bounded samples — never loads all transactions.
 */
export const getDashboardStats = async (req, res) => {
  try {
    const monthStart = startOfMonth();
    const analyticsStart = new Date();
    analyticsStart.setMonth(analyticsStart.getMonth() - (ANALYTICS_MONTH_COUNT - 1));
    analyticsStart.setDate(1);
    analyticsStart.setHours(0, 0, 0, 0);

    const channelSampleStart = new Date();
    channelSampleStart.setDate(channelSampleStart.getDate() - 90);

    const [
      totalUsers,
      totalAgents,
      activeAgents,
      pendingAgents,
      thisMonthTransactions,
      statusGroups,
      transferTypeGroups,
      monthlyRows,
      channelSample,
      latestTransactions,
      latestUsers,
      latestAgents,
    ] = await Promise.all([
      prisma.customer.count(),
      prisma.agent.count(),
      prisma.agent.count({ where: { status: 'approved' } }),
      prisma.agent.count({
        where: { status: { in: ['pending', 'profile_completed'] } },
      }),
      prisma.remittanceTransaction.count({
        where: { createdAt: { gte: monthStart } },
      }),
      prisma.remittanceTransaction.groupBy({
        by: ['status'],
        _count: { _all: true },
        _sum: { sendAmount: true },
      }),
      prisma.remittanceTransaction.groupBy({
        by: ['transferType'],
        _sum: { sendAmount: true },
      }),
      prisma.$queryRaw`
        SELECT
          to_char("createdAt", 'YYYY-MM') AS month,
          COALESCE(SUM("sendAmount"), 0)::float AS amount,
          COUNT(*)::int AS count
        FROM "remittance_transactions"
        WHERE "createdAt" >= ${analyticsStart}
        GROUP BY 1
        ORDER BY 1
      `,
      prisma.remittanceTransaction.findMany({
        where: { createdAt: { gte: channelSampleStart } },
        take: 2000,
        orderBy: { createdAt: 'desc' },
        select: {
          sendAmount: true,
          receiveAmount: true,
          transferType: true,
          recipientInfo: true,
          paymentFieldValues: true,
          createdAt: true,
        },
      }),
      prisma.remittanceTransaction.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          sendAmount: true,
          receiveAmount: true,
          transferType: true,
          status: true,
          createdAt: true,
          customer: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      }),
      prisma.customer.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          telephone: true,
          country: true,
          residentCountry: true,
          createdAt: true,
        },
      }),
      prisma.agent.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          username: true,
          businessName: true,
          status: true,
          updatedAt: true,
          createdAt: true,
        },
      }),
    ]);

    const volume = {
      airtime: 0,
      bankTransfer: 0,
      cashPickup: 0,
      mobileMoney: 0,
    };

    let pendingSendMoney = 0;
    let completedSendMoney = 0;
    const statusCounts = {};

    for (const row of statusGroups) {
      const status = normalizeStatus(row.status);
      const count = row._count?._all ?? 0;
      statusCounts[status] = count;
      if (PENDING_STATUSES.has(status)) pendingSendMoney += count;
      if (COMPLETED_STATUSES.has(status)) completedSendMoney += count;
    }

    for (const tx of channelSample) {
      const sendAmount = toNumber(tx.sendAmount);
      const channel = classifyChannel(tx);
      volume[channel] += sendAmount;
    }

    const transferTypeVolume = { bank: 0, wallet: 0 };
    for (const row of transferTypeGroups) {
      const key = String(row.transferType || 'bank').toLowerCase();
      const sum = toNumber(row._sum?.sendAmount);
      if (key === 'wallet') transferTypeVolume.wallet += sum;
      else transferTypeVolume.bank += sum;
    }

    if (volume.bankTransfer === 0 && volume.mobileMoney === 0) {
      volume.bankTransfer = transferTypeVolume.bank;
      volume.mobileMoney = transferTypeVolume.wallet;
    }

    const combinedVolume =
      volume.airtime + volume.bankTransfer + volume.cashPickup + volume.mobileMoney;

    const analyticsByMonth = new Map(
      (monthlyRows || []).map((row) => [
        row.month,
        { date: row.month, amount: toNumber(row.amount), count: Number(row.count) || 0 },
      ]),
    );

    const analyticsMonthKeys = buildRecentMonthKeys();
    const analytics = analyticsMonthKeys.map(
      (key) => analyticsByMonth.get(key) || { date: key, amount: 0, count: 0 },
    );

    const analyticsTotal = analytics.reduce((sum, row) => sum + row.amount, 0);

    const countryFlows = new Map();
    for (const tx of channelSample) {
      const pair = countryPairKey(tx);
      if (!pair) continue;
      const sendAmount = toNumber(tx.sendAmount);
      const receiveAmount = toNumber(tx.receiveAmount);
      const row = countryFlows.get(pair) || { country: pair, send: 0, receive: 0, net: 0 };
      row.send += sendAmount;
      row.receive += receiveAmount;
      row.net = row.send - row.receive;
      countryFlows.set(pair, row);
    }

    const countryFlowRows = [...countryFlows.values()]
      .sort((a, b) => b.send + b.receive - (a.send + a.receive))
      .slice(0, 12);

    const formatCustomerName = (customer) => {
      if (!customer) return 'Customer';
      const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim();
      return name || customer.email || 'Customer';
    };

    const formatAgentName = (agent) => {
      if (!agent) return 'Agent';
      const name = [agent.firstName, agent.lastName].filter(Boolean).join(' ').trim();
      return name || agent.businessName?.trim() || agent.email || 'Agent';
    };

    const formatAgentStatusLabel = (status) => {
      const s = String(status || 'pending').toLowerCase();
      if (s === 'approved') return 'Active';
      if (s === 'rejected') return 'Inactive';
      return 'Pending';
    };

    res.json({
      success: true,
      data: {
        overview: {
          totalUsers,
          totalAgents,
          activeAgents,
          pendingAgents,
          pendingTickets: 0,
          thisMonthTransactions,
        },
        volume: {
          ...volume,
          combinedVolume,
        },
        sendMoneyStatus: {
          pending: pendingSendMoney,
          completed: completedSendMoney,
        },
        analytics,
        analyticsSummary: {
          totalSendAmount: analyticsTotal,
        },
        countryFlows: countryFlowRows,
        latestTransactions: latestTransactions.map((tx) => ({
          id: tx.id,
          name: formatCustomerName(tx.customer),
          description:
            tx.transferType === 'wallet'
              ? 'Mobile wallet remittance'
              : 'Bank remittance transfer',
          smallAmount: `$${toNumber(tx.receiveAmount).toFixed(2)}`,
          amount: `$${toNumber(tx.sendAmount).toFixed(2)}`,
          date: tx.createdAt,
          status: tx.status,
        })),
        latestUsers: latestUsers.map((u) => ({
          id: u.id,
          name: formatCustomerName(u),
          contact: `${u.email || '—'} - ${u.phone || u.telephone || 'N/A'}`,
          country: u.country || u.residentCountry || 'N/A',
        })),
        latestAgents: latestAgents.map((a) => ({
          id: a.id,
          name: formatAgentName(a),
          contact: `${a.email || '—'} - ${a.phone || 'N/A'}`,
          username: a.username
            ? a.username.startsWith('@')
              ? a.username
              : `@${a.username}`
            : '—',
          status: formatAgentStatusLabel(a.status),
        })),
        statusBreakdown: Object.entries(statusCounts).map(([name, value]) => ({
          name: name.charAt(0).toUpperCase() + name.slice(1),
          value,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to load dashboard stats',
    });
  }
};
