import prisma from './src/utils/prisma.js';

async function main() {
    try {
        // Find the account with phone 251998877 (bhj bhj from portal)
        const customer = await prisma.customer.findFirst({
            where: { phone: '251998877' },
            select: {
                id: true,
                phone: true,
                email: true,
                firstName: true,
                lastName: true,
                kycData: true
            }
        });

        if (!customer) {
            console.log('❌ No customer found with phone 251998877');
            process.exit(0);
        }

        console.log('--- Customer with Phone 251998877 ---');
        console.log('ID:', customer.id);
        console.log('Name:', customer.firstName, customer.lastName);
        console.log('Phone:', customer.phone);
        console.log('Email:', customer.email);
        console.log('Has KYC Data:', customer.kycData != null);

        if (customer.kycData) {
            const docs = Array.isArray(customer.kycData) ? customer.kycData : [customer.kycData];
            console.log('KYC Document Count:', docs.length);
            console.log('\nKYC Documents:');
            docs.forEach((doc, idx) => {
                console.log(`  ${idx + 1}. Type: ${doc.verificationType || doc.formName}, Status: ${doc.status}, ID: ${doc.id}`);
            });
        }
        console.log('--------------------------------------');

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

main();
