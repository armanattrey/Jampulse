const API_BASE = 'http://localhost:5001/api';

// Core State
let map;
let userLocMarker = null;
let radiusCircle = null;
let currentMarkers = [];
let browsingPosition = { lat: 28.4595, lng: 77.0266 }; // Gurugram / Delhi NCR Center default
let activeRadiusKm = 25;
let activeVibe = 'All';
let currentSort = 'distance';
let searchQuery = '';
let jamsData = [];

// Auth State
let token = localStorage.getItem('jam_auth_token') || null;
let currentUser = JSON.parse(localStorage.getItem('jam_auth_user') || 'null');
let pendingPhone = '';

// DOM Elements
const navCityText = document.getElementById('navCityText');
const locationSelectorBtn = document.getElementById('locationSelectorBtn');
const locationModal = document.getElementById('locationModal');
const btnPickGPS = document.getElementById('btnPickGPS');
const manualLocInput = document.getElementById('manualLocInput');
const btnSearchLocation = document.getElementById('btnSearchLocation');
const locSuggestions = document.getElementById('locSuggestions');
const mapRecenterBtn = document.getElementById('mapRecenterBtn');

const mainSearchInput = document.getElementById('mainSearchInput');
const searchClearBtn = document.getElementById('searchClearBtn');
const radiusFilterSelect = document.getElementById('radiusFilterSelect');
const sortFilterSelect = document.getElementById('sortFilterSelect');
const jamsFeedContainer = document.getElementById('jamsFeedContainer');
const resultsCount = document.getElementById('resultsCount');

// Auth DOM
const authModal = document.getElementById('authModal');
const hostModal = document.getElementById('hostModal');
const reviewModal = document.getElementById('reviewModal');
const openLoginModalBtn = document.getElementById('openLoginModalBtn');
const openHostBtn = document.getElementById('openHostBtn');
const unauthControls = document.getElementById('unauthControls');
const authControls = document.getElementById('authControls');
const navUserName = document.getElementById('navUserName');
const avatarInitial = document.getElementById('avatarInitial');
const logoutBtn = document.getElementById('logoutBtn');

// --- 1. Map Initialization ---
function initMap() {
  map = L.map('leafletMap', { zoomControl: false }).setView([browsingPosition.lat, browsingPosition.lng], 12);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  L.control.zoom({ position: 'topright' }).addTo(map);

  // Click on map to pick location coordinates for hosting
  map.on('click', async (e) => {
    const hostCoords = document.getElementById('hostCoords');
    if (hostCoords) {
      hostCoords.value = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
      fetchReverseGeocode(e.latlng.lat, e.latlng.lng, 'hostLocationName');
    }
  });

  renderRadius();
}

function renderRadius() {
  if (radiusCircle) map.removeLayer(radiusCircle);
  if (userLocMarker) map.removeLayer(userLocMarker);

  userLocMarker = L.circleMarker([browsingPosition.lat, browsingPosition.lng], {
    radius: 9,
    fillColor: '#2563eb',
    color: '#ffffff',
    weight: 2,
    fillOpacity: 1
  }).addTo(map).bindPopup('<strong>Center of your search</strong>');

  radiusCircle = L.circle([browsingPosition.lat, browsingPosition.lng], {
    radius: activeRadiusKm * 1000,
    color: '#e11d48',
    fillColor: '#e11d48',
    fillOpacity: 0.05,
    weight: 1.5
  }).addTo(map);
}

// Reverse Geocode (Coordinates -> City Name)
async function fetchReverseGeocode(lat, lng, targetInputId = null) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
    const data = await res.json();
    const city = data.address?.city || data.address?.town || data.address?.suburb || data.address?.neighbourhood || 'Selected Area';

    if (targetInputId) {
      const field = document.getElementById(targetInputId);
      if (field && !field.value) field.value = data.name || data.display_name.split(',')[0];
    } else {
      navCityText.innerText = city;
    }
  } catch (e) {
    if (!targetInputId) navCityText.innerText = 'Connected Area';
  }
}

// --- 2. Dual-Mode Location Handling ---

// Option 1: Direct GPS
function setLocationToCurrentGPS() {
  navCityText.innerText = 'Locating GPS...';
  closeModals();

  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        browsingPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        map.setView([browsingPosition.lat, browsingPosition.lng], 12);
        renderRadius();
        fetchReverseGeocode(browsingPosition.lat, browsingPosition.lng);
        fetchJamsFromBackend();
      },
      (err) => {
        alert('Could not access GPS. Using default area.');
        navCityText.innerText = 'Gurugram (Default)';
        fetchJamsFromBackend();
      },
      { timeout: 8000 }
    );
  } else {
    alert('Geolocation is not supported by your browser.');
  }
}

// Option 2: Search by Custom Name (Nominatim Forward Geocoding)
async function handleManualLocationSearch() {
  const query = manualLocInput.value.trim();
  if (!query) return;

  btnSearchLocation.innerText = 'Searching...';
  locSuggestions.classList.remove('hidden');
  locSuggestions.innerHTML = '<div style="padding:10px;font-size:0.85rem;color:#64748b">Finding areas...</div>';

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
    const results = await res.json();
    btnSearchLocation.innerText = 'Search';

    if (results.length === 0) {
      locSuggestions.innerHTML = '<div style="padding:10px;font-size:0.85rem;color:#64748b">No locations found. Try another query.</div>';
      return;
    }

    locSuggestions.innerHTML = '';
    results.forEach(item => {
      const div = document.createElement('div');
      div.className = 'loc-suggestion-item';
      div.innerHTML = `<span>📍</span> <span>${item.display_name}</span>`;

      div.addEventListener('click', () => {
        const newLat = parseFloat(item.lat);
        const newLng = parseFloat(item.lon);

        browsingPosition = { lat: newLat, lng: newLng };
        navCityText.innerText = item.name || item.display_name.split(',')[0];

        map.setView([newLat, newLng], 12);
        renderRadius();
        closeModals();
        fetchJamsFromBackend();
      });

      locSuggestions.appendChild(div);
    });
  } catch (err) {
    btnSearchLocation.innerText = 'Search';
    locSuggestions.innerHTML = '<div style="padding:10px;font-size:0.85rem;color:#ef4444">Search failed. Check your internet connection.</div>';
  }
}

// --- 3. Backend Integration (Fetch Jams) ---
async function fetchJamsFromBackend() {
  resultsCount.innerText = 'Scanning...';
  try {
    const params = new URLSearchParams({
      lat: browsingPosition.lat,
      lng: browsingPosition.lng,
      radiusKm: activeRadiusKm,
      sortBy: currentSort,
      vibe: activeVibe,
      query: searchQuery
    });

    const res = await fetch(`${API_BASE}/jams?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    
    jamsData = await res.json();
    renderCards(jamsData);
    renderPins(jamsData);
  } catch (err) {
    console.error('Backend connection failed:', err);
    jamsFeedContainer.innerHTML = `
      <div style="background:#fee2e2;color:#991b1b;padding:16px;border-radius:12px;font-size:0.9rem">
        ⚠️ <strong>Backend Not Connected</strong><br>
        Make sure the backend is running in your terminal: <code>npm start</code> on <strong>http://localhost:5001</strong>.
      </div>
    `;
    resultsCount.innerText = 'Server offline';
  }
}

// --- 4. Render Cards & Map Pins ---
function renderCards(jams) {
  resultsCount.innerText = `${jams.length} Jam${jams.length === 1 ? '' : 's'} near you`;
  jamsFeedContainer.innerHTML = '';

  if (jams.length === 0) {
    jamsFeedContainer.innerHTML = `
      <div style="text-align:center;padding:48px 16px;color:#64748b">
        <span style="font-size:2.6rem">🎶</span>
        <h3 style="margin-top:10px;color:#0f172a">No open jam sessions found</h3>
        <p style="font-size:0.88rem;margin-top:4px">Widen the scanning radius or click "+ Host Jam" to start one here!</p>
      </div>
    `;
    return;
  }

  jams.forEach(jam => {
    const card = document.createElement('div');
    card.className = 'jam-card';

    const distKm = jam.distanceMeters ? (jam.distanceMeters / 1000).toFixed(1) : 'Nearby';
    const startTimeStr = new Date(jam.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isAttending = currentUser && jam.rsvpUsers?.includes(currentUser._id);

    card.innerHTML = `
      <div class="card-top">
        <span class="card-team">${escapeHtml(jam.hostTeam)}</span>
        <span class="card-dist-badge">📍 ${distKm} km</span>
      </div>

      <h3 class="card-title">${escapeHtml(jam.title)}</h3>
      <p class="card-desc">${escapeHtml(jam.description)}</p>

      <div class="card-info-table">
        <div class="info-item"><span>📌</span> <strong>${escapeHtml(jam.locationName)}</strong></div>
        <div class="info-item"><span>⏰</span> Starts at <strong>${startTimeStr}</strong></div>
      </div>

      <div class="card-tags">
        <span class="tag-badge vibe-tag">${escapeHtml(jam.vibe)}</span>
        ${(jam.genres || []).map(g => `<span class="tag-badge">#${escapeHtml(g)}</span>`).join('')}
        ${(jam.instrumentsNeeded || []).map(i => `<span class="tag-badge" style="background:#e0f2fe;color:#0369a1">Need: ${escapeHtml(i)}</span>`).join('')}
      </div>

      <div class="card-bottom">
        <div class="rating-pill">
          <span class="star">★</span> ${jam.averageRating || 'New'}
          <span class="rating-count">(${jam.ratingCount || 0} reviews)</span>
        </div>
        <div class="card-actions">
          <button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); openReviewModal('${jam._id}', '${escapeHtml(jam.title)}', '${escapeHtml(jam.hostTeam)}')">
            Rate
          </button>
          <button class="btn ${isAttending ? 'btn-brand' : 'btn-subtle'} btn-sm" onclick="event.stopPropagation(); handleRsvp('${jam._id}')">
            ${isAttending ? '✓ In Circle' : '+ Join In'}
          </button>
        </div>
      </div>
    `;

    card.addEventListener('click', () => {
      map.flyTo([jam.location.coordinates[1], jam.location.coordinates[0]], 15, { duration: 1 });
    });

    jamsFeedContainer.appendChild(card);
  });
}

function renderPins(jams) {
  currentMarkers.forEach(m => map.removeLayer(m));
  currentMarkers = [];

  jams.forEach(jam => {
    const [lng, lat] = jam.location.coordinates;
    const marker = L.circleMarker([lat, lng], {
      radius: 10,
      fillColor: '#e11d48',
      color: '#ffffff',
      weight: 2,
      fillOpacity: 0.95
    }).addTo(map);

    marker.bindPopup(`
      <div style="font-family:sans-serif;padding:2px">
        <div style="font-size:11px;font-weight:700;color:#e11d48;text-transform:uppercase">${escapeHtml(jam.hostTeam)}</div>
        <div style="font-size:14px;font-weight:700;margin:2px 0">${escapeHtml(jam.title)}</div>
        <div style="font-size:12px;color:#475569">📍 ${escapeHtml(jam.locationName)}</div>
        <div style="font-size:12px;color:#f59e0b;font-weight:700;margin-top:4px">★ ${jam.averageRating || 'New'} (${jam.ratingCount || 0})</div>
      </div>
    `);

    currentMarkers.push(marker);
  });
}

// --- 5. Backend Actions: RSVP, Hosting, Reviews ---
window.handleRsvp = async (jamId) => {
  if (!token) return openModal('authModal');
  try {
    const res = await fetch(`${API_BASE}/jams/${jamId}/rsvp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    if (res.ok) fetchJamsFromBackend();
  } catch (e) {
    console.error(e);
  }
};

document.getElementById('hostJamForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!token) return openModal('authModal');

  const coords = document.getElementById('hostCoords').value.split(',').map(n => parseFloat(n.trim()));

  const payload = {
    title: document.getElementById('hostTitle').value,
    hostTeam: document.getElementById('hostTeam').value,
    vibe: document.getElementById('hostVibe').value,
    genres: document.getElementById('hostGenres').value,
    locationName: document.getElementById('hostLocationName').value,
    lat: coords[0],
    lng: coords[1],
    startTime: document.getElementById('hostStartTime').value,
    endTime: document.getElementById('hostEndTime').value,
    instrumentsNeeded: document.getElementById('hostInstruments').value,
    description: document.getElementById('hostDesc').value
  };

  const res = await fetch(`${API_BASE}/jams/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    closeModals();
    e.target.reset();
    fetchJamsFromBackend();
  } else {
    alert('Failed to register jam session.');
  }
});

window.openReviewModal = async (jamId, title, team) => {
  document.getElementById('reviewJamId').value = jamId;
  document.getElementById('reviewTitleHeader').innerText = `Rate: ${title}`;
  document.getElementById('reviewSubtitleHeader').innerText = `Hosted by ${team}`;
  openModal('reviewModal');

  const res = await fetch(`${API_BASE}/reviews/${jamId}`);
  const reviews = await res.json();
  const list = document.getElementById('pastReviewsList');
  list.innerHTML = '';

  if (reviews.length === 0) {
    list.innerHTML = `<p class="empty-text">No reviews yet. Be the first to leave one!</p>`;
    return;
  }

  reviews.forEach(r => {
    const item = document.createElement('div');
    item.className = 'review-item';
    item.innerHTML = `
      <div class="review-item-header">
        <span>${escapeHtml(r.userName)}</span>
        <span style="color:#f59e0b">★ ${r.rating}</span>
      </div>
      <div>${escapeHtml(r.comment)}</div>
    `;
    list.appendChild(item);
  });
};

const starsSelector = document.getElementById('starsSelector');
starsSelector.querySelectorAll('.star').forEach(star => {
  star.addEventListener('click', () => {
    const score = parseInt(star.dataset.rating, 10);
    document.getElementById('selectedStarValue').value = score;
    starsSelector.querySelectorAll('.star').forEach((s, idx) => {
      if (idx < score) s.classList.add('active');
      else s.classList.remove('active');
    });
  });
});

document.getElementById('submitReviewBtn').addEventListener('click', async () => {
  if (!token) return openModal('authModal');

  const payload = {
    jamSessionId: document.getElementById('reviewJamId').value,
    rating: document.getElementById('selectedStarValue').value,
    comment: document.getElementById('reviewComment').value
  };

  const res = await fetch(`${API_BASE}/reviews/rate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    closeModals();
    fetchJamsFromBackend();
  }
});

// --- 6. Authentication Flows ---
document.getElementById('sendOtpBtn').addEventListener('click', async () => {
  const phone = document.getElementById('loginPhoneInput').value.trim();
  if (!phone) return alert('Enter phone number');

  const res = await fetch(`${API_BASE}/auth/phone/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  });
  const data = await res.json();
  if (data.success) {
    pendingPhone = phone;
    document.getElementById('phoneStep1').classList.add('hidden');
    document.getElementById('phoneStep2').classList.remove('hidden');
  }
});

document.getElementById('verifyOtpBtn').addEventListener('click', async () => {
  const otp = document.getElementById('loginOtpInput').value.trim();
  const name = document.getElementById('loginNameInput').value.trim();

  const res = await fetch(`${API_BASE}/auth/phone/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: pendingPhone, otp, name })
  });
  const data = await res.json();
  if (data.token) completeAuth(data.token, data.user);
  else alert(data.error || 'Invalid OTP');
});

document.getElementById('guestLoginBtn').addEventListener('click', async () => {
  const res = await fetch(`${API_BASE}/auth/guest`, { method: 'POST' });
  const data = await res.json();
  if (data.token) completeAuth(data.token, data.user);
});

function completeAuth(jwtToken, user) {
  token = jwtToken;
  currentUser = user;
  localStorage.setItem('jam_auth_token', jwtToken);
  localStorage.setItem('jam_auth_user', JSON.stringify(user));
  closeModals();
  updateAuthUI();
  fetchJamsFromBackend();
}

function updateAuthUI() {
  if (token && currentUser) {
    unauthControls.classList.add('hidden');
    authControls.classList.remove('hidden');
    navUserName.innerText = currentUser.name;
    avatarInitial.innerText = (currentUser.name || 'U').charAt(0).toUpperCase();
  } else {
    unauthControls.classList.remove('hidden');
    authControls.classList.add('hidden');
  }
}

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('jam_auth_token');
  localStorage.removeItem('jam_auth_user');
  token = null;
  currentUser = null;
  updateAuthUI();
  fetchJamsFromBackend();
});

// --- 7. Modal Handlers ---
window.openModal = (id) => document.getElementById(id).classList.remove('hidden');
window.closeModals = () => {
  authModal.classList.add('hidden');
  hostModal.classList.add('hidden');
  reviewModal.classList.add('hidden');
  locationModal.classList.add('hidden');
  document.getElementById('phoneStep1').classList.remove('hidden');
  document.getElementById('phoneStep2').classList.add('hidden');
  locSuggestions.classList.add('hidden');
};

locationSelectorBtn.addEventListener('click', () => openModal('locationModal'));
btnPickGPS.addEventListener('click', setLocationToCurrentGPS);
mapRecenterBtn.addEventListener('click', setLocationToCurrentGPS);
btnSearchLocation.addEventListener('click', handleManualLocationSearch);
manualLocInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleManualLocationSearch();
});

openLoginModalBtn.addEventListener('click', () => openModal('authModal'));
openHostBtn.addEventListener('click', () => {
  document.getElementById('hostCoords').value = `${browsingPosition.lat.toFixed(5)}, ${browsingPosition.lng.toFixed(5)}`;
  fetchReverseGeocode(browsingPosition.lat, browsingPosition.lng, 'hostLocationName');

  const now = new Date();
  now.setHours(now.getHours() + 1);
  now.setMinutes(0);
  document.getElementById('hostStartTime').value = now.toISOString().slice(0, 16);
  now.setHours(now.getHours() + 3);
  document.getElementById('hostEndTime').value = now.toISOString().slice(0, 16);

  openModal('hostModal');
});

// Category & Filter Listeners
document.querySelectorAll('.rail-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.rail-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeVibe = btn.dataset.vibe;
    fetchJamsFromBackend();
  });
});

radiusFilterSelect.addEventListener('change', (e) => {
  activeRadiusKm = parseInt(e.target.value, 10);
  renderRadius();
  fetchJamsFromBackend();
});

sortFilterSelect.addEventListener('change', (e) => {
  currentSort = e.target.value;
  fetchJamsFromBackend();
});

let searchTimeout;
mainSearchInput.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  searchQuery = e.target.value;
  searchClearBtn.classList.toggle('hidden', !searchQuery);
  searchTimeout = setTimeout(fetchJamsFromBackend, 300);
});

searchClearBtn.addEventListener('click', () => {
  mainSearchInput.value = '';
  searchQuery = '';
  searchClearBtn.classList.add('hidden');
  fetchJamsFromBackend();
});

// Mobile View Toggle
const contentWrapper = document.querySelector('.content-wrapper');
document.getElementById('btnShowList').addEventListener('click', (e) => {
  document.getElementById('btnShowMap').classList.remove('active');
  e.target.classList.add('active');
  contentWrapper.classList.remove('show-map');
});
document.getElementById('btnShowMap').addEventListener('click', (e) => {
  document.getElementById('btnShowList').classList.remove('active');
  e.target.classList.add('active');
  contentWrapper.classList.add('show-map');
  setTimeout(() => map.invalidateSize(), 200);
});

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);
}

// Initial Boot
window.addEventListener('DOMContentLoaded', () => {
  initMap();
  updateAuthUI();
  // Auto-detect GPS on first load
  setLocationToCurrentGPS();
});
// --- Authentication State & Handlers ---
let pendingAuthContact = '';

// Tab Switching
const tabPhone = document.getElementById('tabPhone');
const tabEmail = document.getElementById('tabEmail');
const tabGuest = document.getElementById('tabGuest');
const phoneAuthBox = document.getElementById('phoneAuthBox');
const emailAuthBox = document.getElementById('emailAuthBox');
const guestAuthBox = document.getElementById('guestAuthBox');

tabPhone.addEventListener('click', () => {
  tabPhone.classList.add('active');
  tabEmail.classList.remove('active');
  tabGuest.classList.remove('active');
  phoneAuthBox.classList.remove('hidden');
  emailAuthBox.classList.add('hidden');
  guestAuthBox.classList.add('hidden');
});

tabEmail.addEventListener('click', () => {
  tabEmail.classList.add('active');
  tabPhone.classList.remove('active');
  tabGuest.classList.remove('active');
  emailAuthBox.classList.remove('hidden');
  phoneAuthBox.classList.add('hidden');
  guestAuthBox.classList.add('hidden');
});

tabGuest.addEventListener('click', () => {
  tabGuest.classList.add('active');
  tabPhone.classList.remove('active');
  tabEmail.classList.remove('active');
  guestAuthBox.classList.remove('hidden');
  phoneAuthBox.classList.add('hidden');
  emailAuthBox.classList.add('hidden');
});

// 1. Phone Auth Handlers (Indian Number Check & OTP)
document.getElementById('sendOtpBtn').addEventListener('click', async () => {
  const phone = document.getElementById('loginPhoneInput').value.trim();
  const statusElem = document.getElementById('phoneValidateStatus');
  if (!phone) return alert('Please enter your mobile number.');

  statusElem.innerText = 'Validating carrier & region...';
  try {
    const res = await fetch(`${API_BASE}/auth/phone/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();

    if (res.ok) {
      pendingAuthContact = data.formattedNumber;
      statusElem.innerText = `✓ Indian Mobile Verified (${data.formattedNumber})`;
      document.getElementById('phoneStep1').classList.add('hidden');
      document.getElementById('phoneStep2').classList.remove('hidden');

      if (data.demoOtp) {
        alert(`Verification code sent! (Dev Console Code: ${data.demoOtp})`);
      }
    } else {
      statusElem.innerText = 'Validation failed';
      alert(data.error);
    }
  } catch (err) {
    alert('Server connection error.');
  }
});

document.getElementById('verifyOtpBtn').addEventListener('click', async () => {
  const otp = document.getElementById('loginOtpInput').value.trim();
  const name = document.getElementById('loginNameInput').value.trim();

  const res = await fetch(`${API_BASE}/auth/phone/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: pendingAuthContact, otp, name })
  });
  const data = await res.json();
  if (data.token) completeAuth(data.token, data.user);
  else alert(data.error || 'Invalid OTP');
});

// 2. Email Auth Handlers (Real Mail Check & Code)
document.getElementById('sendEmailOtpBtn').addEventListener('click', async () => {
  const email = document.getElementById('loginEmailInput').value.trim();
  const statusElem = document.getElementById('emailValidateStatus');
  if (!email) return alert('Please enter your email.');

  statusElem.innerText = 'Checking mail server & MX records...';
  try {
    const res = await fetch(`${API_BASE}/auth/email/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();

    if (res.ok) {
      pendingAuthContact = email;
      statusElem.innerText = '✓ Valid Mail Server Confirmed';
      document.getElementById('emailStep1').classList.add('hidden');
      document.getElementById('emailStep2').classList.remove('hidden');

      if (data.demoOtp) {
        alert(`Verification code sent! (Dev Console Code: ${data.demoOtp})`);
      }
    } else {
      statusElem.innerText = 'Invalid email';
      alert(data.error);
    }
  } catch (err) {
    alert('Server connection error.');
  }
});

document.getElementById('verifyEmailOtpBtn').addEventListener('click', async () => {
  const otp = document.getElementById('loginEmailOtpInput').value.trim();
  const name = document.getElementById('loginEmailNameInput').value.trim();

  const res = await fetch(`${API_BASE}/auth/email/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: pendingAuthContact, otp, name })
  });
  const data = await res.json();
  if (data.token) completeAuth(data.token, data.user);
  else alert(data.error || 'Invalid Code');
});

// 3. Google Sign-In Integration
function initGoogleAuth() {
  if (window.google) {
    google.accounts.id.initialize({
      client_id: "your_google_client_id_here.apps.googleusercontent.com",
      callback: async (response) => {
        const res = await fetch(`${API_BASE}/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: response.credential })
        });
        const data = await res.json();
        if (data.token) completeAuth(data.token, data.user);
      }
    });

    google.accounts.id.renderButton(
      document.getElementById('googleOneTapBtn'),
      { theme: 'outline', size: 'large', width: 340 }
    );
  }
}

// Dev Simulator for Google
document.getElementById('simulatedGoogleBtn').addEventListener('click', async () => {
  const dummy = {
    email: 'musician.artist@gmail.com',
    name: 'Dev Hendrix',
    picture: ''
  };
  const res = await fetch(`${API_BASE}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dummy)
  });
  const data = await res.json();
  if (data.token) completeAuth(data.token, data.user);
});

// Call Google initialization on load
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(initGoogleAuth, 1000);
});