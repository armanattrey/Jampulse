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
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['http://localhost:3000', 'http://localhost:5173'];

app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? allowedOrigins : '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// 2. Resolve Static Assets Directory
const possibleFrontendPaths = [
  path.join(__dirname, '../frontend'),
  path.join(__dirname, 'frontend'),
  path.join(__dirname, '../public'),
  path.join(__dirname, 'public')
];

const staticDir = possibleFrontendPaths.find(p => fs.existsSync(p)) || path.join(__dirname, '../public');
const indexPath = path.join(staticDir, 'index.html');
const hasIndexHtml = fs.existsSync(indexPath);

app.use(express.static(staticDir));

// 3. Database Connection & Seeding
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/jamcircle';

async function seedDemoJams() {
  try {
    const count = await JamSession.estimatedDocumentCount();
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
  } catch (err) {
    console.error('Error seeding data:', err.message);
  }
}

// 4. API Endpoints
app.use('/api/auth', authRoutes);
app.use('/api/jams', jamRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/chat', chatRoutes);

app.get('/health', (req, res) => res.json({ status: 'live', app: 'JamPulse API Engine' }));

// 5. Client-Side Routing Fallback (Regex avoids matching API calls)
app.get(/^(?!\/api).*/, (req, res) => {
  if (hasIndexHtml) {
    return res.sendFile(indexPath);
  }
  res.status(404).json({ error: 'Frontend build not found' });
});

// 6. Connect to DB and Start Server
mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    await seedDemoJams();
    app.listen(PORT, () => {
      console.log(`🚀 JamPulse server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB Connection Error:', err.message);
    process.exit(1);
  });