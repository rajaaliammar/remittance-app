import prisma from './prisma.js';

export const DEFAULT_COUNTRY_DELIVERY_METHODS = [
  { name: 'Airtime', serviceType: 'Airtime' },
  { name: 'Mobile Money Transfer', serviceType: 'Mobile Money Transfer' },
  { name: 'Bank Transfer', serviceType: 'Bank Transfer' },
];

/**
 * Ensure every active receiver country has at least the standard delivery methods.
 * Called when GET services returns empty (legacy DBs without portal setup).
 */
export async function ensureDefaultCountryServices(countryId) {
  if (!countryId) return;

  const count = await prisma.countryService.count({ where: { countryId } });
  if (count > 0) return;

  const country = await prisma.country.findUnique({
    where: { id: countryId },
    select: { id: true, status: true, receivable: true },
  });

  if (!country || country.status !== 'Active') return;

  for (const method of DEFAULT_COUNTRY_DELIVERY_METHODS) {
    const exists = await prisma.countryService.findFirst({
      where: {
        countryId,
        serviceType: method.serviceType,
      },
    });
    if (!exists) {
      await prisma.countryService.create({
        data: {
          countryId,
          name: method.name,
          serviceType: method.serviceType,
          status: 'Active',
          serviceTypeMode: 'Automatic',
        },
      });
    }
  }
}

/** Seed delivery methods for all receivable countries (dev / migrate). */
export async function seedDefaultCountryServicesForAllCountries() {
  const countries = await prisma.country.findMany({
    where: { status: 'Active', receivable: true },
    select: { id: true },
  });

  for (const { id } of countries) {
    await ensureDefaultCountryServices(id);
  }
}
