import prisma from '../utils/prisma.js';
import { sendPushToCustomer } from '../utils/push.js';

// Emit real-time KYC status update to the customer's socket room (for app Verifications screen)
function emitKYCUpdateToCustomer(req, customerId, payload) {
  try {
    const io = req.app && req.app.get && req.app.get('io');
    if (io) {
      // Original event for compatibility
      io.to('user:' + customerId).emit('kyc-document:status-updated', payload);
      
      // Targeted event according to requested requirements
      io.to('user:' + customerId).emit('kyc-status-updated', {
        userId: customerId,
        status: payload.status,
        documentId: payload.documentId,
        document: payload.document
      });
      console.log(`[KYC] Emitted real-time update to user:${customerId} (status: ${payload.status})`);
    }
  } catch (e) {
    console.warn('[KYC] Socket emit failed:', e?.message);
  }
}

// Send push notification to customer when document is approved or rejected (from portal KYC Request)
async function notifyCustomerKYCStatus(customerId, status, document) {
  const docName = document?.verificationType || document?.formName || 'Your document';
  const isApproved = (status || '').toLowerCase() === 'approved';
  const title = isApproved ? 'Document verified' : 'Document update';
  const body = isApproved
    ? `${docName} has been verified.`
    : `${docName} was not approved. Check Verifications for details.`;
  await sendPushToCustomer(customerId, {
    title,
    body,
    data: {
      type: 'kyc',
      screen: 'Verifications',
      status: isApproved ? 'approved' : 'rejected',
      documentId: document?.id || '',
    },
  });
}

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
      description: form.description || null,
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
      description: form.description || null,
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

    const { name, description, for: forType, kycStatus, countries, fields, priority, maxAmount } = req.body;

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

    const normalizedFields = fields
      .map((field) => ({
        ...field,
        fieldName: String(field?.fieldName || '').trim(),
      }))
      .filter((field) => field.fieldName.length > 0);

    if (normalizedFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one field with a valid field name is required'
      });
    }

    const form = await prisma.kYCForm.create({
      data: {
        name: name.trim(),
        description: description ? description.trim() : null,
        for: forType,
        status: kycStatus ? 'Active' : 'Inactive',
        countries: countries,
        fields: normalizedFields,
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
        description: form.description || null,
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
// Get current customer's own KYC documents (authenticated customer - for app Verifications screen)
export const getMyKYCDocuments = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { kycData: true }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    let raw = customer.kycData;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch (_) {
        raw = null;
      }
    }
    const kycDocuments = raw
      ? (Array.isArray(raw) ? raw : [raw])
      : [];

    res.json({
      success: true,
      data: kycDocuments,
      message: 'KYC documents retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching my KYC documents:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

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

    emitKYCUpdateToCustomer(req, customerId, { documentId, status: 'approved', document: kycData[documentIndex] });
    await notifyCustomerKYCStatus(customerId, 'approved', kycData[documentIndex]);

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

    emitKYCUpdateToCustomer(req, customerId, { documentId, status: 'rejected', document: kycData[documentIndex] });
    await notifyCustomerKYCStatus(customerId, 'rejected', kycData[documentIndex]);

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

// Admin: request customer to re-upload KYC (form + optional requested fields; sets flag and sends push)
export const requestCustomerKYC = async (req, res) => {
  try {
    const { customerId } = req.params;
    const body = req.body || {};
    const formId = body.formId && String(body.formId).trim() ? String(body.formId).trim() : null;
    const formName = body.formName && String(body.formName).trim() ? String(body.formName).trim() : null;
    const message = body.message && String(body.message).trim() ? String(body.message).trim() : null;
    let requestedFields = body.requestedFields;
    if (Array.isArray(requestedFields)) {
      requestedFields = requestedFields
        .map((f) => ({
          fieldName: f?.fieldName != null ? String(f.fieldName).trim() : '',
          inputType: f?.inputType != null ? String(f.inputType).trim() : 'Text',
          validationType: f?.validationType != null ? String(f.validationType).trim() : 'Required',
        }))
        .filter((f) => f.fieldName.length > 0);
    } else {
      requestedFields = null;
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, firstName: true, lastName: true },
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }

    const now = new Date();
    await prisma.customer.update({
      where: { id: customerId },
      data: {
        kycRequestedAt: now,
        kycRequestedBy: req.user?.id || 'system',
        kycRequestedFormId: formId,
        kycRequestedFormName: formName,
        kycRequestedMessage: message,
        kycRequestedFields: requestedFields,
      },
    });

    let pushBody = message;
    if (!pushBody && formName) {
      pushBody = `Please complete the "${formName}" verification in the Verifications section.`;
    }
    if (!pushBody && requestedFields && requestedFields.length > 0) {
      const names = requestedFields.map((f) => f.fieldName).join(', ');
      pushBody = `Please provide: ${names}. Upload in the Verifications section.`;
    }
    if (!pushBody) {
      pushBody = 'Please upload your KYC documents again in the Verifications section.';
    }

    await sendPushToCustomer(customerId, {
      title: 'KYC documents requested',
      body: pushBody,
      data: {
        type: 'kyc_request',
        screen: 'Verifications',
        ...(formId && { formId }),
        ...(formName && { formName: formName.substring(0, 100) }),
      },
    });

    emitKYCUpdateToCustomer(req, customerId, {
      documentId: null,
      status: 'kyc_requested',
      document: { formId, formName, message, requestedFields },
    });

    res.json({
      success: true,
      message: 'KYC request sent to customer. They will be notified to upload documents again.',
    });
  } catch (error) {
    console.error('Error requesting KYC:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to send KYC request',
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

    emitKYCUpdateToCustomer(req, customerId, { documentId, status: kycData[documentIndex].status, document: kycData[documentIndex] });
    if (kycData[documentIndex].status === 'approved') {
      await notifyCustomerKYCStatus(customerId, 'approved', kycData[documentIndex]);
    }

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

    emitKYCUpdateToCustomer(req, customerId, { documentId, status: 'rejected', document: kycData[documentIndex] });
    await notifyCustomerKYCStatus(customerId, 'rejected', kycData[documentIndex]);

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

    // Create new KYC document entry (formId + formName for accurate matching in app)
    const newDocument = {
      id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      formId,
      formName,
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

// List all KYC requests for admin portal (Pending / Approved / Rejected pages). Same data source as app Verifications.
export const getKYCRequests = async (req, res) => {
  try {
    const statusFilter = (req.query.status || '').toLowerCase();
    const validStatuses = ['pending', 'approved', 'rejected'];
    const filterStatus = validStatuses.includes(statusFilter) ? statusFilter : null;

    const customers = await prisma.customer.findMany({
      where: { kycData: { not: null } },
      select: { id: true, firstName: true, lastName: true, email: true, username: true, phone: true, kycData: true }
    });

    const requests = [];
    let no = 0;
    for (const c of customers) {
      let raw = c.kycData;
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch (_) {
          raw = null;
        }
      }
      const docs = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
      const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.phone || '—';
      const username = c.username || c.email || '—';
      for (const doc of docs) {
        const status = (doc.status || 'pending').toLowerCase();
        if (filterStatus && status !== filterStatus) continue;
        no += 1;
        requests.push({
          key: doc.id,
          no,
          customerId: c.id,
          name,
          username,
          verificationType: doc.verificationType || doc.formName || 'KYC Document',
          status: status.charAt(0).toUpperCase() + status.slice(1),
          documentId: doc.id,
          submittedAt: doc.submittedAt || doc.date
        });
      }
    }

    res.json({
      success: true,
      data: requests,
      message: 'KYC requests retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching KYC requests:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/** Tokens that should match each other on KYC forms (portal may use USD vs US). */
function expandKycCountryTokens(countryCode) {
  const c = String(countryCode || '').trim().toUpperCase();
  const set = new Set(c ? [c] : []);
  const usFamily = ['USD', 'US', 'USA'];
  if (usFamily.includes(c)) usFamily.forEach((x) => set.add(x));
  return set;
}

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

    const requested = expandKycCountryTokens(countryCode);

    const allForms = await prisma.kYCForm.findMany({
      where: {
        status: 'Active'
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }]
    });

    // Consumer app: skip Merchant-only forms (portal uses for = User | Merchant)
    const userFacingForms = allForms.filter((form) => {
      const role = String(form.for ?? 'User').trim().toLowerCase();
      return role !== 'merchant';
    });

    // Forms with empty countries apply to all countries (common in local/dev seeds).
    const filteredForms = userFacingForms.filter((form) => {
      const countries = Array.isArray(form.countries) ? form.countries : [];
      const normalizedList = countries
        .map((x) => String(x).trim().toUpperCase())
        .filter(Boolean);
      if (normalizedList.length === 0) return true;
      return normalizedList.some((cc) => requested.has(cc));
    });

    // Transform data to match frontend format
    const formattedForms = filteredForms.map(form => ({
      id: form.id,
      name: form.name,
      description: form.description || null,
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
    const { name, description, for: forType, kycStatus, countries, fields, priority, maxAmount } = req.body;

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
        ...(description !== undefined && { description: description ? description.trim() : null }),
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
        description: updatedForm.description || null,
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
