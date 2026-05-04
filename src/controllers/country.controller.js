import prisma from '../utils/prisma.js';
import {
  shapeCountryFromRestCountry,
  dialCodeFromRestCountriesIdd,
  normalizeStoredPhoneCode,
} from '../utils/countryMeta.js';

/**
 * Country metadata: https://restcountries.com/ (free, no key).
 * Prefer `iso2` when possible — alpha lookup avoids ambiguous names and fixes NANP dial codes.
 */
const fetchCountryFromAPI = async (countryName) => {
  try {
    const response = await fetch(
      `https://restcountries.com/v3.1/name/${encodeURIComponent(countryName)}?fullText=true&fields=name,cca2,cca3,idd,currencies,flags,continents`
    );
    const countries = await response.json();

    if (countries.status === 404 || !Array.isArray(countries) || countries.length === 0) {
      return null;
    }

    const want = countryName.trim().toLowerCase();
    let country = countries[0];
    if (countries.length > 1) {
      const exact =
        countries.find((c) => (c.name?.common || '').toLowerCase() === want) ||
        countries.find((c) => (c.name?.official || '').toLowerCase() === want);
      if (exact) country = exact;
    }

    return shapeCountryFromRestCountry(country, countryName);
  } catch (error) {
    console.error('Error fetching country from API:', error);
    return null;
  }
};

const fetchCountryByIso2 = async (iso2) => {
  try {
    const code = String(iso2).trim().toUpperCase();
    if (code.length !== 2) return null;

    const response = await fetch(
      `https://restcountries.com/v3.1/alpha/${encodeURIComponent(code)}?fields=name,cca2,cca3,idd,currencies,flags,continents`
    );
    const data = await response.json();

    if (data?.status === 404 || !data || data.cca2 == null) {
      return null;
    }

    return shapeCountryFromRestCountry(data, code);
  } catch (error) {
    console.error('Error fetching country by ISO2:', error);
    return null;
  }
};

// Search countries from REST Countries API
const searchCountriesFromAPI = async (query, continent = null) => {
  try {
    const url = `https://restcountries.com/v3.1/name/${encodeURIComponent(query)}?fields=name,cca2,cca3,idd,flags,continents`;
    const response = await fetch(url);
    let countries = await response.json();

    if (countries.status === 404) {
      return [];
    }

    // Filter by continent if provided
    if (continent) {
      countries = countries.filter(country => 
        country.continents && country.continents.includes(continent)
      );
    }

    return countries.map((country) => ({
      name: country.name?.common || '',
      iso2: country.cca2 || '',
      iso3: country.cca3 || '',
      phoneCode: dialCodeFromRestCountriesIdd(country.idd),
      flag: country.flags?.png || country.flags?.svg || '',
      continent: country.continents?.[0] || '',
    }));
  } catch (error) {
    console.error('Error searching countries from API:', error);
    return [];
  }
};

// Get all countries (supports popular=true to return only popular/flagged countries for app)
export const getAllCountries = async (req, res) => {
  try {
    const { search, status, continentId, popular } = req.query;
    
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

    const countries = await prisma.country.findMany({
      where,
      include: {
        continent: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
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

// Get all countries from REST Countries API (third-party)
export const getAllCountriesFromAPI = async (req, res) => {
  try {
    const response = await fetch('https://restcountries.com/v3.1/all?fields=name,cca2,cca3,idd,flags,currencies');
    const countries = await response.json();

    if (!Array.isArray(countries)) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch countries from API' 
      });
    }

    const formattedCountries = countries
      .filter(country => {
        // Only include countries that have calling codes
        const callingCodes = country.idd || {};
        return callingCodes.root || (callingCodes.suffixes && callingCodes.suffixes.length > 0);
      })
      .map((country) => {
        const phoneCode = dialCodeFromRestCountriesIdd(country.idd);

        const currencies = country.currencies || {};
        const currencyCode = Object.keys(currencies)[0] || '';
        const currency = currencies[currencyCode] || {};

        return {
          name: country.name?.common || '',
          iso2: country.cca2 || '',
          iso3: country.cca3 || '',
          phoneCode,
          flag: country.flags?.png || country.flags?.svg || '',
          currencyCode: currencyCode,
          currencyName: currency.name || '',
          currencySymbol: currency.symbol || '',
        };
      })
      .filter(country => country.phoneCode && country.name) // Only include countries with phone codes
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
      flag: flag || null,
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
  } catch (error) {
    console.error('Error creating country:', error);
    
    if (error.code === 'P2002') {
      return res.status(409).json({ 
        success: false, 
        message: 'Country with this ISO code already exists' 
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
    if (flag !== undefined) updateData.flag = flag;
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
      message: 'Country deleted successfully'
    });
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

