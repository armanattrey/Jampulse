const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true, 
    trim: true 
  },
  phone: { 
    type: String, 
    sparse: true, 
    trim: true 
  },
  email: { 
    type: String, 
    sparse: true, 
    lowercase: true, 
    trim: true 
  },
  authProvider: { 
    type: String, 
    enum: ['phone', 'email', 'google', 'guest'], 
    default: 'phone' 
  },
  instruments: [{ 
    type: String 
  }],
  bio: { 
    type: String, 
    default: 'Vibing & strumming with open ears.' 
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
    default: '' 
  },
  joinedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Explicit partial index to guarantee uniqueness only when non-empty
UserSchema.index(
  { email: 1 }, 
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } }
);
UserSchema.index(
  { phone: 1 }, 
  { unique: true, partialFilterExpression: { phone: { $type: 'string' } } }
);

module.exports = mongoose.model('User', UserSchema);