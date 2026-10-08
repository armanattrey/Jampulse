const express = require('express');
const mongoose = require('mongoose');
const authMiddleware = require('../middleware/authMiddleware');
const JamSession = require('../models/JamSession');
const Review = require('../models/Review');

const router = express.Router();

router.get('/:jamSessionId', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.jamSessionId)) {
      return res.status(400).json({ error: 'Invalid jam session id.' });
    }

    const reviews = await Review.find({ jamSession: req.params.jamSessionId })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('userName userRole rating comment createdAt');

    return res.json(reviews);
  } catch (error) {
    return res.status(500).json({ error: 'Could not load reviews.' });
  }
});

router.post('/:jamSessionId', authMiddleware, async (req, res) => {
  try {
    const { rating, comment = '' } = req.body;
    const score = Number(rating);
    const cleanComment = String(comment).trim().slice(0, 1000);

    if (!mongoose.isValidObjectId(req.params.jamSessionId)) {
      return res.status(400).json({ error: 'Invalid jam session id.' });
    }
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return res.status(400).json({ error: 'Rating must be a whole number from 1 to 5.' });
    }

    const jam = await JamSession.findById(req.params.jamSessionId);
    if (!jam) return res.status(404).json({ error: 'Jam session not found.' });

    const review = await Review.findOneAndUpdate(
      { jamSession: jam._id, user: req.user._id },
      {
        jamSession: jam._id,
        user: req.user._id,
        userName: req.user.name || 'Musician',
        userRole: req.user.role || 'Musician',
        rating: score,
        comment: cleanComment
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    const [summary] = await Review.aggregate([
      { $match: { jamSession: jam._id } },
      { $group: { _id: null, averageRating: { $avg: '$rating' }, ratingCount: { $sum: 1 } } }
    ]);
    jam.averageRating = summary?.averageRating || 0;
    jam.ratingCount = summary?.ratingCount || 0;
    await jam.save();

    return res.status(201).json(review);
  } catch (error) {
    console.error('Review save error:', error.message);
    return res.status(500).json({ error: 'Could not save review.' });
  }
});

module.exports = router;
