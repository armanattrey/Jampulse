const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'local_jampals_dev_secret');
if (!JWT_SECRET) throw new Error('JWT_SECRET must be set when NODE_ENV=production.');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// 30 Days (Name) & 90 Days (Phone) Cooldown in milliseconds
const COOLDOWNS = {
  NAME_MS: 30 * 24 * 60 * 60 * 1000,
  PHONE_MS: 90 * 24 * 60 * 60 * 1000
};

// In-memory OTP store; a shared store is needed for multiple API instances.
const otpStore = new Map();
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

function generateOTP() {
  return crypto.randomInt(100000, 1000000).toString();
}

function getOtpRequestBlock(contact) {
  const record = otpStore.get(contact);
  if (!record) return null;

  const now = Date.now();
  if (record.expiresAt <= now) {
    otpStore.delete(contact);
    return null;
  }

  if (record.lockedUntil > now) {
    return 'Too many incorrect codes. Wait for the current code to expire before requesting another.';
  }
  if (now - record.sentAt < OTP_RESEND_COOLDOWN_MS) {
    return 'Wait one minute before requesting another code.';
  }
  return null;
}

function recordOtpFailure(contact, record) {
  if (!record) return false;

  record.failedAttempts = (record.failedAttempts || 0) + 1;
  if (record.failedAttempts >= OTP_MAX_ATTEMPTS) {
    record.lockedUntil = record.expiresAt;
    return true;
  }
  otpStore.set(contact, record);
  return false;
}

function verificationEmailHtml(otp) {
  return `
    <div style="font-family:sans-serif;padding:24px;background:#f8fafc;border-radius:12px;max-width:480px;margin:0 auto;border:1px solid #e2e8f0">
      <h2 style="color:#e11d48;margin:0 0 12px">Welcome to Jampals</h2>
      <p style="color:#334155;font-size:15px;line-height:1.5">Use this single-use verification code to sign in:</p>
      <div style="font-size:32px;font-weight:800;letter-spacing:6px;color:#0f172a;background:#fff;padding:16px;border-radius:8px;text-align:center;border:1.5px dashed #cbd5e1;margin:20px 0">${otp}</div>
      <p style="color:#64748b;font-size:12px;margin:0">Valid for 10 minutes. If you did not request this, you can ignore this email.</p>
    </div>
  `;
}

async function findOrCreateUser({ email, phone, name, role, authProvider, avatarUrl, instruments }) {
  let user = null;

  if (email) {
    user = await User.findOne({ email: email.toLowerCase().trim() });
  }

  if (!user && phone) {
    user = await User.findOne({ phone: phone.trim() });
  }

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

  const validRoles = ['Guitarist', 'Vocalist', 'Drummer/Percussion', 'Bassist', 'Keys', 'Listener/Fan', 'Musician'];
  const safeRole = validRoles.includes(role) ? role : 'Guitarist';

  const newUserData = {
    name: name?.trim() || (email ? email.split('@')[0] : 'Jammer'),
    role: safeRole,
    authProvider: authProvider || 'guest',
    avatarUrl: avatarUrl || '',
    instruments: Array.isArray(instruments) ? instruments : [],
    lastNameChange: null,
    lastPhoneChange: null
  };

  if (email) newUserData.email = email.toLowerCase().trim();
  if (phone) newUserData.phone = phone.trim();

  try {
    user = await User.create(newUserData);
    return user;
  } catch (err) {
    if (err.code === 11000) {
      if (email) user = await User.findOne({ email: email.toLowerCase().trim() });
      if (!user && phone) user = await User.findOne({ phone: phone.trim() });
      if (user) return user;
    }
    throw err;
  }
}

// -----------------------------------------------------------------------------
// 1. SESSION VERIFICATION & PROFILE SYNC (WITH COOLDOWNS)
// -----------------------------------------------------------------------------
router.get('/me', authMiddleware, async (req, res) => {
  try {
    return res.json({ success: true, user: req.user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { name, phone, role, bio, instruments } = req.body;
    const user = req.user;

    const now = Date.now();

    // 1. Enforce 30-Day Display Name Lock
    const newName = name !== undefined ? name.trim() : null;
    const isNameChanging = newName && newName !== user.name;

    if (isNameChanging && user.lastNameChange) {
      const timeSinceNameChange = now - new Date(user.lastNameChange).getTime();
      if (timeSinceNameChange < COOLDOWNS.NAME_MS) {
        const daysLeft = Math.ceil((COOLDOWNS.NAME_MS - timeSinceNameChange) / (1000 * 60 * 60 * 24));
        return res.status(403).json({
          error: `Name can only be updated once every 30 days. Available in ${daysLeft} day(s).`
        });
      }
    }

    // 2. Enforce 90-Day Phone Number Lock (Only if user already had a phone linked)
    const newPhone = phone !== undefined ? phone.trim() : null;
    const isPhoneChanging = newPhone && newPhone !== user.phone;

    if (isPhoneChanging && user.phone && user.lastPhoneChange) {
      const timeSincePhoneChange = now - new Date(user.lastPhoneChange).getTime();
      if (timeSincePhoneChange < COOLDOWNS.PHONE_MS) {
        const daysLeft = Math.ceil((COOLDOWNS.PHONE_MS - timeSincePhoneChange) / (1000 * 60 * 60 * 24));
        return res.status(403).json({
          error: `Phone number can only be updated once every 90 days. Available in ${daysLeft} day(s).`
        });
      }
    }

    // Commit changes and update timestamps
    if (isNameChanging) {
      user.name = newName;
      user.lastNameChange = new Date(now);
    }

    if (isPhoneChanging) {
      user.phone = newPhone;
      user.lastPhoneChange = new Date(now);
    }

    if (role) user.role = role;
    if (bio !== undefined) user.bio = bio;
    if (Array.isArray(instruments)) user.instruments = instruments;

    await user.save();
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/logout', authMiddleware, (req, res) => {
  res.json({ success: true, message: 'Logged out successfully.' });
});

// -----------------------------------------------------------------------------
// 2. PHONE AUTHENTICATION (Fast2SMS Gateway)
// -----------------------------------------------------------------------------
router.post('/phone/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (typeof phone !== 'string' || !phone.trim()) {
      return res.status(400).json({ error: 'Phone number is required.' });
    }

    const parsedNumber = parsePhoneNumberFromString(phone, 'IN');
    if (!parsedNumber || !parsedNumber.isValid()) {
      return res.status(400).json({ error: 'Invalid 10-digit Indian mobile number.' });
    }

    const internationalFormat = parsedNumber.format('E.164');
    const nationalFormat = parsedNumber.formatNational();
    const rawNationalDigits = parsedNumber.nationalNumber;

    if (!process.env.SMS_API_KEY && process.env.NODE_ENV === 'production') {
      return res.status(503).json({ error: 'Phone verification is not configured on this server.' });
    }
    const requestBlock = getOtpRequestBlock(internationalFormat);
    if (requestBlock) {
      return res.status(429).json({ error: requestBlock });
    }

    const otp = generateOTP();
    otpStore.set(internationalFormat, { code: otp, sentAt: Date.now(), expiresAt: Date.now() + 10 * 60 * 1000 });

    if (process.env.SMS_API_KEY) {
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
      if (!smsResponse.ok || !smsData.return) {
        otpStore.delete(internationalFormat);
        return res.status(502).json({ error: 'SMS delivery failed. Please try again later.' });
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
    if (typeof phone !== 'string' || !phone.trim() || typeof otp !== 'string' || !otp.trim()) {
      return res.status(400).json({ error: 'Phone and OTP are required.' });
    }

    const parsedNumber = parsePhoneNumberFromString(phone, 'IN');
    if (!parsedNumber || !parsedNumber.isValid()) {
      return res.status(400).json({ error: 'Invalid phone format.' });
    }

    const formattedNumber = parsedNumber.format('E.164');
    const record = otpStore.get(formattedNumber);
    if (record?.lockedUntil > Date.now()) {
      return res.status(429).json({ error: 'Too many incorrect codes. Wait for the current code to expire.' });
    }

    const isDevBypass = process.env.NODE_ENV !== 'production' && !process.env.SMS_API_KEY && otp.trim() === '999999';
    const isMatch = record && record.code === otp.trim();

    if (!isMatch && !isDevBypass) {
      if (record && Date.now() >= record.expiresAt) {
        otpStore.delete(formattedNumber);
        return res.status(400).json({ error: 'OTP has expired. Please request a new code.' });
      }
      if (recordOtpFailure(formattedNumber, record)) {
        return res.status(429).json({ error: 'Too many incorrect codes. Request a new code after it expires.' });
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
// 3. EMAIL AUTHENTICATION (HTTPS provider for hosted use, SMTP for local use)
// -----------------------------------------------------------------------------
router.post('/email/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Email address is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const hasResend = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
    const hasSmtpCredentials = process.env.SMTP_USER && process.env.SMTP_PASS &&
      !process.env.SMTP_USER.startsWith('your_') && !process.env.SMTP_PASS.startsWith('your_');
    const hasLocalSmtp = Boolean(process.env.SMTP_HOST);

    if (!hasResend && !hasSmtpCredentials && !hasLocalSmtp && process.env.NODE_ENV === 'production') {
      return res.status(503).json({ error: 'Email verification is not configured on this server.' });
    }
    const requestBlock = getOtpRequestBlock(cleanEmail);
    if (requestBlock) {
      return res.status(429).json({ error: requestBlock });
    }

    const otp = generateOTP();
    otpStore.set(cleanEmail, { code: otp, sentAt: Date.now(), expiresAt: Date.now() + 10 * 60 * 1000 });

    if (hasResend) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM,
            to: [cleanEmail],
            subject: `${otp} is your Jampals verification code`,
            html: verificationEmailHtml(otp)
          })
        });

        if (!response.ok) throw new Error('Email provider rejected the request.');
        return res.json({ success: true, message: `Verification code delivered to ${cleanEmail}` });
      } catch (mailErr) {
        otpStore.delete(cleanEmail);
        console.error('Email API delivery failed:', mailErr.message);
        return res.status(502).json({ error: 'Could not deliver the verification email.' });
      }
    }

    if (hasSmtpCredentials || hasLocalSmtp) {
      try {
        const mailOptions = hasLocalSmtp
          ? {
              host: process.env.SMTP_HOST,
              port: Number(process.env.SMTP_PORT) || 587,
              secure: process.env.SMTP_SECURE === 'true',
              ...(hasSmtpCredentials ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } } : {})
            }
          : {
              service: 'gmail',
              auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            };
        const mailTransporter = nodemailer.createTransport(mailOptions);

        await mailTransporter.sendMail({
          from: process.env.EMAIL_FROM || process.env.SMTP_USER || 'Jampals <no-reply@localhost>',
          to: cleanEmail,
          subject: `${otp} is your Jampals verification code`,
          html: verificationEmailHtml(otp)
        });

        return res.json({ success: true, message: `Verification code delivered to ${cleanEmail}` });
      } catch (mailErr) {
        otpStore.delete(cleanEmail);
        console.error('SMTP email delivery failed:', mailErr.message);
        return res.status(502).json({ error: 'Could not deliver the verification email.' });
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
    if (typeof email !== 'string' || !email.trim() || typeof otp !== 'string' || !otp.trim()) {
      return res.status(400).json({ error: 'Email and OTP are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const record = otpStore.get(cleanEmail);
    if (record?.lockedUntil > Date.now()) {
      return res.status(429).json({ error: 'Too many incorrect codes. Wait for the current code to expire.' });
    }

    const isDevBypass = process.env.NODE_ENV !== 'production' && (!process.env.SMTP_USER || !process.env.SMTP_PASS) && otp.trim() === '999999';
    const isMatch = record && record.code === otp.trim();

    if (!isMatch && !isDevBypass) {
      if (record && Date.now() >= record.expiresAt) {
        otpStore.delete(cleanEmail);
        return res.status(400).json({ error: 'Code expired. Please request a new one.' });
      }
      if (recordOtpFailure(cleanEmail, record)) {
        return res.status(429).json({ error: 'Too many incorrect codes. Request a new code after it expires.' });
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
    let googleEmailVerified = false;

    if (accessToken) {
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (userInfoRes.ok) {
        const profileData = await userInfoRes.json();
        googleEmail = profileData.email;
        googleName = profileData.name;
        googlePic = profileData.picture;
        googleEmailVerified = profileData.email_verified === true;
      }
    }

    if (!googleEmail && credential && process.env.GOOGLE_CLIENT_ID && !process.env.GOOGLE_CLIENT_ID.includes('placeholder')) {
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken: credential,
          audience: process.env.GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();
        googleEmail = payload.email;
        googleName = payload.name;
        googlePic = payload.picture;
        googleEmailVerified = payload.email_verified === true;
      } catch (tokenErr) {
        console.warn('Google credential verification failed:', tokenErr.message);
      }
    }

    if (!googleEmail || !googleEmailVerified) {
      return res.status(400).json({ error: 'Unable to authenticate a verified Google account. Please try again.' });
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
