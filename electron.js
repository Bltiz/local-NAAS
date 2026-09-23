const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

let mainWindow = null;
let tray = null;
let serverProcess = null;
let serverPort = 43214;

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function startNextServer() {
  console.log('Starting Next.js server...');
  
  const isDev = !app.isPackaged;
  const nextCommand = isDev ? 'npm' : 'npx';
  const nextArgs = isDev 
    ? ['run', 'dev'] 
    : ['next', 'start', '-p', serverPort.toString(), '-H', '0.0.0.0'];

  serverProcess = spawn(nextCommand, nextArgs, {
    cwd: app.getAppPath(),
    env: { ...process.env, PORT: serverPort.toString() },
    shell: true
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(`Server: ${data}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`Server Error: ${data}`);
  });

  serverProcess.on('close', (code) => {
    console.log(`Server process exited with code ${code}`);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, 'icon.png'),
    title: 'Local NAS',
  });

  // Wait for server to start then load
  setTimeout(() => {
    mainWindow.loadURL(`http://localhost:${serverPort}`);
  }, 5000);

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // Create a simple tray icon (you can replace with a proper icon file)
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAA7AAAAOwBeShxvQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAJnSURBVFiF7ZZNaBNBGIafsZvdZJPdZLPZbDZp0qRN0zZpjW1qPYgH8SBWEATxIHjw4EXwJniQgnjwIAiiCCJ48OBBEDx4EUTwYEEQxINQELxYqNhqbW1t0jRN0t3M7IwHD1KbZjV/IIgvLDuZ5/2+Z2e+mQH+88sW4Ovt4+xbPTrSWLHPVTLJX2+qq6W6ntXoAYCd1p0LXS49u/rWuF8+hIWFH/T0xJP4eCyJ4VCS7naXCPd8Efv7T1FfXz/2DwC7uvoYf0BgYMAD0+wAAEQiFfB4zmB0dDh+r+9l8vBhH+PzpQAAyOUK+HxneXp6SnN7+2iyu/t4rKHBh3w+fygAgUAZFhYW6fb2Ue3s7GPM4/HAYDCAJCkkEgmUy2VYrdbo9vZ7fmoqHjWb71htNrPu8dRpcnlpfn4+EYvFkM/nkc1mQ9lsNhKPx0OTk5Px6emp+PT0VLy7uzN2eL+M3W4nJSUlCIfDyGQykMvlKCsrg8PhgMPhQFlZGeRyOTKZDMLhMOrq6qDT6aBWq7X7DrEkCZQkQaVSQavVQqfTobKyEiRJIpVKYW1tDel0GhqNBgaDAUaj8dc+QimVSmLx6R8drf1vAN3tdqq5ubll5L5c3iOam5vR1NSEhoYG6PV61NbWQqvVQqVSgaIoqFQqaLVa1NTUoL6+/vt+n/lKhI6MnI+5XPskQRDY3NyEx+OBSqX67oBSqYTH40FLSwsIgoDD4cD6+nrijoxUP94X4B9xOP7oH5l5GwJwi6Loh0KhsNHe3oHOzlO4dKkDNput5caNi3crKiqe7Pvmp9n/dmPxC/QbGsUsjgj1AAAAAElFTkSuQmCC'
  );

  tray = new Tray(icon);
  
  const localIp = getLocalIpAddress();
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Local NAS',
      type: 'normal',
      enabled: false
    },
    { type: 'separator' },
    { 
      label: `Local: http://localhost:${serverPort}`,
      click: () => {
        require('electron').shell.openExternal(`http://localhost:${serverPort}`);
      }
    },
    { 
      label: `Network: http://${localIp}:${serverPort}`,
      click: () => {
        require('electron').shell.openExternal(`http://${localIp}:${serverPort}`);
      }
    },
    { type: 'separator' },
    { 
      label: 'Show Window', 
      click: () => {
        mainWindow.show();
      }
    },
    { 
      label: 'Open Uploads Folder',
      click: () => {
        const uploadsPath = path.join(app.getAppPath(), 'uploads');
        require('electron').shell.openPath(uploadsPath);
      }
    },
    { type: 'separator' },
    { 
      label: 'Quit', 
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Local NAS - File Transfer');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    mainWindow.show();
  });
}

app.whenReady().then(() => {
  startNextServer();
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // Keep app running in system tray
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});
