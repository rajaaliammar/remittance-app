const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('Admin@123', 10);
  const admin = await prisma.backofficeUser.upsert({
    where: { email: 'admin@onezapay.com' },
    update: { password: hashedPassword, status: 'ACTIVE' },
    create: {
      email: 'admin@onezapay.com',
      username: 'admin',
      name: 'Super Admin',
      password: hashedPassword,
      status: 'ACTIVE',
      role: 'SUPER_ADMIN'
    }
  });
  console.log('? Admin User Created/Updated:', admin.email);
}

main()
  .catch((e) => console.error('? Error:', e))
  .finally(() => prisma.\());
