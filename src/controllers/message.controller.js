import prisma from '../utils/prisma.js';
import {
  listSessionRequests,
  getSessionRequest,
  removeSessionRequest,
} from '../store/sessionRequestStore.js';
import {
  claimChat,
  releaseChat,
  getActiveChat,
  transferChat,
} from '../store/activeChatStore.js';

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
      rating: m.rating ?? undefined,
      ratedAt: m.ratedAt ? (m.ratedAt.getTime ? m.ratedAt.getTime() : m.ratedAt) : undefined,
    }));
    res.json(list);
  } catch (error) {
    console.error('getMessagesWithUser error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Send a message. Auth: customer or backoffice. Body: { recipientId, content }.
 * If sender is backoffice and recipient is a customer, only the backoffice user who has claimed that customer can send.
 */
export const sendMessage = async (req, res) => {
  try {
    const senderId = req.userId;
    const userType = req.userType || 'customer';
    const { recipientId, content } = req.body;
    if (!recipientId || content === undefined || content === null) {
      return res.status(400).json({ success: false, message: 'recipientId and content are required' });
    }
    const text = String(content).trim();
    if (!text) {
      return res.status(400).json({ success: false, message: 'content cannot be empty' });
    }
    if (userType === 'backoffice') {
      const recipientIsCustomer = await prisma.customer.findUnique({
        where: { id: recipientId },
        select: { id: true },
      });
      if (recipientIsCustomer) {
        const active = getActiveChat(recipientId);
        if (active && String(active.claimedBy) !== String(senderId)) {
          return res.status(409).json({
            success: false,
            message: 'Another agent is currently chatting with this user. You cannot send messages until they end the chat.',
            code: 'CHAT_CLAIMED_BY_OTHER',
            claimedBy: active.claimedBy,
          });
        }
      }
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

const CHAT_ENDED_CONTENT = '__CHAT_ENDED__';

/**
 * Submit a rating for the most recently ended chat session (app user = recipient of support).
 * Body: { supportUserId, rating } where rating is 1-5.
 */
export const submitChatRating = async (req, res) => {
  try {
    const userId = req.userId;
    const { supportUserId, rating } = req.body;
    if (!supportUserId) {
      return res.status(400).json({ success: false, message: 'supportUserId is required' });
    }
    const ratingNum = typeof rating === 'number' ? rating : parseInt(String(rating), 10);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ success: false, message: 'rating must be an integer between 1 and 5' });
    }
    const lastEnded = await prisma.message.findFirst({
      where: {
        senderId: supportUserId,
        recipientId: userId,
        content: CHAT_ENDED_CONTENT,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!lastEnded) {
      return res.status(404).json({ success: false, message: 'No ended chat session found to rate' });
    }
    if (lastEnded.rating != null) {
      return res.status(400).json({ success: false, message: 'This session was already rated' });
    }
    await prisma.message.update({
      where: { id: lastEnded.id },
      data: { rating: ratingNum, ratedAt: new Date() },
    });
    const io = req.app.get('io');
    if (io) {
      io.emit('chatRated', {
        messageId: lastEnded.id,
        userId,
        supportUserId,
        rating: ratingNum,
      });
    }
    return res.json({ success: true, rating: ratingNum });
  } catch (error) {
    console.error('submitChatRating error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get active chat session for a customer (backoffice only). Query: userId (customer id).
 * Returns { claimed: false } or { claimed: true, claimedBy, startedAt }.
 */
export const getActiveChatSession = async (req, res) => {
  try {
    const backoffice = await prisma.backofficeUser.findUnique({
      where: { id: req.userId },
      select: { id: true, status: true },
    });
    if (!backoffice || backoffice.status !== 'approved') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    const customerId = req.query.userId;
    if (!customerId) {
      return res.status(400).json({ success: false, message: 'userId (customer id) is required' });
    }
    const active = getActiveChat(customerId);
    if (!active) {
      return res.json({ claimed: false });
    }
    return res.json({
      claimed: true,
      claimedBy: active.claimedBy,
      startedAt: active.startedAt,
    });
  } catch (error) {
    console.error('getActiveChatSession error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Claim a customer for chat (backoffice only). Body: { userId } (customer id).
 * Only one backoffice user can have an active chat with a customer at a time.
 */
export const claimChatSession = async (req, res) => {
  try {
    const backoffice = await prisma.backofficeUser.findUnique({
      where: { id: req.userId },
      select: { id: true, status: true },
    });
    if (!backoffice || backoffice.status !== 'approved') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    const customerId = req.body?.userId;
    if (!customerId) {
      return res.status(400).json({ success: false, message: 'userId (customer id) is required' });
    }
    const result = claimChat(customerId, req.userId);
    if (!result.success) {
      return res.status(409).json({
        success: false,
        message: 'Another agent is currently chatting with this user. Please wait until they end the chat.',
        code: 'CHAT_CLAIMED_BY_OTHER',
        claimedBy: result.claimedBy,
      });
    }
    return res.json({ success: true, claimedBy: result.claimedBy });
  } catch (error) {
    console.error('claimChatSession error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Release a customer chat session (backoffice only). Body: { userId } (customer id).
 * Call when the agent ends the chat so other agents can chat with that customer.
 */
export const releaseChatSession = async (req, res) => {
  try {
    const backoffice = await prisma.backofficeUser.findUnique({
      where: { id: req.userId },
      select: { id: true, status: true },
    });
    if (!backoffice || backoffice.status !== 'approved') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    const customerId = req.body?.userId;
    if (!customerId) {
      return res.status(400).json({ success: false, message: 'userId (customer id) is required' });
    }
    releaseChat(customerId);
    return res.json({ success: true });
  } catch (error) {
    console.error('releaseChatSession error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get customers the current backoffice user has chatted with (my conversations).
 * Auth: backoffice only.
 */
export const getMyConversations = async (req, res) => {
  try {
    const backoffice = await prisma.backofficeUser.findUnique({
      where: { id: req.userId },
      select: { id: true, status: true },
    });
    if (!backoffice || backoffice.status !== 'approved') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    const myId = req.userId;
    const messages = await prisma.message.findMany({
      where: {
        OR: [{ senderId: myId }, { recipientId: myId }],
      },
      select: { senderId: true, recipientId: true },
    });
    const customerIds = new Set();
    for (const m of messages) {
      const other = m.senderId === myId ? m.recipientId : m.senderId;
      customerIds.add(other);
    }
    const ids = Array.from(customerIds);
    if (ids.length === 0) {
      return res.json([]);
    }
    const customers = await prisma.customer.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
      },
    });
    return res.json(customers);
  } catch (error) {
    console.error('getMyConversations error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Transfer an active chat to another backoffice user.
 * Body: { userId: customerId, targetBackofficeUserId: string }.
 */
export const transferChatSession = async (req, res) => {
  try {
    const backoffice = await prisma.backofficeUser.findUnique({
      where: { id: req.userId },
      select: { id: true, status: true },
    });
    if (!backoffice || backoffice.status !== 'approved') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    const customerId = req.body?.userId;
    const targetBackofficeUserId = req.body?.targetBackofficeUserId;
    if (!customerId || !targetBackofficeUserId) {
      return res.status(400).json({
        success: false,
        message: 'userId (customer id) and targetBackofficeUserId are required',
      });
    }
    const targetUser = await prisma.backofficeUser.findUnique({
      where: { id: targetBackofficeUserId },
      select: { id: true, status: true },
    });
    if (!targetUser || targetUser.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Target backoffice user not found or not approved',
      });
    }
    const result = transferChat(customerId, req.userId, targetBackofficeUserId);
    if (!result.success) {
      if (result.reason === 'not_claimed_by_you') {
        return res.status(409).json({
          success: false,
          message: 'You do not have an active chat with this user. Only the agent currently chatting can transfer.',
          code: 'CHAT_CLAIMED_BY_OTHER',
        });
      }
      if (result.reason === 'no_active_chat') {
        return res.status(400).json({
          success: false,
          message: 'No active chat session with this user to transfer',
        });
      }
      return res.status(400).json({ success: false, message: result.reason || 'Transfer failed' });
    }
    return res.json({ success: true, message: 'Chat transferred successfully' });
  } catch (error) {
    console.error('transferChatSession error:', error);
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
