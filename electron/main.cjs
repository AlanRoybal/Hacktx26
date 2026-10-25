const { app, BrowserWindow, session, powerSaveBlocker, ipcMain } = require('electron');
const { join } = require('node:path');
const fs = require('node:fs');

const NINTENDO = 0x057e;
const JOYCONS = new Set([0x2006, 0x2007]);

app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(() => {
  const icon = join(__dirname, '..', 'build', 'icon.png');
  if (process.platform === 'darwin') app.dock.setIcon(icon);
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
  // play-of-the-game GIF: keep a local copy, then put it in S3 behind hacktx26.alanroybal.com (uses this Mac's AWS credentials)
  ipcMain.handle('upload-clip', async (_e, id, bytes) => {
    if (!/^[a-z0-9]{6,32}$/.test(id)) return 'bad id';
    const body = Buffer.from(bytes);
    const dir = join(__dirname, '..', 'clips');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, `${id}.gif`), body);
    try {
      const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
      await new S3Client({ region: 'us-east-1' }).send(new PutObjectCommand({ Bucket: 'hacktx26-alanroybal-clips', Key: `c/${id}.gif`,
        Body: body, ContentType: 'image/gif', CacheControl: 'public, max-age=31536000, immutable' }));
      return 'ok';
    } catch (err) { console.warn('clip upload', err); return String(err && err.message || err); }
  });

  const win = new BrowserWindow({
    width: 1920, height: 1080, fullscreen: !process.env.RR_WINDOWED, backgroundColor: '#000', icon,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') { e.preventDefault(); win.webContents.send('esc'); }
  });
  if (process.env.RR_URL) win.loadURL(process.env.RR_URL);
  else win.loadFile(join(__dirname, '..', 'dist', 'index.html'));
});
app.on('window-all-closed', () => app.quit());
