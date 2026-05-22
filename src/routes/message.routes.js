import express from 'express';
import * as messageController from '../controllers/message.controller.js';
import { authenticateMessageUser } from '../middleware/messageAuth.js';

const router = express.Router();

router.get('/support', messageController.getSupportUser);
router.get('/chat-eligible-customers', authenticateMessageUser, messageController.getChatEligibleCustomers);
router.get('/with', authenticateMessageUser, messageController.getMessagesWithUser);
router.post('/send', authenticateMessageUser, messageController.sendMessage);
router.post('/rate', authenticateMessageUser, messageController.submitChatRating);

router.get('/session-request/status', authenticateMessageUser, messageController.getMySessionRequestStatus);
router.get('/session-status', authenticateMessageUser, messageController.getMyChatSessionStatus);
router.get('/session-requests', authenticateMessageUser, messageController.getSessionRequests);
router.post('/session-requests/approve', authenticateMessageUser, messageController.approveSessionRequest);
router.post('/session-requests/reject', authenticateMessageUser, messageController.rejectSessionRequest);

router.get('/active-chat', authenticateMessageUser, messageController.getActiveChatSession);
router.get('/my-conversations', authenticateMessageUser, messageController.getMyConversations);
router.post('/claim-chat', authenticateMessageUser, messageController.claimChatSession);
router.post('/release-chat', authenticateMessageUser, messageController.releaseChatSession);
router.post('/transfer-chat', authenticateMessageUser, messageController.transferChatSession);

export default router;
