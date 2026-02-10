import prisma from '../utils/prisma.js';

// Check if KYCForm model exists
if (!prisma.kYCForm) {
  console.error('❌ Prisma client not regenerated! Run: npx prisma generate');
}

// Get all KYC forms
export const getAllKYCForms = async (req, res) => {
  try {
    if (!prisma.kYCForm) {
      return res.status(500).json({
        success: false,
        error: 'Prisma client not regenerated. Please run: npx prisma generate'
      });
    }

    const forms = await prisma.kYCForm.findMany({
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Transform data to match frontend format
    const formattedForms = forms.map((form, index) => ({
      key: form.id,
      no: index + 1,
      formType: form.name,
      for: form.for,
      status: form.status,
      countries: Array.isArray(form.countries) ? form.countries : [],
      fields: Array.isArray(form.fields) ? form.fields : [],
      priority: form.priority || 1,
      maxAmount: form.maxAmount ? parseFloat(form.maxAmount) : null
    }));

    res.json({
      success: true,
      data: formattedForms,
      message: 'KYC forms retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching KYC forms:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Get single KYC form by ID
export const getKYCFormById = async (req, res) => {
  try {
    if (!prisma.kYCForm) {
      return res.status(500).json({
        success: false,
        error: 'Prisma client not regenerated. Please run: npx prisma generate'
      });
    }

    const { id } = req.params;

    const form = await prisma.kYCForm.findUnique({
      where: { id }
    });

    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'KYC form not found'
      });
    }

    // Transform data to match frontend format
    const formattedForm = {
      key: form.id,
      formType: form.name,
      for: form.for,
      status: form.status,
      countries: Array.isArray(form.countries) ? form.countries : [],
      fields: Array.isArray(form.fields) ? form.fields : [],
      priority: form.priority || 1,
      maxAmount: form.maxAmount ? parseFloat(form.maxAmount) : null
    };

    res.json({
      success: true,
      data: formattedForm,
      message: 'KYC form retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching KYC form:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Create KYC form
export const createKYCForm = async (req, res) => {
  try {
    if (!prisma.kYCForm) {
      return res.status(500).json({
        success: false,
        error: 'Prisma client not regenerated. Please run: npx prisma generate'
      });
    }

    const { name, for: forType, kycStatus, countries, fields, priority, maxAmount } = req.body;

    if (!name || !forType) {
      return res.status(400).json({
        success: false,
        message: 'Name and "for" field are required'
      });
    }

    if (!countries || !Array.isArray(countries) || countries.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one country must be selected'
      });
    }

    if (!fields || !Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one field must be added'
      });
    }

    // Auto-assign priority if not provided: find max priority for the first country + 1
    let finalPriority = priority;
    if (!finalPriority || finalPriority < 1) {
      const firstCountry = countries[0];
      const existingForms = await prisma.kYCForm.findMany({
        where: {
          for: forType,
          status: 'Active'
        }
      });
      
      // Filter forms that include this country
      const countryForms = existingForms.filter(form => {
        const formCountries = Array.isArray(form.countries) ? form.countries : [];
        return formCountries.includes(firstCountry);
      });
      
      // Get max priority for this country
      const maxPriority = countryForms.length > 0 
        ? Math.max(...countryForms.map(f => f.priority || 0))
        : 0;
      
      finalPriority = maxPriority + 1;
    }

    const form = await prisma.kYCForm.create({
      data: {
        name: name.trim(),
        for: forType,
        status: kycStatus ? 'Active' : 'Inactive',
        countries: countries,
        fields: fields,
        priority: finalPriority,
        maxAmount: maxAmount ? parseFloat(maxAmount) : null
      }
    });

    res.status(201).json({
      success: true,
      message: 'KYC form created successfully',
      data: {
        id: form.id,
        key: form.id,
        formType: form.name,
        for: form.for,
        status: form.status,
        countries: Array.isArray(form.countries) ? form.countries : [],
        fields: Array.isArray(form.fields) ? form.fields : [],
        priority: form.priority || 1,
        maxAmount: form.maxAmount ? parseFloat(form.maxAmount) : null
      }
    });
  } catch (error) {
    console.error('Error creating KYC form:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Get customer KYC documents
export const getCustomerKYCDocuments = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await prisma.customer.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        kycData: true
      }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Parse KYC data from JSON field
    const kycDocuments = customer.kycData ? (Array.isArray(customer.kycData) ? customer.kycData : [customer.kycData]) : [];

    res.json({
      success: true,
      data: kycDocuments,
      message: 'KYC documents retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching KYC documents:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Approve KYC document
export const approveKYCDocument = async (req, res) => {
  try {
    const { customerId, documentId } = req.params;

    const customer = await prisma.customer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Update KYC document status in kycData JSON field
    let kycData = customer.kycData ? (Array.isArray(customer.kycData) ? customer.kycData : [customer.kycData]) : [];
    
    const documentIndex = kycData.findIndex((doc) => doc.id === documentId);
    if (documentIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'KYC document not found'
      });
    }

    kycData[documentIndex].status = 'approved';
    kycData[documentIndex].approvedAt = new Date().toISOString();
    kycData[documentIndex].approvedBy = req.user?.id || 'system';

    await prisma.customer.update({
      where: { id: customerId },
      data: {
        kycData: kycData
      }
    });

    res.json({
      success: true,
      message: 'KYC document approved successfully',
      data: kycData[documentIndex]
    });
  } catch (error) {
    console.error('Error approving KYC document:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Reject KYC document
export const rejectKYCDocument = async (req, res) => {
  try {
    const { customerId, documentId } = req.params;

    const customer = await prisma.customer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Update KYC document status in kycData JSON field
    let kycData = customer.kycData ? (Array.isArray(customer.kycData) ? customer.kycData : [customer.kycData]) : [];
    
    const documentIndex = kycData.findIndex((doc) => doc.id === documentId);
    if (documentIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'KYC document not found'
      });
    }

    kycData[documentIndex].status = 'rejected';
    kycData[documentIndex].rejectedAt = new Date().toISOString();
    kycData[documentIndex].rejectedBy = req.user?.id || 'system';

    await prisma.customer.update({
      where: { id: customerId },
      data: {
        kycData: kycData
      }
    });

    res.json({
      success: true,
      message: 'KYC document rejected',
      data: kycData[documentIndex]
    });
  } catch (error) {
    console.error('Error rejecting KYC document:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Approve individual KYC document field
export const approveKYCDocumentField = async (req, res) => {
  try {
    const { customerId, documentId, fieldId } = req.params;

    console.log('[Approve Field] Request params:', { customerId, documentId, fieldId });

    const customer = await prisma.customer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    let kycData = customer.kycData ? (Array.isArray(customer.kycData) ? customer.kycData : [customer.kycData]) : [];
    
    const documentIndex = kycData.findIndex((doc) => doc.id === documentId);
    if (documentIndex === -1) {
      console.log('[Approve Field] Document not found. Available documents:', kycData.map(d => d.id));
      return res.status(404).json({
        success: false,
        message: 'KYC document not found'
      });
    }

    const document = kycData[documentIndex];
    console.log('[Approve Field] Document found. Fields:', document.documents?.map(f => ({ id: f.id, fieldName: f.fieldName })));

    // Try to find field by ID first
    let fieldIndex = document.documents?.findIndex((field) => field.id === fieldId);
    
    // If not found by ID, try to find by index (for backward compatibility)
    if ((fieldIndex === -1 || fieldIndex === undefined) && fieldId.startsWith('field_')) {
      const indexMatch = fieldId.match(/field_(\d+)/);
      if (indexMatch) {
        const index = parseInt(indexMatch[1], 10);
        if (index >= 0 && index < document.documents.length) {
          fieldIndex = index;
          console.log('[Approve Field] Found by index:', index);
        }
      }
    }

    if (fieldIndex === -1 || fieldIndex === undefined) {
      console.log('[Approve Field] Field not found. Looking for:', fieldId);
      console.log('[Approve Field] Available field IDs:', document.documents?.map(f => f.id));
      return res.status(404).json({
        success: false,
        message: 'KYC document field not found',
        debug: {
          requestedFieldId: fieldId,
          availableFieldIds: document.documents?.map(f => f.id) || []
        }
      });
    }

    // Update field status
    kycData[documentIndex].documents[fieldIndex].status = 'approved';
    kycData[documentIndex].documents[fieldIndex].verifiedAt = new Date().toISOString();
    kycData[documentIndex].documents[fieldIndex].verifiedBy = req.user?.id || 'system';

    // Update overall document status if all fields are approved
    const allApproved = kycData[documentIndex].documents.every(field => field.status === 'approved');
    if (allApproved) {
      kycData[documentIndex].status = 'approved';
      kycData[documentIndex].approvedAt = new Date().toISOString();
      kycData[documentIndex].approvedBy = req.user?.id || 'system';
    }

    await prisma.customer.update({
      where: { id: customerId },
      data: {
        kycData: kycData
      }
    });

    res.json({
      success: true,
      message: 'KYC document field approved successfully',
      data: kycData[documentIndex].documents[fieldIndex]
    });
  } catch (error) {
    console.error('Error approving KYC document field:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Reject individual KYC document field
export const rejectKYCDocumentField = async (req, res) => {
  try {
    const { customerId, documentId, fieldId } = req.params;

    console.log('[Reject Field] Request params:', { customerId, documentId, fieldId });

    const customer = await prisma.customer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    let kycData = customer.kycData ? (Array.isArray(customer.kycData) ? customer.kycData : [customer.kycData]) : [];
    
    const documentIndex = kycData.findIndex((doc) => doc.id === documentId);
    if (documentIndex === -1) {
      console.log('[Reject Field] Document not found. Available documents:', kycData.map(d => d.id));
      return res.status(404).json({
        success: false,
        message: 'KYC document not found'
      });
    }

    const document = kycData[documentIndex];
    console.log('[Reject Field] Document found. Fields:', document.documents?.map(f => ({ id: f.id, fieldName: f.fieldName })));

    // Try to find field by ID first
    let fieldIndex = document.documents?.findIndex((field) => field.id === fieldId);
    
    // If not found by ID, try to find by index (for backward compatibility)
    if ((fieldIndex === -1 || fieldIndex === undefined) && fieldId.startsWith('field_')) {
      const indexMatch = fieldId.match(/field_(\d+)/);
      if (indexMatch) {
        const index = parseInt(indexMatch[1], 10);
        if (index >= 0 && index < document.documents.length) {
          fieldIndex = index;
          console.log('[Reject Field] Found by index:', index);
        }
      }
    }

    if (fieldIndex === -1 || fieldIndex === undefined) {
      console.log('[Reject Field] Field not found. Looking for:', fieldId);
      console.log('[Reject Field] Available field IDs:', document.documents?.map(f => f.id));
      return res.status(404).json({
        success: false,
        message: 'KYC document field not found',
        debug: {
          requestedFieldId: fieldId,
          availableFieldIds: document.documents?.map(f => f.id) || []
        }
      });
    }

    // Update field status
    kycData[documentIndex].documents[fieldIndex].status = 'rejected';
    kycData[documentIndex].documents[fieldIndex].verifiedAt = new Date().toISOString();
    kycData[documentIndex].documents[fieldIndex].verifiedBy = req.user?.id || 'system';

    // If any field is rejected, mark document as rejected
    kycData[documentIndex].status = 'rejected';
    kycData[documentIndex].rejectedAt = new Date().toISOString();
    kycData[documentIndex].rejectedBy = req.user?.id || 'system';

    await prisma.customer.update({
      where: { id: customerId },
      data: {
        kycData: kycData
      }
    });

    res.json({
      success: true,
      message: 'KYC document field rejected',
      data: kycData[documentIndex].documents[fieldIndex]
    });
  } catch (error) {
    console.error('Error rejecting KYC document field:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Submit KYC form data (save customer KYC documents)
export const submitKYCForm = async (req, res) => {
  try {
    // authenticateCustomer middleware sets req.user with customer info
    const customerId = req.user?.id || req.user?.customerId;
    
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const { formId, formName, country, fields } = req.body;

    if (!formId || !formName || !fields || !Array.isArray(fields)) {
      return res.status(400).json({
        success: false,
        message: 'Form ID, name, and fields are required'
      });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Get existing KYC data or initialize
    let kycData = customer.kycData ? (Array.isArray(customer.kycData) ? customer.kycData : [customer.kycData]) : [];

    // Create new KYC document entry
    const newDocument = {
      id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      formId,
      verificationType: formName,
      country: country || 'USD',
      status: 'pending',
      date: new Date().toISOString(),
      documents: fields.map(field => ({
        id: `field_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        fieldName: field.fieldName,
        inputType: field.inputType,
        value: field.value || '',
        fileUrl: field.fileUrl || null,
        status: 'pending', // Each field has its own status
        verifiedAt: null,
        verifiedBy: null,
      })),
      submittedAt: new Date().toISOString(),
    };

    // Add to existing KYC data
    kycData.push(newDocument);

    // Update customer's KYC data
    await prisma.customer.update({
      where: { id: customerId },
      data: {
        kycData: kycData
      }
    });

    res.json({
      success: true,
      message: 'KYC form submitted successfully',
      data: newDocument
    });
  } catch (error) {
    console.error('Error submitting KYC form:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Get available KYC forms for a country
export const getKYCFormsByCountry = async (req, res) => {
  try {
    if (!prisma.kYCForm) {
      return res.status(500).json({
        success: false,
        error: 'Prisma client not regenerated. Please run: npx prisma generate'
      });
    }

    const { countryCode } = req.params;

    if (!countryCode) {
      return res.status(400).json({
        success: false,
        message: 'Country code is required'
      });
    }

    // Get all active forms and filter by country
    const allForms = await prisma.kYCForm.findMany({
      where: {
        status: 'Active'
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Filter forms that include the requested country code
    const filteredForms = allForms.filter(form => {
      const countries = Array.isArray(form.countries) ? form.countries : [];
      return countries.includes(countryCode);
    });

    // Transform data to match frontend format
    const formattedForms = filteredForms.map(form => ({
      id: form.id,
      name: form.name,
      for: form.for,
      status: form.status,
      countries: Array.isArray(form.countries) ? form.countries : [],
      fields: Array.isArray(form.fields) ? form.fields : [],
      priority: form.priority || 1,
      maxAmount: form.maxAmount ? parseFloat(form.maxAmount) : null
    }));

    res.json({
      success: true,
      data: formattedForms,
      message: 'KYC forms retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching KYC forms by country:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Update KYC form
export const updateKYCForm = async (req, res) => {
  try {
    if (!prisma.kYCForm) {
      return res.status(500).json({
        success: false,
        error: 'Prisma client not regenerated. Please run: npx prisma generate'
      });
    }

    const { id } = req.params;
    const { name, for: forType, kycStatus, countries, fields, priority, maxAmount } = req.body;

    const existingForm = await prisma.kYCForm.findUnique({
      where: { id }
    });

    if (!existingForm) {
      return res.status(404).json({
        success: false,
        message: 'KYC form not found'
      });
    }

    const updatedForm = await prisma.kYCForm.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        ...(forType && { for: forType }),
        ...(kycStatus !== undefined && { status: kycStatus ? 'Active' : 'Inactive' }),
        ...(countries && { countries }),
        ...(fields && { fields }),
        ...(priority !== undefined && priority !== null && { priority: parseInt(priority, 10) }),
        ...(maxAmount !== undefined && maxAmount !== null && { maxAmount: parseFloat(maxAmount) }),
        updatedAt: new Date()
      }
    });

    res.json({
      success: true,
      message: 'KYC form updated successfully',
      data: {
        id: updatedForm.id,
        key: updatedForm.id,
        formType: updatedForm.name,
        for: updatedForm.for,
        status: updatedForm.status,
        countries: Array.isArray(updatedForm.countries) ? updatedForm.countries : [],
        fields: Array.isArray(updatedForm.fields) ? updatedForm.fields : [],
        priority: updatedForm.priority || 1,
        maxAmount: updatedForm.maxAmount ? parseFloat(updatedForm.maxAmount) : null
      }
    });
  } catch (error) {
    console.error('Error updating KYC form:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Delete KYC form
export const deleteKYCForm = async (req, res) => {
  try {
    if (!prisma.kYCForm) {
      return res.status(500).json({
        success: false,
        error: 'Prisma client not regenerated. Please run: npx prisma generate'
      });
    }

    const { id } = req.params;

    const existingForm = await prisma.kYCForm.findUnique({
      where: { id }
    });

    if (!existingForm) {
      return res.status(404).json({
        success: false,
        message: 'KYC form not found'
      });
    }

    await prisma.kYCForm.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'KYC form deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting KYC form:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
