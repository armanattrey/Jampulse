const express = require('express');
const router = express.Router();
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

    const jam = await JamSession.findById(jamSessionId);
    if (!jam) {
      return res.status(404).json({ error: 'Jam session not found.' });
    }

    const hostId = jam.hostUser;

    if (hostId.toString() === senderId.toString()) {
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

// 2. Fetch messages in a thread
router.get('/:conversationId/messages', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const messages = await Message.find({ conversation: conversationId })
      .sort({ createdAt: 1 })
      .select('sender senderName text createdAt isRead');

    res.status(200).json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Could not load messages.' });
  }
});

// 3. Post a message to the thread
router.post('/:conversationId/message', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { text } = req.body;
    const senderId = req.user._id;
    const senderName = req.user.name || 'Musician';

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.participants.includes(senderId)) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const newMessage = await Message.create({
      conversation: conversationId,
      sender: senderId,
      senderName,
      text: text.trim()
    });

    conversation.lastMessage = {
      text: text.trim(),
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