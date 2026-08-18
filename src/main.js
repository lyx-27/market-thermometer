'use strict';

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
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

async function tick() {
  try {
    const snap = await fetchSnapshot();
    snap.metrics = snap.metrics.map((m) => ({ ...m, series: pushHistory(m) }));
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
    hasShadow: true,
    fullscreenable: false,
    maximizable: false,
    skipTaskbar: true,
    vibrancy: 'fullscreen-ui', // more uniformly translucent glass than 'under-window'
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Behave like a desktop widget: float above normal windows, visible on all Spaces.
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });

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
