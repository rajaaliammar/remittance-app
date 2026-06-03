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
      ? tx.paymentFieldValues : {};

  const sendCode = String(
    paymentFields.sendingCountryCode ||
      paymentFields.senderCountryCode ||
      recipientInfo.sendingCountryCode ||
      recipientInfo.senderCountry ||
      '—'
  )
    .trim()
    .toUpperCase()
    .slice(0, 3);

  const receiveCode = String(
    recipientInfo.receivingCountryCode ||
      recipientInfo.receivingBranchCountryCode ||
      recipientInfo.countryCode ||
      recipientInfo.country ||
      '—'
  )
    .trim()
    .toUpperCase()
    .slice(0, 3);

  if (sendCode === '—' && receiveCode === '—') return null;
  return `${sendCode}-${receiveCode}`;
};

/**
 * GET /api/dashboard/stats — portal dashboard metrics from live database.
 */
export const getDashboardStats = async (req, res) => {
  try {
    const monthStart = startOfMonth();

    const [
      totalUsers,
      totalAgents,
      activeAgents,
      pendingAgents,
      thisMonthTransactions,
      transactions,
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
      prisma.remittanceTransaction.findMany({
        select: {
          id: true,
          sendAmount: true,
          receiveAmount: true,
          transferType: true,
          status: true,
          recipientInfo: true,
          paymentFieldValues: true,
          createdAt: true,
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
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
    const analyticsByMonth = new Map();
    const countryFlows = new Map();

    for (const tx of transactions) {
      const status = normalizeStatus(tx.status);
      statusCounts[status] = (statusCounts[status] || 0) + 1;

      if (PENDING_STATUSES.has(status)) pendingSendMoney += 1;
      if (COMPLETED_STATUSES.has(status)) completedSendMoney += 1;

      const sendAmount = toNumber(tx.sendAmount);
      const channel = classifyChannel(tx);
      volume[channel] += sendAmount;

      const monthKey = monthKeyFromDate(tx.createdAt);
      if (monthKey) {
        const bucket = analyticsByMonth.get(monthKey) || { date: monthKey, amount: 0, count: 0 };
        bucket.amount += sendAmount;
        bucket.count += 1;
        analyticsByMonth.set(monthKey, bucket);
      }

      const pair = countryPairKey(tx);
      if (pair) {
        const receiveAmount = toNumber(tx.receiveAmount);
        const row = countryFlows.get(pair) || { country: pair, send: 0, receive: 0, net: 0 };
        row.send += sendAmount;
        row.receive += receiveAmount;
        row.net = row.send - row.receive;
        countryFlows.set(pair, row);
      }
    }

    const combinedVolume =
      volume.airtime + volume.bankTransfer + volume.cashPickup + volume.mobileMoney;

    const analyticsMonthKeys = buildRecentMonthKeys();
    const analytics = analyticsMonthKeys.map(
      (key) => analyticsByMonth.get(key) || { date: key, amount: 0, count: 0 }
    );

    const analyticsTotal = analytics.reduce((sum, row) => sum + row.amount, 0);

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
