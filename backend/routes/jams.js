const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const JamSession = require('../models/JamSession');
const authMiddleware = require('../middleware/authMiddleware');

const ALLOWED_RADII = [5, 10, 25, 50];
const MAX_SEARCH_RADIUS_KM = 20100;
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /api/jams - Geospatial Query with Sort, Search & Vibe Filters
router.get('/', async (req, res) => {
  try {
    const { lat, lng, radiusKm = 25, mapRadiusKm, sortBy = 'distance', vibe, query } = req.query;

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);

    if (!Number.isFinite(userLat) || !Number.isFinite(userLng) || Math.abs(userLat) > 90 || Math.abs(userLng) > 180) {
      return res.status(400).json({ error: 'Valid user latitude and longitude are required.' });
    }

    const parsedRadius = Number(radiusKm);
    if (!Number.isInteger(parsedRadius) || parsedRadius < 1 || parsedRadius > MAX_SEARCH_RADIUS_KM) {
      return res.status(400).json({ error: `Search radius must be a whole number between 1 and ${MAX_SEARCH_RADIUS_KM} km, or Any distance.` });
    }

    const parsedMapRadius = mapRadiusKm === undefined ? parsedRadius : Number(mapRadiusKm);
    if (!Number.isInteger(parsedMapRadius) || parsedMapRadius < parsedRadius || parsedMapRadius > MAX_SEARCH_RADIUS_KM) {
      return res.status(400).json({ error: `Map radius must be between the selected distance and ${MAX_SEARCH_RADIUS_KM} km.` });
    }

    const radiusMeters = parsedMapRadius * 1000;

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
    pipeline.push({
      $addFields: {
        withinSearchRadius: { $lte: ['$distanceMeters', parsedRadius * 1000] }
      }
    });

    const matchConditions = {};
    if (vibe && vibe !== 'All') {
      matchConditions.vibe = vibe;
    }
    const searchText = typeof query === 'string' ? query.trim().slice(0, 80) : '';
    if (searchText) {
      const regex = new RegExp(escapeRegex(searchText), 'i');
      matchConditions.$or = [
        { title: regex },
        { hostTeam: regex },
        { locationName: regex },
        { genres: regex }
      ];
    }

    // A jam is visible only inside both the visitor's search radius and the host's radius.
    pipeline.push({ $match: { endTime: { $gt: new Date() }, status: { $in: ['upcoming', 'live'] } } });
    pipeline.push({
      $match: {
        $expr: {
          $lte: ['$distanceMeters', { $multiply: [{ $ifNull: ['$discoveryRadiusKm', 10] }, 1000] }]
        }
      }
    });

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
    } else {
      pipeline.push({ $sort: { distanceMeters: 1 } });
    }

    // Keep public discovery responses bounded even if a busy area has many jams.
    pipeline.push({ $limit: 100 });
    pipeline.push({
      $lookup: {
        from: 'users',
        let: { hostId: '$hostUser' },
        pipeline: [
          { $match: { $expr: { $eq: ['$_id', '$$hostId'] } } },
          { $project: { name: 1, role: 1, avatarUrl: 1 } }
        ],
        as: 'hostProfile'
      }
    });
    pipeline.push({ $addFields: { hostProfile: { $first: '$hostProfile' } } });
    const jams = await JamSession.aggregate(pipeline);
    res.json(jams);
  } catch (err) {
    console.error('Jam discovery failed:', err.message);
    res.status(500).json({ error: 'Could not find nearby jams.' });
  }
});

// POST /api/jams/register - Register a Jamming Group / Event
router.post('/register', authMiddleware, async (req, res) => {
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
      endTime,
      discoveryRadiusKm = 10,
      allowPhoneCalls = false
    } = req.body;

    const latitude = Number(lat);
    const longitude = Number(lng);
    const startsAt = new Date(startTime);
    const endsAt = new Date(endTime);
    const radius = Number(discoveryRadiusKm);
    const wantsPrivateCalls = allowPhoneCalls === true;

    if (!title?.trim() || !hostTeam?.trim() || !locationName?.trim() || lat === undefined || lat === null || lat === '' || lng === undefined || lng === null || lng === '' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
      return res.status(400).json({ error: 'Required event coordinates or info missing.' });
    }
    if (!ALLOWED_RADII.includes(radius)) return res.status(400).json({ error: 'Choose a discovery radius of 5, 10, 25, or 50 km.' });
    if (wantsPrivateCalls && (!req.user.phone || !req.user.phoneVerified)) {
      return res.status(403).json({ error: 'Verify your phone number before enabling private calls.' });
    }
    if (endsAt <= startsAt || startsAt <= new Date()) return res.status(400).json({ error: 'Choose a future start time and an end time after it.' });

    const newJam = await JamSession.create({
      title: title.trim(),
      description: String(description || '').trim(),
      hostTeam: hostTeam.trim(),
      hostUser: req.user._id,
      vibe: vibe || 'Acoustic Unplugged',
      genres: Array.isArray(genres) ? genres : (genres ? genres.split(',').map(s => s.trim()) : ['Open Jam']),
      instrumentsNeeded: Array.isArray(instrumentsNeeded) ? instrumentsNeeded : (instrumentsNeeded ? instrumentsNeeded.split(',').map(s => s.trim()) : []),
      locationName: locationName.trim(),
      address: String(address || '').trim(),
      discoveryRadiusKm: radius,
      allowPhoneCalls: wantsPrivateCalls,
      location: {
        type: 'Point',
        coordinates: [longitude, latitude]
      },
      startTime: startsAt,
      endTime: endsAt,
      rsvpUsers: [req.user._id]
    });

    res.status(201).json(newJam);
  } catch (err) {
    console.error('Jam creation failed:', err.message);
    res.status(400).json({ error: 'Could not create jam. Check the submitted details.' });
  }
});

// POST /api/jams/:id/rsvp - Join or Leave a Jam
router.post('/:id/rsvp', authMiddleware, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid jam session id.' });
    }
    const jam = await JamSession.findById(req.params.id);
    if (!jam) return res.status(404).json({ error: 'Jam session not found.' });

    const userId = req.user._id;
    const isAttending = jam.rsvpUsers.some(id => id.toString() === userId.toString());

    if (isAttending) {
      jam.rsvpUsers = jam.rsvpUsers.filter(id => id.toString() !== userId.toString());
    } else {
      jam.rsvpUsers.push(userId);
    }

    await jam.save();
    res.json({ success: true, isAttending: !isAttending, rsvpCount: jam.rsvpUsers.length });
  } catch (err) {
    console.error('Jam RSVP update failed:', err.message);
    res.status(500).json({ error: 'Could not update RSVP.' });
  }
});

module.exports = router;
