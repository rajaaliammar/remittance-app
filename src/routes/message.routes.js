import express from 'express';
import * as messageController from '../controllers/message.controller.js';
import { authenticateMessageUser } from '../middleware/messageAuth.js';

const router = express.Router();

router.get('/support', messageController.getSupportUser);
router.get('/with', authenticateMessageUser, messageController.getMessagesWithUser);
router.post('/send', authenticateMessageUser, messageController.sendMessage);

router.get('/session-requests', authenticateMessageUser, messageController.getSessionRequests);
router.post('/session-requests/approve', authenticateMessageUser, messageController.approveSessionRequest);
router.post('/session-requests/reject', authenticateMessageUser, messageController.rejectSessionRequest);

export default router;
