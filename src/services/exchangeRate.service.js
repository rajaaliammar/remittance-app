import prisma from '../utils/prisma.js';
import { CacheKeys, EXCHANGE_RATE_TTL_SECONDS, getOrSet } from '../utils/cache.js';
import {
  DEFAULT_BANKS_BY_ISO2,
  resolveCountry,
} from '../utils/resolveCountry.js';

function parsePositiveRate(value) {
  const n = parseFloat(String(value ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseAssignedCountries(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function countryMatchesAssignment(ac, country) {
  const iso2 = String(country.iso2 || '').toUpperCase();
  const iso3 = String(country.iso3 || '').toUpperCase();
  const cur =
    country.currencyCode != null
      ? String(country.currencyCode).trim().toUpperCase()
      : '';
  const code = ac?.countryCode != null ? String(ac.countryCode).trim().toUpperCase() : '';
  const name = ac?.country != null ? String(ac.country).trim() : '';
  return (
    code === iso2 ||
    code === iso3 ||
    (cur && code === cur) ||
    ac.countryCode === country.id ||
    name.toLowerCase() === String(country.name || '').trim().toLowerCase() ||
    name.toUpperCase() === iso2
  );
}

/** Prefer assignment dollarPrice for this country, then bank.dollarRate. */
function bankRateForCountry(bank, country) {
  if (!bank) return null;
  const assigned = parseAssignedCountries(bank.assignedCountries);
  const row = assigned.find(
    (ac) =>
      countryMatchesAssignment(ac, country) &&
      String(ac?.status ?? 'Active').toLowerCase() === 'active'
  );
  if (row?.dollarPrice != null && String(row.dollarPrice).trim() !== '') {
    const fromAssignment = parsePositiveRate(row.dollarPrice);
    if (fromAssignment) return fromAssignment;
  }
  return parsePositiveRate(bank.dollarRate);
}

function walletRateForCountry(wallet, country) {
  const assigned = parseAssignedCountries(wallet.assignedCountries);
  const row = assigned.find(
    (ac) =>
      countryMatchesAssignment(ac, country) &&
      String(ac?.status ?? 'Active').toLowerCase() === 'active'
  );
  if (row?.dollarPrice != null && String(row.dollarPrice).trim() !== '') {
    return parsePositiveRate(row.dollarPrice);
  }
  return parsePositiveRate(country.currencyRate);
}

function demoBankRate(bankId, country) {
  const iso2 = String(country.iso2 || '').toUpperCase();
  const demos = DEFAULT_BANKS_BY_ISO2[iso2] || [];
  const demo = demos.find((b) => b.id === String(bankId));
  if (!demo) return null;
  return parsePositiveRate(demo.dollarRate) || parsePositiveRate(country.currencyRate);
}

/**
 * Resolve the locked effective FX rate for a send (same rules as GET country info).
 * Accepts DB country id, ISO2/ISO3, or fallback-* ids (via resolveCountry).
 * @returns {Promise<{ effectiveRate: number, rateSource: string, lockedAt: string, country: object }|null>}
 */
export async function resolveEffectiveExchangeRate({
  countryId,
  bankId = null,
  walletId = null,
  serviceId = null,
} = {}) {
  if (!countryId) return null;

  const cacheKey = CacheKeys.exchangeRate({ countryId, bankId, walletId, serviceId });
  const lockedAt = new Date().toISOString();

  const payload = await getOrSet(cacheKey, EXCHANGE_RATE_TTL_SECONDS, async () => {
    const { country, virtual } = await resolveCountry(prisma, countryId);

    if (!country) return null;

    let effectiveRate = parsePositiveRate(country.currencyRate);
    let rateSource = 'country';

    // Country services link to a remittance bank — use that bank's country-specific rate
    if (serviceId && !virtual) {
      const svc = await prisma.countryService.findFirst({
        where: { id: String(serviceId), countryId: country.id, status: 'Active' },
        include: {
          remittanceBank: {
            select: { id: true, name: true, dollarRate: true, assignedCountries: true },
          },
        },
      });
      const svcBankRate = bankRateForCountry(svc?.remittanceBank, country);
      if (svcBankRate) {
        effectiveRate = svcBankRate;
        rateSource = 'bank';
      }
    }

    if (bankId) {
      if (!virtual && !String(bankId).startsWith('demo-')) {
        const bank = await prisma.remittanceBank.findUnique({
          where: { id: String(bankId) },
          select: { id: true, name: true, dollarRate: true, assignedCountries: true, active: true },
        });
        const bankRate = bankRateForCountry(bank, country);
        if (bankRate) {
          effectiveRate = bankRate;
          rateSource = 'bank';
        }
      } else {
        const demoRate = demoBankRate(bankId, country);
        if (demoRate) {
          effectiveRate = demoRate;
          rateSource = 'bank';
        }
      }
    }

    if (walletId && !virtual) {
      const wallet = await prisma.remittanceWallet.findUnique({
        where: { id: String(walletId) },
        select: { id: true, name: true, assignedCountries: true, active: true },
      });
      const walletRate = wallet ? walletRateForCountry(wallet, country) : null;
      if (walletRate) {
        effectiveRate = walletRate;
        rateSource = 'wallet';
      }
    }

    if (effectiveRate == null) {
      const countryOnly = parsePositiveRate(country.currencyRate);
      if (countryOnly) {
        effectiveRate = countryOnly;
        rateSource = 'country';
      }
    }

    return {
      ...country,
      effectiveRate: effectiveRate != null ? String(effectiveRate) : null,
      rateSource,
    };
  });

  if (!payload?.effectiveRate) return null;

  const effectiveRate = parsePositiveRate(payload.effectiveRate);
  if (effectiveRate == null) return null;

  return {
    effectiveRate,
    rateSource: payload.rateSource || 'country',
    lockedAt,
    country: payload,
  };
}

export default { resolveEffectiveExchangeRate };
