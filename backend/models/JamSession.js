const mongoose = require('mongoose');

const JamSessionSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true, maxlength: 3000 },
  hostTeam: { type: String, required: true, trim: true },
  hostUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  vibe: {
    type: String,
    enum: ['Acoustic Unplugged', 'Electric Jam', 'Open Mic', 'Sufi & Classical', 'Chill Electronic', 'Jazz & Blues'],
    default: 'Acoustic Unplugged'
  },
  genres: [{ type: String }],
  instrumentsNeeded: [{ type: String }],
  locationName: { type: String, required: true },
  address: { type: String, default: '' },
  discoveryRadiusKm: { type: Number, enum: [5, 10, 25, 50], default: 10 },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true } // [longitude, latitude]
  },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  rsvpUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  averageRating: { type: Number, default: 0 },
  ratingCount: { type: Number, default: 0 },
  allowInAppChat: { type: Boolean, default: true }, // Enables masked in-app communication
  allowPhoneCalls: { type: Boolean, default: false }, // Host opts in to verified, privacy-masked calls
  status: { type: String, enum: ['upcoming', 'live', 'completed'], default: 'upcoming' },
  createdAt: { type: Date, default: Date.now }
});

JamSessionSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('JamSession', JamSessionSchema);
