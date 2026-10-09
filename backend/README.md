# JamPulse API

The Express API lives in `backend/` and uses MongoDB. The same server entry point works locally and on a Node hosting service. The website and Capacitor phone app use the same `/api` routes; only their API base address differs (same-origin on the website, absolute URL in the app).

## Where to find things

- `server.js` — starts Express, connects MongoDB, serves only the website's `index.html`, `app.js`, and `style.css`, configures CORS and JSON requests, and mounts the API.
- `routes/auth.js` — guest, phone, email, Google, and profile authentication endpoints.
- `routes/jams.js` — nearby jam search, hosting a jam, and RSVP changes.
- `routes/reviews.js` — reading and submitting jam reviews.
- `routes/chat.js` — starting jam conversations and reading or sending messages.
- `routes/calls.js` — short-lived, privacy-masked phone call lines for opted-in jams.
- `middleware/authMiddleware.js` — validates bearer tokens and loads the matching user.
- `models/` — MongoDB document shapes and geospatial indexes.
- `.env.example` — names of local settings; copy it to `.env` and provide your own values.

Requests that change user data or create sessions use bearer-token authentication. Jam search is public. MongoDB's `2dsphere` index powers radius search. A jam is returned only while it has not ended and while it is inside both the visitor's selected radius and the host's discovery radius.

## Run locally

1. Install the API dependencies with `npm install --prefix backend` from the project folder.
2. Copy `backend/.env.example` to `backend/.env` and set `MONGO_URI`. A local MongoDB instance or MongoDB Atlas connection string works.
3. Start the app with `npm run dev` from the project folder, or `node server.js` from `backend/`.
4. Open `http://localhost:5001` for the existing website. The API listens on the same address; `GET /health` reports whether MongoDB is connected.

The API opens its HTTP port before connecting to MongoDB. Health and API-info routes remain available while the database is disconnected; database-backed routes return `503` until MongoDB reconnects. The server retries a failed initial connection every 15 seconds. `MONGO_CONNECT_TIMEOUT_MS` controls each connection attempt (default `5000`).

Render is not needed for local work. The core jam, RSVP, review, and chat API runs against local MongoDB. The `render.yaml` blueprint can create a public service after the repository is connected to Render. GitHub stores code and triggers deployment; it does not run the API by itself.

Do not commit `backend/.env`; it can contain credentials. The checked-in example file has placeholders only.

## Deploy after pushing to GitHub

GitHub stores the source code; it does not run this API. Connect this repository to Render and apply the included blueprint. It installs and starts the API from `backend/` and serves the website and API from one public address. Add these required environment variables in the host dashboard:

- `NODE_ENV=production`
- `MONGO_URI` with the hosted MongoDB connection string
- `JWT_SECRET` with a long, random secret

The host supplies `PORT`. Once deployed, the service serves the website at `/`, the API at `/api`, and the database status at `/health`. Keep provider credentials in the host's environment settings, not in GitHub.

If the website frontend is hosted on a different domain, set `ALLOWED_ORIGINS` to its exact origin (comma-separated for multiple sites), then set `window.JAMPALS_API_BASE` to the public API's `/api` address before `frontend/app.js` loads. The included website uses same-origin `/api` and needs no CORS setting. The packaged Capacitor app uses the same endpoints through `frontend/www/app.js`; change the `window.JAMPALS_API_BASE` value in `frontend/www/index.html` before building if the current fallback host is no longer correct. The API allows Capacitor's local WebView origins for cross-origin requests.

The free Render service is suitable for a prototype, not an always-on production launch: it sleeps after 15 minutes without traffic, and the first request after sleep can take about a minute. Its filesystem is temporary, so app data must stay in MongoDB. Free Render services also block outbound SMTP ports, so email sign-in needs an HTTPS mail provider integration or a host that permits SMTP. Local development does not have these hosting limits.

## Main endpoints

- `GET /health` — API and database status
- `GET /api` — API name, version, route groups, and health-check path
- `GET /api/jams?lat=...&lng=...&radiusKm=...&mapRadiusKm=...` — upcoming and live sessions near a point; visitor search accepts 1–20,100 km (the UI calls the global option “Any distance”) and broader map results mark which are outside the selected distance
- `POST /api/jams/register` — create a session (sign-in required)
- `POST /api/jams/:id/rsvp` — join or leave a session (sign-in required)
- `GET /api/auth/me` and `POST /api/auth/guest` — check a session or create a guest session
- `POST /api/auth/phone/send-otp`, `POST /api/auth/phone/verify-otp` — phone verification
- `POST /api/auth/email/send-otp`, `POST /api/auth/email/verify-otp` — email verification
- `POST /api/auth/google` — verifies a Google access token or ID token
- `PUT /api/auth/profile`, `POST /api/auth/logout` — update a profile or end the client session
- `GET /api/reviews/:jamSessionId` and `POST /api/reviews/:jamSessionId` — read or submit a rating
- `GET /api/chat/conversations`, `POST /api/chat/initiate` — list inbox threads or start a conversation for a jam
- `GET /api/chat/:conversationId/messages?limit=...`, `POST /api/chat/:conversationId/message` — read the latest 100 messages or send a message
- `POST /api/calls/request` — request a temporary shared phone number (requires an RSVP, verified phone numbers, host opt-in, and Exotel GreenVN setup)

## Local showcase demo

Open `frontend/index.html?demo=1` to show clearly labeled sample sessions around Gurugram without a database or live API. Genre, distance, search, map markers, and RSVP toggling are simulated in the browser. Contact, sign-in, messages, and hosting actions show demo notices and do not send requests or contact real people. The demo fixture is never written to MongoDB.

Protected endpoints expect `Authorization: Bearer <token>`. A host chooses `discoveryRadiusKm` as `5`, `10`, `25`, or `50` when creating a jam. The visitor's `radiusKm` filters the session list, while optional `mapRadiusKm` requests broader map markers up to 20,100 km, enough for a global search. Host visibility settings remain in force; the API does not reveal a session beyond its host's chosen discovery radius. Markers outside the visitor's selected distance are returned with `withinSearchRadius: false` so the client can show them on the map without adding them to the list. Discovery responses remain capped at 100 sessions.

## Front-end request shapes

All request bodies are JSON. For phone sign-in, send `POST /api/auth/phone/send-otp` with `{ "phone": "+91XXXXXXXXXX" }`, then send `POST /api/auth/phone/verify-otp` with `{ "phone": "+91XXXXXXXXXX", "otp": "123456", "name": "Artist name" }`. Email sign-in uses `POST /api/auth/email/send-otp` with `{ "email": "artist@example.com" }`, followed by `POST /api/auth/email/verify-otp` with `{ "email": "artist@example.com", "otp": "123456", "name": "Artist name" }`. A successful verification returns a bearer `token` and `user` object.

Include `Authorization: Bearer <token>` on hosting, RSVP, profile, review, and chat requests. For jam creation, send `title`, `hostTeam`, `locationName`, numeric `lat` and `lng`, ISO date strings `startTime` and `endTime`, and `discoveryRadiusKm`; `vibe`, `genres`, `instrumentsNeeded`, and `description` are optional. Jam search needs numeric `lat` and `lng`; `radiusKm` (1–20,100), `mapRadiusKm` (optional, from the selected radius through 20,100), `sortBy`, `vibe`, and `query` are optional. The website/app use a logarithmic slider inside the Custom distance section so small local ranges remain adjustable while the endpoint reaches the global “Any distance” option.

Phone and email verification codes are kept in memory for ten minutes. A contact can request a code once per minute and gets five incorrect attempts before that code is locked until it expires. Without `SMS_API_KEY`, local phone sign-in prints a development code in the API log; it does not send an SMS. Production phone sign-in needs an SMS provider. For local email testing, set `SMTP_HOST` and `SMTP_PORT` to a development mail catcher. For hosted email on Render's free plan, configure `RESEND_API_KEY` and `EMAIL_FROM`; this sends via HTTPS, since free Render services block outbound SMTP. Use a sender address verified with the email provider. Google sign-in needs `GOOGLE_CLIENT_ID`. These providers are optional for local guest access and the core jam API.

### In-app contact, private calls, and notifications

WhatsApp contact links have been removed. Members can contact hosts through the JamPulse inbox. A host may also opt a jam into private calls. Only phone-verified hosts and phone-verified attendees who have RSVP'd can request a temporary shared number; the attendee and host both call that number, which hides their personal numbers. The server limits requests and the allocation expires after ten minutes. To activate real calls, Exotel must enable Lead Assist GreenVN for your account and you must set `EXOTEL_LEAD_ASSIST_TENANT_ID`, `EXOTEL_ACCOUNT_SID`, and `EXOTEL_EXOBRIDGE_TOKEN` locally or in the hosting dashboard. Without those credentials, the API reports that calling is not configured and does not reveal personal numbers. Exotel may charge for the service; confirm current account terms before enabling it.

The Notifications menu can request browser notification permission on HTTPS. Permission alone does not deliver background alerts: web push still needs a service worker, push subscription storage, VAPID credentials, and event delivery; native phone push needs platform push credentials and a native push integration. JamPulse currently does not claim to deliver those alerts.

A multi-instance production deployment should move OTP storage and rate limits to a shared store. In-memory OTPs and limits reset when the server restarts, so codes cannot be verified across multiple instances or after a restart.
