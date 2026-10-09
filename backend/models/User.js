const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true, 
    trim: true 
  },
  phone: { 
    type: String, 
    index: { unique: true, sparse: true }, 
    trim: true 
  },
  phoneVerified: { type: Boolean, default: false },
  lastPrivateCallAt: { type: Date, default: null },
  email: { 
    type: String, 
    index: { unique: true, sparse: true }, 
    lowercase: true, 
    trim: true 
  },
  authProvider: { 
    type: String, 
    enum: ['phone', 'email', 'google', 'guest'], 
    default: 'phone' 
  },
  instruments: [{ 
    type: String,
    trim: true 
  }],
  bio: { 
    type: String, 
    default: 'Vibing & strumming with open ears.',
    trim: true 
  },
  role: { 
    type: String, 
    enum: [
      'Vocalist', 
      'Guitarist', 
      'Drummer/Percussion', 
      'Bassist', 
      'Keys', 
      'Listener/Fan', 
      'Musician'
    ], 
    default: 'Guitarist' 
  },
  avatarUrl: { 
    type: String, 
    default: '',
    trim: true 
  },
  // Cooldown Tracking Timestamps
  lastNameChange: { 
    type: Date, 
    default: null 
  },
  lastPhoneChange: { 
    type: Date, 
    default: null 
  },
  joinedAt: { 
    type: Date, 
    default: Date.now 
  }
});

module.exports = mongoose.model('User', UserSchema);
