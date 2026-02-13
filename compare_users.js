import prisma from './src/utils/prisma.js';

async function main() {
    try {
        const ids = ['cmlgwxhhc0000j1r7g6pg92zq', 'cmlhaa2ug0000nnkwumu4gub7'];
        const customers = await prisma.customer.findMany({
            where: { id: { in: ids } },
            select: {
                id: true,
                phone: true,
                email: true,
                firstName: true,
                lastName: true,
                kycData: true
            }
        });

        console.log('--- Customer Comparison ---');
        customers.forEach(c => {
            console.log(`ID: ${c.id}`);
            console.log(`Name: ${c.firstName} ${c.lastName}`);
            console.log(`Phone: ${c.phone}`);
            console.log(`Email: ${c.email}`);
            console.log(`Has KYC: ${c.kycData != null}`);
            if (c.kycData) {
                const docs = Array.isArray(c.kycData) ? c.kycData : [c.kycData];
                console.log(`KYC Count: ${docs.length}`);
            }
            console.log('---------------------------');
        });

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

main();
