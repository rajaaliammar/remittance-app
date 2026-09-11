import prisma from '../src/utils/prisma.js';

const ID = 'cmtxibai5000bt1fo8jr16thi';

const tx = await prisma.remittanceTransaction.findUnique({
  where: { id: ID },
  select: {
    id: true,
    status: true,
    riskScore: true,
    triggeredRules: true,
    complianceHoldAt: true,
    complianceReviewNote: true,
    sendAmount: true,
    receiveAmount: true,
    currency: true,
    customerId: true,
    createdAt: true,
    updatedAt: true,
    paymentFieldValues: true,
  },
});

console.log(JSON.stringify(tx, null, 2));

const jobs = await prisma.orchestrationJob.findMany({
  where: { remittanceTransactionId: ID },
  select: {
    id: true,
    status: true,
    message: true,
    result: true,
    createdAt: true,
    updatedAt: true,
  },
  take: 5,
}).catch((e) => ({ error: e.message }));

console.log('ORCHESTRATION_JOBS:', JSON.stringify(jobs, null, 2));

await prisma.$disconnect();
