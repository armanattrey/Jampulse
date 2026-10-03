const API_BASE = 'https://jampulse.onrender.com/api';
const GOOGLE_CLIENT_ID = '326107511624-5h1huttdikntqiot9jig0slaccgdcjj2.apps.googleusercontent.com';

const COOLDOWNS = {
  NAME_MS: 30 * 24 * 60 * 60 * 1000,
  PHONE_MS: 90 * 24 * 60 * 60 * 1000
};

let map;
let userLocMarker = null;
let radiusCircle = null;
let currentMarkers = [];
let browsingPosition = { lat: 28.4595, lng: 77.0266 };
let activeRadiusKm = 25;
let activeVibe = 'All';
let currentSort = 'distance';
let searchQuery = '';
let jamsData = [];
let activeJamStatus = 'ready';

let token = localStorage.getItem('jam_auth_token') || null;
let currentUser = JSON.parse(localStorage.getItem('jam_auth_user') || 'null');
let pendingAuthContact = '';

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

const authModal = document.getElementById('authModal');
const hostModal = document.getElementById('hostModal');
const reviewModal = document.getElementById('reviewModal');
const contactModal = document.getElementById('contactModal');
const profileModal = document.getElementById('profileModal');

const openLoginModalBtn = document.getElementById('openLoginModalBtn');
const openHostBtn = document.getElementById('openHostBtn');
const unauthControls = document.getElementById('unauthControls');
const authControls = document.getElementById('authControls');
const avatarTriggerBtn = document.getElementById('avatarTriggerBtn');
const avatarDropdownMenu = document.getElementById('avatarDropdownMenu');
const avatarInitial = document.getElementById('avatarInitial');
const navAvatarImg = document.getElementById('navAvatarImg');

async function verifyActiveSession() {
  if (!token) {
    updateAuthUI();
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      currentUser = { ...currentUser, ...data.user };
      localStorage.setItem('jam_auth_user', JSON.stringify(currentUser));
      updateAuthUI();
    } else {
      logout();
    }
  } catch (err) {
    updateAuthUI();
  }
}

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
            alert('Google authentication error. Try again.');
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
            if (data.token) completeAuth(data.token, data.user);
            else alert(data.error || 'Google sign-in rejected.');
          } catch (fetchErr) {
            alert('Could not connect to auth server.');
          } finally {
            if (btnLabel) btnLabel.innerText = 'Continue with Google';
          }
        }
      });

      triggerBtn.onclick = () => {
        if (googleTokenClient) googleTokenClient.requestAccessToken({ prompt: 'select_account' });
      };
      return;
    } catch (gErr) {}
  }

  triggerBtn.onclick = async () => {
    const emailPrompt = prompt("Enter email to test profile:", "musician@gmail.com");
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
      alert('Network error.');
    }
  };
}

window.openProfileDrawer = () => {
  if (!currentUser) return;
  closeDropdown();

  const nameDisp = document.getElementById('profileNameDisplay');
  const emailDisp = document.getElementById('profileEmailDisplay');
  const roleBadge = document.getElementById('profileRoleBadge');
  const largeImg = document.getElementById('profileLargeAvatar');
  const largeInitial = document.getElementById('profileLargeInitial');

  const editName = document.getElementById('editArtistName');
  const editPhone = document.getElementById('editArtistPhone');
  const editRoleHidden = document.getElementById('editArtistRole');
  const editBio = document.getElementById('editArtistBio');

  const nameMsg = document.getElementById('nameCooldownMsg');
  const phoneMsg = document.getElementById('phoneCooldownMsg');

  const jamsJoinedCount = (jamsData || []).filter(j => j.rsvpUsers?.includes(currentUser._id)).length;
  const statJams = document.getElementById('statJamsCount');
  if (statJams) statJams.innerText = jamsJoinedCount || '1';

  if (nameDisp) nameDisp.innerText = currentUser.name || 'Artist';
  if (emailDisp) emailDisp.innerText = currentUser.email || currentUser.phone || '@musician';

  const userRole = currentUser.role || 'Guitarist';
  if (roleBadge) roleBadge.innerText = `⚡ ${userRole}`;
  if (editRoleHidden) editRoleHidden.value = userRole;

  if (editName) editName.value = currentUser.name || '';
  if (editPhone) editPhone.value = currentUser.phone || '';
  if (editBio) editBio.value = currentUser.bio || '';

  const now = Date.now();
  const lastNameChange = currentUser.lastNameChange ? new Date(currentUser.lastNameChange).getTime() : 0;
  const nameElapsed = now - lastNameChange;
  if (lastNameChange && nameElapsed < COOLDOWNS.NAME_MS) {
    const daysLeft = Math.ceil((COOLDOWNS.NAME_MS - nameElapsed) / (1000 * 60 * 60 * 24));
    editName.disabled = true;
    nameMsg.innerText = `🔒 Name locked for ${daysLeft} more day(s).`;
    nameMsg.className = 'cooldown-hint locked';
  } else {
    editName.disabled = false;
    nameMsg.innerText = `Available to edit. (30-day cooldown triggers upon save)`;
    nameMsg.className = 'cooldown-hint';
  }

  const lastPhoneChange = currentUser.lastPhoneChange ? new Date(currentUser.lastPhoneChange).getTime() : 0;
  const phoneElapsed = now - lastPhoneChange;
  if (currentUser.phone && lastPhoneChange && phoneElapsed < COOLDOWNS.PHONE_MS) {
    const daysLeft = Math.ceil((COOLDOWNS.PHONE_MS - phoneElapsed) / (1000 * 60 * 60 * 24));
    editPhone.disabled = true;
    phoneMsg.innerText = `🔒 Phone number locked for ${daysLeft} more day(s).`;
    phoneMsg.className = 'cooldown-hint locked';
  } else {
    editPhone.disabled = false;
    phoneMsg.innerText = currentUser.phone 
      ? `Can be updated now. (90-day lock triggers upon update)` 
      : `Link your phone number for session updates.`;
    phoneMsg.className = 'cooldown-hint';
  }

  if (currentUser.avatarUrl && largeImg) {
    largeImg.src = currentUser.avatarUrl;
    largeImg.classList.remove('hidden');
    if (largeInitial) largeInitial.classList.add('hidden');
  } else if (largeInitial) {
    if (largeImg) largeImg.classList.add('hidden');
    largeInitial.classList.remove('hidden');
    largeInitial.innerText = (currentUser.name || 'U').charAt(0).toUpperCase();
  }

  document.querySelectorAll('#visualRoleGrid .role-tile').forEach(tile => {
    tile.classList.toggle('active', tile.dataset.role === userRole);
  });

  const userInstruments = currentUser.instruments || [];
  document.querySelectorAll('#instrumentsMultiSelector input[type="checkbox"]').forEach(cb => {
    cb.checked = userInstruments.includes(cb.value);
  });

  openModal('profileModal');
};

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

const saveProfileBtn = document.getElementById('saveProfileBtn');
if (saveProfileBtn) {
  saveProfileBtn.addEventListener('click', async () => {
    if (!token || !currentUser) return;

    const updatedName = document.getElementById('editArtistName')?.value.trim();
    const updatedPhone = document.getElementById('editArtistPhone')?.value.trim();
    const updatedRole = document.getElementById('editArtistRole')?.value;
    const updatedBio = document.getElementById('editArtistBio')?.value.trim();

    const selectedInstruments = [];
    document.querySelectorAll('#instrumentsMultiSelector input[type="checkbox"]:checked').forEach(cb => {
      selectedInstruments.push(cb.value);
    });

    const now = new Date().toISOString();
    const isNameChanged = updatedName && updatedName !== currentUser.name;
    const isPhoneChanged = updatedPhone && updatedPhone !== currentUser.phone;

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
          phone: updatedPhone,
          role: updatedRole,
          bio: updatedBio,
          instruments: selectedInstruments
        })
      });

      const data = await res.json();
      saveProfileBtn.innerText = '✨ Save Profile Details';

      const updatedUser = data.user || {
        ...currentUser,
        name: updatedName,
        phone: updatedPhone,
        role: updatedRole,
        bio: updatedBio,
        instruments: selectedInstruments
      };

      if (isNameChanged) updatedUser.lastNameChange = now;
      if (isPhoneChanged) updatedUser.lastPhoneChange = now;

      currentUser = updatedUser;
      localStorage.setItem('jam_auth_user', JSON.stringify(currentUser));
      updateAuthUI();
      closeModals();
      alert('Studio profile updated & synced!');
    } catch (err) {
      saveProfileBtn.innerText = '✨ Save Profile Details';
      alert('Network error while updating profile.');
    }
  });
}

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
  closeDropdown();
  updateAuthUI();
  fetchJamsFromBackend();
}

window.logout = function() {
  localStorage.removeItem('jam_auth_token');
  localStorage.removeItem('jam_auth_user');
  token = null;
  currentUser = null;
  closeModals();
  closeDropdown();
  updateAuthUI();
  fetchJamsFromBackend();
};

function toggleDropdown(e) {
  if (e) e.stopPropagation();
  if (!avatarDropdownMenu) return;
  avatarDropdownMenu.classList.toggle('hidden');
}

function closeDropdown() {
  if (avatarDropdownMenu) avatarDropdownMenu.classList.add('hidden');
}

if (avatarTriggerBtn) {
  avatarTriggerBtn.addEventListener('click', toggleDropdown);
}

// ==================== PROFILE MENU ACTIONS ====================
function initProfileDropdownActions() {
  const btnMyHosted = document.getElementById('btnMyHostedJams');
  if (btnMyHosted) {
    btnMyHosted.onclick = () => {
      closeDropdown();
      if (!currentUser) return openModal('authModal');
      const myJams = (jamsData || []).filter(j => 
        (j.hostId && j.hostId === currentUser._id) || 
        (j.hostTeam && currentUser.name && j.hostTeam.toLowerCase() === currentUser.name.toLowerCase())
      );
      if (myJams.length === 0) {
        alert('You haven\'t hosted any circles yet. Tap "+ Host Jam" to post one!');
        openHostBtn.click();
      } else {
        renderCards(myJams);
        resultsCount.innerText = `${myJams.length} Hosted Jam(s)`;
      }
    };
  }

  const btnSaved = document.getElementById('btnSavedJams');
  if (btnSaved) {
    btnSaved.onclick = () => {
      closeDropdown();
      const savedIds = JSON.parse(localStorage.getItem('jam_saved_ids') || '[]');
      const savedJams = (jamsData || []).filter(j => savedIds.includes(j._id));
      if (savedJams.length === 0) {
        alert('No saved jams yet. Bookmark jams using the heart or join features to track them here!');
      } else {
        renderCards(savedJams);
        resultsCount.innerText = `${savedJams.length} Saved Jam(s)`;
      }
    };
  }

  const btnInvites = document.getElementById('btnJamInvites');
  if (btnInvites) {
    btnInvites.onclick = () => {
      closeDropdown();
      if (!currentUser) return openModal('authModal');
      const attending = (jamsData || []).filter(j => j.rsvpUsers?.includes(currentUser._id));
      if (attending.length === 0) {
        alert("You haven't RSVP'd to any jams yet. Tap '+ Join In' on any jam card to save your spot!");
      } else {
        renderCards(attending);
        resultsCount.innerText = `${attending.length} Confirmed RSVP(s)`;
      }
    };
  }

  const btnGear = document.getElementById('btnGearLocker');
  if (btnGear) {
    btnGear.onclick = () => {
      closeDropdown();
      window.openProfileDrawer();
      setTimeout(() => {
        const gearSection = document.getElementById('instrumentsMultiSelector');
        if (gearSection) {
          gearSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 150);
    };
  }

  const btnPref = document.getElementById('btnPreferences');
  if (btnPref) {
    btnPref.onclick = () => {
      closeDropdown();
      alert('⚙️ Preferences:\n- Default Radius: 25 km\n- Audio Notifications: Enabled\n- Metric Units (km): Enabled');
    };
  }

  const btnSec = document.getElementById('btnSecurity');
  if (btnSec) {
    btnSec.onclick = () => {
      closeDropdown();
      const identity = currentUser?.email || currentUser?.phone || 'Guest Account';
      alert(`🔒 Security Settings:\n\nActive Account: ${identity}\nOAuth Provider: Google / OTP Auth\nToken status: Active & Encrypted`);
    };
  }

  const btnSupp = document.getElementById('btnSupport');
  if (btnSupp) {
    btnSupp.onclick = () => {
      closeDropdown();
      alert('🎸 JamPulse Community Guidelines & Help:\n\n1. Be respectful to fellow artists & circle leaders.\n2. Keep session descriptions honest regarding skill level.\n\nNeed Help? Reach us at support@jampulse.com');
    };
  }
}

function updateAuthUI() {
  if (token && currentUser) {
    unauthControls.classList.add('hidden');
    authControls.classList.remove('hidden');

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

// ==================== MAP INITIALIZATION WITH BOUNDED STACKING ====================
function initMap() {
  map = L.map('leafletMap', { 
    zoomControl: false 
  }).setView([browsingPosition.lat, browsingPosition.lng], 12);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  // Position controls inside bounded layout
  L.control.zoom({ position: 'topright' }).addTo(map);

  // Enforce pane stacking programmatically so Leaflet does not bleed into UI
  if (map.getPanes) {
    const panes = map.getPanes();
    if (panes.mapPane) panes.mapPane.style.zIndex = '1';
    if (panes.tilePane) panes.tilePane.style.zIndex = '1';
    if (panes.overlayPane) panes.overlayPane.style.zIndex = '2';
    if (panes.markerPane) panes.markerPane.style.zIndex = '3';
    if (panes.popupPane) panes.popupPane.style.zIndex = '4';
  }

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
      () => {
        navCityText.innerText = 'Gurugram (Default)';
        fetchJamsFromBackend();
      },
      { timeout: 8000 }
    );
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
  } catch (e) {}
}

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

window.openModal = (id) => {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
};

window.closeModals = () => {
  [authModal, hostModal, reviewModal, locationModal, contactModal, profileModal].forEach(m => {
    if (m) m.classList.add('hidden');
  });
  const p1 = document.getElementById('phoneStep1');
  const p2 = document.getElementById('phoneStep2');
  const e1 = document.getElementById('emailStep1');
  const e2 = document.getElementById('emailStep2');
  if (p1) p1.classList.remove('hidden');
  if (p2) p2.classList.add('hidden');
  if (e1) e1.classList.remove('hidden');
  if (e2) e2.classList.add('hidden');
  if (locSuggestions) locSuggestions.classList.add('hidden');
};

document.addEventListener('click', (e) => {
  if (avatarDropdownMenu && !avatarDropdownMenu.contains(e.target) && !avatarTriggerBtn.contains(e.target)) {
    closeDropdown();
  }
});

[authModal, hostModal, reviewModal, locationModal, contactModal, profileModal].forEach(backdrop => {
  if (backdrop) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModals();
    });
  }
});

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
const btnShowList = document.getElementById('btnShowList');
const btnShowMap = document.getElementById('btnShowMap');

if (btnShowList) {
  btnShowList.onclick = (e) => {
    btnShowMap?.classList.remove('active');
    e.target.classList.add('active');
    contentWrapper?.classList.remove('show-map');
  };
}

if (btnShowMap) {
  btnShowMap.onclick = (e) => {
    btnShowList?.classList.remove('active');
    e.target.classList.add('active');
    contentWrapper?.classList.add('show-map');
    setTimeout(() => {
      if (map) map.invalidateSize();
    }, 200);
  };
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);
}

window.addEventListener('DOMContentLoaded', () => {
  initMap();
  verifyActiveSession();
  initProfileDropdownActions();
  setLocationToCurrentGPS();
  setTimeout(initGoogleAuth, 400);
});