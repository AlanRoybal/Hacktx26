const { app, BrowserWindow, session, powerSaveBlocker, ipcMain } = require('electron');
const { join } = require('node:path');
const fs = require('node:fs');

const NINTENDO = 0x057e;
const JOYCONS = new Set([0x2006, 0x2007]);

app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(() => {
  const ses = session.defaultSession;
  // Electron has no HID chooser: pick the first Joy-Con matching the renderer's filter
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const jc = details.deviceList.find(d => d.vendorId === NINTENDO && JOYCONS.has(d.productId));
    callback(jc ? jc.deviceId : '');
  });
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'hid' || permission === 'media');
  ses.setDevicePermissionHandler(d => d.deviceType === 'hid' && d.device.vendorId === NINTENDO);

  powerSaveBlocker.start('prevent-display-sleep');
  ipcMain.handle('save-trace', (_e, name, text) => {
    const dir = join(__dirname, '..', 'tools', 'imu-traces');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, name), text);
    return join(dir, name);
  });
  ipcMain.on('quit', () => app.quit());

  const win = new BrowserWindow({
    width: 1920, height: 1080, fullscreen: !process.env.RR_WINDOWED, backgroundColor: '#000',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  if (process.env.RR_URL) win.loadURL(process.env.RR_URL);
  else win.loadFile(join(__dirname, '..', 'dist', 'index.html'));
});
app.on('window-all-closed', () => app.quit());
