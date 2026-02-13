import prisma from './prisma.js';

/**
 * Utility to calculate transaction charge.
 * Used by both calculate-charge endpoint and transaction creation.
 * @param {Object} opts
 * @param {number} opts.amount - Transaction amount
 * @param {string} [opts.countryId] - Receiving country ID
 * @param {string} [opts.transferType] - "bank" | "wallet" - which channel; used to filter tax/fee by applyTo
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
            const levels = countryCharge.chargeLevels
                .map(l => ({ ...l, amount: parseFloat(l.amount), charge: parseFloat(l.charge) }))
                .sort((a, b) => b.amount - a.amount);

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

    // 2. Fetch and apply Tax/Fees from Portal (TaxFee model)
    const taxFees = await prisma.taxFee.findMany({
        where: {
            status: 'Active',
            ...(countryId && {
                countries: {
                    some: { countryId }
                }
            })
        }
    });

    const channel = (transferType === 'wallet' || transferType === 'bank') ? transferType : null;

    let portalTaxTotal = 0;
    let portalFeeTotal = 0;

    taxFees.forEach(tf => {
        const applyTo = tf.applyTo || 'both';
        if (channel && applyTo !== 'both' && applyTo !== channel) {
            return;
        }

        let calculatedAmount = 0;
        let displayValue = tf.value;
        let displayValueType = tf.valueType;

        if (tf.valueType === 'dynamic' && Array.isArray(tf.tiers) && tf.tiers.length > 0) {
            const tier = tf.tiers.find(
                (t) => amt >= parseFloat(t.minAmount) && amt <= parseFloat(t.maxAmount)
            );
            if (tier) {
                const v = parseFloat(tier.value);
                if (tier.valueType === 'fixed') {
                    calculatedAmount = v;
                } else {
                    calculatedAmount = (amt * v) / 100;
                }
                displayValue = v;
                displayValueType = tier.valueType;
            }
        } else {
            const value = tf.value != null ? parseFloat(tf.value) : 0;
            if (tf.valueType === 'fixed') {
                calculatedAmount = value;
            } else if (tf.valueType === 'percentage') {
                calculatedAmount = (amt * value) / 100;
            }
        }

        chargesBreakdown.push({
            name: tf.name,
            type: tf.type,
            value: displayValue,
            valueType: displayValueType,
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
