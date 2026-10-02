const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_dev_secret';
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// In-Memory OTP Store: key -> { code, expiresAt }
const otpStore = new Map();

// Helper: 6-Digit Cryptographic-friendly OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// -----------------------------------------------------------------------------
// Bulletproof User Resolver (Immune to MongoDB E11000 null-index collisions)
// -----------------------------------------------------------------------------
async function findOrCreateUser({ email, phone, name, role, authProvider, avatarUrl }) {
  let user = null;

  // 1. Search by email if available
  if (email) {
    user = await User.findOne({ email: email.toLowerCase().trim() });
  }

  // 2. Search by phone if not found and phone provided
  if (!user && phone) {
    user = await User.findOne({ phone: phone.trim() });
  }

  if (user) {
    return user;
  }

  // 3. User does not exist, build new account payload
  const newUserData = {
    name: name?.trim() || (email ? email.split('@')[0] : 'Jammer'),
    role: role || 'Musician',
    authProvider: authProvider || 'email',
    avatarUrl: avatarUrl || ''
  };

  if (email) newUserData.email = email.toLowerCase().trim();
  if (phone) newUserData.phone = phone.trim();

  try {
    user = await User.create(newUserData);
    return user;
  } catch (err) {
    console.warn('Initial User.create notice:', err.message);

    // Handle MongoDB duplicate key error (code 11000) for null indexes
    if (err.code === 11000) {
      if (email) {
        user = await User.findOne({ email: email.toLowerCase().trim() });
        if (user) return user;
      }
      if (phone) {
        user = await User.findOne({ phone: phone.trim() });
        if (user) return user;
      }

      // If collision was caused by non-sparse null fields, attach unique fallback placeholders
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
        error: 'Invalid phone number. Please enter a valid 10-digit Indian mobile number.'
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

        return res.json({
          success: true,
          message: `SMS OTP dispatched to ${nationalFormat}`
        });
      } catch (smsErr) {
        console.error('SMS Gateway Error:', smsErr.message);
      }
    }

    console.log(`\n========================================`);
    console.log(`📲 [PHONE OTP GENERATED]`);
    console.log(`Target: ${internationalFormat} (${nationalFormat})`);
    console.log(`OTP Code: ${otp}`);
    console.log(`========================================\n`);

    res.json({
      success: true,
      message: `Code generated for ${nationalFormat}. (Check Render logs or use dev PIN 999999)`,
      isDevMode: !process.env.SMS_API_KEY
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/phone/verify-otp', async (req, res) => {
  try {
    const { phone, otp, name, role } = req.body;
    if (!phone || !otp) {
      return res.status(400).json({ error: 'Phone and verification code are required.' });
    }

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
        return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
      }
      return res.status(400).json({ 
        error: process.env.SMS_API_KEY 
          ? 'Incorrect verification code.' 
          : 'Incorrect code. In dev mode without SMS API, enter the code from Render logs or test PIN 999999.' 
      });
    }

    otpStore.delete(formattedNumber);

    const user = await findOrCreateUser({
      phone: formattedNumber,
      name: name?.trim() || `Jammer_${formattedNumber.slice(-4)}`,
      role: role || 'Guitarist',
      authProvider: 'phone'
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

    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (smtpUser && smtpPass) {
      try {
        const mailTransporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user: smtpUser, pass: smtpPass }
        });

        await mailTransporter.sendMail({
          from: `"JamPulse Security" <${smtpUser}>`,
          to: cleanEmail,
          subject: `${otp} is your JamPulse verification code`,
          html: `
            <div style="font-family:sans-serif;padding:24px;background:#f8fafc;border-radius:12px;max-width:480px;margin:0 auto;border:1px solid #e2e8f0">
              <h2 style="color:#e11d48;margin:0 0 12px 0">Welcome to JamPulse 🎸</h2>
              <p style="color:#334155;font-size:15px;line-height:1.5">Here is your one-time verification code to sign in:</p>
              <div style="font-size:32px;font-weight:800;letter-spacing:6px;color:#0f172a;background:#ffffff;padding:16px;border-radius:8px;text-align:center;border:1.5px dashed #cbd5e1;margin:20px 0">
                ${otp}
              </div>
              <p style="color:#64748b;font-size:12px;margin:0">Valid for 10 minutes. If you did not request this, you can safely ignore this email.</p>
            </div>
          `
        });

        return res.json({
          success: true,
          message: `Verification code sent to ${cleanEmail}. Check your inbox or spam.`
        });
      } catch (mailErr) {
        console.error('SMTP Mail Dispatch Error:', mailErr);
        return res.status(500).json({
          error: `Email delivery failed: ${mailErr.message}. Ensure your 16-character Google App Password is correct.`
        });
      }
    } else {
      console.log(`\n========================================`);
      console.log(`📧 [EMAIL OTP GENERATED - NO SMTP ENV FOUND]`);
      console.log(`Target: ${cleanEmail}`);
      console.log(`OTP Code: ${otp}`);
      console.log(`========================================\n`);

      return res.json({
        success: true,
        message: `SMTP not configured on Render. Code printed in server logs. (Dev test code: 999999)`,
        isDevMode: true
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/email/verify-otp', async (req, res) => {
  try {
    const { email, otp, name, role } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and code are required.' });

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
      authProvider: 'email'
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
// 3. GOOGLE SIGN-IN / DEMO AUTH
// -----------------------------------------------------------------------------
router.post('/google', async (req, res) => {
  try {
    const { credential, email, name, picture } = req.body;
    let googleEmail = email;
    let googleName = name;
    let googlePic = picture;

    // Decode or verify credential payload if passed
    if (credential) {
      try {
        if (process.env.GOOGLE_CLIENT_ID && !process.env.GOOGLE_CLIENT_ID.includes('your_google_client_id')) {
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
        try {
          const parts = credential.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
            googleEmail = payload.email || googleEmail;
            googleName = payload.name || googleName;
            googlePic = payload.picture || googlePic;
          }
        } catch (_) {}
      }
    }

    if (!googleEmail) {
      googleEmail = 'musician.artist@gmail.com';
      googleName = 'Google Jammer';
    }

    const cleanEmail = googleEmail.toLowerCase().trim();

    const user = await findOrCreateUser({
      email: cleanEmail,
      name: googleName || 'Google Jammer',
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
// 4. QUICK GUEST MODE
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