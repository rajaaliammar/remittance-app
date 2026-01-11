import prisma from '../utils/prisma.js';

// Get all roles
export const getAllRoles = async (req, res) => {
  try {
    const { search, status } = req.query;
    
    const where = {};
    if (status) {
      where.status = status;
    }
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const roles = await prisma.role.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { users: true }
        }
      }
    });

    // Format response with serial numbers
    const formattedRoles = roles.map((role, index) => ({
      id: role.id,
      key: role.id,
      no: index + 1,
      name: role.name,
      status: role.status,
      permissions: role.permissions,
      userCount: role._count.users,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt
    }));

    res.json({ success: true, data: formattedRoles });
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get role by ID
export const getRoleById = async (req, res) => {
  try {
    const { id } = req.params;

    const role = await prisma.role.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true }
        }
      }
    });

    if (!role) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }

    res.json({
      success: true,
      data: {
        id: role.id,
        name: role.name,
        status: role.status,
        permissions: role.permissions,
        userCount: role._count.users
      }
    });
  } catch (error) {
    console.error('Error fetching role:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create new role
export const createRole = async (req, res) => {
  try {
    const { name, status, permissions } = req.body;

    if (!name) {
      return res.status(400).json({ 
        success: false, 
        message: 'Role name is required' 
      });
    }

    // Check if role already exists
    const existingRole = await prisma.role.findUnique({
      where: { name }
    });

    if (existingRole) {
      return res.status(409).json({ 
        success: false, 
        message: 'Role with this name already exists' 
      });
    }

    const role = await prisma.role.create({
      data: {
        name,
        status: status || 'Active',
        permissions: permissions || {}
      }
    });

    res.status(201).json({
      success: true,
      message: 'Role created successfully',
      data: role
    });
  } catch (error) {
    console.error('Error creating role:', error);
    
    if (error.code === 'P2002') {
      return res.status(409).json({ 
        success: false, 
        message: 'Role name already exists' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Update role
export const updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, status, permissions } = req.body;

    const role = await prisma.role.findUnique({
      where: { id }
    });

    if (!role) {
      return res.status(404).json({ 
        success: false, 
        message: 'Role not found' 
      });
    }

    // Check if name is being changed and if new name already exists
    if (name && name !== role.name) {
      const existingRole = await prisma.role.findUnique({
        where: { name }
      });

      if (existingRole) {
        return res.status(409).json({ 
          success: false, 
          message: 'Role name already exists' 
        });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (status !== undefined) updateData.status = status;
    if (permissions !== undefined) updateData.permissions = permissions;

    const updatedRole = await prisma.role.update({
      where: { id },
      data: updateData
    });

    res.json({
      success: true,
      message: 'Role updated successfully',
      data: updatedRole
    });
  } catch (error) {
    console.error('Error updating role:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Role not found' 
      });
    }

    if (error.code === 'P2002') {
      return res.status(409).json({ 
        success: false, 
        message: 'Role name already exists' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete role
export const deleteRole = async (req, res) => {
  try {
    const { id } = req.params;

    const role = await prisma.role.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true }
        }
      }
    });

    if (!role) {
      return res.status(404).json({ 
        success: false, 
        message: 'Role not found' 
      });
    }

    // Check if role is assigned to any users
    if (role._count.users > 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot delete role. It is assigned to one or more users.' 
      });
    }

    await prisma.role.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Role deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting role:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Role not found' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

