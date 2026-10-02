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

// In-Memory OTP Store: key -> { code, expiresAt, attempts }
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

// Helper: 6-Digit Cryptographic-friendly OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// -----------------------------------------------------------------------------
// 1. PHONE AUTHENTICATION (Indian Number Validation & SMS)
// -----------------------------------------------------------------------------
router.post('/phone/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required.' });
    }

    // Parse and validate phone structure with default country set to 'IN'
    const parsedNumber = parsePhoneNumberFromString(phone, 'IN');

    // 1. Check if number is mathematically valid
    if (!parsedNumber || !parsedNumber.isValid()) {
      return res.status(400).json({
        error: 'Invalid phone number. Please enter a genuine phone number.'
      });
    }

    // 2. Strict Check: Is this number native to India?
    if (parsedNumber.country !== 'IN' || parsedNumber.countryCallingCode !== '91') {
      return res.status(400).json({
        error: `Only Indian phone numbers (+91) are supported. Provided country: ${parsedNumber.country || 'Unknown'}`
      });
    }

    // 3. Strict Check: Is it a mobile line? (Exclude landlines/toll-free where SMS fails)
    const numberType = parsedNumber.getType();
    if (numberType && numberType !== 'MOBILE' && numberType !== 'FIXED_LINE_OR_MOBILE') {
      return res.status(400).json({
        error: 'Only mobile phone numbers can receive SMS OTPs.'
      });
    }

    const internationalFormat = parsedNumber.format('E.164'); // e.g. +919876543210
    const nationalFormat = parsedNumber.formatNational();

    const otp = generateOTP();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 mins
    otpStore.set(internationalFormat, { code: otp, expiresAt });

    // Send SMS via Fast2SMS / Gateway if API key provided, else log
    if (process.env.SMS_API_KEY) {
      try {
        const rawDigits = parsedNumber.nationalNumber; // 10 digits
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
      console.log(`\n📲 [SMS OTP SIMULATOR]`);
      console.log(`To: ${internationalFormat} (${nationalFormat})`);
      console.log(`Your JamPulse OTP is: ${otp}\n`);
    }

    res.json({
      success: true,
      message: `OTP dispatched to Indian mobile ${nationalFormat}`,
      formattedNumber: internationalFormat,
      // For local testing convenience if SMS_API_KEY is unset:
      demoOtp: process.env.SMS_API_KEY ? undefined : otp
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

    if (record.code !== otp.trim()) {
      return res.status(400).json({ error: 'Incorrect verification code.' });
    }

    // OTP Verified -> Delete record
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
// 2. EMAIL AUTHENTICATION (MX Record Check & Email OTP)
// -----------------------------------------------------------------------------
router.post('/email/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email address is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Deep Email Validation (Checks syntax + DNS MX records to verify email domain actually exists)
    const validationResult = await validateEmailDeep({
      email: cleanEmail,
      validateRegex: true,
      validateMx: true,
      validateTypo: true,
      validateDisposable: true,
      validateSMTP: false // avoid getting IP blacklisted
    });

    if (!validationResult.valid) {
      const reason = validationResult.validators[validationResult.reason]?.reason || 'Email domain does not exist or cannot receive mail.';
      return res.status(400).json({
        error: `Invalid email: ${reason}`
      });
    }

    const otp = generateOTP();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 mins
    otpStore.set(cleanEmail, { code: otp, expiresAt });

    // Send Mail via SMTP
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      await mailTransporter.sendMail({
        from: `"JamPulse Security" <${process.env.SMTP_USER}>`,
        to: cleanEmail,
        subject: `${otp} is your JamPulse verification code`,
        html: `
          <div style="font-family:sans-serif;padding:20px;background:#f8fafc;border-radius:8px">
            <h2 style="color:#e11d48">Welcome to JamPulse 🎸</h2>
            <p>Your one-time authentication code is:</p>
            <div style="font-size:28px;font-weight:bold;letter-spacing:4px;color:#0f172a;margin:16px 0">${otp}</div>
            <p style="color:#64748b;font-size:12px">Valid for 10 minutes. Do not share this code with anyone.</p>
          </div>
        `
      });
    } else {
      console.log(`\n📧 [EMAIL OTP SIMULATOR]`);
      console.log(`To: ${cleanEmail}`);
      console.log(`Your JamPulse Email Code is: ${otp}\n`);
    }

    res.json({
      success: true,
      message: `Verification code sent to ${cleanEmail}`,
      demoOtp: (process.env.SMTP_USER && process.env.SMTP_PASS) ? undefined : otp
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
// 3. GOOGLE ONE-TAP & OAUTH SIGN-IN / SIGN-UP
// -----------------------------------------------------------------------------
router.post('/google', async (req, res) => {
  try {
    const { credential, email, name, picture } = req.body;

    let googleData = { email, name, picture };

    // If client sends real Google JWT ID token
    if (credential) {
      if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID !== 'your_google_client_id_here') {
        const ticket = await googleClient.verifyIdToken({
          idToken: credential,
          audience: process.env.GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();
        googleData = {
          email: payload.email,
          name: payload.name,
          picture: payload.picture,
          googleId: payload.sub
        };
      } else {
        // Fallback for development decoding
        const decoded = JSON.parse(Buffer.from(credential.split('.')[1], 'base64').toString('utf-8'));
        googleData = {
          email: decoded.email,
          name: decoded.name,
          picture: decoded.picture,
          googleId: decoded.sub
        };
      }
    }

    if (!googleData.email) {
      return res.status(400).json({ error: 'Google authentication did not provide a valid email.' });
    }

    let user = await User.findOne({ email: googleData.email.toLowerCase() });
    if (!user) {
      user = await User.create({
        email: googleData.email.toLowerCase(),
        name: googleData.name || 'Google Jammer',
        avatarUrl: googleData.picture || '',
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
});

module.exports = router;