/* Atlantica events PWA. */

const state = {
  vapidPublicKey: null,
  leadMinutes: 30,
  subscribed: false,
  enabled: { entertainment: true, daytime: true },
};

/**
 * iOS gates Web Push behind home-screen installation: in a Safari tab,
 * Notification.requestPermission() either doesn't exist or always denies. So we
 * detect the standalone display mode and show instructions instead of a button
 * that could only ever fail.
 */
function isStandalone() {
  return (
    window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

/* ------------------------------------------------------------------ */

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

function banner(msg, kind = 'info') {
  const el = document.getElementById('banner');
  el.textContent = msg;
  el.className = `banner ${kind}`;
  el.hidden = false;
}

/* ------------------------------------------------------------------ */

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function enableNotifications() {
  const btn = document.getElementById('enable-btn');
  btn.disabled = true;
  btn.textContent = 'Enabling…';

  try {
    // Must be called from the user gesture that triggered this handler.
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      banner('Notifications were blocked. Enable them in Settings → Atlantica.', 'warn');
      btn.disabled = false;
      btn.textContent = 'Enable';
      return;
    }

    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(state.vapidPublicKey),
      });
    }

    const json = sub.toJSON();
    await api('/api/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: json.keys,
        enabled: state.enabled,
      }),
    });

    state.subscribed = true;
    renderNotifyCard();
    banner(`Reminders on — you'll be nudged ${state.leadMinutes} minutes before.`, 'ok');
  } catch (err) {
    console.error(err);
    banner(`Could not enable notifications: ${err.message}`, 'warn');
    btn.disabled = false;
    btn.textContent = 'Enable';
  }
}

async function savePrefs() {
  state.enabled = {
    entertainment: document.getElementById('pref-entertainment').checked,
    daytime: document.getElementById('pref-daytime').checked,
  };
  try {
    await api('/api/preferences', {
      method: 'POST',
      body: JSON.stringify({ enabled: state.enabled }),
    });
  } catch (err) {
    banner('Could not save preferences.', 'warn');
  }
}

function renderNotifyCard() {
  const card = document.getElementById('notify-card');
  const hint = document.getElementById('install-hint');
  const btn = document.getElementById('enable-btn');
  const status = document.getElementById('notify-status');
  const prefs = document.getElementById('prefs');

  if (isIos() && !isStandalone()) {
    hint.hidden = false;
    card.hidden = true;
    return;
  }

  hint.hidden = true;
  card.hidden = false;

  if (!pushSupported()) {
    status.textContent = 'This browser does not support push notifications.';
    btn.hidden = true;
    return;
  }

  if (state.subscribed && Notification.permission === 'granted') {
    status.textContent = `On — ${state.leadMinutes} min before each event`;
    btn.hidden = true;
    prefs.hidden = false;
  } else {
    status.textContent = 'Not enabled';
    btn.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Enable';
    prefs.hidden = true;
  }
}

/* ------------------------------------------------------------------ */

const DAY_FMT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Athens',
});

function dayHeading(isoDate, todayIso, tomorrowIso) {
  if (isoDate === todayIso) return 'Today';
  if (isoDate === tomorrowIso) return 'Tomorrow';
  return DAY_FMT.format(new Date(`${isoDate}T12:00:00`));
}

function renderSchedule(data) {
  const main = document.getElementById('schedule');
  const now = new Date(data.now);

  const todayIso = data.now.slice(0, 10);
  const tomorrow = new Date(now.getTime() + 864e5);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10);

  if (data.occurrences.length === 0) {
    main.innerHTML = '<p class="muted">Nothing scheduled right now.</p>';
    return;
  }

  const byDay = new Map();
  for (const occ of data.occurrences) {
    if (!byDay.has(occ.date)) byDay.set(occ.date, []);
    byDay.get(occ.date).push(occ);
  }

  const parts = [];
  for (const [date, items] of byDay) {
    parts.push(`<h2 class="day">${dayHeading(date, todayIso, tomorrowIso)}</h2>`);
    parts.push('<ul class="items">');
    for (const occ of items) {
      const past = new Date(occ.startsAt) < now;
      const time = occ.endTime
        ? `${occ.startTime}–${occ.endTime}`
        : occ.startTime;
      parts.push(`
        <li class="item ${past ? 'past' : ''} cat-${occ.category}">
          <div class="time">${time}</div>
          <div class="body">
            <div class="title">${escapeHtml(occ.title)}</div>
            ${occ.venue ? `<div class="venue">${escapeHtml(occ.venue)}</div>` : ''}
            ${
              // Daytime items all carry the same "arrive 5 minutes early" note.
              // Useful in a notification, pure noise repeated down a list, so
              // it lives in the footer instead.
              occ.description && occ.category !== 'daytime'
                ? `<div class="desc">${escapeHtml(occ.description)}</div>`
                : ''
            }
          </div>
        </li>`);
    }
    parts.push('</ul>');
  }

  main.innerHTML = parts.join('');

  const hasDaytime = data.occurrences.some((o) => o.category === 'daytime');
  document.getElementById('standing-note').hidden = !hasDaytime;

  const note = document.getElementById('footer-note');
  if (data.lastScrapeError) {
    note.textContent = `Last refresh had a problem: ${data.lastScrapeError}`;
  } else if (data.lastScrapeAt) {
    note.textContent = `Updated ${new Date(data.lastScrapeAt).toLocaleTimeString(
      'en-GB',
      { timeZone: 'Europe/Athens', hour: '2-digit', minute: '2-digit' },
    )} resort time`;
  }
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

/* ------------------------------------------------------------------ */

async function init() {
  document.getElementById('enable-btn').addEventListener('click', enableNotifications);
  document.getElementById('pref-entertainment').addEventListener('change', savePrefs);
  document.getElementById('pref-daytime').addEventListener('change', savePrefs);
  document.getElementById('test-btn').addEventListener('click', async () => {
    try {
      await api('/api/test-notification', { method: 'POST' });
      banner('Test sent — it should arrive in a second.', 'ok');
    } catch {
      banner('Could not send the test notification.', 'warn');
    }
  });

  try {
    const cfg = await api('/api/config');
    state.vapidPublicKey = cfg.vapidPublicKey;
    state.leadMinutes = cfg.leadMinutes;
    state.subscribed = cfg.subscribed;
    state.enabled = cfg.enabled;
    document.getElementById('pref-entertainment').checked = cfg.enabled.entertainment;
    document.getElementById('pref-daytime').checked = cfg.enabled.daytime;
  } catch (err) {
    banner('Could not load settings. Try your invite link again.', 'warn');
  }

  renderNotifyCard();

  // Keep the service worker registered even before the user opts in, so the
  // subscribe step later is a single tap.
  if (pushSupported() && isStandalone()) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  try {
    renderSchedule(await api('/api/schedule'));
  } catch (err) {
    document.getElementById('schedule').innerHTML =
      '<p class="muted">Could not load the schedule.</p>';
  }
}

init();

// Refresh when the app comes back to the foreground.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    try {
      renderSchedule(await api('/api/schedule'));
    } catch {}
  }
});
