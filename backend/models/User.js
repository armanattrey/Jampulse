const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, sparse: true, unique: true, trim: true },
  email: { type: String, sparse: true, unique: true, lowercase: true, trim: true },
  authProvider: { type: String, enum: ['phone', 'google', 'guest'], default: 'phone' },
  instruments: [{ type: String }],
  bio: { type: String, default: 'Vibing & strumming with open ears.' },
  role: { type: String, enum: ['Vocalist', 'Guitarist', 'Drummer/Percussion', 'Bassist', 'Keys', 'Listener/Fan'], default: 'Guitarist' },
  avatarUrl: { type: String, default: '' },
  joinedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);