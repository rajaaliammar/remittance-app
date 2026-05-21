import prisma from '../utils/prisma.js';

// Check if manageContent model exists
if (!prisma.manageContent) {
  console.error('❌ Prisma client not regenerated! Run: npm run prisma:generate');
}

// Get all manage content sections
export const getAllManageContent = async (req, res) => {
  try {
    if (!prisma.manageContent) {
      return res.status(500).json({ 
        success: false, 
        error: 'Prisma client not regenerated. Please run: npm run prisma:generate' 
      });
    }
    
    const contents = await prisma.manageContent.findMany({
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: contents });
  } catch (error) {
    console.error('Error fetching manage content:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get manage content by section type
export const getManageContentByType = async (req, res) => {
  try {
    if (!prisma.manageContent) {
      return res.status(500).json({ 
        success: false, 
        error: 'Prisma client not regenerated. Please run: npm run prisma:generate' 
      });
    }
    
    const { sectionType } = req.params;

    const content = await prisma.manageContent.findFirst({
      where: { sectionType },
      orderBy: { updatedAt: 'desc' },
    });

    if (!content) {
      return res.status(404).json({ 
        success: false, 
        message: 'Content section not found' 
      });
    }

    res.json({ success: true, data: content });
  } catch (error) {
    console.error('Error fetching manage content by type:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create or update manage content (upsert)
export const upsertManageContent = async (req, res) => {
  try {
    if (!prisma.manageContent) {
      return res.status(500).json({ 
        success: false, 
        error: 'Prisma client not regenerated. Please run: npm run prisma:generate' 
      });
    }
    
    const { sectionType, englishData, spanishData, images } = req.body;

    if (!sectionType) {
      return res.status(400).json({ 
        success: false, 
        message: 'Section type is required' 
      });
    }

    if (!englishData) {
      return res.status(400).json({ 
        success: false, 
        message: 'English data is required' 
      });
    }

    const payload = {
      englishData: englishData || {},
      spanishData: spanishData ?? null,
      images: images ?? null,
      updatedAt: new Date(),
    };

    // findFirst + update/create — DB may lack unique index on sectionType (upsert would fail)
    const existing = await prisma.manageContent.findFirst({
      where: { sectionType },
      orderBy: { updatedAt: 'desc' },
    });

    const content = existing
      ? await prisma.manageContent.update({
          where: { id: existing.id },
          data: payload,
        })
      : await prisma.manageContent.create({
          data: {
            sectionType,
            englishData: payload.englishData,
            spanishData: payload.spanishData,
            images: payload.images,
          },
        });

    res.json({
      success: true,
      message: 'Content saved successfully',
      data: content
    });
  } catch (error) {
    console.error('Error saving manage content:', error);
    res.status(500).json({ success: false, message: error.message, error: error.message });
  }
};

// Update manage content
export const updateManageContent = async (req, res) => {
  try {
    if (!prisma.manageContent) {
      return res.status(500).json({ 
        success: false, 
        error: 'Prisma client not regenerated. Please run: npm run prisma:generate' 
      });
    }
    
    const { id } = req.params;
    const { englishData, spanishData, images } = req.body;

    const content = await prisma.manageContent.findUnique({
      where: { id }
    });

    if (!content) {
      return res.status(404).json({ 
        success: false, 
        message: 'Content section not found' 
      });
    }

    const updateData = {};
    if (englishData !== undefined) updateData.englishData = englishData;
    if (spanishData !== undefined) updateData.spanishData = spanishData;
    if (images !== undefined) updateData.images = images;

    const updatedContent = await prisma.manageContent.update({
      where: { id },
      data: updateData
    });

    res.json({
      success: true,
      message: 'Content updated successfully',
      data: updatedContent
    });
  } catch (error) {
    console.error('Error updating manage content:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Content section not found' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete manage content
export const deleteManageContent = async (req, res) => {
  try {
    if (!prisma.manageContent) {
      return res.status(500).json({ 
        success: false, 
        error: 'Prisma client not regenerated. Please run: npm run prisma:generate' 
      });
    }
    
    const { id } = req.params;

    const content = await prisma.manageContent.findUnique({
      where: { id }
    });

    if (!content) {
      return res.status(404).json({ 
        success: false, 
        message: 'Content section not found' 
      });
    }

    await prisma.manageContent.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Content deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting manage content:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Content section not found' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

