# Local NAS - Universal File Transfer System

A beautiful, modern file transfer system that works locally, on the cloud, or as a desktop app! Transfer files between your devices easily and securely.

## 🚀 Quick Start Options

### 1️⃣ Local Network (Fastest)
Perfect for transferring between PC and laptop on same WiFi
```bash
npm install
npm run dev
```
Access at `http://your-ip:43214`

### 2️⃣ Cloud Deployment (24/7 Access)
Deploy to Railway for internet access anywhere
```bash
# See RAILWAY_DEPLOY.md for full guide
git push railway main
```
Access at `https://your-app.railway.app`

### 3️⃣ Install as an App (Recommended)
Once it's running (on Railway or locally), install it from the browser. You get its own window, a desktop/Start menu icon, and a home-screen icon on phones.

- **Chrome (Windows/Mac):** click the install icon at the right end of the address bar, or ⋮ → **Cast, save, and share** → **Install page as app**
- **Edge (Windows):** ⋯ → **Apps** → **Install this site as an app**
- **iPhone (Safari):** Share → **Add to Home Screen**
- **Android (Chrome):** ⋮ → **Add to Home screen** → **Install**

The Electron build in `DESKTOP_APP.md` is experimental and not currently working.

## Features

✨ **Easy to Use** - Drag and drop files or click to upload
🚀 **Multiple Deploy Options** - Local, cloud, or desktop app
💾 **Flexible Storage** - Local files or AWS S3
🎨 **Beautiful UI** - Modern, responsive design
📱 **Cross-Platform** - Works on Windows, Mac, Linux
🔒 **Secure** - Local network or private cloud deployment
⚡ **Fast** - Direct transfers, no middle man

## Use Cases

### 👨‍💻 Developer Workflow
- Transfer code between work PC and home laptop
- Share builds with team members
- Quick file sync without git

### 📸 Media Transfer
- Move photos from phone to PC
- Transfer videos between devices
- Backup important files

### 💼 Business
- Share files in office network
- Transfer documents between workstations
- Quick file sharing without email

### 🏠 Home Network
- Share files between family computers
- Transfer media to smart TV
- Central file hub for home devices

## Installation

### Prerequisites
- Node.js 18+ (not needed for desktop app)
- Devices on same network (for local mode)

### Setup
```bash
# Clone or download this repo
git clone <your-repo-url>

# Install dependencies
npm install

# Run in development mode
npm run dev

# Or build for production
npm run build
npm start
```

## Configuration

### Password Protection
Set `NAS_PASSWORD` to require a sign-in before anyone can see, upload, or delete files.

- **Local use:** optional. Without it, anyone on your Wi-Fi can use the app.
- **Railway:** required. Without it, the hosted app stays locked and shows a setup notice.

```bash
# Windows PowerShell
$env:NAS_PASSWORD="choose-a-long-password"; npm run dev

# Mac / Linux / WSL
NAS_PASSWORD=choose-a-long-password npm run dev
```

Sessions last 30 days. Changing the password signs out every device. Five wrong attempts from one IP block sign-in for 15 minutes.

### Local Storage (Default)
No setup needed! Files stored in `/uploads` folder.

### S3 Storage (For Railway)
Create `.env` file:
```env
USE_S3=true
S3_BUCKET_NAME=your-bucket-name
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=your-key
S3_SECRET_ACCESS_KEY=your-secret
```

See `RAILWAY_DEPLOY.md` for detailed S3 setup.

### Desktop App
```bash
# Development
npm run electron-dev

# Build for your platform
npm run electron-build
```

See `DESKTOP_APP.md` for full desktop app guide.

## Usage

### Web Interface

1. **Upload Files**
   - Drag & drop into upload area
   - Or click to browse files
   - Multiple files supported
   - Progress bar shows upload status

2. **Download Files**
   - Click download icon (↓) next to file
   - File downloads to your device

3. **Delete Files**
   - Click trash icon (🗑️) to remove
   - Permanent deletion from storage

### Desktop App

1. **Access from Tray**
   - Right-click tray icon
   - See local and network URLs
   - Open main window or uploads folder

2. **Share Network URL**
   - Copy network URL from tray
   - Open on other devices
   - Transfer files between devices

### API Usage

For automation and integration:

```bash
# Upload file
curl -F "files=@myfile.pdf" http://localhost:43214/api/upload

# List files
curl http://localhost:43214/api/files

# Download file
curl http://localhost:43214/api/download?file=myfile.pdf -o myfile.pdf

# Delete file
curl -X DELETE -H "Content-Type: application/json" \
  -d '{"filename":"myfile.pdf"}' \
  http://localhost:43214/api/delete
```

## Deployment Guides

### 🚂 Railway (Cloud)
**Best for**: 24/7 access from anywhere
- Free tier available
- Optional S3 for persistence
- Custom domain support
- [Full Guide →](RAILWAY_DEPLOY.md)

### 💻 Desktop App
**Best for**: Non-technical users
- No terminal needed
- System tray integration
- Auto-start option
- [Full Guide →](DESKTOP_APP.md)

### 🏠 Self-Hosted
**Best for**: Full control
- Run on your own server
- Raspberry Pi compatible
- Docker support (coming soon)

## Technical Stack

- **Frontend**: Next.js 16, React 19, TypeScript
- **Styling**: Tailwind CSS 4, shadcn/ui
- **Storage**: Local FS or AWS S3
- **Desktop**: Electron
- **Deployment**: Railway, Vercel, Docker

## Project Structure

```
local-nas/
├── app/
│   ├── api/          # API routes
│   │   ├── upload/   # File upload endpoint
│   │   ├── download/ # File download endpoint
│   │   ├── files/    # List files endpoint
│   │   ├── delete/   # Delete file endpoint
│   │   └── server-info/ # Server info endpoint
│   ├── page.tsx      # Main UI
│   └── layout.tsx    # App layout
├── lib/
│   ├── storage.ts    # Storage abstraction
│   └── utils.ts      # Utilities
├── components/ui/    # UI components
├── electron.js       # Desktop app entry
├── uploads/          # Local file storage
├── RAILWAY_DEPLOY.md # Railway deployment guide
├── DESKTOP_APP.md    # Desktop app guide
└── README.md         # This file
```

## Security

### Local Network Mode
- Accessible only on your WiFi
- No internet exposure
- Firewall protection

### Cloud Deployment
- HTTPS encryption
- Private S3 buckets
- Environment variable secrets
- Password sign-in via `NAS_PASSWORD` (required on Railway)

### Desktop App
- Runs entirely local
- No telemetry
- Open source code

## Troubleshooting

### Can't connect from other device?
- Ensure same WiFi network
- Check firewall settings
- Try the IP address shown on screen

### Files not persisting on Railway?
- Use S3 storage (see RAILWAY_DEPLOY.md)
- Or accept ephemeral storage for temp files

### Desktop app won't build?
- Clear node_modules and rebuild
- Check Electron version compatibility
- See DESKTOP_APP.md troubleshooting

### Port already in use?
Edit port in:
- `package.json` scripts
- `electron.js` (for desktop app)

## Roadmap

- [ ] Docker support
- [ ] File encryption
- [x] Password protection
- [ ] Multiple user accounts
- [ ] File sharing links
- [ ] Mobile apps (iOS/Android)
- [ ] File preview (images, PDFs)
- [ ] Folder upload/download
- [ ] File search
- [ ] QR code connection
- [ ] WebRTC direct transfer

## Contributing

Contributions welcome! Ideas:
- Add multiple user accounts
- Implement file preview
- Add drag & drop from desktop
- Create mobile apps
- Improve UI/UX
- Add tests

## Cost Breakdown

| Option | Setup | Monthly | Storage | Speed |
|--------|-------|---------|---------|-------|
| Local Network | Free | Free | Unlimited | Fastest |
| Railway (ephemeral) | Free | Free | Temporary | Fast |
| Railway + S3 | ~$0 | <$1 | 5GB free | Fast |
| Desktop App | Free | Free | Unlimited | Fastest |
| Self-Hosted | ~$5 | ~$5 | Unlimited | Fast |

## Support

- 📖 Read the guides: `RAILWAY_DEPLOY.md`, `DESKTOP_APP.md`
- 🐛 Report issues: GitHub Issues
- 💡 Request features: GitHub Discussions
- 📧 Email: [your-email]

## License

MIT License - Free for personal and commercial use!

## Acknowledgments

- Built with [Next.js](https://nextjs.org)
- UI components from [shadcn/ui](https://ui.shadcn.com)
- Icons from [Lucide](https://lucide.dev)
- Desktop app with [Electron](https://electronjs.org)

---

**Made with ❤️ for easy file transfers**

Start local: `npm run dev` | Deploy cloud: See `RAILWAY_DEPLOY.md` | Build app: See `DESKTOP_APP.md`
