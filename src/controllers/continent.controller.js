import prisma from '../utils/prisma.js';

// Standard list of continents as fallback
const STANDARD_CONTINENTS = [
  'Africa',
  'Antarctica',
  'Asia',
  'Europe',
  'North America',
  'South America',
  'Oceania',
  'Australia'
];

// Fetch continents from REST Countries API
const fetchContinentsFromAPI = async () => {
  try {
    const response = await fetch('https://restcountries.com/v3.1/all?fields=continents');
    const countries = await response.json();
    
    // Extract unique continents
    const continentSet = new Set();
    countries.forEach(country => {
      if (country.continents && Array.isArray(country.continents)) {
        country.continents.forEach(continent => continentSet.add(continent));
      }
    });
    
    return Array.from(continentSet).sort();
  } catch (error) {
    console.error('Error fetching continents from API:', error);
    // Return standard list as fallback
    return STANDARD_CONTINENTS;
  }
};

// Get all continents
export const getAllContinents = async (req, res) => {
  try {
    const { search, status } = req.query;
    
    const where = {};
    if (status) {
      where.status = status;
    }
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const continents = await prisma.continent.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    // Format response with serial numbers
    const formattedContinents = continents.map((continent, index) => ({
      id: continent.id,
      key: continent.id,
      sl: index + 1,
      name: continent.name,
      status: continent.status,
      createdAt: continent.createdAt,
      updatedAt: continent.updatedAt
    }));

    res.json({ success: true, data: formattedContinents });
  } catch (error) {
    console.error('Error fetching continents:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get continent suggestions (for autocomplete)
export const getContinentSuggestions = async (req, res) => {
  try {
    const { query } = req.query;

    // Fetch continents from REST Countries API
    const apiContinents = await fetchContinentsFromAPI();
    
    if (!query || query.trim().length === 0) {
      // Also include database continents
      const dbContinents = await prisma.continent.findMany({
        select: { name: true },
        take: 20
      });
      
      const allContinents = [
        ...apiContinents,
        ...dbContinents.map(c => c.name)
      ].filter((value, index, self) => self.indexOf(value) === index);
      
      return res.json({ success: true, data: allContinents });
    }

    const searchQuery = query.toLowerCase().trim();
    
    // Filter API continents that match the query
    const matchingApiContinents = apiContinents.filter(continent =>
      continent.toLowerCase().includes(searchQuery)
    );

    // Also check database for custom continents that match
    const dbContinents = await prisma.continent.findMany({
      where: {
        name: { contains: searchQuery, mode: 'insensitive' }
      },
      select: { name: true },
      take: 10
    });

    // Combine and deduplicate
    const allSuggestions = [
      ...matchingApiContinents,
      ...dbContinents.map(c => c.name)
    ].filter((value, index, self) => self.indexOf(value) === index);

    res.json({ success: true, data: allSuggestions });
  } catch (error) {
    console.error('Error fetching continent suggestions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get continent by ID
export const getContinentById = async (req, res) => {
  try {
    const { id } = req.params;

    const continent = await prisma.continent.findUnique({
      where: { id }
    });

    if (!continent) {
      return res.status(404).json({ success: false, message: 'Continent not found' });
    }

    res.json({
      success: true,
      data: continent
    });
  } catch (error) {
    console.error('Error fetching continent:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create new continent
export const createContinent = async (req, res) => {
  try {
    const { name, status } = req.body;

    if (!name) {
      return res.status(400).json({ 
        success: false, 
        message: 'Continent name is required' 
      });
    }

    // Check if continent already exists
    const existingContinent = await prisma.continent.findUnique({
      where: { name }
    });

    if (existingContinent) {
      return res.status(409).json({ 
        success: false, 
        message: 'Continent with this name already exists' 
      });
    }

    const continent = await prisma.continent.create({
      data: {
        name: name.trim(),
        status: status || 'Active'
      }
    });

    res.status(201).json({
      success: true,
      message: 'Continent created successfully',
      data: continent
    });
  } catch (error) {
    console.error('Error creating continent:', error);
    
    if (error.code === 'P2002') {
      return res.status(409).json({ 
        success: false, 
        message: 'Continent name already exists' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Update continent
export const updateContinent = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, status } = req.body;

    const continent = await prisma.continent.findUnique({
      where: { id }
    });

    if (!continent) {
      return res.status(404).json({ 
        success: false, 
        message: 'Continent not found' 
      });
    }

    // Check if name is being changed and if new name already exists
    if (name && name.trim() !== continent.name) {
      const existingContinent = await prisma.continent.findUnique({
        where: { name: name.trim() }
      });

      if (existingContinent) {
        return res.status(409).json({ 
          success: false, 
          message: 'Continent name already exists' 
        });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (status !== undefined) updateData.status = status;

    const updatedContinent = await prisma.continent.update({
      where: { id },
      data: updateData
    });

    res.json({
      success: true,
      message: 'Continent updated successfully',
      data: updatedContinent
    });
  } catch (error) {
    console.error('Error updating continent:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Continent not found' 
      });
    }

    if (error.code === 'P2002') {
      return res.status(409).json({ 
        success: false, 
        message: 'Continent name already exists' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete continent
export const deleteContinent = async (req, res) => {
  try {
    const { id } = req.params;

    const continent = await prisma.continent.findUnique({
      where: { id }
    });

    if (!continent) {
      return res.status(404).json({ 
        success: false, 
        message: 'Continent not found' 
      });
    }

    await prisma.continent.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Continent deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting continent:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Continent not found' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

