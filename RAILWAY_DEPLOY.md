# Railway Deployment Guide

Deploy your Local NAS file transfer system to Railway for 24/7 access from anywhere!

## Option 1: Quick Deploy (Ephemeral Storage)

Files will be lost on restart, but it's free and easy to set up.

### Steps:

1. **Push to GitHub** (if not already done):
   ```bash
   git remote add github https://github.com/yourusername/local-nas.git
   git push github main
   ```

2. **Deploy to Railway**:
   - Go to [railway.app](https://railway.app)
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose this repository
   - Railway will auto-detect Next.js and deploy!

3. **Access Your App**:
   - Railway will provide a public URL (e.g., `your-app.railway.app`)
   - Share this URL to access from anywhere

### Limitations:
- Files are deleted when the app restarts or redeploys (unless you add a Volume, below)
- Railway has no permanent free tier: new accounts get trial credit, then the Hobby plan is about $5/month

### Keeping files with a Railway Volume (simplest)

1. In your Railway service, right-click → **Attach Volume**, mount path `/data`
2. Under **Variables**, add `UPLOAD_DIR=/data`
3. Redeploy. Uploaded files now survive restarts.

## Option 2: Persistent Storage with S3

Files persist forever using Amazon S3.

### Prerequisites:

1. **Create an AWS S3 Bucket**:
   - Go to [AWS S3 Console](https://console.aws.amazon.com/s3)
   - Click "Create bucket"
   - Name it (e.g., `my-nas-files`)
   - Choose a region (e.g., `us-east-1`)
   - Keep default settings and create

2. **Create IAM Access Keys**:
   - Go to [IAM Console](https://console.aws.amazon.com/iam)
   - Users → Add users → Create programmatic access
   - Attach policy: `AmazonS3FullAccess`
   - Save the Access Key ID and Secret Access Key

### Deploy to Railway with S3:

1. **Deploy as in Option 1** first

2. **Add Environment Variables** in Railway:
   - Go to your Railway project
   - Click "Variables"
   - Add these variables:
     ```
     USE_S3=true
     S3_BUCKET_NAME=your-bucket-name
     S3_REGION=us-east-1
     S3_ACCESS_KEY_ID=your-access-key-id
     S3_SECRET_ACCESS_KEY=your-secret-access-key
     ```

3. **Redeploy**:
   - Railway will automatically redeploy with new config
   - Files now persist in S3!

### S3 Costs:
- First 5GB: Free
- Storage: ~$0.023/GB per month
- Transfers: Minimal for personal use
- Estimated: <$1/month for typical use

## Option 3: Local + Railway Hybrid

Run locally for private file transfers, use Railway for remote access.

### Setup:

1. **Local (for home network)**:
   ```bash
   npm run dev
   ```
   Access at `http://your-local-ip:43214`

2. **Railway (for internet access)**:
   Deploy with S3 as described above
   Access at `https://your-app.railway.app`

## Desktop App (Coming Soon)

Turn this into a standalone desktop app with Electron.

### Features:
- System tray icon
- Auto-start with computer
- No terminal needed
- Bundled with Node.js

Want me to create the desktop app version? Let me know!

## Troubleshooting

### Railway Build Fails
```bash
# Make sure package.json is correct
npm run build
```

### S3 Upload Fails
- Check AWS credentials are correct
- Verify bucket name matches
- Ensure IAM user has S3 permissions

### App Won't Start
- Check Railway logs: Project → Deployments → View logs
- Verify all environment variables are set

## Security Recommendations

### For Railway Deployment:

1. **Add Authentication** (optional but recommended):
   - Use environment variable for password
   - Add middleware to check auth

2. **Set Upload Limits**:
   - Add file size limits in API routes
   - Prevent abuse with rate limiting

3. **Use Private Bucket** (if using S3):
   - Keep bucket private
   - Use presigned URLs (already implemented)

## Cost Comparison

| Option | Monthly Cost | Persistent? | Speed |
|--------|-------------|-------------|-------|
| Local Only | $0 | Yes | Fastest |
| Railway (ephemeral) | $0 (free tier) | No | Fast |
| Railway + S3 | <$1 | Yes | Fast |
| Railway Volumes | $5-10 | Yes | Fastest |

## Next Steps

1. Choose your deployment option
2. Follow the setup steps above
3. Test by uploading a file
4. Share the URL with your devices

Need help with any step? Just ask!
