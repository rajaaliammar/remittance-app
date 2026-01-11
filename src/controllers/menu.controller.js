import prisma from '../utils/prisma.js';

// Get menu by type (header or footer)
export const getMenuByType = async (req, res) => {
  try {
    const { menuType } = req.params;

    if (!menuType || !['header', 'footer'].includes(menuType)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid menu type. Must be "header" or "footer"' 
      });
    }

    // Check if prisma.menu exists (model might not be generated yet)
    if (!prisma.menu) {
      // Return default structure if model not available
      if (menuType === 'header') {
        return res.json({
          success: true,
          data: {
            menuType: 'header',
            items: [],
            logo: null,
            brandName: null
          }
        });
      } else {
        return res.json({
          success: true,
          data: {
            menuType: 'footer',
            footerPages: [],
            footerUsefulLinks: [],
            footerSupportLinks: []
          }
        });
      }
    }

    let menu = await prisma.menu.findUnique({
      where: { menuType }
    });

    // If menu doesn't exist, return default structure
    if (!menu) {
      if (menuType === 'header') {
        return res.json({
          success: true,
          data: {
            menuType: 'header',
            items: [],
            logo: null,
            brandName: null
          }
        });
      } else {
        return res.json({
          success: true,
          data: {
            menuType: 'footer',
            footerPages: [],
            footerUsefulLinks: [],
            footerSupportLinks: []
          }
        });
      }
    }

    // Fetch page slugs for menu items that reference pages
    const items = menu.items || [];
    const footerPages = menu.footerPages || [];
    const footerUsefulLinks = menu.footerUsefulLinks || [];
    const footerSupportLinks = menu.footerSupportLinks || [];

    // Get all page IDs referenced in menu items
    const pageIds = new Set();
    [...items, ...footerPages, ...footerUsefulLinks, ...footerSupportLinks].forEach(item => {
      if (item.pageId && !item.isCustom) {
        pageIds.add(item.pageId);
      }
    });

    // Fetch pages to get slugs
    const pages = await prisma.page.findMany({
      where: {
        id: { in: Array.from(pageIds) }
      },
      select: {
        id: true,
        slug: true,
        name: true
      }
    });

    // Create a map of pageId to slug
    const pageMap = {};
    pages.forEach(page => {
      pageMap[page.id] = { slug: page.slug, name: page.name };
    });

    // Enrich menu items with page slugs
    const enrichedItems = items.map(item => {
      if (item.pageId && !item.isCustom && pageMap[item.pageId]) {
        return {
          ...item,
          slug: pageMap[item.pageId].slug,
          pageName: pageMap[item.pageId].name
        };
      }
      return item;
    });

    const enrichedFooterPages = footerPages.map(item => {
      if (item.pageId && !item.isCustom && pageMap[item.pageId]) {
        return {
          ...item,
          slug: pageMap[item.pageId].slug,
          pageName: pageMap[item.pageId].name
        };
      }
      return item;
    });

    const enrichedFooterUsefulLinks = footerUsefulLinks.map(item => {
      if (item.pageId && !item.isCustom && pageMap[item.pageId]) {
        return {
          ...item,
          slug: pageMap[item.pageId].slug,
          pageName: pageMap[item.pageId].name
        };
      }
      return item;
    });

    const enrichedFooterSupportLinks = footerSupportLinks.map(item => {
      if (item.pageId && !item.isCustom && pageMap[item.pageId]) {
        return {
          ...item,
          slug: pageMap[item.pageId].slug,
          pageName: pageMap[item.pageId].name
        };
      }
      return item;
    });

    res.json({
      success: true,
      data: {
        ...menu,
        items: enrichedItems,
        footerPages: enrichedFooterPages,
        footerUsefulLinks: enrichedFooterUsefulLinks,
        footerSupportLinks: enrichedFooterSupportLinks
      }
    });
  } catch (error) {
    console.error('Error fetching menu:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get all menus
export const getAllMenus = async (req, res) => {
  try {
    const menus = await prisma.menu.findMany({
      orderBy: { updatedAt: 'desc' }
    });

    res.json({ success: true, data: menus });
  } catch (error) {
    console.error('Error fetching menus:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create or update menu
export const saveMenu = async (req, res) => {
  try {
    const { menuType, items, footerPages, footerUsefulLinks, footerSupportLinks, logo, brandName } = req.body;

    if (!menuType || !['header', 'footer'].includes(menuType)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid menu type. Must be "header" or "footer"' 
      });
    }

    // Check if prisma.menu exists (model might not be generated yet)
    if (!prisma.menu) {
      return res.status(500).json({
        success: false,
        message: 'Menu model not available. Please run: npx prisma generate'
      });
    }

    // Check if menu exists
    const existingMenu = await prisma.menu.findUnique({
      where: { menuType }
    });

    let menu;
    if (existingMenu) {
      // Update existing menu
      const updateData = {};
      if (items !== undefined) updateData.items = items;
      if (footerPages !== undefined) updateData.footerPages = footerPages;
      if (footerUsefulLinks !== undefined) updateData.footerUsefulLinks = footerUsefulLinks;
      if (footerSupportLinks !== undefined) updateData.footerSupportLinks = footerSupportLinks;
      if (logo !== undefined) updateData.logo = logo;
      if (brandName !== undefined) updateData.brandName = brandName;

      menu = await prisma.menu.update({
        where: { menuType },
        data: updateData
      });
    } else {
      // Create new menu
      menu = await prisma.menu.create({
        data: {
          menuType,
          items: items || [],
          footerPages: footerPages || [],
          footerUsefulLinks: footerUsefulLinks || [],
          footerSupportLinks: footerSupportLinks || [],
          logo: logo || null,
          brandName: brandName || null
        }
      });
    }

    res.json({
      success: true,
      message: 'Menu saved successfully',
      data: menu
    });
  } catch (error) {
    console.error('Error saving menu:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete menu
export const deleteMenu = async (req, res) => {
  try {
    const { menuType } = req.params;

    const menu = await prisma.menu.findUnique({
      where: { menuType }
    });

    if (!menu) {
      return res.status(404).json({ 
        success: false, 
        message: 'Menu not found' 
      });
    }

    await prisma.menu.delete({
      where: { menuType }
    });

    res.json({
      success: true,
      message: 'Menu deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting menu:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

