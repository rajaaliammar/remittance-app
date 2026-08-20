import prisma from '../utils/prisma.js';
import { sanitizeLogoField } from '../utils/imageFieldSanitizer.js';
import {
  shapeCountryFromCountriesDev,
  countryMatchesContinent,
  dialCodeFromCallingCodes,
  normalizeStoredPhoneCode,
} from '../utils/countryMeta.js';
import {
  searchCountriesByName,
  fetchCountryByName,
  fetchCountryByAlpha2,
  fetchAllCountries,
} from '../utils/countriesExternalApi.js';
import {
  CacheKeys,
  REFERENCE_TTL_SECONDS,
  getOrSet,
  invalidateCountriesCache,
} from '../utils/cache.js';

/**
 * Country metadata: https://countries.dev (free, no key).
 * Prefer `iso2` when possible — alpha lookup avoids ambiguous names and fixes NANP dial codes.
 * REST Countries v3.1 is deprecated and returns empty/error payloads.
 */
const fetchCountryFromAPI = async (countryName) => {
  try {
    const country = await fetchCountryByName(countryName);
    if (!country) return null;
    return shapeCountryFromCountriesDev(country, countryName);
  } catch (error) {
    console.error('Error fetching country from API:', error);
    return null;
  }
};

const fetchCountryByIso2 = async (iso2) => {
  try {
    const code = String(iso2).trim().toUpperCase();
    if (code.length !== 2) return null;

    const country = await fetchCountryByAlpha2(code);
    if (!country) return null;

    return shapeCountryFromCountriesDev(country, code);
  } catch (error) {
    console.error('Error fetching country by ISO2:', error);
    return null;
  }
};

// Search countries from countries.dev (optional continent filter)
const searchCountriesFromAPI = async (query, continent = null) => {
  try {
    let countries = await searchCountriesByName(query);

    if (continent) {
      countries = countries.filter((country) =>
        countryMatchesContinent(country, continent)
      );
    }

    return countries.map((country) => {
      const shaped = shapeCountryFromCountriesDev(country);
      return {
        name: shaped.name,
        iso2: shaped.iso2,
        iso3: shaped.iso3,
        phoneCode: shaped.phoneCode,
        flag: shaped.flag,
        continent: shaped.continent,
      };
    });
  } catch (error) {
    console.error('Error searching countries from API:', error);
    return [];
  }
};

// Get all countries (supports popular=true to return only popular/flagged countries for app)
export const getAllCountries = async (req, res) => {
  try {
    const { search, status, continentId, popular } = req.query;
    const cacheKey = CacheKeys.countriesList({ search, status, continentId, popular });

    const countries = await getOrSet(cacheKey, REFERENCE_TTL_SECONDS, async () => {
      const where = {};
      if (status) {
        where.status = status;
      }
      if (continentId) {
        where.continentId = continentId;
      }
      if (search) {
        where.name = { contains: search, mode: 'insensitive' };
      }
      if (popular === 'true' || popular === '1') {
        where.isPopular = true;
      }

      return prisma.country.findMany({
        where,
        include: {
          continent: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    res.json({ success: true, data: countries });
  } catch (error) {
    console.error('Error fetching countries:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get country by ID
export const getCountryById = async (req, res) => {
  try {
    const { id } = req.params;

    const country = await prisma.country.findUnique({
      where: { id },
      include: {
        continent: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    if (!country) {
      return res.status(404).json({ success: false, message: 'Country not found' });
    }

    res.json({
      success: true,
      data: country
    });
  } catch (error) {
    console.error('Error fetching country:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get country suggestions from API
export const getCountrySuggestions = async (req, res) => {
  try {
    const { query, continent } = req.query;

    if (!query || query.trim().length < 2) {
      return res.json({ success: true, data: [] });
    }

    const suggestions = await searchCountriesFromAPI(query.trim(), continent || null);
    res.json({ success: true, data: suggestions });
  } catch (error) {
    console.error('Error fetching country suggestions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get all countries from countries.dev (third-party)
export const getAllCountriesFromAPI = async (req, res) => {
  try {
    const countries = await fetchAllCountries(
      'name,alpha2Code,alpha3Code,callingCodes,flags,currencies'
    );

    if (!Array.isArray(countries) || countries.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch countries from API',
      });
    }

    const formattedCountries = countries
      .map((country) => {
        const shaped = shapeCountryFromCountriesDev(country);
        return {
          name: shaped.name,
          iso2: shaped.iso2,
          iso3: shaped.iso3,
          phoneCode: shaped.phoneCode || dialCodeFromCallingCodes(country.callingCodes),
          flag: shaped.flag,
          currencyCode: shaped.currencyCode,
          currencyName: shaped.currencyName,
          currencySymbol: shaped.currencySymbol,
        };
      })
      .filter((country) => country.phoneCode && country.name)
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ success: true, data: formattedCountries });
  } catch (error) {
    console.error('Error fetching all countries from API:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get country details from API
export const getCountryDetails = async (req, res) => {
  try {
    const { countryName, iso2 } = req.query;

    if (!countryName && !iso2) {
      return res.status(400).json({
        success: false,
        message: 'Provide countryName and/or iso2 (ISO 3166-1 alpha-2, e.g. US). iso2 is recommended for accurate phone codes.',
      });
    }

    let countryData = null;
    if (iso2) {
      countryData = await fetchCountryByIso2(iso2);
    }
    if (!countryData && countryName) {
      countryData = await fetchCountryFromAPI(countryName);
    }

    if (!countryData) {
      return res.status(404).json({
        success: false,
        message: 'Country not found',
      });
    }

    res.json({ success: true, data: countryData });
  } catch (error) {
    console.error('Error fetching country details:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create new country
export const createCountry = async (req, res) => {
  try {
    const {
      continentId,
      name,
      iso2,
      iso3,
      phoneCode,
      currencyName,
      currencyCode,
      currencyRate,
      currencySymbol,
      currencyNativeSymbol,
      flag,
      isPopular,
      status,
      sendable,
      receivable,
      services
    } = req.body;

    if (!continentId || !name || !iso2 || !iso3) {
      return res.status(400).json({ 
        success: false, 
        message: 'Continent, name, ISO2, and ISO3 are required' 
      });
    }

    // Check if continent exists
    const continent = await prisma.continent.findUnique({
      where: { id: continentId }
    });

    if (!continent) {
      return res.status(404).json({ 
        success: false, 
        message: 'Continent not found' 
      });
    }

    // Check if country already exists
    const existingCountry = await prisma.country.findFirst({
      where: {
        OR: [
          { iso2 },
          { iso3 },
          { name: { equals: name, mode: 'insensitive' } }
        ]
      }
    });

    if (existingCountry) {
      return res.status(409).json({ 
        success: false, 
        message: 'Country with this ISO code or name already exists' 
      });
    }

    const createData = {
      continentId,
      name: name.trim(),
      iso2: iso2.toUpperCase(),
      iso3: iso3.toUpperCase(),
      phoneCode: normalizeStoredPhoneCode(phoneCode || ''),
      currencyName: currencyName || '',
      currencyCode: currencyCode || '',
      currencyRate: currencyRate || null,
      currencySymbol: currencySymbol || null,
      currencyNativeSymbol: currencyNativeSymbol || null,
      flag: flag ? await sanitizeLogoField(flag, 'countries') : null,
      status: status || 'Active',
      sendable: sendable || false,
      receivable: receivable || false,
      services: services || null
    };

    // Add isPopular if provided, default to false
    if (isPopular !== undefined) {
      createData.isPopular = Boolean(isPopular);
    } else {
      createData.isPopular = false;
    }

    let country;
    try {
      country = await prisma.country.create({
        data: createData,
        include: {
          continent: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });
    } catch (error) {
      if (error.message && error.message.includes('isPopular') && error.message.includes('Unknown argument')) {
        console.error('Prisma client out of sync. isPopular field not recognized.');
        console.error('Please run: npx prisma migrate deploy && npx prisma generate');
        return res.status(500).json({
          success: false,
          error: 'Database schema out of sync. Please run `npx prisma migrate deploy` and `npx prisma generate` in the backend directory.',
          details: error.message
        });
      }
      throw error; // Re-throw other errors
    }

    res.status(201).json({
      success: true,
      message: 'Country created successfully',
      data: country
    });
    void invalidateCountriesCache();
  } catch (error) {
    console.error('Error creating country:', error);

    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'Country with this ISO code already exists',
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Update country
export const updateCountry = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      continentId,
      name,
      iso2,
      iso3,
      phoneCode,
      currencyName,
      currencyCode,
      currencyRate,
      currencySymbol,
      currencyNativeSymbol,
      flag,
      isPopular,
      status,
      sendable,
      receivable,
      services
    } = req.body;

    const country = await prisma.country.findUnique({
      where: { id }
    });

    if (!country) {
      return res.status(404).json({ 
        success: false, 
        message: 'Country not found' 
      });
    }

    // Check if continent exists if being updated
    if (continentId && continentId !== country.continentId) {
      const continent = await prisma.continent.findUnique({
        where: { id: continentId }
      });

      if (!continent) {
        return res.status(404).json({ 
          success: false, 
          message: 'Continent not found' 
        });
      }
    }

    // Check for duplicate ISO codes if being changed
    if (iso2 && iso2 !== country.iso2) {
      const existing = await prisma.country.findUnique({
        where: { iso2: iso2.toUpperCase() }
      });
      if (existing) {
        return res.status(409).json({ 
          success: false, 
          message: 'Country with this ISO2 code already exists' 
        });
      }
    }

    if (iso3 && iso3 !== country.iso3) {
      const existing = await prisma.country.findUnique({
        where: { iso3: iso3.toUpperCase() }
      });
      if (existing) {
        return res.status(409).json({ 
          success: false, 
          message: 'Country with this ISO3 code already exists' 
        });
      }
    }

    const updateData = {};
    if (continentId !== undefined) updateData.continentId = continentId;
    if (name !== undefined) updateData.name = name.trim();
    if (iso2 !== undefined) updateData.iso2 = iso2.toUpperCase();
    if (iso3 !== undefined) updateData.iso3 = iso3.toUpperCase();
    if (phoneCode !== undefined) updateData.phoneCode = normalizeStoredPhoneCode(phoneCode);
    if (currencyName !== undefined) updateData.currencyName = currencyName;
    if (currencyCode !== undefined) updateData.currencyCode = currencyCode;
    if (currencyRate !== undefined) updateData.currencyRate = currencyRate;
    if (currencySymbol !== undefined) updateData.currencySymbol = currencySymbol;
    if (currencyNativeSymbol !== undefined) updateData.currencyNativeSymbol = currencyNativeSymbol;
    if (flag !== undefined) updateData.flag = await sanitizeLogoField(flag, 'countries');
    if (status !== undefined) updateData.status = status;
    if (isPopular !== undefined) updateData.isPopular = Boolean(isPopular);
    if (sendable !== undefined) updateData.sendable = sendable;
    if (receivable !== undefined) updateData.receivable = receivable;
    if (services !== undefined) updateData.services = services;

    let updatedCountry;
    try {
      updatedCountry = await prisma.country.update({
        where: { id },
        data: updateData,
        include: {
          continent: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });
    } catch (error) {
      if (error.message && error.message.includes('isPopular') && error.message.includes('Unknown argument')) {
        console.error('Prisma client out of sync. isPopular field not recognized.');
        console.error('Please run: npx prisma migrate deploy && npx prisma generate');
        return res.status(500).json({
          success: false,
          error: 'Database schema out of sync. Please run `npx prisma migrate deploy` and `npx prisma generate` in the backend directory.',
          details: error.message
        });
      }
      throw error; // Re-throw other errors
    }

    res.json({
      success: true,
      message: 'Country updated successfully',
      data: updatedCountry
    });
    void invalidateCountriesCache();
  } catch (error) {
    console.error('Error updating country:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Country not found' 
      });
    }

    if (error.code === 'P2002') {
      return res.status(409).json({ 
        success: false, 
        message: 'Country with this ISO code already exists' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete country
export const deleteCountry = async (req, res) => {
  try {
    const { id } = req.params;

    const country = await prisma.country.findUnique({
      where: { id }
    });

    if (!country) {
      return res.status(404).json({ 
        success: false, 
        message: 'Country not found' 
      });
    }

    await prisma.country.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Country deleted successfully',
    });
    void invalidateCountriesCache();
  } catch (error) {
    console.error('Error deleting country:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Country not found' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

