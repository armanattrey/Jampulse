const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const jamRoutes = require('./routes/jams');
const reviewRoutes = require('./routes/reviews');
const chatRoutes = require('./routes/chat');
const JamSession = require('./models/JamSession');

const app = express();
const PORT = process.env.PORT || 5001;

// 1. Core Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// 2. Resolve Static Assets Directory (checks ../frontend, ../public, or ./public)
const possibleFrontendPaths = [
  path.join(__dirname, '../frontend'),
  path.join(__dirname, 'frontend'),
  path.join(__dirname, '../public'),
  path.join(__dirname, 'public')
];

let staticDir = possibleFrontendPaths.find(p => fs.existsSync(p)) || path.join(__dirname, '../frontend');
app.use(express.static(staticDir));

// 3. Database Connection & Seeding
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/jamcircle';

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB Atlas (jamcircle)');
    await seedDemoJams();
  })
  .catch((err) => {
    console.error('❌ MongoDB Connection Error:', err.message);
  });

async function seedDemoJams() {
  try {
    const count = await JamSession.countDocuments();
    if (count === 0) {
      const now = new Date();
      const mockUserId = new mongoose.Types.ObjectId();

      await JamSession.create([
        {
          title: "Sunset Unplugged Vibes & Sufi Jam",
          description: "Open vocal & guitar circle under the trees. Beginners, pros, cajonists and listeners all welcome to sit and sing along!",
          hostTeam: "Acoustic Nomads",
          hostUser: mockUserId,
          vibe: "Acoustic Unplugged",
          genres: ["Indie Folk", "Sufi", "Pop Classics"],
          instrumentsNeeded: ["Flute", "Djembe", "Harmonies"],
          locationName: "Amphitheater, Sector 29 Leisure Valley",
          address: "Leisure Valley Park, Gurugram",
          location: { type: "Point", coordinates: [77.0688, 28.4682] },
          startTime: new Date(now.getTime() + 1000 * 60 * 45),
          endTime: new Date(now.getTime() + 1000 * 60 * 240),
          averageRating: 4.9,
          ratingCount: 18,
          status: "live"
        },
        {
          title: "Electric Blues & Hard Rock Improv",
          description: "We bring standard amps, cables & mic stands. Bring pedals, electric guitars or sax! Let's build spontaneous grooves.",
          hostTeam: "The High Gain Collective",
          hostUser: mockUserId,
          vibe: "Electric Jam",
          genres: ["Classic Rock", "Blues", "Funk"],
          instrumentsNeeded: ["Bass", "Lead Vocals", "Keyboard"],
          locationName: "CyberHub Rooftop Greens",
          address: "DLF CyberHub, DLF Phase 2",
          location: { type: "Point", coordinates: [77.0878, 28.4952] },
          startTime: new Date(now.getTime() + 1000 * 60 * 180),
          endTime: new Date(now.getTime() + 1000 * 60 * 360),
          averageRating: 4.7,
          ratingCount: 29,
          status: "upcoming"
        },
        {
          title: "Lo-Fi Beats, Keys & Ambient Chill",
          description: "Chill listening vibe with synths, handpans, acoustic guitars, and coffee.",
          hostTeam: "Underground Frequency",
          hostUser: mockUserId,
          vibe: "Chill Electronic",
          genres: ["Lo-Fi", "Neo Soul", "Ambient"],
          instrumentsNeeded: ["Keys", "Melodica"],
          locationName: "Aravali Biodiversity Park Trail Lawn",
          address: "Near Guru Dronacharya Metro, MG Road",
          location: { type: "Point", coordinates: [77.1065, 28.4891] },
          startTime: new Date(now.getTime() + 1000 * 60 * 300),
          endTime: new Date(now.getTime() + 1000 * 60 * 480),
          averageRating: 5.0,
          ratingCount: 8,
          status: "upcoming"
        }
      ]);
      console.log('🎸 Seeded 3 rich musical jam sessions for exploration.');
    }
  } catch (e) {
    console.error('Error seeding data:', e.message);
  }
}

// 4. API Endpoints
app.use('/api/auth', authRoutes);
app.use('/api/jams', jamRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/chat', chatRoutes);

app.get('/health', (req, res) => res.json({ status: 'live', app: 'JamPulse API Engine' }));

// 5. Client-Side Routing Fallback
app.get('*', (req, res) => {
  const indexPath = path.join(staticDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Frontend index.html not found.');
  }
});

// 6. Start Server
app.listen(PORT, () => {
  console.log(`🚀 JamPulse server running at http://localhost:${PORT}`);
});