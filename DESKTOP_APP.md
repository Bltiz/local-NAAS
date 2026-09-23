# Desktop App Guide

Turn Local NAS into a standalone desktop application that runs in your system tray!

## Features

✨ **System Tray Integration** - Runs in background, always accessible
🚀 **Auto-Start** - Option to start with your computer
💻 **Native App** - No browser or terminal needed
📦 **Bundled** - Includes everything, no Node.js required
🔒 **Private** - All data stays on your computer

## Development Mode

Test the desktop app before building:

```bash
npm run electron-dev
```

This will:
1. Start the Next.js dev server
2. Wait for it to be ready
3. Launch the Electron window

## Building the Desktop App

### For Windows:
```bash
npm run electron-build-win
```
Creates: `Local NAS Setup.exe` in the `dist` folder

### For Mac:
```bash
npm run electron-build-mac
```
Creates: `Local NAS.dmg` in the `dist` folder

### For Linux:
```bash
npm run electron-build-linux
```
Creates: `Local NAS.AppImage` and `.deb` in the `dist` folder

### All Platforms:
```bash
npm run electron-build
```
Builds for your current platform

## Installation

### Windows:
1. Run `Local NAS Setup.exe`
2. Follow the installer
3. App appears in system tray

### Mac:
1. Open `Local NAS.dmg`
2. Drag to Applications folder
3. App appears in menu bar

### Linux:
```bash
# AppImage (no installation needed)
chmod +x Local-NAS.AppImage
./Local-NAS.AppImage

# Or install .deb package
sudo dpkg -i local-nas_1.0.0_amd64.deb
```

## Using the Desktop App

### System Tray Menu:

Right-click the tray icon to see:

- **Local URL**: `http://localhost:43214` - Open on this computer
- **Network URL**: `http://192.168.x.x:43214` - Share with other devices
- **Show Window**: Open the main window
- **Open Uploads Folder**: Browse uploaded files
- **Quit**: Close the app

### Accessing from Other Devices:

1. Right-click tray icon
2. Copy the **Network URL**
3. Open that URL on your laptop/phone
4. Upload and download files!

### Auto-Start with Computer (Optional):

#### Windows:
1. Press `Win + R`
2. Type `shell:startup`
3. Create shortcut to `Local NAS.exe`

#### Mac:
1. System Preferences → Users & Groups
2. Login Items → Add `Local NAS.app`

#### Linux:
```bash
# Copy .desktop file to autostart
cp /usr/share/applications/local-nas.desktop ~/.config/autostart/
```

## File Storage

Files are stored in:
- **Windows**: `%APPDATA%\Local NAS\uploads`
- **Mac**: `~/Library/Application Support/Local NAS/uploads`
- **Linux**: `~/.local/share/Local NAS/uploads`

Access via "Open Uploads Folder" in the tray menu.

## Distribution

### Sharing Your App:

1. Build the app for your platform
2. Find the installer in the `dist` folder
3. Share the installer file:
   - **Windows**: `Local NAS Setup.exe` (~150MB)
   - **Mac**: `Local NAS.dmg` (~150MB)
   - **Linux**: `Local-NAS.AppImage` or `.deb` (~150MB)

### Code Signing (Optional):

For professional distribution:

#### Windows:
```bash
# Get a code signing certificate
# Add to package.json build config:
"win": {
  "certificateFile": "path/to/cert.pfx",
  "certificatePassword": "your-password"
}
```

#### Mac:
```bash
# Use Apple Developer certificate
# Add to package.json:
"mac": {
  "identity": "Developer ID Application: Your Name"
}
```

## Customization

### Change App Icon:

1. Create icons:
   - **Windows**: `public/icon.ico` (256x256)
   - **Mac**: `public/icon.icns` (512x512)
   - **Linux**: `public/icon.png` (512x512)

2. Rebuild the app

### Change Port:

Edit `electron.js`:
```javascript
let serverPort = 43214; // Change to your preferred port
```

### Add Custom Features:

The app uses standard Next.js + Electron, so you can:
- Add system notifications
- Implement file watching
- Add keyboard shortcuts
- Create custom menus

## Troubleshooting

### Build Fails:

```bash
# Clear cache and rebuild
rm -rf node_modules dist .next
npm install
npm run electron-build
```

### App Won't Start:

- Check if port 43214 is available
- Look for errors in: Help → Toggle Developer Tools

### Network Access Not Working:

- Check firewall settings
- Ensure devices are on same WiFi
- Try disabling VPN temporarily

## Advanced: Multi-User Setup

Want multiple people to use it?

1. **Build and distribute** the app
2. Each person runs their own instance
3. Or set up one **central server** (see RAILWAY_DEPLOY.md)

## Performance

- **RAM Usage**: ~150-200MB
- **CPU**: Minimal when idle
- **Disk**: App size ~150MB + uploaded files
- **Network**: Local network speed (typically 100-1000 Mbps)

## Security Notes

- App runs on local network only by default
- Files stored locally, not in cloud
- No analytics or telemetry
- Open source - audit the code yourself

## Updates

To update the app:

1. Pull latest code:
   ```bash
   git pull
   ```

2. Rebuild:
   ```bash
   npm install
   npm run electron-build
   ```

3. Distribute new installer

## Contributing

Want to improve the desktop app?

Ideas:
- Auto-updater integration
- Cloud sync option
- File encryption
- Multi-language support
- Mobile companion app

## License

Free for personal and commercial use!

---

**Questions?** Open an issue or ask in the community!
