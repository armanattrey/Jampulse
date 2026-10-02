/**
 * JamPulse — Frontend Application Controller
 * Handles Leaflet Map interactions, Geolocation, Filters, 
 * Real-time Jam Feeds, Live Google GIS Auth, Session Persistence, and Multi-Select Profile Sync.
 */

const API_BASE = 'https://jampulse.onrender.com/api';

// Live Google Cloud Web OAuth Client ID
const GOOGLE_CLIENT_ID = '326107511624-5h1huttdikntqiot9jig0slaccgdcjj2.apps.googleusercontent.com';

// --- State Management ---
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
let activeJamStatus = 'ready';

// Auth State
let token = localStorage.getItem('jam_auth_token') || null;
let currentUser = JSON.parse(localStorage.getItem('jam_auth_user') || 'null');
let pendingAuthContact = '';

// --- DOM References ---
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

// Modals
const authModal = document.getElementById('authModal');
const hostModal = document.getElementById('hostModal');
const reviewModal = document.getElementById('reviewModal');
const contactModal = document.getElementById('contactModal');
const profileModal = document.getElementById('profileModal');

const openLoginModalBtn = document.getElementById('openLoginModalBtn');
const openHostBtn = document.getElementById('openHostBtn');
const unauthControls = document.getElementById('unauthControls');
const authControls = document.getElementById('authControls');
const navUserName = document.getElementById('navUserName');
const avatarInitial = document.getElementById('avatarInitial');
const navAvatarImg = document.getElementById('navAvatarImg');

// --- 1. Session Persistence & Live Recovery ---
async function verifyActiveSession() {
  if (!token) {
    updateAuthUI();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      localStorage.setItem('jam_auth_user', JSON.stringify(currentUser));
      updateAuthUI();
    } else {
      logout();
    }
  } catch (err) {
    console.warn('Session verification fallback to cached storage:', err.message);
    updateAuthUI();
  }
}

// --- 2. Live Google OAuth 2.0 Integration ---
let googleTokenClient = null;

function initGoogleAuth() {
  const triggerBtn = document.getElementById('googleLoginTriggerBtn');
  const btnLabel = document.getElementById('googleBtnLabel');
  if (!triggerBtn) return;

  if (window.google?.accounts?.oauth2 && GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.includes('placeholder')) {
    try {
      googleTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'openid email profile',
        callback: async (tokenResponse) => {
          if (tokenResponse.error !== undefined) {
            alert('Google authentication encountered an issue. Please try again.');
            return;
          }

          if (btnLabel) btnLabel.innerText = 'Signing in...';

          try {
            const res = await fetch(`${API_BASE}/auth/google`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ accessToken: tokenResponse.access_token })
            });

            const data = await res.json();
            if (data.token) {
              completeAuth(data.token, data.user);
            } else {
              alert(data.error || 'Google sign-in rejected.');
            }
          } catch (fetchErr) {
            alert('Could not complete Google authentication with server.');
          } finally {
            if (btnLabel) btnLabel.innerText = 'Continue with Google';
          }
        }
      });

      triggerBtn.onclick = () => {
        if (googleTokenClient) {
          googleTokenClient.requestAccessToken({ prompt: 'select_account' });
        }
      };
      return;
    } catch (gErr) {
      console.warn('Google Identity initialization retry needed:', gErr);
    }
  }

  // Graceful fallback if Google GIS is still initializing
  triggerBtn.onclick = async () => {
    if (window.google?.accounts?.oauth2) {
      initGoogleAuth();
      if (googleTokenClient) {
        googleTokenClient.requestAccessToken({ prompt: 'select_account' });
        return;
      }
    }

    const emailPrompt = prompt("Enter your personal email to test authenticated profile:", "musician@gmail.com");
    if (!emailPrompt) return;

    try {
      const res = await fetch(`${API_BASE}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: btoa(JSON.stringify({
            email: emailPrompt.trim(),
            name: emailPrompt.split('@')[0],
            picture: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=150'
          }))
        })
      });
      const data = await res.json();
      if (data.token) completeAuth(data.token, data.user);
      else alert(data.error || 'Login rejected.');
    } catch (e) {
      alert('Network error connecting to auth server.');
    }
  };
}

// --- 3. Profile Drawer & Multi-Option Interactive Controller ---
window.openProfileDrawer = () => {
  if (!currentUser) return;

  const nameDisp = document.getElementById('profileNameDisplay');
  const emailDisp = document.getElementById('profileEmailDisplay');
  const roleBadge = document.getElementById('profileRoleBadge');
  const largeImg = document.getElementById('profileLargeAvatar');
  const largeInitial = document.getElementById('profileLargeInitial');

  const editName = document.getElementById('editArtistName');
  const editRoleHidden = document.getElementById('editArtistRole');
  const editBio = document.getElementById('editArtistBio');

  // Stats Calculation
  const jamsJoinedCount = (jamsData || []).filter(j => j.rsvpUsers?.includes(currentUser._id)).length;
  const statJams = document.getElementById('statJamsCount');
  if (statJams) statJams.innerText = jamsJoinedCount || '1';

  if (nameDisp) nameDisp.innerText = currentUser.name || 'Artist';
  if (emailDisp) emailDisp.innerText = currentUser.email || currentUser.phone || '@musician';

  const userRole = currentUser.role || 'Guitarist';
  if (roleBadge) roleBadge.innerText = `⚡ ${userRole}`;
  if (editRoleHidden) editRoleHidden.value = userRole;

  if (editName) editName.value = currentUser.name || '';
  if (editBio) editBio.value = currentUser.bio || '';

  // Avatar Image Sync
  if (currentUser.avatarUrl && largeImg) {
    largeImg.src = currentUser.avatarUrl;
    largeImg.classList.remove('hidden');
    if (largeInitial) largeInitial.classList.add('hidden');
  } else if (largeInitial) {
    if (largeImg) largeImg.classList.add('hidden');
    largeInitial.classList.remove('hidden');
    largeInitial.innerText = (currentUser.name || 'U').charAt(0).toUpperCase();
  }

  // Visual Role Cards Selection
  document.querySelectorAll('#visualRoleGrid .role-tile').forEach(tile => {
    tile.classList.toggle('active', tile.dataset.role === userRole);
  });

  // Instruments Multi-select Checkboxes
  const userInstruments = currentUser.instruments || [];
  document.querySelectorAll('#instrumentsMultiSelector input[type="checkbox"]').forEach(cb => {
    cb.checked = userInstruments.includes(cb.value);
  });

  openModal('profileModal');
};

// Interactive Role Tiles Click Handler
document.querySelectorAll('#visualRoleGrid .role-tile').forEach(tile => {
  tile.addEventListener('click', () => {
    document.querySelectorAll('#visualRoleGrid .role-tile').forEach(t => t.classList.remove('active'));
    tile.classList.add('active');
    const roleVal = tile.dataset.role;
    const roleHidden = document.getElementById('editArtistRole');
    if (roleHidden) roleHidden.value = roleVal;
    const roleBadge = document.getElementById('profileRoleBadge');
    if (roleBadge) roleBadge.innerText = `⚡ ${roleVal}`;
  });
});

// Interactive Jam Status Switcher Pills
document.querySelectorAll('.status-pill-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.status-pill-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeJamStatus = btn.dataset.status;

    const pulseDot = document.getElementById('avatarPulseDot');
    if (pulseDot) {
      if (activeJamStatus === 'ready') pulseDot.style.background = '#22c55e';
      else if (activeJamStatus === 'studio') pulseDot.style.background = '#f97316';
      else pulseDot.style.background = '#a855f7';
    }
  });
});

// Save Profile Details
const saveProfileBtn = document.getElementById('saveProfileBtn');
if (saveProfileBtn) {
  saveProfileBtn.addEventListener('click', async () => {
    if (!token || !currentUser) return;

    const updatedName = document.getElementById('editArtistName')?.value.trim();
    const updatedRole = document.getElementById('editArtistRole')?.value;
    const updatedBio = document.getElementById('editArtistBio')?.value.trim();

    const selectedInstruments = [];
    document.querySelectorAll('#instrumentsMultiSelector input[type="checkbox"]:checked').forEach(cb => {
      selectedInstruments.push(cb.value);
    });

    saveProfileBtn.innerText = 'Syncing Changes...';

    try {
      const res = await fetch(`${API_BASE}/auth/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: updatedName,
          role: updatedRole,
          bio: updatedBio,
          instruments: selectedInstruments
        })
      });

      const data = await res.json();
      saveProfileBtn.innerText = '✨ Save Profile Details';

      if (res.ok && data.user) {
        currentUser = data.user;
        localStorage.setItem('jam_auth_user', JSON.stringify(currentUser));
        updateAuthUI();
        closeModals();
        alert('Studio profile updated & synced to cloud!');
      } else {
        alert(data.error || 'Failed to update profile.');
      }
    } catch (err) {
      saveProfileBtn.innerText = '✨ Save Profile Details';
      alert('Network error while updating profile.');
    }
  });
}

// Share Artist Card Button
const shareProfileCardBtn = document.getElementById('shareProfileCardBtn');
if (shareProfileCardBtn) {
  shareProfileCardBtn.addEventListener('click', () => {
    const handle = currentUser?.name || 'Artist';
    const profileUrl = `${window.location.origin}/?artist=${encodeURIComponent(handle)}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(profileUrl);
      alert(`Copied link to clipboard!\n${profileUrl}`);
    } else {
      alert(`Share this artist link:\n${profileUrl}`);
    }
  });
}

function completeAuth(jwtToken, user) {
  token = jwtToken;
  currentUser = user;
  localStorage.setItem('jam_auth_token', jwtToken);
  localStorage.setItem('jam_auth_user', JSON.stringify(user));
  closeModals();
  updateAuthUI();
  fetchJamsFromBackend();
}

function logout() {
  localStorage.removeItem('jam_auth_token');
  localStorage.removeItem('jam_auth_user');
  token = null;
  currentUser = null;
  closeModals();
  updateAuthUI();
  fetchJamsFromBackend();
}

const drawerLogoutBtn = document.getElementById('drawerLogoutBtn');
if (drawerLogoutBtn) drawerLogoutBtn.addEventListener('click', logout);

const navLogoutBtn = document.getElementById('logoutBtn');
if (navLogoutBtn) navLogoutBtn.addEventListener('click', logout);

function updateAuthUI() {
  if (token && currentUser) {
    unauthControls.classList.add('hidden');
    authControls.classList.remove('hidden');
    if (navUserName) navUserName.innerText = currentUser.name || 'Artist';

    if (currentUser.avatarUrl && navAvatarImg) {
      navAvatarImg.src = currentUser.avatarUrl;
      navAvatarImg.classList.remove('hidden');
      if (avatarInitial) avatarInitial.classList.add('hidden');
    } else {
      if (navAvatarImg) navAvatarImg.classList.add('hidden');
      if (avatarInitial) {
        avatarInitial.classList.remove('hidden');
        avatarInitial.innerText = (currentUser.name || 'U').charAt(0).toUpperCase();
      }
    }
  } else {
    unauthControls.classList.remove('hidden');
    authControls.classList.add('hidden');
  }
}

// --- 4. Map & Core Geo Functions ---
function initMap() {
  map = L.map('leafletMap', { zoomControl: false }).setView([browsingPosition.lat, browsingPosition.lng], 12);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  L.control.zoom({ position: 'topright' }).addTo(map);

  map.on('click', async (e) => {
    const hostCoords = document.getElementById('hostCoords');
    if (hostCoords && !hostModal.classList.contains('hidden')) {
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
    radius: 8,
    fillColor: '#2563eb',
    color: '#ffffff',
    weight: 2,
    fillOpacity: 1
  }).addTo(map);

  radiusCircle = L.circle([browsingPosition.lat, browsingPosition.lng], {
    radius: activeRadiusKm * 1000,
    color: '#e11d48',
    fillColor: '#e11d48',
    fillOpacity: 0.06,
    weight: 1.5
  }).addTo(map);
}

async function fetchReverseGeocode(lat, lng, targetInputId = null) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
    const data = await res.json();
    const city = data.address?.city || data.address?.town || data.address?.suburb || 'Selected Area';

    if (targetInputId) {
      const field = document.getElementById(targetInputId);
      if (field) field.value = data.name || data.display_name.split(',')[0];
    } else {
      navCityText.innerText = city;
    }
  } catch (e) {
    if (!targetInputId) navCityText.innerText = 'Connected Area';
  }
}

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
        navCityText.innerText = 'Gurugram (Default)';
        fetchJamsFromBackend();
      },
      { timeout: 8000 }
    );
  } else {
    alert('Geolocation is not supported by your browser.');
  }
}

async function handleManualLocationSearch() {
  const query = manualLocInput.value.trim();
  if (!query) return;

  btnSearchLocation.innerText = 'Searching...';
  locSuggestions.classList.remove('hidden');

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
    const results = await res.json();
    btnSearchLocation.innerText = 'Search';

    if (results.length === 0) {
      locSuggestions.innerHTML = '<div style="padding:10px;font-size:0.85rem;color:#64748b">No areas found.</div>';
      return;
    }

    locSuggestions.innerHTML = '';
    results.forEach(item => {
      const div = document.createElement('div');
      div.className = 'loc-suggestion-item';
      div.style.cssText = 'padding:10px;cursor:pointer;border-bottom:1px solid #f1f5f9;font-size:0.88rem;';
      div.innerHTML = `📍 ${escapeHtml(item.display_name)}`;

      div.onclick = () => {
        browsingPosition = { lat: parseFloat(item.lat), lng: parseFloat(item.lon) };
        navCityText.innerText = item.name || item.display_name.split(',')[0];
        map.setView([browsingPosition.lat, browsingPosition.lng], 12);
        renderRadius();
        closeModals();
        fetchJamsFromBackend();
      };
      locSuggestions.appendChild(div);
    });
  } catch (err) {
    btnSearchLocation.innerText = 'Search';
  }
}

// --- 5. Fetch and Render Jams ---
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
    if (!res.ok) throw new Error(`Status: ${res.status}`);

    jamsData = await res.json();
    renderCards(jamsData);
    renderPins(jamsData);
  } catch (err) {
    jamsFeedContainer.innerHTML = `
      <div style="background:#fee2e2;color:#991b1b;padding:16px;border-radius:12px;font-size:0.9rem">
        ⚠️ <strong>Connecting to Cloud Services...</strong>
      </div>
    `;
    resultsCount.innerText = 'Server offline';
  }
}

function renderCards(jams) {
  resultsCount.innerText = `${jams.length} Jam${jams.length === 1 ? '' : 's'} near you`;
  jamsFeedContainer.innerHTML = '';

  if (jams.length === 0) {
    jamsFeedContainer.innerHTML = `
      <div style="text-align:center;padding:48px 16px;color:#64748b">
        <span style="font-size:2.6rem">🎶</span>
        <h3 style="margin-top:10px;color:#0f172a">No open jam sessions found</h3>
        <p style="font-size:0.88rem;margin-top:4px">Widen radius or click "+ Host Jam"!</p>
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
      <p class="card-desc">${escapeHtml(jam.description || 'No description.')}</p>

      <div class="card-info-table">
        <div class="info-item"><span>📌</span> <strong>${escapeHtml(jam.locationName)}</strong></div>
        <div class="info-item"><span>⏰</span> Starts at <strong>${startTimeStr}</strong></div>
      </div>

      <div class="card-tags">
        <span class="tag-badge vibe-tag">${escapeHtml(jam.vibe)}</span>
        ${(jam.instrumentsNeeded || []).map(i => `<span class="tag-badge">Need: ${escapeHtml(i)}</span>`).join('')}
      </div>

      <div class="card-bottom">
        <div class="rating-pill">
          <span class="star" style="color:#f59e0b">★</span> ${jam.averageRating || 'New'}
        </div>
        <div class="card-actions">
          <button class="btn btn-outline btn-sm contact-host-trigger">Contact</button>
          <button class="btn ${isAttending ? 'btn-brand' : 'btn-subtle'} btn-sm rsvp-trigger">
            ${isAttending ? '✓ In Circle' : '+ Join In'}
          </button>
        </div>
      </div>
    `;

    card.onclick = () => map.flyTo([jam.location.coordinates[1], jam.location.coordinates[0]], 15);
    card.querySelector('.contact-host-trigger').onclick = (e) => { e.stopPropagation(); openContactModal(jam); };
    card.querySelector('.rsvp-trigger').onclick = (e) => { e.stopPropagation(); handleRsvp(jam._id); };

    jamsFeedContainer.appendChild(card);
  });
}

function renderPins(jams) {
  currentMarkers.forEach(m => map.removeLayer(m));
  currentMarkers = [];

  jams.forEach(jam => {
    const [lng, lat] = jam.location.coordinates;
    const marker = L.circleMarker([lat, lng], {
      radius: 9,
      fillColor: '#e11d48',
      color: '#ffffff',
      weight: 2,
      fillOpacity: 0.95
    }).addTo(map);

    marker.bindPopup(`<strong>${escapeHtml(jam.title)}</strong><br>${escapeHtml(jam.locationName)}`);
    currentMarkers.push(marker);
  });
}

async function handleRsvp(jamId) {
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
    console.error('RSVP failed:', e);
  }
}

// Host Form Submission
document.getElementById('hostJamForm').onsubmit = async (e) => {
  e.preventDefault();
  if (!token) return openModal('authModal');

  const coordsRaw = document.getElementById('hostCoords').value;
  if (!coordsRaw) return alert('Click on map to select coordinates.');
  const coords = coordsRaw.split(',').map(n => parseFloat(n.trim()));

  const payload = {
    title: document.getElementById('hostTitle').value,
    hostTeam: document.getElementById('hostTeam').value,
    vibe: document.getElementById('hostVibe').value,
    genres: document.getElementById('hostGenres').value.split(',').map(s => s.trim()).filter(Boolean),
    locationName: document.getElementById('hostLocationName').value,
    lat: coords[0],
    lng: coords[1],
    startTime: document.getElementById('hostStartTime').value,
    endTime: document.getElementById('hostEndTime').value,
    instrumentsNeeded: document.getElementById('hostInstruments').value.split(',').map(s => s.trim()).filter(Boolean),
    description: document.getElementById('hostDesc').value
  };

  try {
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
      const err = await res.json();
      alert(err.error || 'Failed to host session.');
    }
  } catch (err) {
    alert('Network error registering session.');
  }
};

function openContactModal(jam) {
  document.getElementById('contactSubtitleHeader').innerText = `${jam.title} (${jam.hostTeam})`;
  const cleanPhone = (jam.hostPhone || '919999999999').replace(/[^\d]/g, '');
  document.getElementById('whatsappContactLink').href = `https://wa.me/${cleanPhone}`;
  openModal('contactModal');
}

// --- 6. Auth Tabs & Form Triggers ---
const tabPhone = document.getElementById('tabPhone');
const tabEmail = document.getElementById('tabEmail');
const tabGuest = document.getElementById('tabGuest');
const phoneAuthBox = document.getElementById('phoneAuthBox');
const emailAuthBox = document.getElementById('emailAuthBox');
const guestAuthBox = document.getElementById('guestAuthBox');

tabPhone.onclick = () => {
  tabPhone.classList.add('active'); tabEmail.classList.remove('active'); tabGuest.classList.remove('active');
  phoneAuthBox.classList.remove('hidden'); emailAuthBox.classList.add('hidden'); guestAuthBox.classList.add('hidden');
};

tabEmail.onclick = () => {
  tabEmail.classList.add('active'); tabPhone.classList.remove('active'); tabGuest.classList.remove('active');
  emailAuthBox.classList.remove('hidden'); phoneAuthBox.classList.add('hidden'); guestAuthBox.classList.add('hidden');
};

tabGuest.onclick = () => {
  tabGuest.classList.add('active'); tabPhone.classList.remove('active'); tabEmail.classList.remove('active');
  guestAuthBox.classList.remove('hidden'); phoneAuthBox.classList.add('hidden'); emailAuthBox.classList.add('hidden');
};

document.getElementById('sendOtpBtn').onclick = async () => {
  const phone = document.getElementById('loginPhoneInput').value.trim();
  if (!phone) return alert('Enter phone number');

  try {
    const res = await fetch(`${API_BASE}/auth/phone/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();
    if (res.ok) {
      pendingAuthContact = data.formattedNumber || phone;
      document.getElementById('phoneStep1').classList.add('hidden');
      document.getElementById('phoneStep2').classList.remove('hidden');
      alert(data.message || 'OTP dispatched!');
    } else alert(data.error);
  } catch (e) { alert('Server error'); }
};

document.getElementById('verifyOtpBtn').onclick = async () => {
  const otp = document.getElementById('loginOtpInput').value.trim();
  const name = document.getElementById('loginNameInput').value.trim();

  try {
    const res = await fetch(`${API_BASE}/auth/phone/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: pendingAuthContact, otp, name })
    });
    const data = await res.json();
    if (data.token) completeAuth(data.token, data.user);
    else alert(data.error || 'Verification failed');
  } catch (e) { alert('Verification error'); }
};

document.getElementById('sendEmailOtpBtn').onclick = async () => {
  const email = document.getElementById('loginEmailInput').value.trim();
  if (!email) return alert('Enter email');

  try {
    const res = await fetch(`${API_BASE}/auth/email/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (res.ok) {
      pendingAuthContact = email;
      document.getElementById('emailStep1').classList.add('hidden');
      document.getElementById('emailStep2').classList.remove('hidden');
      alert(data.message || 'Code sent!');
    } else alert(data.error);
  } catch (e) { alert('Server error'); }
};

document.getElementById('verifyEmailOtpBtn').onclick = async () => {
  const otp = document.getElementById('loginEmailOtpInput').value.trim();
  const name = document.getElementById('loginEmailNameInput').value.trim();

  try {
    const res = await fetch(`${API_BASE}/auth/email/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pendingAuthContact, otp, name })
    });
    const data = await res.json();
    if (data.token) completeAuth(data.token, data.user);
    else alert(data.error || 'Verification failed');
  } catch (e) { alert('Verification error'); }
};

document.getElementById('guestLoginBtn').onclick = async () => {
  try {
    const res = await fetch(`${API_BASE}/auth/guest`, { method: 'POST' });
    const data = await res.json();
    if (data.token) completeAuth(data.token, data.user);
  } catch (e) { alert('Guest login error'); }
};

// Modal Utility
window.openModal = (id) => {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
};

window.closeModals = () => {
  [authModal, hostModal, reviewModal, locationModal, contactModal, profileModal].forEach(m => {
    if (m) m.classList.add('hidden');
  });
  document.getElementById('phoneStep1').classList.remove('hidden');
  document.getElementById('phoneStep2').classList.add('hidden');
  document.getElementById('emailStep1').classList.remove('hidden');
  document.getElementById('emailStep2').classList.add('hidden');
  locSuggestions.classList.add('hidden');
};

locationSelectorBtn.onclick = () => openModal('locationModal');
btnPickGPS.onclick = setLocationToCurrentGPS;
mapRecenterBtn.onclick = setLocationToCurrentGPS;
btnSearchLocation.onclick = handleManualLocationSearch;
openLoginModalBtn.onclick = () => openModal('authModal');
openHostBtn.onclick = () => {
  document.getElementById('hostCoords').value = `${browsingPosition.lat.toFixed(5)}, ${browsingPosition.lng.toFixed(5)}`;
  fetchReverseGeocode(browsingPosition.lat, browsingPosition.lng, 'hostLocationName');
  const now = new Date();
  now.setHours(now.getHours() + 1, 0, 0, 0);
  document.getElementById('hostStartTime').value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  now.setHours(now.getHours() + 3);
  document.getElementById('hostEndTime').value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  openModal('hostModal');
};

document.querySelectorAll('.rail-item').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.rail-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeVibe = btn.dataset.vibe;
    fetchJamsFromBackend();
  };
});

radiusFilterSelect.onchange = (e) => {
  activeRadiusKm = parseInt(e.target.value, 10);
  renderRadius();
  fetchJamsFromBackend();
};

sortFilterSelect.onchange = (e) => {
  currentSort = e.target.value;
  fetchJamsFromBackend();
};

let searchTimeout;
mainSearchInput.oninput = (e) => {
  clearTimeout(searchTimeout);
  searchQuery = e.target.value.trim();
  searchClearBtn.classList.toggle('hidden', !searchQuery);
  searchTimeout = setTimeout(fetchJamsFromBackend, 350);
};

searchClearBtn.onclick = () => {
  mainSearchInput.value = '';
  searchQuery = '';
  searchClearBtn.classList.add('hidden');
  fetchJamsFromBackend();
};

const contentWrapper = document.querySelector('.content-wrapper');
document.getElementById('btnShowList').onclick = (e) => {
  document.getElementById('btnShowMap').classList.remove('active');
  e.target.classList.add('active');
  contentWrapper.classList.remove('show-map');
};

document.getElementById('btnShowMap').onclick = (e) => {
  document.getElementById('btnShowList').classList.remove('active');
  e.target.classList.add('active');
  contentWrapper.classList.add('show-map');
  setTimeout(() => map.invalidateSize(), 200);
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);
}

window.addEventListener('DOMContentLoaded', () => {
  initMap();
  verifyActiveSession();
  setLocationToCurrentGPS();
  setTimeout(initGoogleAuth, 400);
});
