import prisma from '../utils/prisma.js';

// Get all pages
export const getAllPages = async (req, res) => {
  try {
    const { search, status } = req.query;

    const where = {};
    
    if (status) {
      where.status = status;
    }
    
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } }
      ];
    }

    const pages = await prisma.page.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    // Format response to match frontend expectations
    const formattedPages = pages.map((page, index) => ({
      key: page.id,
      sl: index + 1,
      name: page.name,
      slug: page.slug,
      createdAt: new Date(page.createdAt).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      status: page.status,
      enPublished: page.enPublished,
      esPublished: page.esPublished,
      content: page.content,
      sections: page.sections,
      breadcrumbStatus: page.breadcrumbStatus,
      breadcrumbImage: page.breadcrumbImage
    }));

    res.json({ success: true, data: formattedPages });
  } catch (error) {
    console.error('Error fetching pages:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get page by ID
export const getPageById = async (req, res) => {
  try {
    const { id } = req.params;

    const page = await prisma.page.findUnique({
      where: { id }
    });

    if (!page) {
      return res.status(404).json({ success: false, message: 'Page not found' });
    }

    res.json({
      success: true,
      data: page
    });
  } catch (error) {
    console.error('Error fetching page:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get page by slug
export const getPageBySlug = async (req, res) => {
  try {
    let { slug } = req.params;

    // Normalize slug - ensure it starts with /
    if (!slug.startsWith('/')) {
      slug = '/' + slug;
    }

    const page = await prisma.page.findUnique({
      where: { slug }
    });

    if (!page) {
      return res.status(404).json({ success: false, message: 'Page not found' });
    }

    res.json({
      success: true,
      data: page
    });
  } catch (error) {
    console.error('Error fetching page:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create new page
export const createPage = async (req, res) => {
  try {
    const { 
      name, 
      slug, 
      content, 
      sections, 
      status, 
      breadcrumbStatus, 
      breadcrumbImage,
      enPublished,
      esPublished
    } = req.body;

    if (!name) {
      return res.status(400).json({ 
        success: false, 
        message: 'Page name is required' 
      });
    }

    if (!slug) {
      return res.status(400).json({ 
        success: false, 
        message: 'Page slug is required' 
      });
    }

    // Normalize slug (remove leading/trailing slashes, ensure it starts with /)
    let normalizedSlug = slug.trim();
    if (!normalizedSlug.startsWith('/')) {
      normalizedSlug = '/' + normalizedSlug;
    }

    const page = await prisma.page.create({
      data: {
        name: name.trim(),
        slug: normalizedSlug,
        content: content || null,
        sections: sections || null,
        status: status || 'Draft',
        breadcrumbStatus: breadcrumbStatus || false,
        breadcrumbImage: breadcrumbImage || null,
        enPublished: enPublished || false,
        esPublished: esPublished || false
      }
    });

    res.status(201).json({
      success: true,
      message: 'Page created successfully',
      data: page
    });
  } catch (error) {
    console.error('Error creating page:', error);
    
    if (error.code === 'P2002') {
      return res.status(409).json({ 
        success: false, 
        message: 'Page with this slug already exists' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Update page
export const updatePage = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, 
      slug, 
      content, 
      sections, 
      status, 
      breadcrumbStatus, 
      breadcrumbImage,
      enPublished,
      esPublished
    } = req.body;

    const page = await prisma.page.findUnique({
      where: { id }
    });

    if (!page) {
      return res.status(404).json({ 
        success: false, 
        message: 'Page not found' 
      });
    }

    // Check for duplicate slug if slug is being changed
    if (slug && slug.trim() !== page.slug) {
      let normalizedSlug = slug.trim();
      if (!normalizedSlug.startsWith('/')) {
        normalizedSlug = '/' + normalizedSlug;
      }

      const existingPage = await prisma.page.findFirst({
        where: {
          slug: normalizedSlug,
          id: { not: id }
        }
      });

      if (existingPage) {
        return res.status(409).json({ 
          success: false, 
          message: 'Page with this slug already exists' 
        });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (slug !== undefined) {
      let normalizedSlug = slug.trim();
      if (!normalizedSlug.startsWith('/')) {
        normalizedSlug = '/' + normalizedSlug;
      }
      updateData.slug = normalizedSlug;
    }
    if (content !== undefined) updateData.content = content;
    if (sections !== undefined) updateData.sections = sections;
    if (status !== undefined) updateData.status = status;
    if (breadcrumbStatus !== undefined) updateData.breadcrumbStatus = breadcrumbStatus;
    if (breadcrumbImage !== undefined) updateData.breadcrumbImage = breadcrumbImage;
    if (enPublished !== undefined) updateData.enPublished = enPublished;
    if (esPublished !== undefined) updateData.esPublished = esPublished;

    const updatedPage = await prisma.page.update({
      where: { id },
      data: updateData
    });

    res.json({
      success: true,
      message: 'Page updated successfully',
      data: updatedPage
    });
  } catch (error) {
    console.error('Error updating page:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Page not found' 
      });
    }

    if (error.code === 'P2002') {
      return res.status(409).json({ 
        success: false, 
        message: 'Page with this slug already exists' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete page
export const deletePage = async (req, res) => {
  try {
    const { id } = req.params;

    const page = await prisma.page.findUnique({
      where: { id }
    });

    if (!page) {
      return res.status(404).json({ 
        success: false, 
        message: 'Page not found' 
      });
    }

    await prisma.page.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Page deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting page:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Page not found' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};


