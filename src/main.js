'use strict';

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { fetchSnapshot } = require('./data/providers');

const REFRESH_MS = 45_000; // 45s: friendly to CoinGecko free-tier rate limits
const HISTORY_MAX = 60; // rolling live points kept per metric

let win = null;
let timer = null;

// Rolling live history so the sparklines gain a "momentum" tail between refreshes,
// even for sources that don't return a historical chart.
const liveHistory = new Map();

function pushHistory(metric) {
  if (metric.value == null) return metric.series || [];
  const buf = liveHistory.get(metric.id) || [];
  buf.push(metric.value);
  while (buf.length > HISTORY_MAX) buf.shift();
  liveHistory.set(metric.id, buf);
  // Prefer the richer API-provided series; fall back to the live buffer.
  return metric.series && metric.series.length > 2 ? metric.series : buf.slice();
}

/* ---------- 48h drop sound alerts ------------------------------------------
 * When a watched coin's 48h change crosses -20% (and again at -40%), play a
 * short chime once. A level re-arms only after the coin recovers back above it.
 * The first tick seeds current state silently, so launching never makes noise
 * for a drop that already happened. macOS uses afplay; best-effort elsewhere.
 */
const DROP_THRESHOLDS = [-20, -40];
// Re-arm only once the coin has recovered a few points ABOVE the level, not the
// instant it ticks back over it. Without this buffer a coin hovering around −20%
// re-fires on every dip: in one ~2h window that produced 126 chimes (MOONBASE alone
// fired 19 times) without ever actually recovering.
const DROP_REARM_BUFFER = 5; // percentage points
// Muted coins (hidden from the page) get the opposite treatment: they're already
// down, so another dip isn't news — a sudden rip is. Hysteresis on the re-arm stops
// it chattering for a coin hovering right at the line.
const PUMP_THRESHOLD = 50; // +50% over 24h
const PUMP_REARM = 35;

// Alert state is persisted, so restarting neither replays old alerts nor misses a
// pump that began while the widget was closed. Only a first-ever run seeds silently.
const ALERT_STATE_FILE = path.join(__dirname, '..', '.cache', 'alerts.json');
let alertState = new Map(); // id -> { fired: { '-20':bool, '-40':bool, pump:bool } }
let alertsSeeded = false;
try {
  const raw = JSON.parse(fs.readFileSync(ALERT_STATE_FILE, 'utf8'));
  alertState = new Map(Object.entries(raw.state || {}));
  alertsSeeded = alertState.size > 0; // we know what already fired -> safe to alert
} catch (_) {
  alertsSeeded = false; // first run ever -> seed from current values, silently
}
// Durable, timestamped alert history. stdout goes to /tmp (wiped on reboot) and had
// no timestamps, so there was no way to answer "what fired, and when?" after the
// fact — the whole point of an audible alert you might be away from.
// Deliberately NOT in .cache/ — that folder is safe to delete, this is history.
const ALERT_LOG = path.join(__dirname, '..', 'logs', 'alerts.log');
function logAlert(kind, name, detail) {
  const ts = new Date().toLocaleString('sv-SE'); // 'YYYY-MM-DD HH:mm:ss', sortable
  const line = `${ts}  ${kind.padEnd(4)}  ${String(name).padEnd(10)}  ${detail}`;
  console.log(`[alert] ${kind} ${name} ${detail}`);
  try {
    fs.mkdirSync(path.dirname(ALERT_LOG), { recursive: true });
    fs.appendFileSync(ALERT_LOG, line + '\n');
  } catch (_) {
    /* logging is best-effort */
  }
}

let _alertSaveTimer = null;
function saveAlertState() {
  clearTimeout(_alertSaveTimer);
  _alertSaveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(ALERT_STATE_FILE), { recursive: true });
      fs.writeFileSync(ALERT_STATE_FILE, JSON.stringify({ state: Object.fromEntries(alertState) }));
    } catch (_) {
      /* best-effort */
    }
  }, 1500);
  if (_alertSaveTimer.unref) _alertSaveTimer.unref();
}

function safeExists(p) {
  try {
    return fs.existsSync(p);
  } catch (_) {
    return false;
  }
}

function resolveAlertSound() {
  if (process.env.MT_ALERT_SOUND && safeExists(process.env.MT_ALERT_SOUND)) return process.env.MT_ALERT_SOUND;
  // reuse a sound file dropped into the Trader_Record_tool folder, if present
  try {
    const dir = '/Users/a27/Tools/Trader_Record_tool';
    const f = fs.readdirSync(dir).find((n) => /\.(aiff?|wav|mp3|m4a|caf)$/i.test(n));
    if (f) return path.join(dir, f);
  } catch (_) {
    /* fall through to the system chime */
  }
  return '/System/Library/Sounds/Glass.aiff'; // the "Glass" chime
}
const ALERT_SOUND = resolveAlertSound();

function playChime() {
  try {
    if (process.platform === 'darwin') {
      spawn('afplay', [ALERT_SOUND], { stdio: 'ignore', detached: true }).unref();
    } else if (process.platform === 'win32') {
      spawn('powershell', ['-NoProfile', '-c', `(New-Object Media.SoundPlayer '${ALERT_SOUND}').PlaySync()`], {
        stdio: 'ignore',
        detached: true,
      }).unref();
    }
  } catch (_) {
    /* sound is best-effort */
  }
}
// One chime = a drop, two = a pump, so they're distinguishable without looking.
function playAlert(times = 1) {
  for (let i = 0; i < times; i++) setTimeout(playChime, i * 600);
}

function change48h(series) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const first = series[0];
  const last = series[series.length - 1];
  if (!(first > 0)) return null;
  return ((last - first) / first) * 100;
}

function checkAlerts(metrics) {
  for (const m of metrics) {
    if (!['meme', 'onchain'].includes(m.group) || !m.ok) continue;
    const st = alertState.get(m.id) || { fired: {} };

    if (m.muted) {
      // hidden coin -> only care if it suddenly rips (24h change from the API)
      const chg = m.changePct;
      if (chg == null) continue;
      if (chg < PUMP_REARM) st.fired.pump = false;
      if (!alertsSeeded) {
        st.fired.pump = chg >= PUMP_THRESHOLD;
      } else if (chg >= PUMP_THRESHOLD && !st.fired.pump) {
        playAlert(2); // two chimes = pump
        st.fired.pump = true;
        logAlert('PUMP', m.name, `+${chg.toFixed(1)}% 24h`);
      }
    } else {
      // visible coin -> the original 48h drawdown alerts
      const chg = change48h(m.series);
      if (chg == null) continue;
      for (const lv of DROP_THRESHOLDS) if (chg > lv + DROP_REARM_BUFFER) st.fired[lv] = false;
      if (!alertsSeeded) {
        for (const lv of DROP_THRESHOLDS) st.fired[lv] = chg <= lv;
      } else if (DROP_THRESHOLDS.some((lv) => chg <= lv && !st.fired[lv])) {
        playAlert(1); // one chime = drop
        for (const lv of DROP_THRESHOLDS) if (chg <= lv) st.fired[lv] = true;
        logAlert('DROP', m.name, `${chg.toFixed(1)}% 48h`);
      }
    }
    alertState.set(m.id, st);
  }
  alertsSeeded = true;
  saveAlertState();
}

async function tick() {
  try {
    const snap = await fetchSnapshot();
    snap.metrics = snap.metrics.map((m) => ({ ...m, series: pushHistory(m) }));
    checkAlerts(snap.metrics);
    if (win && !win.isDestroyed()) win.webContents.send('snapshot', snap);
  } catch (e) {
    if (win && !win.isDestroyed()) win.webContents.send('snapshot-error', String(e && e.message));
  }
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 486;
  const height = 244;

  win = new BrowserWindow({
    width,
    height,
    minWidth: 380,
    minHeight: 200,
    x: workArea.x + workArea.width - width - 20,
    y: workArea.y + 20,
    frame: false,
    transparent: true,
    resizable: true,
    hasShadow: false, // CSS box-shadow instead, so it scales smoothly with opacity
    fullscreenable: false,
    maximizable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Behave like a desktop widget: float above normal windows, visible on all Spaces.
  // `alwaysOnTop` is already set in the constructor (works on every platform). The
  // 'floating' level string and setVisibleOnAllWorkspaces are macOS/Linux concepts
  // (Spaces / virtual desktops); on Windows they're unsupported no-ops, so we guard
  // them and just keep the plain always-on-top behavior there.
  if (process.platform === 'darwin' || process.platform === 'linux') {
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  } else {
    win.setAlwaysOnTop(true);
  }

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.webContents.on('did-finish-load', () => {
    tick();
    timer = setInterval(tick, REFRESH_MS);
  });
}

// Renderer actions
ipcMain.handle('refresh-now', tick);
ipcMain.handle('close-app', () => app.quit());
ipcMain.handle('toggle-pin', () => {
  if (!win) return false;
  const next = !win.isAlwaysOnTop();
  // 'floating' level is macOS-only; harmless/ignored on Windows & Linux.
  win.setAlwaysOnTop(next, 'floating');
  return next;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (timer) clearInterval(timer);
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
