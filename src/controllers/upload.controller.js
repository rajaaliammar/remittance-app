import { persistMulterFile, resolvePublicFileUrl } from '../utils/objectStorage.js';

export const uploadCmsImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file uploaded.' });
    }
    const stored = await persistMulterFile(req.file, 'cms', {
      filenamePrefix: 'cms',
    });
    const url = resolvePublicFileUrl(stored?.url);
    res.json({ success: true, url });
  } catch (error) {
    console.error('Error uploading CMS image:', error);
    res.status(500).json({ success: false, message: error?.message || 'Upload failed.' });
  }
};
