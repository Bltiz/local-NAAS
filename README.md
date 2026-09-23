# Local NAS

A private file hub you run yourself. Upload files and whole folders to your own server, browse and search them, preview them in the browser, optionally encrypt them end to end, and send files straight from one device to another over WebRTC.

Built with Next.js 16, React 19, TypeScript, Tailwind CSS 4, and shadcn/ui. Deploys to Railway with a persistent volume.

## Features

- **Folder uploads that keep everything.** Pick or drag in whole folders. Subfolders, empty folders, hidden files (like `.env`), and non-English names are all preserved. Nothing is zipped.
- **Fast, safe uploads.** Files upload in 8 MB chunks, 6 files at a time. Every chunk is checked with SHA-256 on the server, failed chunks retry automatically, and an interrupted large file resumes where it stopped. Existing files are never overwritten; clashes become `name (1)`.
- **Browse and search.** Folder navigation with breadcrumbs, plus instant search by name across every folder.
- **Preview.** Images, video and audio (with seeking), PDFs, and text or code files open right in the app.
- **End-to-end encryption (optional).** Turn it on with a passphrase and files are encrypted in your browser (AES-256-GCM) before they upload. The server only stores scrambled data. Encrypted files can still be previewed and downloaded after you unlock them.
- **Send directly (WebRTC).** Any device with the app open appears under **Send directly**. Files go device to device without touching the server, which is the fastest option on the same Wi-Fi.
- **Download whole folders.** In Chrome or Edge on a computer, "Download folder" writes the full folder structure to a location you choose.
- **Password protected.** One password (`NAS_PASSWORD`) guards everything. Installable as an app from Chrome, Edge, or Safari.

## Run it locally

Requires Node.js 22.

```bash
npm install
npm run dev
```

Open http://localhost:43214. Other devices on your Wi-Fi can use `http://<this-computer's-IP>:43214`.

To require a password locally:

```bash
# Mac / Linux / WSL
NAS_PASSWORD=choose-a-long-password npm run dev

# Windows PowerShell
$env:NAS_PASSWORD="choose-a-long-password"; npm run dev
```

Without `NAS_PASSWORD`, anyone on your network can use it. Files are stored in `./uploads` unless you set `UPLOAD_DIR`.

## Deploy to Railway

See [RAILWAY_DEPLOY.md](RAILWAY_DEPLOY.md). In short: deploy from GitHub, attach a volume at `/data`, and set these variables on the service:

| Variable | Value |
| --- | --- |
| `NAS_PASSWORD` | Your sign-in password (required; the app stays locked without it) |
| `UPLOAD_DIR` | `/data` (the volume mount path, so files survive restarts) |

## Install it as an app

Open your site, sign in, then:

- **Chrome:** click **Install** at the right end of the address bar.
- **Edge:** ⋯ → **Apps** → **Install this site as an app**.
- **iPhone (Safari):** Share → **Add to Home Screen**.
- **Android (Chrome):** ⋮ → **Add to Home screen** → **Install**.

## How the pieces work

**Uploads.** The browser sends each file in 8 MB chunks with a SHA-256 checksum header to `PUT /api/upload`. The server appends chunks in order to a temporary file under `.nas-system/parts/`, rejects any chunk whose checksum or position is wrong, and moves the finished file into place in one step. Half-uploaded files never appear in your file list.

**Encryption.** Your passphrase is stretched with PBKDF2-SHA256 (600,000 rounds), and each file gets its own key. Files are split into 8 MB blocks, each sealed with AES-256-GCM; the last block is marked so a cut-short file is detected. The passphrase stays in the browser tab and is forgotten when the tab closes. There is no recovery if you forget it. File and folder **names** are not encrypted.

**Direct transfer.** Each open tab registers over a server-sent event stream (`/api/rtc/events`). When you send, the two browsers exchange connection details through the server and then open a WebRTC data channel between themselves. Files stream in order with flow control, the receiver writes straight to disk (Chrome/Edge) or downloads each file (other browsers), and each file's byte count is verified. The badge shows the path: **Same network**, **Direct over internet**, or **Relayed**. Some strict networks (certain mobile carriers and office Wi-Fi) block direct connections; use a cloud upload in that case.

## Project layout

```
app/
  page.tsx               Main screen (files, uploads, Send directly)
  login/page.tsx         Sign-in screen
  api/files              List (GET), new folder (POST), delete (DELETE)
  api/upload             Chunked upload (PUT), resume status (GET), cancel (DELETE)
  api/download           Download and preview with Range support
  api/rtc/events         Device presence and signaling stream (SSE)
  api/rtc/signal         Relay a WebRTC message to another device
  api/login, logout, auth-status
components/nas/          File browser, preview, uploads, devices, encryption UI
lib/storage.ts           Safe paths, chunk writes, listing, range reads
lib/auth.ts              Password sessions
lib/signal.ts            In-memory signaling hub
lib/client/              Browser code: upload engine, crypto, downloads, WebRTC, folder picking
proxy.ts                 Redirects signed-out visitors to /login
```

## Limits

- Signaling is kept in memory, so run a single server instance (the Railway default).
- Search matches file and folder names, not file contents.
- Encrypted file previews are limited to 1 GB; download larger ones instead.
- The Electron desktop build (`DESKTOP_APP.md`, `electron.js`) is experimental and not currently working. Install the web app instead.

## Support

Questions or problems: [vxxtwo@gmail.com](mailto:vxxtwo@gmail.com)
