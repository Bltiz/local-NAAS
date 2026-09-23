# Local NAS

A private file hub you run yourself, in two places that work together:

- **Server:** runs 24/7 on Railway, reachable from anywhere.
- **Local:** runs on your Windows PC and shares a folder you choose (for example your Projects folder) straight from disk, at Wi-Fi speed, with no copying. It can back that folder up to the server automatically.

Built with Next.js 16, React 19, TypeScript, Tailwind CSS 4, and shadcn/ui.

## Features

- **Folder uploads that mirror your PC.** Pick or drag in whole folders. Structure, empty folders, hidden files like `.env`, `.git` history, and non-English names are all kept. Uploading a folder that already exists merges into it: unchanged files are skipped, changed files replace the old version (which goes to Trash), and nothing is ever duplicated as `name (1)`.
- **Fast with huge folders.** A summary appears before anything uploads, with new, changed, and unchanged counts, total size, a free-space check, and a time estimate. Small files travel hundreds at a time in one request and are unpacked into normal files on the NAS, every file checksum-verified. Large files go in resumable 8 MB chunks. Re-dropping a folder after an interruption only sends what's missing.
- **Rebuildable folders are your choice.** `node_modules`, `.next`, `dist`, `venv` and similar folders are detected and listed with their size. They're included by default, and one switch skips them.
- **Trash.** Deleted files and replaced old versions are kept for 30 days and can be restored. Deleting shows an Undo button.
- **Browse, search, preview.** Folder navigation, instant search by name across every folder, and previews for images, video, audio, PDFs, and text or code.
- **Storage view.** Space used per folder, the disk or volume capacity, and a warning if Railway isn't storing files on a volume.
- **End-to-end encryption (optional).** Files are encrypted in the browser (AES-256-GCM) before upload.
- **Send directly (WebRTC).** Device to device with no server in between; fastest on the same Wi-Fi.
- **Server/Local switch.** One click in the header moves between your Railway server and your PC's local NAS.
- **Automatic backup (local → server).** Your PC keeps a copy of its shared folder on the server: only new and changed files, a few seconds after they change and every 5 minutes. Files deleted on the PC go to the server's Trash. Nothing on the PC is ever deleted by the backup.
- **Password protected** and installable as an app.

## Run the local NAS on Windows

1. **Install Node.js** (once). Open PowerShell and run:

   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```

2. **Get the code onto Windows**, not WSL: WSL's networking hides servers from your laptop, and reading Windows folders from WSL is slow. Either:
   - download the ZIP from GitHub (**Code → Download ZIP**) and extract it to a folder such as `C:\LocalNAS`, or
   - with Git for Windows: `git clone https://github.com/Bltiz/local-NAAS.git C:\LocalNAS`

3. **Double-click `Start Local NAS.bat`.** The first time it asks:
   - which folder to share (your files stay where they are),
   - a password for signing in,
   - a name for this PC.

   It then installs and builds (a minute or two the first time), starts the NAS, opens it in your browser, and prints the address for your laptop, such as `http://192.168.1.20:43214`.

4. When Windows asks whether Node.js may use the network, allow **Private networks**.

Keep the window open while you want the NAS running. To change the folder or password later, run `Start Local NAS.bat -Setup` from a terminal. Settings are saved in `local-nas.config.json` next to the launcher, which is not committed to Git.

The app keeps its own data (Trash, backup settings, partial uploads) in a hidden `.nas-system` folder inside the shared folder.

### Back up the local NAS to the server

On the PC's NAS page, fill in **Backup to server**: your Railway address, the server's password, and the folder name to use on the server (defaults to the PC's name). The first backup starts right away. After that the PC appears in the server's location menu as **Online**, with its Wi-Fi address.

Safety: if the shared folder ever looks empty (for example an unplugged drive), backup pauses instead of mirroring that. It also refuses to remove more than half of the server copy in one run.

## Run it on a Mac, Linux, or in development

```bash
npm install
npm run dev                                                # server mode, files in ./uploads
NAS_MODE=local UPLOAD_DIR=~/Projects NAS_PASSWORD=pick-one npm run dev   # local mode
```

Open http://localhost:43214.

## Deploy the server to Railway

See [RAILWAY_DEPLOY.md](RAILWAY_DEPLOY.md). In short: deploy from GitHub, attach a volume, and set `NAS_PASSWORD` on the service. The volume is detected automatically. You can also set `UPLOAD_DIR` to its mount path.

## Settings

| Variable | Where | Meaning |
| --- | --- | --- |
| `NAS_PASSWORD` | both | Sign-in password. Required on Railway; the app stays locked without it. |
| `UPLOAD_DIR` | both | Folder to store or share. Defaults to the Railway volume, else `./uploads`. |
| `NAS_MODE` | local | `local` turns on local mode (file watching, backup, PC name). The launcher sets it. |
| `NAS_NAME` | local | Name shown for the PC. |
| `PORT` | both | Port, default `43214`. |

## Install it as an app

Open it, sign in, then in Chrome click **Install** in the address bar (Edge: ⋯ → Apps → Install this site as an app; iPhone: Share → Add to Home Screen). Install both the server and the local NAS if you like; each is its own app.

## How it works

- **Uploads:** small files are packed into one request (`PUT /api/upload/batch`) with a SHA-256 checksum per file. Large files go through `PUT /api/upload` in 8 MB chunks, which resume after interruptions. Files are written to `.nas-system/parts` first and moved into place only once complete. The original modified date is kept, which is how unchanged files are recognized later. Same-size files with different dates are compared by checksum (`POST /api/files/match`).
- **Trash:** replaced and deleted items move to `.nas-system/trash` with a small record of where they came from.
- **Index:** the server keeps an in-memory index of all files so listing 100,000+ files is instant. In local mode a file watcher keeps it current when you change files outside the app.
- **Backup:** the local NAS compares its index with the server's list, then uses the same batch, chunk, and match endpoints with the server password's session. It announces itself to the server (`POST /api/instances`) so the server can show it in the location menu.
- **Encryption:** PBKDF2-SHA256 (600,000 rounds) plus AES-256-GCM in 8 MB blocks. The passphrase stays in the browser tab. Names aren't encrypted, and backups made by the local NAS are not end-to-end encrypted.
- **Direct transfer:** presence and signaling over server-sent events (`/api/rtc/events`), then a WebRTC data channel between browsers.

## Limits

- The switch opens the other location's page rather than swapping in place, because browsers block a secure `https://` page from calling an `http://` address on your home network.
- Local addresses only work on the same Wi-Fi as the PC.
- Signaling and the index live in memory, so run one server instance (the Railway default).
- Search matches names, not file contents.

## Support

Questions or problems: [vxxtwo@gmail.com](mailto:vxxtwo@gmail.com)
