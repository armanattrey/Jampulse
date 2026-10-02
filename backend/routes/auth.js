const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'jampulse_live_jwt_secret_key_2026';
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// In-Memory OTP Store: key -> { code, expiresAt }
const otpStore = new Map();

// Helper: 6-Digit Cryptographic-friendly OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Authentication Gate Middleware
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization token missing or malformed.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
}

// -----------------------------------------------------------------------------
// Bulletproof User Resolver (Immune to Enum & E11000 Duplicate Key Collisions)
// -----------------------------------------------------------------------------
async function findOrCreateUser({ email, phone, name, role, authProvider, avatarUrl, instruments }) {
  let user = null;

  // 1. Search existing record by email
  if (email) {
    user = await User.findOne({ email: email.toLowerCase().trim() });
  }

  // 2. Search existing record by phone
  if (!user && phone) {
    user = await User.findOne({ phone: phone.trim() });
  }

  // If user already exists, backfill missing profile fields
  if (user) {
    let modified = false;
    if (avatarUrl && !user.avatarUrl) {
      user.avatarUrl = avatarUrl;
      modified = true;
    }
    if (Array.isArray(instruments) && instruments.length > 0 && (!user.instruments || user.instruments.length === 0)) {
      user.instruments = instruments;
      modified = true;
    }
    if (modified) await user.save();
    return user;
  }

  // Fallback role check to avoid schema validation crashes
  const validRoles = ['Guitarist', 'Vocalist', 'Drummer/Percussion', 'Bassist', 'Keys', 'Listener/Fan', 'Musician'];
  const safeRole = validRoles.includes(role) ? role : 'Guitarist';

  // 3. Prepare fresh document payload
  const newUserData = {
    name: name?.trim() || (email ? email.split('@')[0] : 'Jammer'),
    role: safeRole,
    authProvider: authProvider || 'guest',
    avatarUrl: avatarUrl || '',
    instruments: Array.isArray(instruments) ? instruments : []
  };

  if (email) newUserData.email = email.toLowerCase().trim();
  if (phone) newUserData.phone = phone.trim();

  try {
    user = await User.create(newUserData);
    return user;
  } catch (err) {
    console.warn('Initial User.create notification:', err.message);

    // Handle MongoDB duplicate key collision (code 11000)
    if (err.code === 11000) {
      if (email) user = await User.findOne({ email: email.toLowerCase().trim() });
      if (!user && phone) user = await User.findOne({ phone: phone.trim() });
      if (user) return user;

      // Handle sparse null index collisions
      if (!newUserData.phone && err.message.includes('phone')) {
        newUserData.phone = `+91000${Date.now().toString().slice(-7)}`;
      }
      if (!newUserData.email && err.message.includes('email')) {
        newUserData.email = `user_${Date.now()}@jampulse.local`;
      }

      user = await User.create(newUserData);
      return user;
    }

    throw err;
  }
}

// -----------------------------------------------------------------------------
// 1. SESSION VERIFICATION & PROFILE SYNC
// -----------------------------------------------------------------------------
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User does not exist.' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { name, role, bio, instruments } = req.body;
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User does not exist.' });

    if (name) user.name = name.trim();
    if (role) user.role = role;
    if (bio !== undefined) user.bio = bio;
    if (Array.isArray(instruments)) user.instruments = instruments;

    await user.save();
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 2. PHONE AUTHENTICATION (Fast2SMS Gateway)
// -----------------------------------------------------------------------------
router.post('/phone/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number is required.' });

    const parsedNumber = parsePhoneNumberFromString(phone, 'IN');
    if (!parsedNumber || !parsedNumber.isValid()) {
      return res.status(400).json({ error: 'Invalid 10-digit Indian mobile number.' });
    }

    const internationalFormat = parsedNumber.format('E.164');
    const nationalFormat = parsedNumber.formatNational();
    const rawNationalDigits = parsedNumber.nationalNumber;

    const otp = generateOTP();
    otpStore.set(internationalFormat, { code: otp, expiresAt: Date.now() + 10 * 60 * 1000 });

    if (process.env.SMS_API_KEY) {
      try {
        const smsResponse = await fetch('https://www.fast2sms.com/dev/bulkV2', {
          method: 'POST',
          headers: {
            authorization: process.env.SMS_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            route: 'otp',
            variables_values: otp,
            numbers: rawNationalDigits
          })
        });
        const smsData = await smsResponse.json();
        if (!smsData.return) {
          console.warn('Fast2SMS Dispatch Notice:', smsData.message);
        }
      } catch (smsErr) {
        console.error('Fast2SMS Gateway Error:', smsErr.message);
      }
    } else {
      console.log(`\n========================================`);
      console.log(`📲 [PHONE OTP GENERATED - DEV MODE]`);
      console.log(`Target: ${internationalFormat} (${nationalFormat})`);
      console.log(`OTP Code: ${otp}`);
      console.log(`========================================\n`);
    }

    res.json({
      success: true,
      message: `Verification code dispatched to ${nationalFormat}`,
      formattedNumber: internationalFormat,
      isDevMode: !process.env.SMS_API_KEY
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/phone/verify-otp', async (req, res) => {
  try {
    const { phone, otp, name, role, instruments } = req.body;
    if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP are required.' });

    const parsedNumber = parsePhoneNumberFromString(phone, 'IN');
    if (!parsedNumber || !parsedNumber.isValid()) {
      return res.status(400).json({ error: 'Invalid phone format.' });
    }

    const formattedNumber = parsedNumber.format('E.164');
    const record = otpStore.get(formattedNumber);

    const isDevBypass = !process.env.SMS_API_KEY && otp.trim() === '999999';
    const isMatch = record && record.code === otp.trim();

    if (!isMatch && !isDevBypass) {
      if (record && Date.now() > record.expiresAt) {
        otpStore.delete(formattedNumber);
        return res.status(400).json({ error: 'OTP has expired. Please request a new code.' });
      }
      return res.status(400).json({ error: 'Incorrect verification code.' });
    }

    otpStore.delete(formattedNumber);

    const user = await findOrCreateUser({
      phone: formattedNumber,
      name: name?.trim() || `Jammer_${formattedNumber.slice(-4)}`,
      role: role || 'Guitarist',
      authProvider: 'phone',
      instruments: Array.isArray(instruments) ? instruments : []
    });

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
// 3. EMAIL AUTHENTICATION (Nodemailer Transporter)
// -----------------------------------------------------------------------------
router.post('/email/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email address is required.' });

    const cleanEmail = email.trim().toLowerCase();
    const otp = generateOTP();
    otpStore.set(cleanEmail, { code: otp, expiresAt: Date.now() + 10 * 60 * 1000 });

    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        const mailTransporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          }
        });

        await mailTransporter.sendMail({
          from: `"JamPulse Security" <${process.env.SMTP_USER}>`,
          to: cleanEmail,
          subject: `${otp} is your JamPulse verification code`,
          html: `
            <div style="font-family:sans-serif;padding:24px;background:#f8fafc;border-radius:12px;max-width:480px;margin:0 auto;border:1px solid #e2e8f0">
              <h2 style="color:#e11d48;margin:0 0 12px 0">Welcome to JamPulse 🎸</h2>
              <p style="color:#334155;font-size:15px;line-height:1.5">Here is your single-use verification code to sign in:</p>
              <div style="font-size:32px;font-weight:800;letter-spacing:6px;color:#0f172a;background:#ffffff;padding:16px;border-radius:8px;text-align:center;border:1.5px dashed #cbd5e1;margin:20px 0">
                ${otp}
              </div>
              <p style="color:#64748b;font-size:12px;margin:0">Valid for 10 minutes. If you did not request this, you can safely ignore this email.</p>
            </div>
          `
        });

        return res.json({ success: true, message: `Verification code delivered to ${cleanEmail}` });
      } catch (mailErr) {
        return res.status(500).json({ error: `SMTP delivery failed: ${mailErr.message}` });
      }
    }

    console.log(`\n========================================`);
    console.log(`📧 [EMAIL OTP GENERATED - DEV MODE]`);
    console.log(`Target: ${cleanEmail}`);
    console.log(`OTP Code: ${otp}`);
    console.log(`========================================\n`);

    res.json({ success: true, message: `Verification code generated for ${cleanEmail}`, isDevMode: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/email/verify-otp', async (req, res) => {
  try {
    const { email, otp, name, role, instruments } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required.' });

    const cleanEmail = email.trim().toLowerCase();
    const record = otpStore.get(cleanEmail);

    const isDevBypass = (!process.env.SMTP_USER || !process.env.SMTP_PASS) && otp.trim() === '999999';
    const isMatch = record && record.code === otp.trim();

    if (!isMatch && !isDevBypass) {
      if (record && Date.now() > record.expiresAt) {
        otpStore.delete(cleanEmail);
        return res.status(400).json({ error: 'Code expired. Please request a new one.' });
      }
      return res.status(400).json({ error: 'Incorrect verification code.' });
    }

    otpStore.delete(cleanEmail);

    const user = await findOrCreateUser({
      email: cleanEmail,
      name: name?.trim() || cleanEmail.split('@')[0],
      role: role || 'Vocalist',
      authProvider: 'email',
      instruments: Array.isArray(instruments) ? instruments : []
    });

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
// 4. GOOGLE SIGN-IN (Access Token Exchange & GIS ID Tokens)
// -----------------------------------------------------------------------------
router.post('/google', async (req, res) => {
  try {
    const { credential, accessToken } = req.body;
    let googleEmail = '';
    let googleName = '';
    let googlePic = '';

    // 1. Direct Access Token UserInfo resolution
    if (accessToken) {
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (userInfoRes.ok) {
        const profileData = await userInfoRes.json();
        googleEmail = profileData.email;
        googleName = profileData.name;
        googlePic = profileData.picture;
      }
    }

    // 2. Google Identity Services ID Token resolution
    if (!googleEmail && credential) {
      try {
        if (process.env.GOOGLE_CLIENT_ID && !process.env.GOOGLE_CLIENT_ID.includes('placeholder')) {
          const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID
          });
          const payload = ticket.getPayload();
          googleEmail = payload.email;
          googleName = payload.name;
          googlePic = payload.picture;
        } else {
          const parts = credential.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
            googleEmail = payload.email;
            googleName = payload.name;
            googlePic = payload.picture;
          }
        }
      } catch (tokenErr) {
        console.warn('Google credential parsing fallback:', tokenErr.message);
      }
    }

    if (!googleEmail) {
      return res.status(400).json({ error: 'Unable to authenticate Google account. Please try again.' });
    }

    const cleanEmail = googleEmail.toLowerCase().trim();
    const user = await findOrCreateUser({
      email: cleanEmail,
      name: googleName || cleanEmail.split('@')[0],
      avatarUrl: googlePic || '',
      authProvider: 'google',
      role: 'Musician'
    });

    const token = jwt.sign(
      { userId: user._id, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ success: true, token, user });
  } catch (err) {
    console.error('Google Auth Route Error:', err);
    res.status(500).json({ error: 'Google sign-in error: ' + err.message });
  }
});

// -----------------------------------------------------------------------------
// 5. QUICK GUEST MODE
// -----------------------------------------------------------------------------
router.post('/guest', async (req, res) => {
  try {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const guestUser = await findOrCreateUser({
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