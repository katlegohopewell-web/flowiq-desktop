// FlowIQ — Stormwater Runoff Calculator — Desktop App (Electron, MVP)
//
// Flow:
//   1. On launch, look for a saved license key (userData/license.json).
//   2. If we have one AND it was successfully validated within GRACE_PERIOD_DAYS,
//      let the user straight into the calculator (good for offline/field use),
//      and quietly re-check with the server in the background.
//   3. Otherwise, show the license gate and require a fresh online check.
//   4. Only once validation succeeds does the app load the real calculator.

const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// >>> CHANGE THIS to your deployed license server's URL before shipping <<<
const SERVER_URL = process.env.STORMWATER_LICENSE_SERVER || 'https://flowiq-license-server.onrender.com';

const GRACE_PERIOD_DAYS = 7; // how long the app trusts a cached "valid" result while offline

const licenseFilePath = () => path.join(app.getPath('userData'), 'license.json');

function readLicense(){
  try {
    return JSON.parse(fs.readFileSync(licenseFilePath(), 'utf8'));
  } catch (e) {
    return null;
  }
}
function writeLicense(data){
  fs.writeFileSync(licenseFilePath(), JSON.stringify(data, null, 2));
}
function clearLicense(){
  try { fs.unlinkSync(licenseFilePath()); } catch (e) {}
}

async function checkKeyWithServer(key){
  try {
    const res = await fetch(`${SERVER_URL}/api/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    const data = await res.json();
    return data; // { valid, expiresAt, message }
  } catch (e) {
    return { valid: false, offline: true, message: 'Could not reach the license server' };
  }
}

function withinGracePeriod(license){
  if (!license || !license.lastValidatedAt) return false;
  const last = new Date(license.lastValidatedAt).getTime();
  const now = Date.now();
  const days = (now - last) / (1000 * 60 * 60 * 24);
  return days <= GRACE_PERIOD_DAYS;
}

let mainWindow;

function createWindow(){
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  Menu.setApplicationMenu(null);
  decideInitialScreen();
}

async function decideInitialScreen(){
  const license = readLicense();

  if (license && license.key && withinGracePeriod(license) && license.lastStatus === 'valid') {
    // Let them in immediately, re-check quietly in the background.
    loadCalculator();
    checkKeyWithServer(license.key).then(result => {
      if (result.valid) {
        writeLicense({ ...license, lastValidatedAt: new Date().toISOString(), lastStatus: 'valid', expiresAt: result.expiresAt });
      } else if (!result.offline) {
        // Genuinely revoked/expired (not just offline) — kick back to the gate next launch.
        writeLicense({ ...license, lastStatus: 'invalid' });
      }
    });
    return;
  }

  if (license && license.key) {
    // We have a stored key but it's stale or previously failed — try a fresh check
    // before bothering the user, so returning subscribers don't have to retype anything.
    const result = await checkKeyWithServer(license.key);
    if (result.valid) {
      writeLicense({ key: license.key, lastValidatedAt: new Date().toISOString(), lastStatus: 'valid', expiresAt: result.expiresAt });
      loadCalculator();
      return;
    }
  }

  loadGate();
}

function loadGate(){
  mainWindow.loadFile(path.join(__dirname, 'src', 'gate.html'));
}
function loadCalculator(){
  mainWindow.loadFile(path.join(__dirname, 'src', 'calculator.html'));
}

// ---- IPC handlers used by the gate screen ----

ipcMain.handle('license:activate', async (event, key) => {
  const trimmed = (key || '').trim().toUpperCase();
  if (!trimmed) return { valid: false, message: 'Enter a license key' };
  const result = await checkKeyWithServer(trimmed);
  if (result.valid) {
    writeLicense({ key: trimmed, lastValidatedAt: new Date().toISOString(), lastStatus: 'valid', expiresAt: result.expiresAt });
  }
  return result;
});

ipcMain.handle('license:enterApp', () => {
  loadCalculator();
});

ipcMain.handle('license:signOut', () => {
  clearLicense();
  loadGate();
});

ipcMain.handle('license:getStatus', () => {
  return readLicense();
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
