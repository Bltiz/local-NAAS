# Local NAS - Network File Transfer System

A beautiful, modern web-based file transfer system that lets you share files between your PC and laptop over the same local network. Think of it as your personal Dropbox or Google Drive, but everything stays on your local network!

## Features

✨ **Easy to Use** - Drag and drop files or click to upload
🚀 **Fast Transfer** - Direct transfer over your local network, no internet needed
💾 **Any File Type** - Share documents, photos, videos, or any file
🎨 **Beautiful UI** - Modern, responsive design that works on all devices
📱 **Mobile Friendly** - Access from phones, tablets, laptops, or desktops
🔒 **Local Only** - All files stay on your network, no cloud storage

## How It Works

1. **Start the server** on one device (your PC)
2. **Get the network address** displayed on the screen
3. **Open that address** on your laptop's browser
4. **Upload and download** files between devices!

## Getting Started

### Prerequisites

- Node.js 18+ installed on your computer
- Both devices connected to the same WiFi network

### Installation

```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

The server will start at `http://0.0.0.0:43214`

### Usage

#### On Your PC (Server):

1. Run `npm run dev` in this directory
2. Look at the screen - you'll see a **Network Address** like `http://192.168.1.100:43214`
3. Keep this terminal window open to keep the server running

#### On Your Laptop (Client):

1. Open your web browser
2. Type in the network address from your PC (e.g., `http://192.168.1.100:43214`)
3. You'll see the same interface - upload and download files!

### Uploading Files

- Click the upload area or drag & drop files
- Multiple files can be uploaded at once
- Progress bar shows upload status
- Files appear in the "Available Files" section immediately

### Downloading Files

- Click the download icon (↓) next to any file
- File downloads to your device's default download folder

### Deleting Files

- Click the trash icon (🗑️) next to any file
- File is permanently removed from the server

## File Storage

All uploaded files are stored in the `/uploads` directory in this project folder. You can:

- Browse them directly in your file manager
- Back them up manually
- Move them to permanent storage when done

## Network Setup

### Finding Your IP Address

If you need to find your computer's IP address manually:

**Windows:**
```bash
ipconfig
# Look for "IPv4 Address" under your WiFi adapter
```

**Mac/Linux:**
```bash
ifconfig
# or
ip addr show
# Look for inet address under your WiFi interface
```

### Firewall Settings

If you can't connect from your laptop:

**Windows:**
- Windows Defender Firewall → Allow an app
- Add Node.js if not already allowed

**Mac:**
- System Preferences → Security & Privacy → Firewall
- Add Node.js to allowed applications

## Production Use

To run this as a permanent service:

```bash
# Build for production
npm run build

# Start production server
npm start
```

The production server runs on port 43214 by default. To change it, edit `package.json` scripts.

## Tips & Tricks

### Keep Server Running
- Keep the terminal window open on your PC
- Or run in background: `npm run dev &` (Linux/Mac) or use PM2

### Access from Multiple Devices
- The same address works on ALL devices on your network
- Phone, tablet, smart TV - if it has a browser, it works!

### Large Files
- No file size limit built in
- Transfer speed depends on your WiFi speed
- 100MB+ files work perfectly fine

### Security Note
⚠️ This is designed for LOCAL NETWORKS ONLY. Anyone on your WiFi can access it.
- Only run it when you need to transfer files
- Don't expose it to the internet without adding authentication
- Trust all devices on your network

## Troubleshooting

**Can't connect from laptop?**
- Make sure both devices are on the same WiFi network
- Check firewall settings (see above)
- Try using the IP address instead of hostname
- Verify the server is running on your PC

**Files not uploading?**
- Check disk space on the server
- Verify write permissions on `/uploads` folder
- Try smaller files first to test

**Server crashed?**
- Just restart with `npm run dev`
- Your files in `/uploads` are safe

## Future Enhancements

Want to add more features? Ideas:
- Password protection
- File preview (images, PDFs)
- Folder support
- File search
- QR code for easy connection
- Mobile app version

## Technical Stack

- **Next.js 16** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **shadcn/ui** - UI components
- **Node.js File System** - File handling

## License

Free to use for personal projects!

---

**Enjoy your personal local file transfer system!** 🚀
