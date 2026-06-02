import prisma from './prisma.js';

/**
 * Resolve a portal assigned-country row to a Country record.
 * countryCode is typically ISO2 from Remittance Bank modal.
 */
export async function resolveCountryFromAssignment(assignment) {
  const code = assignment?.countryCode != null ? String(assignment.countryCode).trim() : '';
  const name = assignment?.country != null ? String(assignment.country).trim() : '';
  if (!code && !name) return null;

  const upper = code.toUpperCase();

  if (code.length > 10) {
    const byId = await prisma.country.findUnique({ where: { id: code } });
    if (byId) return byId;
  }

  if (upper.length === 2) {
    const byIso2 = await prisma.country.findUnique({ where: { iso2: upper } });
    if (byIso2) return byIso2;
  }

  if (upper.length === 3) {
    const byIso3 = await prisma.country.findUnique({ where: { iso3: upper } });
    if (byIso3) return byIso3;
  }

  if (code) {
    const byCurrency = await prisma.country.findFirst({
      where: { currencyCode: { equals: upper, mode: 'insensitive' } },
    });
    if (byCurrency) return byCurrency;
  }

  if (name) {
    const byName = await prisma.country.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (byName) return byName;
  }

  return null;
}

/**
 * Keep Manage Country → Bank Transfer services in sync with remittance bank assignedCountries.
 * Creates or updates country_services rows linked via remittanceBankId.
 */
export async function syncBankToCountryServices(bank) {
  if (!bank?.id || !bank?.name) return;

  const bankId = bank.id;
  const bankName = String(bank.name).trim();
  const bankActive = bank.active !== false;
  const logo = bank.logo && String(bank.logo).trim() ? String(bank.logo).trim() : null;

  let assignments = bank.assignedCountries;
  if (!assignments) {
    assignments = [];
  } else if (!Array.isArray(assignments) && typeof assignments === 'string') {
    try {
      const parsed = JSON.parse(assignments);
      assignments = Array.isArray(parsed) ? parsed : [];
    } catch {
      assignments = [];
    }
  }

  const resolvedCountryIds = new Set();

  for (const assignment of assignments) {
    const country = await resolveCountryFromAssignment(assignment);
    if (!country) {
      console.warn(
        '[syncBankToCountryServices] Skipping unknown country assignment:',
        assignment?.countryCode || assignment?.country
      );
      continue;
    }

    const assignmentActive =
      String(assignment?.status ?? 'Active').toLowerCase() === 'active';
    const serviceStatus = bankActive && assignmentActive ? 'Active' : 'Inactive';

    resolvedCountryIds.add(country.id);

    const existing = await prisma.countryService.findFirst({
      where: {
        countryId: country.id,
        serviceType: 'Bank Transfer',
        remittanceBankId: bankId,
      },
    });

    if (existing) {
      const updateData = {
        name: bankName,
        status: serviceStatus,
      };
      if (logo && !existing.displayImage) {
        updateData.displayImage = logo;
      }
      await prisma.countryService.update({
        where: { id: existing.id },
        data: updateData,
      });
    } else {
      await prisma.countryService.create({
        data: {
          countryId: country.id,
          name: bankName,
          serviceType: 'Bank Transfer',
          status: serviceStatus,
          serviceTypeMode: 'Automatic',
          remittanceBankId: bankId,
          displayImage: logo,
        },
      });
    }
  }

  const linkedServices = await prisma.countryService.findMany({
    where: {
      remittanceBankId: bankId,
      serviceType: 'Bank Transfer',
    },
    select: { id: true, countryId: true },
  });

  for (const service of linkedServices) {
    if (!resolvedCountryIds.has(service.countryId)) {
      await prisma.countryService.update({
        where: { id: service.id },
        data: { status: 'Inactive' },
      });
    }
  }

  if (!bankActive) {
    await prisma.countryService.updateMany({
      where: { remittanceBankId: bankId, serviceType: 'Bank Transfer' },
      data: { status: 'Inactive' },
    });
  }
}
