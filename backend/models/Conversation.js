const mongoose = require('mongoose');

const ConversationSchema = new mongoose.Schema({
  jamSession: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JamSession',
    required: true
  },
  participants: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  ],
  lastMessage: {
    text: { type: String, default: '' },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sentAt: { type: Date, default: Date.now }
  },
  createdAt: { type: Date, default: Date.now }
});

ConversationSchema.index({ jamSession: 1, participants: 1 });
ConversationSchema.index({ participants: 1, 'lastMessage.sentAt': -1 });

module.exports = mongoose.model('Conversation', ConversationSchema);
