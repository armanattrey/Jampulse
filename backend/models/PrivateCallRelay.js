const mongoose = require('mongoose');

const PrivateCallRelaySchema = new mongoose.Schema({
  connectionId: { type: String, required: true, unique: true },
  jamSession: { type: mongoose.Schema.Types.ObjectId, ref: 'JamSession', required: true },
  caller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  virtualNumber: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});

PrivateCallRelaySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
PrivateCallRelaySchema.index({ caller: 1, jamSession: 1, expiresAt: 1 });

module.exports = mongoose.model('PrivateCallRelay', PrivateCallRelaySchema);
