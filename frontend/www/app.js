// Same-origin by default; set this before app.js for a separately hosted UI.
const API_BASE = (window.JAMPALS_API_BASE || '/api').replace(/\/+$/, '');
const DEMO_MODE = new URLSearchParams(window.location.search).get('demo') === '1';
const GOOGLE_CLIENT_ID = '326107511624-5h1huttdikntqiot9jig0slaccgdcjj2.apps.googleusercontent.com';

const COOLDOWNS = {
  NAME_MS: 30 * 24 * 60 * 60 * 1000,
  PHONE_MS: 90 * 24 * 60 * 60 * 1000
};

let map;
let userLocMarker = null;
let radiusCircle = null;
let currentMarkers = [];
let fittedNearbyMarkers = false;
let browsingPosition = { lat: 28.4595, lng: 77.0266 };
let activeRadiusKm = 25;
const MAX_SEARCH_RADIUS_KM = 20100;
const RADIUS_SLIDER_STEPS = 1000;
let activeVibe = 'All';
let currentSort = 'distance';
let searchQuery = '';
let jamsData = [];
let displayedJams = [];
let lineupStatus = 'loading';
let activeJamStatus = 'ready';
const demoRsvpIds = new Set();

// Demo preview never reuses a signed-in account or sends authenticated requests.
let token = DEMO_MODE ? null : (localStorage.getItem('jam_auth_token') || null);
let currentUser = DEMO_MODE ? null : JSON.parse(localStorage.getItem('jam_auth_user') || 'null');
let pendingAuthContact = '';
let activeJamForContact = null;
let activeConversationId = null;

const navCityText = document.getElementById('navCityText');
const demoModeBadge = document.getElementById('demoModeBadge');
const locationSelectorBtn = document.getElementById('locationSelectorBtn');
const locationModal = document.getElementById('locationModal');
const btnPickGPS = document.getElementById('btnPickGPS');
const manualLocInput = document.getElementById('manualLocInput');
const btnSearchLocation = document.getElementById('btnSearchLocation');
const locSuggestions = document.getElementById('locSuggestions');
const mapRecenterBtn = document.getElementById('mapRecenterBtn');

const mainSearchInput = document.getElementById('mainSearchInput');
const searchClearBtn = document.getElementById('searchClearBtn');
const radiusFilterSlider = document.getElementById('radiusFilterSlider');
const radiusFilterValue = document.getElementById('radiusFilterValue');
const customRadiusValue = document.getElementById('customRadiusValue');
const customRadiusSummary = document.getElementById('customRadiusSummary');
const customRadiusMenu = document.getElementById('customRadiusMenu');
const mapRadiusLabel = document.getElementById('mapRadiusLabel');
const distanceFilterSummary = document.getElementById('distanceFilterSummary');
const distanceFilterMenu = document.getElementById('distanceFilterMenu');
const radiusPresetButtons = document.querySelectorAll('.radius-preset');
const genreFilterSelect = document.getElementById('genreFilterSelect');
const genreFilterMenu = document.getElementById('genreFilterMenu');
const genreFilterSummary = document.getElementById('genreFilterSummary');
const sortFilterSelect = document.getElementById('sortFilterSelect');
const jamsFeedContainer = document.getElementById('jamsFeedContainer');
const resultsCount = document.getElementById('resultsCount');

const authModal = document.getElementById('authModal');
const hostModal = document.getElementById('hostModal');
const reviewModal = document.getElementById('reviewModal');
const contactModal = document.getElementById('contactModal');
const messagesModal = document.getElementById('messagesModal');
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
function initGoogleAuth(attempt = 0) {
  const triggerBtn = document.getElementById('googleLoginTriggerBtn');
  const btnLabel = document.getElementById('googleBtnLabel');
  if (!triggerBtn) return;

  if (!window.google?.accounts?.oauth2) {
    if (attempt < 24) {
      if (btnLabel) btnLabel.innerText = 'Loading Google sign-in...';
      setTimeout(() => initGoogleAuth(attempt + 1), 250);
      return;
    }
    triggerBtn.disabled = true;
    triggerBtn.title = 'Google sign-in could not load. Use email or phone instead.';
    if (btnLabel) btnLabel.innerText = 'Google sign-in unavailable';
    return;
  }

  if (GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.includes('placeholder')) {
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
    } catch (gErr) {
      console.error('Google sign-in initialization failed:', gErr.message);
    }
  }

  triggerBtn.disabled = true;
  triggerBtn.title = 'Google sign-in is not configured. Use email or phone instead.';
  if (btnLabel) btnLabel.innerText = 'Google sign-in unavailable';
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

// ==================== CLEAN CUSTOM POPUP HELPER ====================
function showCustomPopup(title, message) {
  let popupModal = document.getElementById('customInfoModal');
  if (!popupModal) {
    popupModal = document.createElement('div');
    popupModal.id = 'customInfoModal';
    popupModal.className = 'modal-backdrop';
    popupModal.innerHTML = `
      <div class="modal-card" style="max-width:380px; text-align:center;">
        <h3 id="customPopupTitle" style="font-size:1.15rem; margin-bottom:8px; color:var(--text-primary);"></h3>
        <p id="customPopupMsg" style="font-size:0.86rem; color:var(--text-secondary); line-height:1.5; white-space:pre-line; margin-bottom:18px;"></p>
        <button class="btn btn-brand btn-block" onclick="closeModals()">Got it</button>
      </div>
    `;
    document.body.appendChild(popupModal);
  }
  document.getElementById('customPopupTitle').innerText = title;
  document.getElementById('customPopupMsg').innerText = message;
  popupModal.setAttribute('role', 'dialog');
  popupModal.setAttribute('aria-modal', 'true');
  popupModal.setAttribute('aria-labelledby', 'customPopupTitle');
  window.openModal('customInfoModal');
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
        showCustomPopup("Hosted Jams", "You haven't hosted any circles yet. Tap '+ Host Jam' to post one!");
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
        showCustomPopup("Saved Jams", "No saved jams yet. Bookmark jams using the heart or join features to track them here!");
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
        showCustomPopup("Confirmed RSVPs", "You haven't RSVP'd to any jams yet. Tap '+ Join In' on any jam card to save your spot!");
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
    };
  }

  const btnPref = document.getElementById('btnPreferences');
  if (btnPref) {
    btnPref.onclick = async () => {
      closeDropdown();
      if (window.Capacitor?.isNativePlatform?.()) {
        showCustomPopup('Notifications', 'Phone notifications need the native push service to be configured before JamPulse can send alerts.');
        return;
      }
      if (!('Notification' in window) || !window.isSecureContext) {
        showCustomPopup('Notifications', 'Browser notifications require a supported browser and a secure website address (HTTPS).');
        return;
      }
      const requestPermission = Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission;
      const permissionMessage = requestPermission === 'granted'
        ? 'Browser permission is enabled. Background jam and message alerts still need push delivery configured.'
        : requestPermission === 'denied'
          ? 'Notifications are blocked in browser settings. You can allow them for JamPulse in site permissions.'
          : 'Notifications were not enabled. You can choose Allow in your browser prompt later.';
      showCustomPopup('Notifications', permissionMessage);
    };
  }

  const btnSec = document.getElementById('btnSecurity');
  if (btnSec) {
    btnSec.onclick = () => {
      closeDropdown();
      const identity = currentUser?.email || currentUser?.phone || 'Guest Account';
      showCustomPopup("🔒 Account Security", `Active Account: ${identity}\nOAuth Provider: Google / OTP Auth\nToken status: Active & Encrypted`);
    };
  }

  const btnSupp = document.getElementById('btnSupport');
  if (btnSupp) {
    btnSupp.onclick = () => {
      closeDropdown();
      showCustomPopup("🎸 Community Help & Rules", "1. Be respectful to fellow artists & circle leaders.\n2. Keep session descriptions honest regarding skill level.\n\nNeed Help? Reach us at support@jampulse.com");
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
      hostCoords.value = `${e.latlng.lat.toFixed(5)},${e.latlng.lng.toFixed(5)}`;
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
    fillOpacity: 0.08,
    weight: 2,
    dashArray: '5 5'
  }).addTo(map);
}

async function fetchReverseGeocode(lat, lng, targetInputId = null) {
  if (DEMO_MODE) {
    const field = targetInputId ? document.getElementById(targetInputId) : null;
    if (field) field.value = 'Gurugram demo area';
    else navCityText.innerText = 'Gurugram · Demo';
    return;
  }
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
  if (DEMO_MODE) {
    browsingPosition = { lat: 28.4595, lng: 77.0266 };
    navCityText.innerText = 'Gurugram · Demo';
    fittedNearbyMarkers = false;
    map.setView([browsingPosition.lat, browsingPosition.lng], 11);
    renderRadius();
    fetchJamsFromBackend();
    closeModals();
    return;
  }
  navCityText.innerText = 'Locating GPS...';
  closeModals();
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        browsingPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        fittedNearbyMarkers = false;
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

const manualGeocodeCache = new Map();
let lastManualGeocodeRequestAt = 0;

async function handleManualLocationSearch() {
  if (DEMO_MODE) {
    showCustomPopup('Demo location', 'This preview uses sample jams around Gurugram. Use the location pin to return to the demo area.');
    return;
  }
  const rawQuery = manualLocInput.value.trim();
  if (!rawQuery) return;

  const cacheKey = rawQuery.toLocaleLowerCase();
  const hasCachedResults = manualGeocodeCache.has(cacheKey);
  if (!hasCachedResults && Date.now() - lastManualGeocodeRequestAt < 1000) {
    locSuggestions.classList.remove('hidden');
    locSuggestions.innerHTML = '<div style="padding:10px;font-size:0.85rem;color:#64748b">Please wait a moment before searching again.</div>';
    return;
  }

  btnSearchLocation.innerText = 'Searching...';
  locSuggestions.classList.remove('hidden');

  try {
    let results = manualGeocodeCache.get(cacheKey);
    if (!hasCachedResults) {
      const params = new URLSearchParams({
        format: 'jsonv2',
        q: rawQuery,
        countrycodes: 'in',
        limit: '5',
        addressdetails: '1'
      });

      lastManualGeocodeRequestAt = Date.now();
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
      if (!res.ok) throw new Error(`Place search returned ${res.status}.`);
      results = await res.json();
      manualGeocodeCache.set(cacheKey, results);
    }
    btnSearchLocation.innerText = 'Search';

    if (results.length === 0) {
      locSuggestions.innerHTML = '<div style="padding:10px;font-size:0.85rem;color:#64748b">No areas found. Try a broader landmark or neighborhood.</div>';
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
        fittedNearbyMarkers = false;
        navCityText.innerText = item.name || item.display_name.split(',')[0];
        map.setView([browsingPosition.lat, browsingPosition.lng], 13);
        renderRadius();
        closeModals();
        fetchJamsFromBackend();
      };
      locSuggestions.appendChild(div);
    });
  } catch (err) {
    btnSearchLocation.innerText = 'Search';
    locSuggestions.innerHTML = '<div style="padding:10px;font-size:0.85rem;color:#ef4444">Network search error. Try again.</div>';
  }
}

async function fetchJamsFromBackend() {
  resultsCount.innerText = 'Finding nearby jams…';
  lineupStatus = 'loading';
  window.dispatchEvent(new CustomEvent('jampulse:jams', { detail: { jams: displayedJams, loading: true } }));
  if (DEMO_MODE) {
    jamsData = buildDemoSessions();
    const filteredJams = jamsData.filter(jam => {
      const matchesGenre = activeVibe === 'All' || jam.vibe === activeVibe;
      const searchableText = `${jam.title} ${jam.hostTeam} ${jam.locationName} ${jam.vibe} ${jam.genres.join(' ')}`.toLowerCase();
      const matchesSearch = !searchQuery || searchableText.includes(searchQuery.toLowerCase());
      return matchesGenre && matchesSearch;
    });
    if (currentSort === 'rating') filteredJams.sort((a, b) => b.averageRating - a.averageRating);
    else if (currentSort === 'timing') filteredJams.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    else filteredJams.sort((a, b) => a.distanceMeters - b.distanceMeters);
    const inRangeJams = filteredJams.filter(jam => jam.withinSearchRadius);
    jamsData = filteredJams;
    renderCards(inRangeJams);
    renderPins(jamsData);
    const outsideCount = jamsData.length - inRangeJams.length;
    document.getElementById('mapPinSummary').textContent = outsideCount
      ? `${inRangeJams.length} in your distance · ${outsideCount} beyond it`
      : `${inRangeJams.length} sample jam${inRangeJams.length === 1 ? '' : 's'} in your distance`;
    return;
  }

  try {
    const params = new URLSearchParams({
      lat: browsingPosition.lat,
      lng: browsingPosition.lng,
      radiusKm: activeRadiusKm,
      mapRadiusKm: MAX_SEARCH_RADIUS_KM,
      sortBy: currentSort,
      vibe: activeVibe,
      query: searchQuery
    });

    const res = await fetch(`${API_BASE}/jams?${params.toString()}`);
    if (!res.ok) throw new Error(`Status: ${res.status}`);
    jamsData = await res.json();
    const inRangeJams = jamsData.filter(jam => jam.withinSearchRadius ?? jam.distanceMeters <= activeRadiusKm * 1000);
    renderCards(inRangeJams);
    renderPins(jamsData);
    const outsideCount = jamsData.length - inRangeJams.length;
    document.getElementById('mapPinSummary').textContent = outsideCount
      ? `${inRangeJams.length} in your distance · ${outsideCount} beyond it`
      : `${inRangeJams.length} jam${inRangeJams.length === 1 ? '' : 's'} in your distance`;
  } catch (err) {
    displayedJams = [];
    lineupStatus = 'error';
    window.dispatchEvent(new CustomEvent('jampulse:jams', { detail: { jams: [], error: true } }));
    jamsFeedContainer.innerHTML = `<div class="reel-error"><h3>We couldn’t load the lineup.</h3><p>Please try again in a moment.</p><button class="btn btn-outline" id="retryJamsBtn" type="button">Try again</button></div>`;
    document.getElementById('retryJamsBtn').onclick = fetchJamsFromBackend;
    resultsCount.innerText = 'Connection unavailable';
  }
}

function buildDemoSessions() {
  const sampleSessions = [
    { id: 'demo-acoustic', distanceKm: 4, bearing: 35, title: 'Acoustic rooftop circle', hostTeam: 'The Good Company', hostName: 'Riya Mehta', role: 'Vocalist & guitarist', vibe: 'Acoustic Unplugged', locationName: 'Sector 29, Gurugram', hoursFromNow: 1, rating: 4.8, ratingCount: 12, instruments: ['Cajón', 'Harmony vocals'], description: 'Easygoing acoustic covers and originals. Bring an instrument or just come sing along.' },
    { id: 'demo-openmic', distanceKm: 9, bearing: 115, title: 'Friday open mic warm-up', hostTeam: 'Mic Check Gurugram', hostName: 'Kabir Anand', role: 'Singer-songwriter', vibe: 'Open Mic', locationName: 'Golf Course Road', hoursFromNow: 2, rating: 4.6, ratingCount: 8, instruments: ['Any instrument'], description: 'Short sets, friendly crowd, and time to meet other local performers.' },
    { id: 'demo-classical', distanceKm: 17, bearing: 220, title: 'Sufi strings & tabla', hostTeam: 'Mehfil Sessions', hostName: 'Aarav Khan', role: 'Tabla player', vibe: 'Sufi & Classical', locationName: 'Sohna Road', hoursFromNow: 3, rating: 4.9, ratingCount: 15, instruments: ['Harmonium', 'Vocals'], description: 'A relaxed Sufi and classical improvisation. All experience levels are welcome.' },
    { id: 'demo-electric', distanceKm: 31, bearing: 300, title: 'Electric indie jam', hostTeam: 'Neon Monsoon', hostName: 'Dev Sharma', role: 'Drummer', vibe: 'Electric Jam', locationName: 'Manesar', hoursFromNow: 4, rating: 4.7, ratingCount: 6, instruments: ['Bass', 'Lead guitar'], description: 'Loud amps, indie grooves, and a couple of unfinished songs looking for new ideas.' },
    { id: 'demo-jazz', distanceKm: 43, bearing: 55, title: 'Late-night jazz sketches', hostTeam: 'Blue Note Friends', hostName: 'Mira Das', role: 'Keyboardist', vibe: 'Jazz & Blues', locationName: 'Faridabad', hoursFromNow: 5, rating: 4.5, ratingCount: 5, instruments: ['Saxophone', 'Upright bass'], description: 'Small combo exploring standards and open-ended blues. Host discovery range: 50 km.' },
    { id: 'demo-electronic', distanceKm: 22, bearing: 160, title: 'Chill electronic live set', hostTeam: 'Soft Signal', hostName: 'Naina Roy', role: 'Producer', vibe: 'Chill Electronic', locationName: 'Badshahpur', hoursFromNow: 6, rating: 4.7, ratingCount: 9, instruments: ['Synth', 'Percussion'], description: 'Build a mellow live set together with synths, hand percussion, and found sounds.' }
  ];
  const earthRadiusKm = 6371.0088;
  const originLat = browsingPosition.lat * Math.PI / 180;
  const originLng = browsingPosition.lng * Math.PI / 180;

  return sampleSessions.map(session => {
    const bearing = session.bearing * Math.PI / 180;
    const angularDistance = session.distanceKm / earthRadiusKm;
    const destinationLat = Math.asin(
      Math.sin(originLat) * Math.cos(angularDistance)
      + Math.cos(originLat) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const destinationLng = originLng + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(originLat),
      Math.cos(angularDistance) - Math.sin(originLat) * Math.sin(destinationLat)
    );
    const startTime = new Date(Date.now() + session.hoursFromNow * 60 * 60 * 1000);
    const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

    return {
      _id: session.id,
      title: session.title,
      description: session.description,
      hostTeam: session.hostTeam,
      hostProfile: { name: session.hostName, role: session.role },
      vibe: session.vibe,
      genres: [session.vibe],
      instrumentsNeeded: session.instruments,
      locationName: session.locationName,
      location: {
        type: 'Point',
        coordinates: [destinationLng * 180 / Math.PI, destinationLat * 180 / Math.PI]
      },
      distanceMeters: session.distanceKm * 1000,
      withinSearchRadius: session.distanceKm <= activeRadiusKm,
      discoveryRadiusKm: 50,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      status: 'upcoming',
      averageRating: session.rating,
      ratingCount: session.ratingCount,
      rsvpUsers: demoRsvpIds.has(session.id) ? ['demo-viewer'] : []
    };
  });
}

function renderCards(jams) {
  displayedJams = jams;
  lineupStatus = 'ready';
  window.dispatchEvent(new CustomEvent('jampulse:jams', { detail: { jams } }));
  resultsCount.innerText = `${jams.length} Jam${jams.length === 1 ? '' : 's'} near you`;
  jamsFeedContainer.innerHTML = '';
  let savedIds = [];
  try { savedIds = JSON.parse(localStorage.getItem('jam_saved_ids') || '[]'); } catch (error) { savedIds = []; }
  const savedJamIds = new Set(Array.isArray(savedIds) ? savedIds : []);

  if (jams.length === 0) {
    const outsideCount = jamsData.filter(jam => jam.withinSearchRadius === false || jam.distanceMeters > activeRadiusKm * 1000).length;
    jamsFeedContainer.innerHTML = `
      <div class="empty-jams">

        <h3 style="margin-top:10px;color:#0f172a">No open jam sessions found</h3>
        <p style="font-size:0.88rem;margin-top:4px">${outsideCount ? `${outsideCount} more ${outsideCount === 1 ? 'jam is' : 'jams are'} marked beyond your distance on the map. Tap a dot or widen your distance.` : 'Widen distance or host a jam to get started.'}</p>
      </div>
    `;
    return;
  }

  jams.forEach(jam => {
    const card = document.createElement('div');
    card.className = 'jam-card';

    const distKm = jam.distanceMeters ? (jam.distanceMeters / 1000).toFixed(1) : 'Nearby';
    const startsAt = new Date(jam.startTime);
    const startTimeStr = Number.isNaN(startsAt.getTime()) ? 'Time to be announced' : startsAt.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    const isAttending = DEMO_MODE ? demoRsvpIds.has(jam._id) : currentUser && jam.rsvpUsers?.includes(currentUser._id);
    const isSaved = savedJamIds.has(jam._id);
    const posterTitle = ({'Acoustic Unplugged':'Acoustic','Electric Jam':'Electric','Open Mic':'Open mic','Sufi & Classical':'Sufi & classical','Chill Electronic':'Electronic','Jazz & Blues':'Jazz & blues'})[jam.vibe] || 'Open jam';

    card.innerHTML = `
      <div class="jam-poster" aria-label="${escapeHtml(jam.vibe || 'Open')} jam poster">
        <span class="poster-tag">JAMPULSE · LOCAL JAM</span>
        <strong>${escapeHtml(posterTitle)}</strong>
        <small>MAKE SOME NOISE</small>
      </div>
      <div class="jam-info">
        <div class="jam-topline"><span>${escapeHtml(startTimeStr)}</span><button type="button" class="jam-save-trigger ${isSaved ? 'is-saved' : ''}" aria-label="${isSaved ? 'Remove saved jam' : 'Save jam'}" aria-pressed="${isSaved}">${isSaved ? '♥' : '♡'}</button></div>
        <h3 class="card-title">${escapeHtml(jam.title)}</h3>
        <div class="jam-meta"><span>⌖ ${escapeHtml(distKm)} km</span><span>⌖ ${escapeHtml(jam.locationName)}</span></div>
        <p class="card-desc">${escapeHtml(jam.description || 'A local music circle is looking for its next sound.')}</p>
        <div class="jam-bottom">
          <div class="card-tags"><span class="tag-badge vibe-tag">${escapeHtml(jam.vibe || 'Open Jam')}</span>${(jam.instrumentsNeeded || []).slice(0, 3).map(i => `<span class="tag-badge">${escapeHtml(i)}</span>`).join('')}</div>
          <div class="card-actions">
            <button type="button" class="btn btn-outline btn-sm contact-host-trigger">Contact</button>
            <button type="button" class="btn ${isAttending ? 'btn-subtle' : 'btn-brand'} btn-sm rsvp-trigger">${isAttending ? '✓ In Circle' : 'Ask to join →'}</button>
          </div>
        </div>
      </div>
    `;

    card.onclick = () => map.flyTo([jam.location.coordinates[1], jam.location.coordinates[0]], 15);
    card.querySelector('.contact-host-trigger').onclick = (e) => { e.stopPropagation(); openContactModal(jam); };
    card.querySelector('.rsvp-trigger').onclick = (e) => { e.stopPropagation(); handleRsvp(jam._id); };
    card.querySelector('.jam-save-trigger').onclick = (e) => {
      e.stopPropagation();
      const nextIds = new Set(savedJamIds);
      if (nextIds.has(jam._id)) nextIds.delete(jam._id);
      else nextIds.add(jam._id);
      localStorage.setItem('jam_saved_ids', JSON.stringify([...nextIds]));
      renderCards(jams);
    };

    jamsFeedContainer.appendChild(card);
  });
}

function renderPins(jams) {
  currentMarkers.forEach(m => map.removeLayer(m));
  currentMarkers = [];

  jams.forEach(jam => {
    const [lng, lat] = jam.location.coordinates;
    const distanceKm = Number.isFinite(jam.distanceMeters) ? jam.distanceMeters / 1000 : 0;
    const withinSearchRadius = jam.withinSearchRadius ?? distanceKm <= activeRadiusKm;
    const distanceLabel = `${distanceKm.toFixed(1)} km`;
    const startsAt = new Date(jam.startTime);
    const startsLabel = Number.isFinite(startsAt.getTime())
      ? startsAt.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
      : 'Time not listed';
    const mapIcon = L.divIcon({
      className: 'jam-marker-shell',
      html: `<span class="jam-marker-dot ${withinSearchRadius ? 'is-in-range' : 'is-out-of-range'}"></span>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });
    const marker = L.marker([lat, lng], {
      icon: mapIcon,
      keyboard: true,
      title: `${jam.title}, hosted by ${jam.hostProfile?.name || jam.hostTeam}, ${distanceLabel} away`
    }).addTo(map);

    const expandDistance = Math.min(MAX_SEARCH_RADIUS_KM, Math.ceil(distanceKm));
    const description = typeof jam.description === 'string' && jam.description.trim()
      ? jam.description.trim().slice(0, 180)
      : 'No session description yet.';
    marker.bindPopup(`
      <article class="jam-map-popup">
        <span class="jam-map-popup-status ${withinSearchRadius ? 'is-in-range' : 'is-out-of-range'}">${withinSearchRadius ? `Within your ${activeRadiusKm >= MAX_SEARCH_RADIUS_KM ? 'Any distance' : `${activeRadiusKm} km`} range` : 'Beyond selected distance'}</span>
        <h3>${escapeHtml(jam.title)}</h3>
        <p class="jam-map-popup-host">Hosted by <strong>${escapeHtml(jam.hostProfile?.name || jam.hostTeam || 'Local jammer')}</strong>${jam.hostProfile?.role ? ` · ${escapeHtml(jam.hostProfile.role)}` : ''}<br>${escapeHtml(jam.hostTeam || '')}</p>
        <p>${escapeHtml(jam.vibe || 'Open jam')} · ${escapeHtml(jam.locationName || 'Location available on map')}</p>
        <p>${escapeHtml(startsLabel)} · ${escapeHtml(distanceLabel)} away</p>
        <p class="jam-map-popup-description">${escapeHtml(description)}</p>
        ${withinSearchRadius ? '' : `<button class="jam-map-expand-distance" type="button" data-expand-distance="${expandDistance}">Show in list at ${expandDistance} km</button>`}
        <div class="jam-map-popup-actions">
          <button type="button" data-map-contact>Contact host</button>
          <button type="button" data-map-rsvp>Join jam</button>
        </div>
      </article>
    `, { maxWidth: 290, minWidth: 220 });
    marker.on('popupopen', event => {
      const popupElement = event.popup.getElement();
      popupElement?.querySelector('[data-expand-distance]')?.addEventListener('click', clickEvent => {
        clickEvent.stopPropagation();
        setSearchRadius(clickEvent.currentTarget.dataset.expandDistance);
        map.closePopup();
      });
      popupElement?.querySelector('[data-map-contact]')?.addEventListener('click', () => {
        map.closePopup();
        openContactModal(jam);
      });
      popupElement?.querySelector('[data-map-rsvp]')?.addEventListener('click', () => {
        map.closePopup();
        handleRsvp(jam._id);
      });
    });
    currentMarkers.push(marker);
  });

  fitMapToNearbyMarkers(jams);
}

function fitMapToNearbyMarkers(jams) {
  if (fittedNearbyMarkers || !jams?.length || !map) return;
  const mapIsHiddenOnPhone = window.matchMedia('(max-width: 760px)').matches
    && !document.querySelector('.content-wrapper')?.classList.contains('show-map');
  if (mapIsHiddenOnPhone) return;

  const points = [[browsingPosition.lat, browsingPosition.lng], ...jams.map(jam => [jam.location.coordinates[1], jam.location.coordinates[0]])];
  map.fitBounds(L.latLngBounds(points).pad(0.12), { maxZoom: 12, padding: [24, 24], animate: false });
  fittedNearbyMarkers = true;
}

async function handleRsvp(jamId) {
  if (DEMO_MODE) {
    const wasAttending = demoRsvpIds.has(jamId);
    if (wasAttending) demoRsvpIds.delete(jamId);
    else demoRsvpIds.add(jamId);
    showCustomPopup('Demo action', wasAttending
      ? 'You left this sample jam. No account or real RSVP was changed.'
      : 'You joined this sample jam. No account or real RSVP was changed.');
    fetchJamsFromBackend();
    return;
  }
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
  if (DEMO_MODE) {
    showCustomPopup('Demo action', 'Hosting is simulated in this preview. No jam was saved or sent to the backend.');
    return;
  }
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
    startTime: new Date(document.getElementById('hostStartTime').value).toISOString(),
    endTime: new Date(document.getElementById('hostEndTime').value).toISOString(),
    discoveryRadiusKm: Number(document.getElementById('hostDiscoveryRadius').value),
    instrumentsNeeded: document.getElementById('hostInstruments').value.split(',').map(s => s.trim()).filter(Boolean),
    description: document.getElementById('hostDesc').value,
    allowPhoneCalls: document.getElementById('hostAllowPrivateCalls').checked
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
  if (DEMO_MODE) {
    showCustomPopup('Demo contact', `This sample session is hosted by ${jam.hostProfile?.name || jam.hostTeam}. No message was sent and no contact details were shared.`);
    return;
  }
  activeJamForContact = jam;
  document.getElementById('contactSubtitleHeader').innerText = `${jam.title} (${jam.hostTeam})`;
  const privateCallBtn = document.getElementById('privateCallBtn');
  const privateCallStatus = document.getElementById('privateCallStatus');
  privateCallBtn.classList.toggle('hidden', jam.allowPhoneCalls !== true);
  privateCallBtn.disabled = false;
  privateCallBtn.textContent = '☎ Request a private call';
  privateCallStatus.classList.add('hidden');
  privateCallStatus.textContent = '';
  openModal('contactModal');
}

async function requestPrivateCall(jam) {
  if (!token) {
    closeModals();
    return openModal('authModal');
  }
  const button = document.getElementById('privateCallBtn');
  const status = document.getElementById('privateCallStatus');
  button.disabled = true;
  button.textContent = 'Setting up private line…';
  status.classList.add('hidden');
  try {
    const response = await fetch(`${API_BASE}/calls/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jamSessionId: jam._id })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not set up a private call.');
    const expires = new Date(data.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    status.textContent = `Temporary shared number: ${data.callNumber}. Both you and the host call this number before ${expires}; your personal numbers stay hidden.`;
    status.classList.remove('hidden');
    button.textContent = 'Private call line ready';
  } catch (error) {
    status.textContent = error.message || 'Could not set up a private call.';
    status.classList.remove('hidden');
    button.disabled = false;
    button.textContent = '☎ Request a private call';
  }
}

async function openJamConversation(jam) {
  if (DEMO_MODE) {
    showCustomPopup('Demo message', 'In-app messaging is simulated in this preview. No message was sent.');
    return;
  }
  if (!token) {
    closeModals();
    return openModal('authModal');
  }
  const button = document.getElementById('inAppContactBtn');
  button.disabled = true;
  button.textContent = 'Opening conversation…';
  try {
    const response = await fetch(`${API_BASE}/chat/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jamSessionId: jam._id })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not start a conversation.');
    activeConversationId = data.conversationId;
    closeModals();
    openModal('messagesModal');
    await loadConversations(activeConversationId);
  } catch (error) {
    alert(error.message || 'Could not connect to messaging.');
  } finally {
    button.disabled = false;
    button.textContent = '✉ Send In-App Message';
  }
}

async function openMessages() {
  if (DEMO_MODE) {
    return showCustomPopup('Demo messages', 'Messaging is simulated in this preview. No inbox or messages were opened.');
  }
  if (!token) return openModal('authModal');
  closeDropdown();
  activeConversationId = null;
  openModal('messagesModal');
  await loadConversations();
}

async function loadConversations(preferredId = activeConversationId) {
  const list = document.getElementById('conversationList');
  const panel = document.getElementById('chatPanel');
  list.innerHTML = '<div class="conversation-empty">Loading conversations…</div>';
  try {
    const response = await fetch(`${API_BASE}/chat/conversations`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const conversations = await response.json();
    if (!response.ok) throw new Error(conversations.error || 'Could not load conversations.');
    list.innerHTML = '';
    if (!conversations.length) {
      list.innerHTML = '<div class="conversation-empty">No conversations yet.</div>';
      panel.innerHTML = '<div class="chat-empty-state">Contact a jam host to start a conversation.</div>';
      return;
    }

    conversations.forEach(conversation => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `conversation-item${conversation._id === preferredId ? ' active' : ''}`;
      item.dataset.conversationId = conversation._id;
      item.innerHTML = `<strong>${escapeHtml(conversation.otherParticipant?.name || 'Musician')}</strong><span>${escapeHtml(conversation.jamSession?.title || 'Jam conversation')} · ${escapeHtml(conversation.lastMessage?.text || 'Conversation started')}</span>`;
      item.onclick = () => {
        activeConversationId = conversation._id;
        loadConversations(conversation._id);
      };
      list.appendChild(item);
    });

    const selected = conversations.find(conversation => conversation._id === preferredId) || conversations[0];
    activeConversationId = selected._id;
    list.querySelector(`[data-conversation-id="${selected._id}"]`)?.classList.add('active');
    await loadConversationThread(selected);
  } catch (error) {
    list.innerHTML = `<div class="conversation-empty">${escapeHtml(error.message || 'Could not load conversations.')}</div>`;
    panel.innerHTML = '<div class="chat-empty-state">Try opening Messages again.</div>';
  }
}

async function loadConversationThread(conversation) {
  const panel = document.getElementById('chatPanel');
  const otherName = conversation.otherParticipant?.name || 'Musician';
  const jamTitle = conversation.jamSession?.title || 'Jam conversation';
  panel.innerHTML = `<div class="chat-thread-header"><strong>${escapeHtml(otherName)}</strong><span>${escapeHtml(jamTitle)}</span></div><div class="chat-messages" id="chatMessages"><div class="chat-empty-state">Loading messages…</div></div><form class="chat-composer" id="chatComposer"><input id="chatMessageInput" type="text" maxlength="1000" autocomplete="off" placeholder="Write a message…" aria-label="Write a message" required /><button class="btn btn-brand" type="submit">Send</button></form>`;
  const messagesContainer = document.getElementById('chatMessages');
  try {
    const response = await fetch(`${API_BASE}/chat/${conversation._id}/messages`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const messages = await response.json();
    if (!response.ok) throw new Error(messages.error || 'Could not load messages.');
    if (!messages.length) {
      messagesContainer.innerHTML = '<div class="chat-empty-state">Say hello and ask about the session.</div>';
    } else {
      messagesContainer.innerHTML = messages.map(message => {
        const ownMessage = String(message.sender) === String(currentUser?._id);
        const time = new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `<div class="chat-message${ownMessage ? ' own' : ''}">${escapeHtml(message.text)}<small>${ownMessage ? 'You' : escapeHtml(message.senderName)} · ${time}</small></div>`;
      }).join('');
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  } catch (error) {
    messagesContainer.innerHTML = `<div class="chat-empty-state">${escapeHtml(error.message || 'Could not load messages.')}</div>`;
  }

  document.getElementById('chatComposer').onsubmit = async event => {
    event.preventDefault();
    const input = document.getElementById('chatMessageInput');
    const sendButton = event.currentTarget.querySelector('button[type="submit"]');
    const text = input.value.trim();
    if (!text || !activeConversationId) return;
    sendButton.disabled = true;
    try {
      const response = await fetch(`${API_BASE}/chat/${activeConversationId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not send message.');
      await loadConversations(activeConversationId);
    } catch (error) {
      alert(error.message || 'Could not send message.');
    } finally {
      sendButton.disabled = false;
    }
  };
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

let lastModalTrigger = null;
window.openModal = (id) => {
  const el = document.getElementById(id);
  if (!el) return;
  lastModalTrigger = document.activeElement;
  el.classList.remove('hidden');
  document.body.classList.add('modal-open');
  el.querySelector('button, input, select, textarea, [tabindex]')?.focus();
};

window.closeModals = () => {
  document.getElementById('customInfoModal')?.classList.add('hidden');
  document.body.classList.remove('modal-open');
  if (lastModalTrigger?.isConnected) lastModalTrigger.focus();
  [authModal, hostModal, reviewModal, locationModal, contactModal, messagesModal, profileModal].forEach(m => {
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

[authModal, hostModal, reviewModal, locationModal, contactModal, messagesModal, profileModal].forEach(backdrop => {
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
openLoginModalBtn.onclick = () => DEMO_MODE
  ? showCustomPopup('Demo sign-in', 'Sign-in providers are not connected in this sample preview.')
  : openModal('authModal');
document.getElementById('inAppContactBtn').onclick = () => activeJamForContact && openJamConversation(activeJamForContact);
document.getElementById('privateCallBtn').onclick = () => activeJamForContact && requestPrivateCall(activeJamForContact);
document.getElementById('btnMessages').onclick = openMessages;
openHostBtn.onclick = () => {
  document.getElementById('hostCoords').value = `${browsingPosition.lat.toFixed(5)},${browsingPosition.lng.toFixed(5)}`;
  fetchReverseGeocode(browsingPosition.lat, browsingPosition.lng, 'hostLocationName');
  const now = new Date();
  now.setHours(now.getHours() + 1, 0, 0, 0);
  document.getElementById('hostStartTime').value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  now.setHours(now.getHours() + 3);
  document.getElementById('hostEndTime').value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  openModal('hostModal');
};

genreFilterSelect.addEventListener('change', () => {
  activeVibe = genreFilterSelect.value;
  genreFilterSummary.textContent = genreFilterSelect.selectedOptions[0]?.textContent || 'All sounds';
  genreFilterMenu.open = false;
  fetchJamsFromBackend();
});

document.querySelectorAll('[data-nav-action]').forEach(button => {
  button.addEventListener('click', () => {
    const action = button.dataset.navAction;
    document.querySelectorAll('[data-nav-action]').forEach(item => {
      item.classList.toggle('is-active', item.dataset.navAction === action);
    });
    const destinations = {
      'my-jams': 'btnJamInvites',
      messages: 'btnMessages',
      saved: 'btnSavedJams',
      host: 'openHostBtn'
    };
    if (action === 'discover') {
      document.querySelector('.discovery-welcome')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    document.getElementById(destinations[action])?.click();
  });
});

function setSearchRadius(value, shouldFetch = true) {
  activeRadiusKm = Math.max(1, Math.min(MAX_SEARCH_RADIUS_KM, Number(value)));
  const sliderPosition = activeRadiusKm >= MAX_SEARCH_RADIUS_KM
    ? RADIUS_SLIDER_STEPS
    : Math.round(Math.log(activeRadiusKm) / Math.log(MAX_SEARCH_RADIUS_KM) * RADIUS_SLIDER_STEPS);
  const radiusLabel = activeRadiusKm >= MAX_SEARCH_RADIUS_KM ? 'Any distance' : `${activeRadiusKm} km`;
  radiusFilterSlider.value = String(sliderPosition);
  radiusFilterValue.value = radiusLabel;
  radiusFilterValue.textContent = radiusLabel;
  customRadiusValue.value = radiusLabel;
  customRadiusValue.textContent = radiusLabel;
  customRadiusSummary.textContent = [5, 10, 25].includes(activeRadiusKm) ? 'Choose a range' : radiusLabel;
  distanceFilterSummary.textContent = radiusLabel;
  mapRadiusLabel.textContent = radiusLabel;
  radiusFilterSlider.setAttribute('aria-valuenow', String(activeRadiusKm));
  radiusFilterSlider.setAttribute('aria-valuetext', radiusLabel === 'Any distance' ? 'Any distance, worldwide search' : `${activeRadiusKm} kilometers`);
  radiusPresetButtons.forEach(button => {
    const isSelected = Number(button.dataset.radius) === activeRadiusKm;
    button.classList.toggle('is-active', isSelected);
    button.setAttribute('aria-pressed', String(isSelected));
  });
  renderRadius();
  if (shouldFetch) fetchJamsFromBackend();
}

radiusFilterSlider.addEventListener('input', event => {
  const position = Number(event.target.value);
  const value = position >= RADIUS_SLIDER_STEPS
    ? MAX_SEARCH_RADIUS_KM
    : Math.max(1, Math.round(Math.exp(position / RADIUS_SLIDER_STEPS * Math.log(MAX_SEARCH_RADIUS_KM))));
  setSearchRadius(value, false);
});
radiusFilterSlider.addEventListener('change', () => fetchJamsFromBackend());
radiusPresetButtons.forEach(button => {
  button.addEventListener('click', () => {
    setSearchRadius(button.dataset.radius);
    customRadiusMenu.open = false;
    distanceFilterMenu.open = false;
  });
});

document.getElementById('clearFilters').addEventListener('click', () => {
  activeVibe = 'All';
  genreFilterSelect.value = 'All';
  genreFilterSummary.textContent = 'All sounds';
  genreFilterMenu.open = false;
  currentSort = 'distance';
  sortFilterSelect.value = 'distance';
  mainSearchInput.value = '';
  searchQuery = '';
  searchClearBtn.classList.add('hidden');
  distanceFilterMenu.open = false;
  customRadiusMenu.open = false;
  setSearchRadius(25, false);
  fetchJamsFromBackend();
});

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
    e.currentTarget.classList.add('active');
    btnShowMap?.setAttribute('aria-pressed', 'false');
    btnShowList.setAttribute('aria-pressed', 'true');
    contentWrapper?.classList.remove('show-map');
  };
}

if (btnShowMap) {
  btnShowMap.onclick = (e) => {
    btnShowList?.classList.remove('active');
    e.currentTarget.classList.add('active');
    btnShowMap.setAttribute('aria-pressed', 'true');
    btnShowList?.setAttribute('aria-pressed', 'false');
    contentWrapper?.classList.add('show-map');
    setTimeout(() => {
      if (map) map.invalidateSize();
      fitMapToNearbyMarkers(jamsData);
    }, 200);
  };
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[`&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);
}

window.addEventListener('DOMContentLoaded', () => {
  if (DEMO_MODE) {
    document.title = 'JamPulse Demo — Sample Sessions';
    demoModeBadge?.classList.remove('hidden');
  }
  initMap();
  if (!DEMO_MODE) verifyActiveSession();
  initProfileDropdownActions();
  setLocationToCurrentGPS();
  if (!DEMO_MODE) setTimeout(initGoogleAuth, 400);
});

// Shared session actions connect the React reel to the working app.
window.jampulseUI = {
  getJams: () => displayedJams,
  getStatus: () => lineupStatus,
  select: jam => map?.flyTo([jam.location.coordinates[1], jam.location.coordinates[0]], 15),
  contact: openContactModal,
  join: handleRsvp,
  isSaved: id => { try { return JSON.parse(localStorage.getItem('jam_saved_ids') || '[]').includes(id); } catch { return false; } },
  isAttending: jam => DEMO_MODE ? demoRsvpIds.has(jam._id) : Boolean(currentUser && jam.rsvpUsers?.includes(currentUser._id)),
  save: id => {
    let ids = [];
    try { ids = JSON.parse(localStorage.getItem('jam_saved_ids') || '[]'); } catch {}
    const saved = new Set(Array.isArray(ids) ? ids : []);
    if (saved.has(id)) saved.delete(id); else saved.add(id);
    localStorage.setItem('jam_saved_ids', JSON.stringify([...saved]));
    renderCards(displayedJams);
  }
};

// Keep keyboard navigation inside the active dialog and restore the opener on close.
document.addEventListener('keydown', event => {
  const modal = [...document.querySelectorAll('.modal-backdrop:not(.hidden)')].at(-1);
  if (!modal) return;
  if (event.key === 'Escape') { event.preventDefault(); closeModals(); return; }
  if (event.key !== 'Tab') return;
  const items = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')].filter(el => el.getClientRects().length);
  const first = items[0], last = items.at(-1);
  if (!first) return;
  if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
});
