import prisma from './prisma.js';

/**
 * Utility to calculate transaction charge.
 * Used by both calculate-charge endpoint and transaction creation.
 * @param {Object} opts
 * @param {number} opts.amount - Transaction amount
 * @param {string} [opts.countryId] - Receiving country ID (for country-specific tax/fee)
 * @param {string} [opts.transferType] - "wallet" | "bank" — only TaxFees that apply to this transfer type (or "both") are included
 */
export const calculateTransactionFee = async ({ amount, countryId, transferType }) => {
    const amt = parseFloat(amount);
    let baseCharge = 0;
    let chargesBreakdown = [];

    // 1. Calculate Base Charge from CountryCharge (if countryId provided)
    if (countryId) {
        const countryCharge = await prisma.countryCharge.findUnique({
            where: { countryId }
        });

        if (countryCharge && Array.isArray(countryCharge.chargeLevels)) {
            // Find the applicable level based on amount
            // Logic: find a level where amt is within range.
            // For now, let's just find the level where amount (min) <= amt, assuming they are ordered.
            const levels = countryCharge.chargeLevels
                .map(l => ({ ...l, amount: parseFloat(l.amount), charge: parseFloat(l.charge) }))
                .sort((a, b) => b.amount - a.amount); // Sort descending to find the highest match below amt

            const level = levels.find(l => l.amount <= amt);

            if (level) {
                if (level.type === 'fixed') {
                    baseCharge = level.charge;
                } else if (level.type === 'percent') {
                    baseCharge = (amt * level.charge) / 100;
                }
                chargesBreakdown.push({
                    name: 'Base Charge',
                    type: 'Fee',
                    value: level.charge,
                    valueType: level.type,
                    amount: baseCharge
                });
            }
        }
    }

    // 2. Fetch and apply Tax/Fees from Portal (TaxFee model) — filter by country and transfer type (wallet vs bank)
    const taxFeeWhere = {
        status: 'Active',
        ...(countryId && {
            countries: {
                some: { countryId }
            }
        }),
        // Apply to wallet, bank, or both: include if transferType is 'both' or matches current transfer
        ...(transferType && transferType !== 'both' && {
            OR: [
                { transferType: 'both' },
                { transferType }
            ]
        })
    };
    const taxFees = await prisma.taxFee.findMany({
        where: taxFeeWhere
    });

    let portalTaxTotal = 0;
    let portalFeeTotal = 0;

    taxFees.forEach(tf => {
        let calculatedAmount = 0;
        const value = parseFloat(tf.value);
        if (tf.valueType === 'fixed') {
            calculatedAmount = value;
        } else if (tf.valueType === 'percentage') {
            calculatedAmount = (amt * value) / 100;
        }

        chargesBreakdown.push({
            name: tf.name,
            type: tf.type,
            value: tf.value,
            valueType: tf.valueType,
            amount: calculatedAmount
        });

        if (tf.type === 'Tax') {
            portalTaxTotal += calculatedAmount;
        } else {
            portalFeeTotal += calculatedAmount;
        }
    });

    const totalCharge = baseCharge + portalTaxTotal + portalFeeTotal;

    return {
        totalCharge,
        breakdown: chargesBreakdown,
        baseCharge,
        tax: portalTaxTotal,
        fee: portalFeeTotal + baseCharge
    };
};
