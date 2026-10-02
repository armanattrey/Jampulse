const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const { validate: validateEmailDeep } = require('deep-email-validator');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_dev_secret';
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// In-Memory OTP Store: key -> { code, expiresAt }
const otpStore = new Map();

// Setup Nodemailer Transporter
const mailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// -----------------------------------------------------------------------------
// 1. PHONE AUTHENTICATION
// -----------------------------------------------------------------------------
router.post('/phone/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required.' });
    }

    const parsedNumber = parsePhoneNumberFromString(phone, 'IN');

    if (!parsedNumber || !parsedNumber.isValid()) {
      return res.status(400).json({
        error: 'Invalid phone number. Please enter a valid 10-digit mobile number.'
      });
    }

    const internationalFormat = parsedNumber.format('E.164');
    const nationalFormat = parsedNumber.formatNational();

    const otp = generateOTP();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 mins
    otpStore.set(internationalFormat, { code: otp, expiresAt });

    if (process.env.SMS_API_KEY) {
      try {
        const rawDigits = parsedNumber.nationalNumber;
        await fetch('https://www.fast2sms.com/dev/bulkV2', {
          method: 'POST',
          headers: {
            authorization: process.env.SMS_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            route: 'otp',
            variables_values: otp,
            numbers: rawDigits
          })
        });
      } catch (smsErr) {
        console.error('SMS Gateway Error:', smsErr.message);
      }
    } else {
      // Kept private on the server for the admin
      console.log(`\n🔒 [SECURE SERVER LOG ONLY]`);
      console.log(`To: ${internationalFormat} (${nationalFormat}) | OTP: ${otp}\n`);
    }

    // Never return the OTP in the JSON response
    res.json({
      success: true,
      message: `OTP sent to ${nationalFormat}`,
      formattedNumber: internationalFormat
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/phone/verify-otp', async (req, res) => {
  try {
    const { phone, otp, name, role } = req.body;
    const parsedNumber = parsePhoneNumberFromString(phone, 'IN');
    if (!parsedNumber || !parsedNumber.isValid()) {
      return res.status(400).json({ error: 'Invalid phone format.' });
    }

    const formattedNumber = parsedNumber.format('E.164');
    const record = otpStore.get(formattedNumber);

    if (!record) {
      return res.status(400).json({ error: 'No OTP requested or OTP has expired.' });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(formattedNumber);
      return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
    }

    // Strict validation: must match generated code exactly
    if (record.code !== otp.trim()) {
      return res.status(400).json({ error: 'Incorrect verification code.' });
    }

    otpStore.delete(formattedNumber);

    let user = await User.findOne({ phone: formattedNumber });
    if (!user) {
      user = await User.create({
        phone: formattedNumber,
        name: name?.trim() || `Jammer_${formattedNumber.slice(-4)}`,
        role: role || 'Guitarist',
        authProvider: 'phone'
      });
    }

    const token = jwt.sign(
      { userId: user._id, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ success: true, token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 2. EMAIL AUTHENTICATION
// -----------------------------------------------------------------------------
router.post('/email/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email address is required.' });

    const cleanEmail = email.trim().toLowerCase();
    const otp = generateOTP();
    const expiresAt = Date.now() + 10 * 60 * 1000;
    otpStore.set(cleanEmail, { code: otp, expiresAt });

    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      await mailTransporter.sendMail({
        from: `"JamPulse Security" <${process.env.SMTP_USER}>`,
        to: cleanEmail,
        subject: `${otp} is your JamPulse verification code`,
        html: `<h2>Your JamPulse code is: <strong>${otp}</strong></h2>`
      });
    } else {
      console.log(`\n🔒 [SECURE SERVER LOG ONLY]`);
      console.log(`To: ${cleanEmail} | OTP: ${otp}\n`);
    }

    res.json({
      success: true,
      message: `Code sent to ${cleanEmail}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/email/verify-otp', async (req, res) => {
  try {
    const { email, otp, name, role } = req.body;
    const cleanEmail = email?.trim().toLowerCase();
    const record = otpStore.get(cleanEmail);

    if (!record) {
      return res.status(400).json({ error: 'No code requested or code expired.' });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(cleanEmail);
      return res.status(400).json({ error: 'Code expired. Please request a new one.' });
    }

    if (record.code !== otp.trim()) {
      return res.status(400).json({ error: 'Incorrect verification code.' });
    }

    otpStore.delete(cleanEmail);

    let user = await User.findOne({ email: cleanEmail });
    if (!user) {
      user = await User.create({
        email: cleanEmail,
        name: name?.trim() || cleanEmail.split('@')[0],
        role: role || 'Vocalist',
        authProvider: 'email'
      });
    }

    const token = jwt.sign(
      { userId: user._id, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ success: true, token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 3. GOOGLE SIGN-IN / DEMO AUTH
// -----------------------------------------------------------------------------
router.post('/google', async (req, res) => {
  try {
    const { credential, email, name, picture } = req.body;
    let googleEmail = email;
    let googleName = name;
    let googlePic = picture;

    if (credential) {
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken: credential,
          audience: process.env.GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();
        googleEmail = payload.email;
        googleName = payload.name;
        googlePic = payload.picture;
      } catch (e) {
        const parts = credential.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
          googleEmail = payload.email;
          googleName = payload.name;
          googlePic = payload.picture;
        }
      }
    }

    if (!googleEmail) {
      googleEmail = 'demo.musician@gmail.com';
      googleName = 'Demo Musician';
    }

    let user = await User.findOne({ email: googleEmail.toLowerCase() });
    if (!user) {
      user = await User.create({
        email: googleEmail.toLowerCase(),
        name: googleName || 'Google Jammer',
        avatarUrl: googlePic || '',
        authProvider: 'google',
        role: 'Musician'
      });
    }

    const token = jwt.sign(
      { userId: user._id, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ success: true, token, user });
  } catch (err) {
    res.status(500).json({ error: 'Google sign-in error: ' + err.message });
  }
});

// -----------------------------------------------------------------------------
// 4. QUICK GUEST MODE
// -----------------------------------------------------------------------------
router.post('/guest', async (req, res) => {
  try {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const guestUser = await User.create({
      name: `Guest Jammer #${randomSuffix}`,
      authProvider: 'guest',
      role: 'Listener/Fan'
    });

    const token = jwt.sign(
      { userId: guestUser._id, name: guestUser.name, role: guestUser.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: guestUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;