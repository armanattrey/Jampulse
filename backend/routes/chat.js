const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const authMiddleware = require('../middleware/authMiddleware');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const JamSession = require('../models/JamSession');

// Protect all chat routes with authentication
router.use(authMiddleware);

// 1. Initiate or find an active chat thread for a Jam
router.post('/initiate', async (req, res) => {
  try {
    const { jamSessionId } = req.body;
    const senderId = req.user._id;

    if (!mongoose.isValidObjectId(jamSessionId)) {
      return res.status(400).json({ error: 'Invalid jam session id.' });
    }

    const jam = await JamSession.findById(jamSessionId);
    if (!jam) {
      return res.status(404).json({ error: 'Jam session not found.' });
    }
    if (!jam.allowInAppChat) {
      return res.status(403).json({ error: 'In-app messaging is disabled for this jam.' });
    }

    const hostId = jam.hostUser;

    if (hostId.equals(senderId)) {
      return res.status(400).json({ error: 'You cannot initiate a chat with your own jam.' });
    }

    let conversation = await Conversation.findOne({
      jamSession: jamSessionId,
      participants: { $all: [senderId, hostId] }
    });

    if (!conversation) {
      conversation = await Conversation.create({
        jamSession: jamSessionId,
        participants: [senderId, hostId],
        lastMessage: {
          text: 'Conversation started',
          sender: senderId,
          sentAt: new Date()
        }
      });
    }

    res.status(200).json({ conversationId: conversation._id });
  } catch (err) {
    console.error('Chat initiate error:', err);
    res.status(500).json({ error: 'Failed to initiate chat.' });
  }
});

// 2. List the signed-in user's conversations for the inbox
router.get('/conversations', async (req, res) => {
  try {
    const conversations = await Conversation.find({ participants: req.user._id })
      .sort({ 'lastMessage.sentAt': -1, createdAt: -1 })
      .limit(100)
      .populate('jamSession', 'title hostTeam')
      .populate('participants', 'name role avatarUrl')
      .lean();

    const userId = req.user._id.toString();
    return res.json(conversations.map((conversation) => ({
      ...conversation,
      otherParticipant: conversation.participants.find((participant) => participant._id.toString() !== userId) || null
    })));
  } catch (err) {
    console.error('Chat inbox error:', err.message);
    return res.status(500).json({ error: 'Could not load conversations.' });
  }
});

// 3. Fetch messages in a thread
router.get('/:conversationId/messages', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id;

    if (!mongoose.isValidObjectId(conversationId)) {
      return res.status(400).json({ error: 'Invalid conversation id.' });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.participants.some((participant) => participant.equals(userId))) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 100;
    const messages = await Message.find({ conversation: conversationId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .select('sender senderName text createdAt isRead');

    res.status(200).json(messages.reverse());
  } catch (err) {
    res.status(500).json({ error: 'Could not load messages.' });
  }
});

// 4. Post a message to the thread
router.post('/:conversationId/message', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { text } = req.body;
    const senderId = req.user._id;
    const senderName = req.user.name || 'Musician';
    const cleanText = typeof text === 'string' ? text.trim() : '';

    if (!mongoose.isValidObjectId(conversationId)) {
      return res.status(400).json({ error: 'Invalid conversation id.' });
    }

    if (!cleanText) {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }
    if (cleanText.length > 1000) {
      return res.status(400).json({ error: 'Message must be 1000 characters or fewer.' });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.participants.some((participant) => participant.equals(senderId))) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const newMessage = await Message.create({
      conversation: conversationId,
      sender: senderId,
      senderName,
      text: cleanText
    });

    conversation.lastMessage = {
      text: cleanText,
      sender: senderId,
      sentAt: new Date()
    };
    await conversation.save();

    res.status(201).json(newMessage);
  } catch (err) {
    res.status(500).json({ error: 'Failed to send message.' });
  }
});

module.exports = router;
