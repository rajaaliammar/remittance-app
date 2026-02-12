import prisma from '../utils/prisma.js';
import {
  listSessionRequests,
  getSessionRequest,
  removeSessionRequest,
} from '../store/sessionRequestStore.js';

/**
 * Get support user ID for chat.
 * Set SUPPORT_USER_ID in .env to a BackofficeUser id to receive app chats; otherwise uses first approved backoffice user.
 */
export const getSupportUser = async (req, res) => {
  try {
    const supportId = process.env.SUPPORT_USER_ID;
    if (supportId) {
      return res.json({ id: supportId });
    }
    const user = await prisma.backofficeUser.findFirst({
      where: { status: 'approved' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!user) {
      return res.status(404).json({ success: false, message: 'Support user not configured' });
    }
    res.json({ id: user.id });
  } catch (error) {
    console.error('getSupportUser error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get messages between current user and another user. Auth: customer or backoffice.
 */
export const getMessagesWithUser = async (req, res) => {
  try {
    const userId = req.userId;
    const otherUserId = req.query.userId;
    if (!otherUserId) {
      return res.status(400).json({ success: false, message: 'userId is required' });
    }
    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: userId, recipientId: otherUserId },
          { senderId: otherUserId, recipientId: userId },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    const list = messages.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      recipientId: m.recipientId,
      content: m.content,
      createdAt: m.createdAt.getTime ? m.createdAt.getTime() : m.createdAt,
    }));
    res.json(list);
  } catch (error) {
    console.error('getMessagesWithUser error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Send a message. Auth: customer or backoffice. Body: { recipientId, content }.
 * Emits to recipient via Socket.io (caller must pass io from req.app.get('io')).
 */
export const sendMessage = async (req, res) => {
  try {
    const senderId = req.userId;
    const { recipientId, content } = req.body;
    if (!recipientId || content === undefined || content === null) {
      return res.status(400).json({ success: false, message: 'recipientId and content are required' });
    }
    const text = String(content).trim();
    if (!text) {
      return res.status(400).json({ success: false, message: 'content cannot be empty' });
    }
    const message = await prisma.message.create({
      data: { senderId, recipientId, content: text },
    });
    const timestamp = message.createdAt.getTime ? message.createdAt.getTime() : message.createdAt;
    const payload = {
      id: message.id,
      senderId: message.senderId,
      recipientId: message.recipientId,
      content: message.content,
      createdAt: timestamp,
    };
    const io = req.app.get('io');
    if (io) {
      const receivePayload = { id: payload.id, senderId: payload.senderId, receiverId: payload.recipientId, message: payload.content, timestamp };
      io.emit('receiveMessage', receivePayload);
      console.log('[Message] Broadcast receiveMessage to all clients from', senderId);
    }
    res.json(payload);
  } catch (error) {
    console.error('sendMessage error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * List pending new-session requests (admin only). Used by portal to show approve/reject UI.
 */
export const getSessionRequests = async (req, res) => {
  try {
    const backoffice = await prisma.backofficeUser.findUnique({
      where: { id: req.userId },
      select: { id: true, status: true },
    });
    if (!backoffice || backoffice.status !== 'approved') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    const list = listSessionRequests();
    return res.json(list);
  } catch (error) {
    console.error('getSessionRequests error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Approve a new-session request. Notifies the user via socket so they can send messages again.
 */
export const approveSessionRequest = async (req, res) => {
  try {
    const backoffice = await prisma.backofficeUser.findUnique({
      where: { id: req.userId },
      select: { id: true, status: true },
    });
    if (!backoffice || backoffice.status !== 'approved') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    const { requestId } = req.body;
    if (!requestId) {
      return res.status(400).json({ success: false, message: 'requestId is required' });
    }
    const request = getSessionRequest(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found or already handled' });
    }
    removeSessionRequest(requestId);
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${request.userId}`).emit('sessionRequestApproved', { requestId });
    }
    return res.json({ success: true, requestId });
  } catch (error) {
    console.error('approveSessionRequest error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Reject a new-session request. Sends rejection message to user via socket.
 */
export const rejectSessionRequest = async (req, res) => {
  try {
    const backoffice = await prisma.backofficeUser.findUnique({
      where: { id: req.userId },
      select: { id: true, status: true },
    });
    if (!backoffice || backoffice.status !== 'approved') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    const { requestId, message } = req.body;
    if (!requestId) {
      return res.status(400).json({ success: false, message: 'requestId is required' });
    }
    const request = getSessionRequest(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found or already handled' });
    }
    removeSessionRequest(requestId);
    const io = req.app.get('io');
    const rejectionMessage = message != null ? String(message).trim() : 'Your request to start a new chat session was declined.';
    if (io) {
      io.to(`user:${request.userId}`).emit('sessionRequestRejected', {
        requestId,
        message: rejectionMessage,
      });
    }
    return res.json({ success: true, requestId });
  } catch (error) {
    console.error('rejectSessionRequest error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
