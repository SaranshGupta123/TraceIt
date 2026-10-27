const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const DEFAULT_OPACITY = 200;
const MAX_SCREEN_FRACTION = 0.9;
const TOP_BAR_HEIGHT = 48;
const TOP_BAR_MIN_WIDTH = 640;
const FRAME_BORDER = 2;

let splashWindow = null;
let controlWindow = null;
let topBarWindow = null;
let overlayWindow = null;
let tray = null;

let config = { opacity: DEFAULT_OPACITY, lastImage: null };
let currentImagePath = null;
let overlayScale = 1.0;
let clickThrough = true;
let traceMode = false;
let isMaximized = false;
let preMaximizeBounds = null;
let topBarDragInterval = null;

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 280,
    height: 180,
    frame: false,
    center: true,
    resizable: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: '#0a0a0a',
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  splashWindow.loadFile(getRendererPath('splash'));
  return splashWindow;
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}

function loadConfig() {
  try {
    const data = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(data);
    if (typeof parsed.opacity === 'number' && parsed.opacity >= 0 && parsed.opacity <= 255) {
      config.opacity = parsed.opacity;
    }
    if (typeof parsed.lastImage === 'string') config.lastImage = parsed.lastImage;
  } catch (_) {}
}

function saveConfig() {
  try {
    config.lastImage = currentImagePath;
    config.opacity = typeof config.opacity === 'number' ? config.opacity : DEFAULT_OPACITY;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (_) {}
}

function getPreloadPath() {
  return path.join(__dirname, 'preload.js');
}

function getRendererPath(name) {
  return path.join(__dirname, 'renderer', `${name}.html`);
}

function createControlWindow() {
  if (controlWindow && !controlWindow.isDestroyed()) return controlWindow;
  controlWindow = new BrowserWindow({
    width: 380,
    height: 420,
    minWidth: 320,
    minHeight: 280,
    center: true,
    show: false,
    title: 'TraceIt by Sig',
    backgroundColor: '#0e0e0e',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  controlWindow.setMenuBarVisibility(false);
  controlWindow.loadFile(getRendererPath('control'));
  controlWindow.on('closed', () => { controlWindow = null; });
  return controlWindow;
}

function resizeTopBar(w) {
  if (!topBarWindow || topBarWindow.isDestroyed()) return;
  const width = Math.max(w, TOP_BAR_MIN_WIDTH);
  topBarWindow.setResizable(true);
  topBarWindow.setMinimumSize(TOP_BAR_MIN_WIDTH, TOP_BAR_HEIGHT);
  topBarWindow.setSize(width, TOP_BAR_HEIGHT);
  topBarWindow.setResizable(false);
}

function createTopBarWindow(width) {
  if (topBarWindow && !topBarWindow.isDestroyed()) {
    resizeTopBar(width || topBarWindow.getSize()[0]);
    return topBarWindow;
  }
  topBarWindow = new BrowserWindow({
    width: Math.max(width || TOP_BAR_MIN_WIDTH, TOP_BAR_MIN_WIDTH),
    height: TOP_BAR_HEIGHT,
    minWidth: TOP_BAR_MIN_WIDTH,
    minHeight: TOP_BAR_HEIGHT,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    title: 'TraceIt',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  topBarWindow.loadFile(getRendererPath('topbar'));
  topBarWindow.setAlwaysOnTop(true, 'screen-saver');
  topBarWindow.on('closed', () => {
    topBarWindow = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.close();
    }
  });
  topBarWindow.on('move', () => {
    if (!isMaximized && overlayWindow && !overlayWindow.isDestroyed() && topBarWindow && !topBarWindow.isDestroyed()) {
      const [x, y] = topBarWindow.getPosition();
      overlayWindow.setPosition(x, y + TOP_BAR_HEIGHT);
    }
  });
  topBarWindow.on('minimize', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.hide();
    }
  });
  topBarWindow.on('restore', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.show();
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      topBarWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  });
  return topBarWindow;
}

function getMaxOverlaySize() {
  const { screen } = require('electron');
  const primary = screen.getPrimaryDisplay();
  const bounds = primary.workAreaSize;
  return {
    width: Math.floor(bounds.width * MAX_SCREEN_FRACTION),
    height: Math.floor(bounds.height * MAX_SCREEN_FRACTION),
  };
}

function computeOverlaySize(imagePath) {
  const max = getMaxOverlaySize();
  let w = 320;
  let h = 200;
  if (imagePath) {
    const img = nativeImage.createFromPath(imagePath);
    const size = img.getSize();
    if (size.width > 0 && size.height > 0) {
      w = size.width;
      h = size.height;
    }
  }
  w = Math.round(w * overlayScale);
  h = Math.round(h * overlayScale);
  if (w > max.width || h > max.height) {
    const r = Math.min(max.width / w, max.height / h);
    w = Math.floor(w * r);
    h = Math.floor(h * r);
  }
  w = Math.max(80, w);
  h = Math.max(60, h);
  return { width: w, height: h };
}

function resizeOverlay(w, h) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setResizable(true);
  overlayWindow.setMinimumSize(1, 1);
  overlayWindow.setSize(w, h);
  overlayWindow.setResizable(false);
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
  const size = computeOverlaySize(currentImagePath);
  const barWidth = Math.max(size.width, TOP_BAR_MIN_WIDTH);
  overlayWindow = new BrowserWindow({
    width: barWidth,
    height: size.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });
  overlayWindow.loadFile(getRendererPath('overlay'));
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  // If traceMode is false, overlay can receive mouse events to pan/drag the image
  overlayWindow.setIgnoreMouseEvents(traceMode, { forward: true });
  overlayWindow.setOpacity((config.opacity || DEFAULT_OPACITY) / 255);
  overlayWindow.on('closed', () => { overlayWindow = null; });
  return overlayWindow;
}

function getCenteredPosition(frameWidth, frameHeight) {
  const primary = screen.getPrimaryDisplay();
  const workArea = primary.workArea;
  return {
    x: workArea.x + Math.max(0, Math.floor((workArea.width - frameWidth) / 2)),
    y: workArea.y + Math.max(0, Math.floor((workArea.height - frameHeight) / 2)),
  };
}

function switchToTopBar() {
  if (controlWindow && !controlWindow.isDestroyed()) controlWindow.hide();
  isMaximized = false;
  createOverlayWindow();
  const size = computeOverlaySize(currentImagePath);
  const barWidth = Math.max(size.width, TOP_BAR_MIN_WIDTH);
  const totalHeight = TOP_BAR_HEIGHT + size.height;
  const pos = getCenteredPosition(barWidth, totalHeight);
  if (currentImagePath && overlayWindow && !overlayWindow.isDestroyed()) {
    const fileUrl = pathToFileURL(currentImagePath).href;
    resizeOverlay(barWidth, size.height);
    const sendImage = () => {
      overlayWindow.webContents.send('set-image', fileUrl, overlayScale);
      overlayWindow.webContents.send('trace-state', traceMode);
      overlayWindow.setIgnoreMouseEvents(traceMode, { forward: true });
    };
    if (overlayWindow.webContents.isLoading()) {
      overlayWindow.webContents.once('did-finish-load', sendImage);
    } else {
      sendImage();
    }
    overlayWindow.setPosition(pos.x, pos.y + TOP_BAR_HEIGHT);
    overlayWindow.show();
  }
  const bar = createTopBarWindow(barWidth);
  bar.setPosition(pos.x, pos.y);
  bar.show();
  bar.focus();
  if (bar.webContents) {
    bar.webContents.send('maximized-state', false);
    bar.webContents.send('trace-state', traceMode);
  }
}

function toggleMaximize() {
  if (!topBarWindow || topBarWindow.isDestroyed()) return;

  if (!isMaximized) {
    // Save current bounds
    const barBounds = topBarWindow.getBounds();
    const overlayBounds = (overlayWindow && !overlayWindow.isDestroyed()) ? overlayWindow.getBounds() : null;
    preMaximizeBounds = { barBounds, overlayBounds };

    // Get work area of current display
    const currentDisplay = screen.getDisplayMatching(barBounds);
    const workArea = currentDisplay.workArea;

    // Enlarge top bar to full width
    topBarWindow.setResizable(true);
    topBarWindow.setBounds({
      x: workArea.x,
      y: workArea.y,
      width: workArea.width,
      height: TOP_BAR_HEIGHT,
    });
    topBarWindow.setResizable(false);

    // Enlarge overlay to fill remainder of screen below top bar
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setResizable(true);
      overlayWindow.setBounds({
        x: workArea.x,
        y: workArea.y + TOP_BAR_HEIGHT,
        width: workArea.width,
        height: Math.max(60, workArea.height - TOP_BAR_HEIGHT),
      });
      overlayWindow.setResizable(false);
    }

    isMaximized = true;
    topBarWindow.webContents.send('maximized-state', true);
  } else {
    // Restore
    if (preMaximizeBounds && preMaximizeBounds.barBounds) {
      const bb = preMaximizeBounds.barBounds;
      const ob = preMaximizeBounds.overlayBounds;

      topBarWindow.setResizable(true);
      topBarWindow.setBounds(bb);
      topBarWindow.setResizable(false);

      if (overlayWindow && !overlayWindow.isDestroyed() && ob) {
        overlayWindow.setResizable(true);
        overlayWindow.setBounds(ob);
        overlayWindow.setResizable(false);
      }
    } else {
      const size = computeOverlaySize(currentImagePath);
      const barWidth = Math.max(size.width, TOP_BAR_MIN_WIDTH);
      const pos = getCenteredPosition(barWidth, TOP_BAR_HEIGHT + size.height);
      topBarWindow.setResizable(true);
      topBarWindow.setBounds({ x: pos.x, y: pos.y, width: barWidth, height: TOP_BAR_HEIGHT });
      topBarWindow.setResizable(false);
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setResizable(true);
        overlayWindow.setBounds({ x: pos.x, y: pos.y + TOP_BAR_HEIGHT, width: barWidth, height: size.height });
        overlayWindow.setResizable(false);
      }
    }

    isMaximized = false;
    topBarWindow.webContents.send('maximized-state', false);
  }
}

function updateTraceModeState() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setIgnoreMouseEvents(traceMode, { forward: true });
    overlayWindow.webContents.send('trace-state', traceMode);
    overlayWindow.showInactive();
  }
  if (topBarWindow && !topBarWindow.isDestroyed()) {
    topBarWindow.setAlwaysOnTop(true, 'screen-saver');
    topBarWindow.show();
    topBarWindow.webContents.send('trace-state', traceMode);
  }
  clickThrough = traceMode;
}

function switchToControl() {
  if (topBarWindow && !topBarWindow.isDestroyed()) topBarWindow.hide();
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
  isMaximized = false;
  const ctrl = createControlWindow();
  ctrl.show();
  ctrl.focus();
  const sendState = () => {
    if (ctrl.webContents && !ctrl.webContents.isDestroyed()) {
      ctrl.webContents.send('current-state', { imagePath: currentImagePath, scale: overlayScale });
    }
  };
  if (ctrl.webContents.isLoading()) {
    ctrl.webContents.once('did-finish-load', sendState);
  } else {
    sendState();
  }
}

// --- IPC ---

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.on('image-loaded', (_, imagePath) => {
  if (!imagePath || typeof imagePath !== 'string') return;
  currentImagePath = imagePath;
  saveConfig();
  switchToTopBar();
});

ipcMain.on('upload-clicked', () => {
  switchToControl();
});

ipcMain.on('minimize-clicked', () => {
  if (topBarWindow && !topBarWindow.isDestroyed()) topBarWindow.minimize();
});

ipcMain.on('maximize-toggle', () => {
  toggleMaximize();
});

ipcMain.on('exit-clicked', () => {
  saveConfig();
  app.quit();
});

ipcMain.on('topbar-move', (_, dx, dy) => {
  if (!topBarWindow || topBarWindow.isDestroyed()) return;
  const [x, y] = topBarWindow.getPosition();
  const nx = Math.round(Number(x) + Number(dx));
  const ny = Math.round(Number(y) + Number(dy));
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
  topBarWindow.setPosition(nx, ny);
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setPosition(nx, ny + TOP_BAR_HEIGHT);
  }
});

ipcMain.on('topbar-drag-start', (_, screenX, screenY) => {
  if (topBarDragInterval) return;
  if (!topBarWindow || topBarWindow.isDestroyed()) return;
  if (isMaximized) {
    toggleMaximize();
  }
  const [barX, barY] = topBarWindow.getPosition();
  const offsetX = screenX - barX;
  const offsetY = screenY - barY;
  topBarDragInterval = setInterval(() => {
    if (!topBarWindow || topBarWindow.isDestroyed()) {
      clearInterval(topBarDragInterval);
      topBarDragInterval = null;
      return;
    }
    const pos = screen.getCursorScreenPoint();
    const nx = Math.round(Number(pos.x) - offsetX);
    const ny = Math.round(Number(pos.y) - offsetY);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
    topBarWindow.setPosition(nx, ny);
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setPosition(nx, ny + TOP_BAR_HEIGHT);
    }
  }, 16);
});

ipcMain.on('topbar-drag-end', () => {
  if (topBarDragInterval) {
    clearInterval(topBarDragInterval);
    topBarDragInterval = null;
  }
});

ipcMain.on('set-scale', (_, scale) => {
  overlayScale = Math.max(0.49, Math.min(3, scale));
  if (overlayWindow && !overlayWindow.isDestroyed() && currentImagePath) {
    if (!isMaximized) {
      const size = computeOverlaySize(currentImagePath);
      const barWidth = Math.max(size.width, TOP_BAR_MIN_WIDTH);
      let anchorX, anchorY;
      if (topBarWindow && !topBarWindow.isDestroyed()) {
        [anchorX, anchorY] = topBarWindow.getPosition();
        resizeTopBar(barWidth);
      }
      resizeOverlay(barWidth, size.height);
      if (topBarWindow && !topBarWindow.isDestroyed() && anchorX !== undefined) {
        overlayWindow.setPosition(anchorX, anchorY + TOP_BAR_HEIGHT);
      }
    }
    overlayWindow.webContents.send('set-scale', overlayScale);
    if (topBarWindow && !topBarWindow.isDestroyed()) {
      topBarWindow.webContents.send('set-scale', overlayScale);
    }
  }
});

ipcMain.on('center-image', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('center-image');
  }
});

ipcMain.on('nudge-pan', (_, dx, dy) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('nudge-pan', dx, dy);
  }
});

ipcMain.on('overlay-move', (_, dx, dy) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const [x, y] = overlayWindow.getPosition();
  const nx = Math.round(Number(x) + Number(dx));
  const ny = Math.round(Number(y) + Number(dy));
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
  overlayWindow.setPosition(nx, ny);
  if (topBarWindow && !topBarWindow.isDestroyed()) {
    topBarWindow.setPosition(nx, ny - TOP_BAR_HEIGHT);
  }
});

ipcMain.handle('get-initial-config', () => ({
  ...config,
  currentImagePath,
  overlayScale,
  traceMode,
  isMaximized,
}));

ipcMain.handle('tray-load-image', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.on('tray-image-selected', (_, imagePath) => {
  if (!imagePath) return;
  currentImagePath = imagePath;
  saveConfig();
  isMaximized = false;
  createOverlayWindow();
  const fileUrl = pathToFileURL(currentImagePath).href;
  const size = computeOverlaySize(currentImagePath);
  const barWidth = Math.max(size.width, TOP_BAR_MIN_WIDTH);
  const totalHeight = TOP_BAR_HEIGHT + size.height;
  const pos = getCenteredPosition(barWidth, totalHeight);
  resizeOverlay(barWidth, size.height);
  const sendImage = () => {
    overlayWindow.webContents.send('set-image', fileUrl, overlayScale);
    overlayWindow.webContents.send('trace-state', traceMode);
    overlayWindow.setIgnoreMouseEvents(traceMode, { forward: true });
  };
  if (overlayWindow.webContents.isLoading()) {
    overlayWindow.webContents.once('did-finish-load', sendImage);
  } else {
    sendImage();
  }
  overlayWindow.setPosition(pos.x, pos.y + TOP_BAR_HEIGHT);
  overlayWindow.show();
  const bar = createTopBarWindow(barWidth);
  bar.setPosition(pos.x, pos.y);
  bar.show();
  if (bar.webContents) {
    bar.webContents.send('maximized-state', false);
    bar.webContents.send('trace-state', traceMode);
  }
  if (controlWindow && !controlWindow.isDestroyed()) controlWindow.hide();
});

ipcMain.on('set-opacity', (_, value) => {
  config.opacity = value;
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.setOpacity(value / 255);
});

ipcMain.on('set-click-through', (_, enabled) => {
  clickThrough = enabled;
  traceMode = enabled;
  updateTraceModeState();
});

ipcMain.on('trace-toggle', () => {
  traceMode = !traceMode;
  updateTraceModeState();
});

// --- Tray ---

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const { nativeImage } = require('electron');
  let icon = nativeImage.createEmpty();
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  }
  if (icon.isEmpty()) {
    icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
  }
  tray = new Tray(icon);
  tray.setToolTip('Trace Overlay');
  updateTrayMenu();
}

function updateTrayMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Load image…',
      click: async () => {
        const imagePath = await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] }],
        }).then(r => (r.canceled || !r.filePaths.length ? null : r.filePaths[0]));
        if (imagePath) {
          currentImagePath = imagePath;
          saveConfig();
          isMaximized = false;
          createOverlayWindow();
          const fileUrl = pathToFileURL(currentImagePath).href;
          const size = computeOverlaySize(currentImagePath);
          const barWidth = Math.max(size.width, TOP_BAR_MIN_WIDTH);
          const totalHeight = TOP_BAR_HEIGHT + size.height;
          const pos = getCenteredPosition(barWidth, totalHeight);
          resizeOverlay(barWidth, size.height);
          const sendImage = () => {
            overlayWindow.webContents.send('set-image', fileUrl, overlayScale);
            overlayWindow.webContents.send('trace-state', traceMode);
            overlayWindow.setIgnoreMouseEvents(traceMode, { forward: true });
          };
          if (overlayWindow.webContents.isLoading()) {
            overlayWindow.webContents.once('did-finish-load', sendImage);
          } else {
            sendImage();
          }
          overlayWindow.setPosition(pos.x, pos.y + TOP_BAR_HEIGHT);
          overlayWindow.show();
          const bar = createTopBarWindow(barWidth);
          bar.setPosition(pos.x, pos.y);
          bar.show();
          if (bar.webContents) {
            bar.webContents.send('maximized-state', false);
            bar.webContents.send('trace-state', traceMode);
          }
          if (controlWindow && !controlWindow.isDestroyed()) controlWindow.hide();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Opacity',
      submenu: [25, 50, 75, 100].map(pct => ({
        label: `${pct}%`,
        click: () => {
          const value = Math.round((pct / 100) * 255);
          config.opacity = value;
          if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.setOpacity(value / 255);
        },
      })),
    },
    {
      label: 'Trace mode (click-through)',
      type: 'checkbox',
      checked: traceMode,
      click: (item) => {
        traceMode = item.checked;
        updateTraceModeState();
      },
    },
    {
      label: 'Center image',
      click: () => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.webContents.send('center-image');
        }
      },
    },
    { type: 'separator' },
    { label: 'Exit', role: 'quit', click: () => { saveConfig(); app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

// --- App lifecycle ---

app.whenReady().then(() => {
  app.setAppUserModelId('com.sig.traceit');
  // Show splash first and wait for it to be visible before loading main UI
  createSplashWindow();
  const splash = splashWindow;
  if (!splash || splash.isDestroyed()) {
    startMainUI();
    return;
  }
  splash.webContents.once('did-finish-load', () => {
    startMainUI();
  });
  // Fallback: if splash fails to load (e.g. missing file), still open main UI after short delay
  setTimeout(() => {
    if (splashWindow === splash && !controlWindow) startMainUI();
  }, 3000);
});

function startMainUI() {
  loadConfig();
  if (config.lastImage && require('fs').existsSync(config.lastImage)) {
    currentImagePath = config.lastImage;
    overlayScale = 1.0;
  }
  const imageExts = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp'];
  const argv = process.argv.slice(1);
  const cliPath = argv.find(
    (a) => !a.startsWith('-') && fs.existsSync(a) && imageExts.includes(path.extname(a).toLowerCase())
  );
  if (cliPath) {
    currentImagePath = cliPath;
    saveConfig();
    switchToTopBar();
    closeSplash();
  } else {
    createControlWindow();
    const win = controlWindow;
    if (win && !win.isDestroyed()) {
      win.once('ready-to-show', () => {
        if (win && !win.isDestroyed()) {
          win.show();
          closeSplash();
        }
      });
      win.webContents.once('did-finish-load', () => {
        if (win && !win.isDestroyed() && !win.isVisible()) {
          win.show();
          closeSplash();
        }
      });
    }
  }
  createTray();
}

app.on('window-all-closed', (e) => {
  // Don't quit or destroy tray -- the app lives in the tray
  e.preventDefault();
});

app.on('before-quit', () => saveConfig());
