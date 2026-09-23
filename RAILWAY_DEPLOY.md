# Deploying to Railway

Railway runs the app 24/7 and gives it a public HTTPS address. Files are stored on a Railway volume.

## 1. Deploy from GitHub

1. Push this repository to GitHub.
2. On [railway.app](https://railway.app), choose **New Project → Deploy from GitHub repo** and pick the repository.
3. Railway builds with Node 22 (pinned in `package.json`, `.nvmrc`, and `nixpacks.toml`) and starts the app with `npm start`.

## 2. Add a volume

Without a volume, every restart or redeploy wipes uploaded files.

1. Right-click the project canvas → **Volume**, and attach it to the service.
2. Set the mount path to `/data`.

## 3. Set variables on the service

Open the service → **Variables** (not the project's *Shared Variables*, unless you also share them with the service):

| Variable | Value |
| --- | --- |
| `NAS_PASSWORD` | A long password. Required: without it the site shows "No password is set" and stays locked. |
| `UPLOAD_DIR` | `/data` |

Click **Deploy** on the "Apply changes" banner so the variables take effect.

## 4. Get your address

**Settings → Networking → Generate Domain.** Open it, sign in, and install it as an app from your browser if you like.

## Updating

Push to GitHub and Railway redeploys automatically. Files on the volume are kept.

## Notes

- **Cost:** new accounts get trial credit; after that the Hobby plan is about $5/month, plus volume storage.
- **Single instance:** direct-transfer signaling lives in server memory, so keep the service at one replica.
- **Direct transfers don't use Railway bandwidth.** Only the small connection messages go through the server; file bytes flow device to device.
- **Sign-in protection:** after 5 wrong passwords from one IP, sign-in is blocked for 15 minutes. Changing `NAS_PASSWORD` signs out every device.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Build log says `Node.js version ">=20.9.0" is required` | Make sure the latest code (with the Node 22 pin) is pushed, and the service's builder is Nixpacks. |
| Site says "No password is set" | `NAS_PASSWORD` isn't set on the service itself, or the change wasn't deployed. |
| Files disappear after a redeploy | The volume isn't attached at `/data`, or `UPLOAD_DIR` isn't `/data`. |
| "Send directly" never connects | One of the networks blocks direct WebRTC connections. Use a cloud upload instead. |
