import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create super admin
  const hashedPassword = await bcrypt.hash('admin', 10);
  const inviteToken = randomBytes(32).toString('hex');
  const inviteTokenExp = new Date();
  inviteTokenExp.setFullYear(inviteTokenExp.getFullYear() + 1); // Never expires for super admin

  const superAdmin = await prisma.backofficeUser.upsert({
    where: { email: 'admin@brandpay.com' },
    update: {
      username: 'admin',
      password: hashedPassword,
      status: 'approved',
      isSuperAdmin: true,
      approvedAt: new Date(),
      approvedBy: 'system',
      profileCompletedAt: new Date()
    },
    create: {
      email: 'admin@brandpay.com',
      username: 'admin',
      firstName: 'Super',
      lastName: 'Admin',
      password: hashedPassword,
      inviteToken,
      inviteTokenExp,
      status: 'approved',
      isSuperAdmin: true,
      invitedBy: 'system',
      approvedAt: new Date(),
      approvedBy: 'system',
      profileCompletedAt: new Date()
    }
  });

  console.log('✅ Super admin created:', superAdmin.email);
  console.log('   Username: admin');
  console.log('   Password: admin');

  // Create default services
  const defaultServices = [
    { name: 'Airtime', status: 'Active' },
    { name: 'Mobile Money Transfer', status: 'Active' },
    { name: 'Bank Transfer', status: 'Active' },
    { name: 'Cash Pick-Up', status: 'Active' },
  ];

  for (const serviceData of defaultServices) {
    const existingService = await prisma.service.findUnique({
      where: { name: serviceData.name },
    });

    if (!existingService) {
      await prisma.service.create({
        data: serviceData,
      });
      console.log(`✅ Service created: ${serviceData.name}`);
    } else {
      console.log(`ℹ️ Service already exists: ${serviceData.name}`);
    }
  }

  // Create default purposes
  const defaultPurposes = [
    { name: 'Payment of services or Invoice', status: 'Active' },
    { name: 'Property or Large purchase', status: 'Active' },
    { name: 'School fees', status: 'Active' },
  ];

  for (const purposeData of defaultPurposes) {
    const existingPurpose = await prisma.purpose.findUnique({
      where: { name: purposeData.name },
    });

    if (!existingPurpose) {
      await prisma.purpose.create({
        data: purposeData,
      });
      console.log(`✅ Purpose created: ${purposeData.name}`);
    } else {
      console.log(`ℹ️ Purpose already exists: ${purposeData.name}`);
    }
  }

  // Create default source of funds
  const defaultSourceOfFunds = [
    { name: 'Pension/Retirement', status: 'Active' },
    { name: 'Government Assistance', status: 'Active' },
    { name: 'Freelance/Contractual Income', status: 'Active' },
  ];

  for (const sourceData of defaultSourceOfFunds) {
    const existingSource = await prisma.sourceOfFund.findUnique({
      where: { name: sourceData.name },
    });

    if (!existingSource) {
      await prisma.sourceOfFund.create({
        data: sourceData,
      });
      console.log(`✅ Source of fund created: ${sourceData.name}`);
    } else {
      console.log(`ℹ️ Source of fund already exists: ${sourceData.name}`);
    }
  }
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

