const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const JamSession = require('../models/JamSession');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_dev_secret';

// Auth Guard Middleware
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Sign-in required for this action.' });
  }
  try {
    const token = authHeader.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
};

// GET /api/jams - Geospatial Query with Sort, Search & Vibe Filters
router.get('/', async (req, res) => {
  try {
    const { lat, lng, radiusKm = 25, sortBy = 'distance', vibe, query } = req.query;

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);

    if (isNaN(userLat) || isNaN(userLng)) {
      return res.status(400).json({ error: 'Valid user latitude and longitude are required.' });
    }

    const radiusMeters = parseFloat(radiusKm) * 1000;

    const pipeline = [
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [userLng, userLat] },
          distanceField: 'distanceMeters',
          maxDistance: radiusMeters,
          spherical: true
        }
      }
    ];

    const matchConditions = {};
    if (vibe && vibe !== 'All') {
      matchConditions.vibe = vibe;
    }
    if (query && query.trim() !== '') {
      const regex = new RegExp(query.trim(), 'i');
      matchConditions.$or = [
        { title: regex },
        { hostTeam: regex },
        { locationName: regex },
        { genres: regex }
      ];
    }

    if (Object.keys(matchConditions).length > 0) {
      pipeline.push({ $match: matchConditions });
    }

    // Dynamic Sorting
    if (sortBy === 'distance') {
      pipeline.push({ $sort: { distanceMeters: 1 } });
    } else if (sortBy === 'rating') {
      pipeline.push({ $sort: { averageRating: -1, ratingCount: -1 } });
    } else if (sortBy === 'timing') {
      pipeline.push({ $sort: { startTime: 1 } });
    }

    const jams = await JamSession.aggregate(pipeline);
    res.json(jams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jams/register - Register a Jamming Group / Event
router.post('/register', verifyToken, async (req, res) => {
  try {
    const {
      title,
      description,
      hostTeam,
      vibe,
      genres,
      instrumentsNeeded,
      locationName,
      address,
      lat,
      lng,
      startTime,
      endTime
    } = req.body;

    if (!title || !hostTeam || !lat || !lng || !startTime || !endTime) {
      return res.status(400).json({ error: 'Required event coordinates or info missing.' });
    }

    const newJam = await JamSession.create({
      title,
      description,
      hostTeam,
      hostUser: req.user.userId,
      vibe: vibe || 'Acoustic Unplugged',
      genres: Array.isArray(genres) ? genres : (genres ? genres.split(',').map(s => s.trim()) : ['Open Jam']),
      instrumentsNeeded: Array.isArray(instrumentsNeeded) ? instrumentsNeeded : (instrumentsNeeded ? instrumentsNeeded.split(',').map(s => s.trim()) : []),
      locationName,
      address: address || '',
      location: {
        type: 'Point',
        coordinates: [parseFloat(lng), parseFloat(lat)]
      },
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      rsvpUsers: [req.user.userId]
    });

    res.status(201).json(newJam);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jams/:id/rsvp - Join or Leave a Jam
router.post('/:id/rsvp', verifyToken, async (req, res) => {
  try {
    const jam = await JamSession.findById(req.params.id);
    if (!jam) return res.status(404).json({ error: 'Jam session not found.' });

    const userId = req.user.userId;
    const isAttending = jam.rsvpUsers.some(id => id.toString() === userId.toString());

    if (isAttending) {
      jam.rsvpUsers = jam.rsvpUsers.filter(id => id.toString() !== userId.toString());
    } else {
      jam.rsvpUsers.push(userId);
    }

    await jam.save();
    res.json({ success: true, isAttending: !isAttending, rsvpCount: jam.rsvpUsers.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;