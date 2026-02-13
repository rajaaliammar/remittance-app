import { calculateTransactionFee } from '../utils/chargeUtils.js';

/**
 * Calculate transaction charge based on amount, country, and transaction type.
 * Integrates CountryCharge (base fee) and TaxFee (additional portal settings).
 */
export const calculateCharge = async (req, res) => {
    try {
        const { amount, countryId, transactionType, currency = 'USD', transferType } = req.body;

        if (amount == null || isNaN(parseFloat(amount))) {
            return res.status(400).json({
                success: false,
                message: 'Valid amount is required'
            });
        }

        const { totalCharge, breakdown, baseCharge, tax, fee } = await calculateTransactionFee({
            amount,
            countryId,
            transferType: transferType || null
        });

        res.json({
            success: true,
            data: {
                amount: parseFloat(amount),
                charge: totalCharge,
                breakdown,
                baseCharge,
                tax,
                fee,
                currency
            }
        });

    } catch (error) {
        console.error('Error calculating charge:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to calculate charge',
            error: error.message
        });
    }
};
