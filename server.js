const express = require('express');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const COOLDOWNS = {
  NAME_MS: 30 * 24 * 60 * 60 * 1000,
  PHONE_MS: 90 * 24 * 60 * 60 * 1000
};

// In-memory demo user store
let currentUser = {
  id: "usr_101",
  name: "Alex Mercer",
  phone: "",
  lastNameChange: null,
  lastPhoneChange: null
};

app.get('/api/user', (req, res) => {
  const now = Date.now();
  const nameCooldownRemaining = currentUser.lastNameChange
    ? Math.max(0, COOLDOWNS.NAME_MS - (now - currentUser.lastNameChange))
    : 0;

  const phoneCooldownRemaining = (currentUser.phone && currentUser.lastPhoneChange)
    ? Math.max(0, COOLDOWNS.PHONE_MS - (now - currentUser.lastPhoneChange))
    : 0;

  res.json({
    ...currentUser,
    nameDaysLeft: Math.ceil(nameCooldownRemaining / (1000 * 60 * 60 * 24)),
    phoneDaysLeft: Math.ceil(phoneCooldownRemaining / (1000 * 60 * 60 * 24)),
    canChangeName: nameCooldownRemaining === 0,
    canChangePhone: phoneCooldownRemaining === 0
  });
});

app.patch('/api/user/name', (req, res) => {
  const { name } = req.body;
  const now = Date.now();
  
  if (currentUser.lastNameChange && (now - currentUser.lastNameChange) < COOLDOWNS.NAME_MS) {
    const daysLeft = Math.ceil((COOLDOWNS.NAME_MS - (now - currentUser.lastNameChange)) / (1000 * 60 * 60 * 24));
    return res.status(403).json({ error: `Name locked for ${daysLeft} more day(s).` });
  }

  currentUser.name = name.trim();
  currentUser.lastNameChange = now;
  res.json({ success: true, user: currentUser });
});

app.patch('/api/user/phone', (req, res) => {
  const { phone } = req.body;
  const now = Date.now();

  if (currentUser.phone && currentUser.lastPhoneChange && (now - currentUser.lastPhoneChange) < COOLDOWNS.PHONE_MS) {
    const daysLeft = Math.ceil((COOLDOWNS.PHONE_MS - (now - currentUser.lastPhoneChange)) / (1000 * 60 * 60 * 24));
    return res.status(403).json({ error: `Phone locked for ${daysLeft} more day(s).` });
  }

  currentUser.phone = phone.trim();
  currentUser.lastPhoneChange = now;
  res.json({ success: true, user: currentUser });
});

app.post('/api/logout', (req, res) => {
  res.json({ success: true, message: "Logged out" });
});

app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});
