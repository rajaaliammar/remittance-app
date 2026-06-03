import {
  amlGetLastUpdateDate,
  amlValidateIp,
  amlGetMaxOccupationId,
  amlCreateBusinessActivity,
  amlCreateOccupation,
  amlGetActiveRules,
} from '../services/amlProvider.service.js';

function providerError(res, raw, fallbackMessage) {
  if (raw?.isError) {
    return res.status(400).json({
      success: false,
      message: raw.message || fallbackMessage,
      messageCode: raw.messageCode,
      messageDetails: raw.messageDetails,
      provider: raw,
    });
  }
  return null;
}

/** GET /api/utilities/last-update-date */
export const getLastUpdateDate = async (_req, res) => {
  try {
    const raw = await amlGetLastUpdateDate();
    const err = providerError(res, raw, 'Failed to fetch last update date');
    if (err) return err;

    // Normalise: spec says { lastUpdate }, but provider may return the date inside `message`
    const lastUpdate =
      raw?.lastUpdate ||
      raw?.LastUpdate ||
      (typeof raw?.message === 'string' && !raw.isError ? raw.message : null) ||
      (typeof raw === 'string' ? raw : null);

    return res.json({
      success: true,
      data: { lastUpdate, raw },
    });
  } catch (error) {
    console.error('[Utilities] getLastUpdateDate:', error.message);
    return res.json({
      success: false,
      message: error.message || 'Failed to fetch AML last update date',
      error: error.data || undefined,
    });
  }
};

/** POST /api/utilities/validate-ip */
export const validateIp = async (req, res) => {
  try {
    const { IpAddress, ipAddress } = req.body || {};
    const ip = String(IpAddress || ipAddress || '').trim();
    if (!ip) {
      return res.status(400).json({
        success: false,
        message: 'IpAddress is required',
      });
    }

    const raw = await amlValidateIp(ip);
    const err = providerError(res, raw, 'IP validation failed');
    if (err) return err;

    // Utilities spec: { "isValid": true }
    const isValid =
      typeof raw?.isValid === 'boolean'
        ? raw.isValid
        : typeof raw?.IsValid === 'boolean'
          ? raw.IsValid
          : typeof raw === 'boolean'
            ? raw
            : !raw?.isError;

    return res.json({
      success: true,
      data: {
        isValid: Boolean(isValid),
        IpAddress: ip,
      },
      provider: raw && typeof raw === 'object' ? raw : undefined,
    });
  } catch (error) {
    console.error('[Utilities] validateIp:', error.message);
    return res.json({
      success: false,
      message: error.message || 'Failed to validate IP address',
      error: error.data || undefined,
    });
  }
};

/** GET /api/utilities/max-occupation-id */
export const getMaxOccupationId = async (_req, res) => {
  try {
    const raw = await amlGetMaxOccupationId();
    const err = providerError(res, raw, 'Failed to fetch max occupation ID');
    if (err) return err;

    // AML spec: plain integer response (e.g. 254)
    const maxId =
      typeof raw === 'number'
        ? raw
        : typeof raw?.id === 'number'
          ? raw.id
          : parseInt(String(raw?.maxId ?? raw?.MaxId ?? raw ?? ''), 10) || null;

    return res.json({
      success: true,
      data: { maxId },
    });
  } catch (error) {
    console.error('[Utilities] getMaxOccupationId:', error.message);
    return res.json({
      success: false,
      message: error.message || 'Failed to fetch max occupation/business activity ID',
      error: error.data || undefined,
    });
  }
};

/** POST /api/utilities/business-activity */
export const createBusinessActivity = async (req, res) => {
  try {
    const { id, name } = req.body || {};
    if (id === undefined || id === null) {
      return res.status(400).json({
        success: false,
        message: 'id is required',
      });
    }
    if (!name?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'name is required',
      });
    }

    const raw = await amlCreateBusinessActivity({ id: Number(id), name: name.trim() });
    const err = providerError(res, raw, 'Failed to create business activity');
    if (err) return err;

    return res.json({
      success: true,
      message: raw?.status || raw?.message || 'Business activity created',
      data: raw,
    });
  } catch (error) {
    console.error('[Utilities] createBusinessActivity:', error.message);
    return res.json({
      success: false,
      message: error.message || 'Failed to create business activity',
      error: error.data || undefined,
    });
  }
};

/** POST /api/utilities/occupation */
export const createOccupation = async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'name is required',
      });
    }

    const raw = await amlCreateOccupation({ name: name.trim() });
    const err = providerError(res, raw, 'Failed to create occupation');
    if (err) return err;

    return res.json({
      success: true,
      message: raw?.message || 'Occupation created',
      data: raw,
    });
  } catch (error) {
    console.error('[Utilities] createOccupation:', error.message);
    return res.json({
      success: false,
      message: error.message || 'Failed to create occupation',
      error: error.data || undefined,
    });
  }
};

/** GET /api/utilities/active-rules */
export const getActiveRules = async (_req, res) => {
  try {
    const raw = await amlGetActiveRules();
    const err = providerError(res, raw, 'Failed to fetch active AML rules');
    if (err) return err;

    return res.json({
      success: true,
      data: raw,
    });
  } catch (error) {
    console.error('[Utilities] getActiveRules:', error.message);
    return res.json({
      success: false,
      message: error.message || 'Failed to fetch active AML rules',
      error: error.data || undefined,
    });
  }
};
