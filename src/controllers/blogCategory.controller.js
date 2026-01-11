import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Get all blog categories
export const getAllBlogCategories = async (req, res) => {
  try {
    const categories = await prisma.blogCategory.findMany({
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: categories });
  } catch (error) {
    console.error('Error fetching blog categories:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get blog category by ID
export const getBlogCategoryById = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await prisma.blogCategory.findUnique({
      where: { id }
    });

    if (!category) {
      return res.status(404).json({ success: false, message: 'Blog category not found' });
    }

    res.json({ success: true, data: category });
  } catch (error) {
    console.error('Error fetching blog category:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create blog category
export const createBlogCategory = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }

    // Generate slug from name
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens

    // Check if slug already exists
    const existingCategory = await prisma.blogCategory.findUnique({
      where: { slug }
    });

    if (existingCategory) {
      return res.status(400).json({ success: false, message: 'A category with this name already exists' });
    }

    const category = await prisma.blogCategory.create({
      data: {
        name: name.trim(),
        slug
      }
    });

    res.status(201).json({ success: true, data: category });
  } catch (error) {
    console.error('Error creating blog category:', error);
    
    // Handle unique constraint violation
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'A category with this name already exists' });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Update blog category
export const updateBlogCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }

    // Check if category exists
    const existingCategory = await prisma.blogCategory.findUnique({
      where: { id }
    });

    if (!existingCategory) {
      return res.status(404).json({ success: false, message: 'Blog category not found' });
    }

    // Generate slug from name
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens

    // Check if slug already exists for another category
    const slugExists = await prisma.blogCategory.findFirst({
      where: {
        slug,
        id: { not: id }
      }
    });

    if (slugExists) {
      return res.status(400).json({ success: false, message: 'A category with this name already exists' });
    }

    const category = await prisma.blogCategory.update({
      where: { id },
      data: {
        name: name.trim(),
        slug
      }
    });

    res.json({ success: true, data: category });
  } catch (error) {
    console.error('Error updating blog category:', error);
    
    // Handle unique constraint violation
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'A category with this name already exists' });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete blog category
export const deleteBlogCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await prisma.blogCategory.findUnique({
      where: { id }
    });

    if (!category) {
      return res.status(404).json({ success: false, message: 'Blog category not found' });
    }

    await prisma.blogCategory.delete({
      where: { id }
    });

    res.json({ success: true, message: 'Blog category deleted successfully' });
  } catch (error) {
    console.error('Error deleting blog category:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

