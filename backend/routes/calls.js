const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const authMiddleware = require('../middleware/authMiddleware');
const Conversation = require('../models/Conversation');
const JamSession = require('../models/JamSession');
const Message = require('../models/Message');
const PrivateCallRelay = require('../models/PrivateCallRelay');
const User = require('../models/User');

const router = express.Router();
const RELAY_LIFETIME_MS = 10 * 60 * 1000;
const CALL_COOLDOWN_MS = 10 * 60 * 1000;
const CALLS_PER_HOUR_LIMIT = 4;

router.use(authMiddleware);

router.post('/request', async (req, res) => {
  let cooldownClaimed = false;
  let cooldownTimestamp = null;
  try {
    const { jamSessionId } = req.body;
    if (!mongoose.isValidObjectId(jamSessionId)) {
      return res.status(400).json({ error: 'A valid jam session is required.' });
    }

    const jam = await JamSession.findById(jamSessionId);
    if (!jam) return res.status(404).json({ error: 'Jam session not found.' });
    if (!jam.allowPhoneCalls) return res.status(403).json({ error: 'The host has not enabled private calls for this jam.' });
    if (jam.hostUser.equals(req.user._id)) return res.status(400).json({ error: 'You are the host of this jam.' });
    if (!jam.rsvpUsers.some((id) => id.equals(req.user._id))) {
      return res.status(403).json({ error: 'Join this jam before requesting a private call.' });
    }
    if (!req.user.phone || !req.user.phoneVerified) {
      return res.status(403).json({ error: 'Verify your phone number before requesting a private call.' });
    }

    const host = await User.findById(jam.hostUser).select('phone phoneVerified');
    if (!host?.phone || !host.phoneVerified) {
      return res.status(409).json({ error: 'The host needs to verify a phone number before private calls can be used.' });
    }

    const now = new Date();
    const existingRelay = await PrivateCallRelay.findOne({
      jamSession: jam._id,
      caller: req.user._id,
      expiresAt: { $gt: now }
    }).lean();
    if (existingRelay) {
      return res.json({
        success: true,
        callNumber: existingRelay.virtualNumber,
        expiresAt: existingRelay.expiresAt,
        privacy: 'Both participants call the shared number; personal numbers are masked.'
      });
    }

    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const recentCalls = await PrivateCallRelay.countDocuments({ caller: req.user._id, createdAt: { $gte: oneHourAgo } });
    if (recentCalls >= CALLS_PER_HOUR_LIMIT) {
      return res.status(429).json({ error: 'Private call limit reached. Try again later.' });
    }
    if (req.user.lastPrivateCallAt && now.getTime() - req.user.lastPrivateCallAt.getTime() < CALL_COOLDOWN_MS) {
      return res.status(429).json({ error: 'Please wait before requesting another private call.' });
    }

    // Claim the cooldown atomically so concurrent requests cannot allocate
    // multiple paid relay numbers for one attendee.
    const cooldownClaim = await User.findOneAndUpdate({
      _id: req.user._id,
      $or: [
        { lastPrivateCallAt: null },
        { lastPrivateCallAt: { $lte: new Date(now.getTime() - CALL_COOLDOWN_MS) } }
      ]
    }, { $set: { lastPrivateCallAt: now } }, { new: true });
    if (!cooldownClaim) return res.status(429).json({ error: 'Please wait before requesting another private call.' });
    cooldownClaimed = true;
    cooldownTimestamp = now;

    const tenantId = process.env.EXOTEL_LEAD_ASSIST_TENANT_ID;
    const accountSid = process.env.EXOTEL_ACCOUNT_SID;
    const bridgeToken = process.env.EXOTEL_EXOBRIDGE_TOKEN;
    if (!tenantId || !accountSid || !bridgeToken) {
      await User.updateOne({ _id: req.user._id, lastPrivateCallAt: now }, { $set: { lastPrivateCallAt: null } });
      cooldownClaimed = false;
      return res.status(503).json({ error: 'Privacy-protected calling is not configured on this service yet.' });
    }

    const connectionId = crypto.randomUUID();
    const expiresAt = new Date(now.getTime() + RELAY_LIFETIME_MS);
    const endpoint = `https://leadassist.exotel.in/v1/tenants/${encodeURIComponent(tenantId)}/greenvn`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let providerResponse;
    try {
      providerResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${bridgeToken}`).toString('base64')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          connection_id: connectionId,
          aparty_numbers: [req.user.phone],
          bparty_numbers: [host.phone],
          usage: 'twoway',
          deallocation_policy: { duration: '600s' }
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const providerData = await providerResponse.json().catch(() => null);
    const relayNumber = providerData?.data?.greenvn || providerData?.data?.green_vn;
    const allocationId = providerData?.data?.greenvn_id;
    if (!providerResponse.ok || !providerData?.success || !relayNumber || !allocationId) {
      console.error('Private call allocation failed:', providerResponse.status, providerData?.code || 'provider_error');
      await User.updateOne({ _id: req.user._id, lastPrivateCallAt: now }, { $set: { lastPrivateCallAt: null } });
      cooldownClaimed = false;
      return res.status(502).json({ error: 'The private call number could not be allocated. Please try again later.' });
    }

    try {
      await PrivateCallRelay.create({
        connectionId: allocationId,
        jamSession: jam._id,
        caller: req.user._id,
        host: jam.hostUser,
        virtualNumber: relayNumber,
        expiresAt
      });
      let conversation = await Conversation.findOne({
        jamSession: jam._id,
        participants: { $all: [req.user._id, jam.hostUser] }
      });
      if (!conversation) {
        conversation = await Conversation.create({
          jamSession: jam._id,
          participants: [req.user._id, jam.hostUser]
        });
      }
      const callMessage = `JamPulse private call line: ${relayNumber}. This shared number expires at ${expiresAt.toISOString()}; call it to connect without sharing personal phone numbers.`;
      await Message.create({
        conversation: conversation._id,
        sender: req.user._id,
        senderName: req.user.name || 'JamPulse member',
        text: callMessage
      });
      conversation.lastMessage = { text: callMessage, sender: req.user._id, sentAt: new Date() };
      await conversation.save();
      cooldownClaimed = false;
    } catch (storageError) {
      await PrivateCallRelay.deleteOne({ connectionId: allocationId }).catch(() => {});
      const cleanupController = new AbortController();
      const cleanupTimeout = setTimeout(() => cleanupController.abort(), 5000);
      try {
        await fetch(`${endpoint}/${encodeURIComponent(allocationId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${bridgeToken}`).toString('base64')}` },
          signal: cleanupController.signal
        });
      } catch (cleanupError) {
        console.error('Could not release untracked private call allocation.');
      } finally {
        clearTimeout(cleanupTimeout);
      }
      throw storageError;
    }

    return res.status(201).json({
      success: true,
      callNumber: relayNumber,
      expiresAt,
      privacy: 'Both participants call the shared number; personal numbers are masked.'
    });
  } catch (error) {
    if (cooldownClaimed) {
      await User.updateOne({ _id: req.user._id, lastPrivateCallAt: cooldownTimestamp }, { $set: { lastPrivateCallAt: null } }).catch(() => {});
    }
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'The private call provider took too long. Please try again.' });
    }
    console.error('Private call request failed:', error.message);
    return res.status(500).json({ error: 'Could not set up a private call.' });
  }
});

module.exports = router;
