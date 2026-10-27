// Krusty Krab LIVE desktop app: starts the local server (or reuses a running one), shows the control
// panel, and opens the full-resolution Stream window that you capture in TikTok LIVE Studio / OBS.
// Closing the control panel quits the app and stops the server it started.
const { app, BrowserWindow, Menu, clipboard, shell, dialog, screen } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const PORT = 7777;
const URL = `http://localhost:${PORT}/`;
const ICON = path.join(__dirname, 'icon.png');

// Voices and effects play without needing a click first.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (!app.requestSingleInstanceLock()) app.quit();

let server = null, main = null, stream = null;

const ping = () => new Promise((res) => {
  const r = http.get(URL, (x) => { x.resume(); res(x.statusCode === 200); });
  r.on('error', () => res(false)); r.setTimeout(1500, () => { r.destroy(); res(false); });
});

async function ensureServer() {
  if (await ping()) return; // already running (e.g. started from a terminal)
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: 'ignore',
  });
  server.on('exit', (code) => { server = null; if (!app.isQuitting) dialog.showErrorBox('Krusty Krab LIVE', `The server stopped (code ${code}). Check data/app.log.`); });
  for (let i = 0; i < 40; i++) { if (await ping()) return; await new Promise(r => setTimeout(r, 250)); }
  throw new Error('Server did not start on port ' + PORT);
}

// A window whose renderer crashes (e.g. the GPU runs out of memory while the AI is busy) reloads itself
// instead of sitting there grey.
function selfHealing(win, label) {
  win.webContents.on('render-process-gone', (_e, d) => {
    console.error(`${label} renderer gone (${d.reason}); reloading`);
    setTimeout(() => { if (!win.isDestroyed()) win.reload(); }, 1000);
  });
  win.on('unresponsive', () => setTimeout(() => { if (!win.isDestroyed()) win.reload(); }, 5000));
}

/** The stream output: 9:16, as tall as the screen allows, rendered at the display's real pixel density,
 *  never throttled in the background, and the only window that plays audio. Capture THIS window. */
function openStream() {
  if (stream && !stream.isDestroyed()) { stream.show(); stream.focus(); return; }
  const wa = screen.getPrimaryDisplay().workArea;
  const h = Math.min(wa.height, 1920), w = Math.round(h * 9 / 16);
  stream = new BrowserWindow({
    width: w, height: h, x: wa.x + wa.width - w, y: wa.y, useContentSize: true,
    title: 'Krusty Krab Stream', icon: ICON, backgroundColor: '#000000', autoHideMenuBar: true,
    webPreferences: { backgroundThrottling: false },
  });
  stream.setAspectRatio(9 / 16);
  stream.on('page-title-updated', (e) => e.preventDefault()); // keep a stable title for window capture
  selfHealing(stream, 'Stream');
  stream.loadURL(URL + 'overlay.html?quality=high');
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'App', submenu: [
      { label: 'Open stream window', accelerator: 'Ctrl+O', click: openStream },
      { label: 'Copy OBS overlay URL', click: () => clipboard.writeText(URL + 'overlay.html') },
      { label: 'Open logs folder', click: () => shell.openPath(path.join(ROOT, 'data')) },
      { type: 'separator' },
      { role: 'reload' }, { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'quit' },
    ] },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
  ]));
}

app.whenReady().then(async () => {
  buildMenu();
  main = new BrowserWindow({
    width: 1500, height: 950, minWidth: 900, minHeight: 600, title: 'Krusty Krab LIVE', icon: ICON, backgroundColor: '#12161c', show: false,
    webPreferences: { backgroundThrottling: false },
  });
  selfHealing(main, 'Control panel');
  main.loadURL('data:text/html,' + encodeURIComponent('<body style="background:#12161c;color:#e6e9ee;font:18px Segoe UI;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">🦀 Starting the Krusty Krab…</body>'));
  main.once('ready-to-show', () => main.show());
  try {
    await ensureServer();
    main.loadURL(URL); // the Stream window (App menu, Ctrl+O) is opt-in so it never competes with your TikTok link
  } catch (e) {
    dialog.showErrorBox('Krusty Krab LIVE', e.message);
    app.quit();
  }
  main.on('closed', () => { main = null; app.quit(); });
});

app.on('child-process-gone', (_e, d) => { if (d.type === 'GPU') console.error('GPU process restarted:', d.reason); });
app.on('second-instance', () => { if (main) { if (main.isMinimized()) main.restore(); main.focus(); } });
app.on('before-quit', () => { app.isQuitting = true; if (server) server.kill(); });
