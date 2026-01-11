import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Get all blogs
export const getAllBlogs = async (req, res) => {
  try {
    const { language, status, categoryId } = req.query;
    
    const where = {};
    if (language) where.language = language;
    if (status) where.status = status;
    if (categoryId) where.categoryId = categoryId;

    const blogs = await prisma.blog.findMany({
      where,
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: blogs });
  } catch (error) {
    console.error('Error fetching blogs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get blog by ID
export const getBlogById = async (req, res) => {
  try {
    const { id } = req.params;

    const blog = await prisma.blog.findUnique({
      where: { id },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      }
    });

    if (!blog) {
      return res.status(404).json({ success: false, message: 'Blog not found' });
    }

    res.json({ success: true, data: blog });
  } catch (error) {
    console.error('Error fetching blog:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get blog by slug
export const getBlogBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    const blog = await prisma.blog.findUnique({
      where: { slug },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      }
    });

    if (!blog) {
      return res.status(404).json({ success: false, message: 'Blog not found' });
    }

    res.json({ success: true, data: blog });
  } catch (error) {
    console.error('Error fetching blog:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create blog
export const createBlog = async (req, res) => {
  try {
    const { title, slug, description, descriptionImage, categoryId, status, language } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Title is required' });
    }

    if (!slug || !slug.trim()) {
      return res.status(400).json({ success: false, message: 'Slug is required' });
    }

    if (!description || !description.trim()) {
      return res.status(400).json({ success: false, message: 'Description is required' });
    }

    // Check if slug already exists
    const existingBlog = await prisma.blog.findUnique({
      where: { slug }
    });

    if (existingBlog) {
      return res.status(400).json({ success: false, message: 'A blog with this slug already exists' });
    }

    // Verify category exists if provided
    if (categoryId) {
      const category = await prisma.blogCategory.findUnique({
        where: { id: categoryId }
      });

      if (!category) {
        return res.status(400).json({ success: false, message: 'Invalid category' });
      }
    }

    const blog = await prisma.blog.create({
      data: {
        title: title.trim(),
        slug: slug.trim(),
        description: description.trim(),
        descriptionImage: descriptionImage || null,
        categoryId: categoryId || null,
        status: status || 'draft',
        language: language || 'english'
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      }
    });

    res.status(201).json({ success: true, data: blog });
  } catch (error) {
    console.error('Error creating blog:', error);
    
    // Handle unique constraint violation
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'A blog with this slug already exists' });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Update blog
export const updateBlog = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, slug, description, descriptionImage, categoryId, status, language } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Title is required' });
    }

    if (!slug || !slug.trim()) {
      return res.status(400).json({ success: false, message: 'Slug is required' });
    }

    if (!description || !description.trim()) {
      return res.status(400).json({ success: false, message: 'Description is required' });
    }

    // Check if blog exists
    const existingBlog = await prisma.blog.findUnique({
      where: { id }
    });

    if (!existingBlog) {
      return res.status(404).json({ success: false, message: 'Blog not found' });
    }

    // Check if slug already exists for another blog
    const slugExists = await prisma.blog.findFirst({
      where: {
        slug: slug.trim(),
        id: { not: id }
      }
    });

    if (slugExists) {
      return res.status(400).json({ success: false, message: 'A blog with this slug already exists' });
    }

    // Verify category exists if provided
    if (categoryId) {
      const category = await prisma.blogCategory.findUnique({
        where: { id: categoryId }
      });

      if (!category) {
        return res.status(400).json({ success: false, message: 'Invalid category' });
      }
    }

    const blog = await prisma.blog.update({
      where: { id },
      data: {
        title: title.trim(),
        slug: slug.trim(),
        description: description.trim(),
        descriptionImage: descriptionImage || null,
        categoryId: categoryId || null,
        status: status || existingBlog.status,
        language: language || existingBlog.language
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      }
    });

    res.json({ success: true, data: blog });
  } catch (error) {
    console.error('Error updating blog:', error);
    
    // Handle unique constraint violation
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'A blog with this slug already exists' });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete blog
export const deleteBlog = async (req, res) => {
  try {
    const { id } = req.params;

    const blog = await prisma.blog.findUnique({
      where: { id }
    });

    if (!blog) {
      return res.status(404).json({ success: false, message: 'Blog not found' });
    }

    await prisma.blog.delete({
      where: { id }
    });

    res.json({ success: true, message: 'Blog deleted successfully' });
  } catch (error) {
    console.error('Error deleting blog:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

