const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema({
  jamSession: { type: mongoose.Schema.Types.ObjectId, ref: 'JamSession', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName: { type: String, required: true },
  userRole: { type: String, default: 'Musician' },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, default: '', trim: true, maxlength: 1000 },
  createdAt: { type: Date, default: Date.now }
});

ReviewSchema.index({ jamSession: 1, createdAt: -1 });
ReviewSchema.index({ jamSession: 1, user: 1 });

module.exports = mongoose.model('Review', ReviewSchema);
