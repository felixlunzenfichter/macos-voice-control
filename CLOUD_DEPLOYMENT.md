# Cloud Deployment Guide

Complete guide for deploying the voice control backend to Google Cloud Run.

## Prerequisites

### 1. Google Cloud Setup
- Google Cloud account with billing enabled
- Google Cloud CLI installed and configured
- Project with Speech-to-Text API enabled

### 2. Required Tools
- `gcloud` CLI (Google Cloud SDK)
- `git` for version control
- Node.js 18+ for local testing

### 3. Service Account Setup
You need a service account with Speech-to-Text API permissions:

```bash
# List existing service accounts
gcloud iam service-accounts list

# If you need to create one:
gcloud iam service-accounts create speech-to-text-app \
    --display-name="Speech to Text App"

# Grant necessary permissions
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:speech-to-text-app@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/speech.admin"
```

## Backend Code Preparation

### 1. Remove Local Dependencies
The backend must be modified to work in a cloud environment without local file system dependencies.

**Replace logger dependency in `backend/server.js`:**
```javascript
// OLD (local dependency):
const Logger = require('../logs/logger');
const logger = new Logger('backend');

// NEW (cloud-compatible):
const logger = {
  log: (type, message, metadata = {}) => console.log(`LOG | backend | ${type} | ${message}`, metadata),
  error: (type, message, metadata = {}) => console.error(`ERROR | backend | ${type} | ${message}`, metadata)
};
```

**Remove file logging functionality:**
```javascript
// OLD (local file writing):
} else if (message.type === 'log') {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level: message.level || 'LOG',
    service: 'iOS',
    class: message.class || '',
    function: message.function || '',
    message: message.message,
    ...message.metadata
  };
  
  const logLine = JSON.stringify(logEntry) + '\n';
  require('fs').appendFile(require('path').join(__dirname, '../logs/logs.json'), logLine, (err) => {
    if (err) {
      logger.error('onMessage', 'Failed to write iOS log', { error: err.message });
    }
  });
  
  logger.log('onMessage', 'Received iOS log', { level: message.level, message: message.message });

// NEW (cloud logging):
} else if (message.type === 'log') {
  // Log iOS messages to console in Cloud Run
  logger.log('onMessage', 'Received iOS log', { 
    level: message.level, 
    service: 'iOS',
    class: message.class || '',
    function: message.function || '',
    message: message.message 
  });
```

### 2. Verify Dockerfile
Ensure `backend/Dockerfile` is properly configured:

```dockerfile
FROM node:18-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Cloud Run expects port 8080
EXPOSE 8080

# Start the server
CMD ["npm", "start"]
```

### 3. Verify package.json
Ensure `backend/package.json` has correct dependencies:

```json
{
  "name": "speech-transcription-backend",
  "version": "1.0.0",
  "description": "WebSocket backend for Google Cloud Speech-to-Text",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "@google-cloud/speech": "^6.7.1",
    "express": "^4.18.2",
    "node-wav": "^0.0.2",
    "ws": "^8.16.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

## Deployment Steps

### 1. Prepare Environment
```bash
# Navigate to backend directory
cd /path/to/your/project/backend

# Ensure you're logged into the correct Google Cloud project
gcloud config get-value project

# Set project if needed
gcloud config set project YOUR_PROJECT_ID
```

### 2. Deploy to Cloud Run
```bash
# Deploy with service account for Speech API access
gcloud run deploy voice-control-backend \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --service-account=speech-to-text-app@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

**Alternative deployment with more options:**
```bash
# Deploy with additional configuration
gcloud run deploy voice-control-backend \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --service-account=speech-to-text-app@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --memory=1Gi \
  --cpu=1 \
  --max-instances=10 \
  --timeout=3600
```

### 3. Note the Service URL
After successful deployment, you'll get a URL like:
```
https://voice-control-backend-1007452504573.us-central1.run.app
```

## Client Configuration Updates

### 1. Update Mac Server Configuration

**Option A: Update config.json:**
```json
{
  "backendUrl": "wss://YOUR_CLOUD_RUN_URL"
}
```

**Option B: Update .env file:**
```env
# Backend URL - Cloud Run
BACKEND_URL=wss://YOUR_CLOUD_RUN_URL
```

**Important:** The `.env` file takes precedence over `config.json`. Make sure both are updated or remove the `BACKEND_URL` from `.env` to use `config.json`.

### 2. Update iPhone App Configuration

Update both config files with the cloud URL and HTTPS port:

**Debug.xcconfig:**
```
// Backend WebSocket URL for development - Cloud Run
BACKEND_HOST = YOUR_CLOUD_RUN_HOST
BACKEND_PORT = 443
```

**Release.xcconfig:**
```
// Backend WebSocket URL for production - Cloud Run  
BACKEND_HOST = YOUR_CLOUD_RUN_HOST
BACKEND_PORT = 443
```

**Example:**
```
BACKEND_HOST = voice-control-backend-1007452504573.us-central1.run.app
BACKEND_PORT = 443
```

## Deployment and Testing

### 1. Restart Mac Server
```bash
# Kill existing session
tmux kill-session -t mac-server 2>/dev/null

# Start new session with cloud backend
cd /path/to/your/project/mac-server
tmux new-session -d -s mac-server 'npm start'

# Check connection status
tmux capture-pane -t mac-server -p | tail -10
```

**Expected output:**
```
[LOG] Connecting to backend: wss://voice-control-backend-xxx.us-central1.run.app
[LOG] Connected to transcription backend
[LOG] Backend says: { message: 'Ready to transcribe' }
```

### 2. Redeploy iPhone App
```bash
cd "/path/to/your/project/iOS app"
./run-on-iphone.sh
```

**Expected output:**
```
** BUILD SUCCEEDED **
App installed: com.felixlunzenfichter.ClaudeCodeMicrophone
SUCCESS: ClaudeCodeMicrophone is now running on your iPhone!
```

### 3. Test End-to-End Connection
1. **Start voice recording** on iPhone (tilt forward)
2. **Check mac-server logs** for transcription activity:
```bash
tmux capture-pane -t mac-server -p | tail -20
```

**Expected logs:**
```
[LOG] Final transcript: "your spoken text" { transcript: "your spoken text" }
[LOG] Typed successfully
```

## Troubleshooting

### Common Issues

**1. Backend fails to start:**
- Check logs: `gcloud run logs read --service=voice-control-backend`
- Verify service account permissions
- Ensure Speech API is enabled

**2. Mac server can't connect:**
- Verify URL format: `wss://` not `ws://`
- Check firewall/network connectivity
- Verify `.env` vs `config.json` precedence

**3. iPhone app build fails:**
- Verify xcconfig files have correct syntax
- Ensure device is connected and trusted
- Check provisioning profiles

**4. No speech recognition:**
- Verify Google Cloud credentials
- Check Speech API quotas/billing
- Monitor Cloud Run logs for errors

### Monitoring and Logs

**View Cloud Run logs:**
```bash
# Recent logs
gcloud run logs read --service=voice-control-backend

# Follow logs in real-time
gcloud run logs tail --service=voice-control-backend
```

**Check service status:**
```bash
gcloud run services describe voice-control-backend --region=us-central1
```

**Monitor Cloud Run metrics in Google Cloud Console:**
- Request count and latency
- Container instance scaling
- Error rates and status codes

## Security Considerations

### 1. Service Account Permissions
- Use principle of least privilege
- Only grant Speech API permissions needed
- Consider separate service accounts for different environments

### 2. Network Security
- Cloud Run services are HTTPS by default
- WebSocket connections use WSS (encrypted)
- Consider VPC connector for additional isolation

### 3. API Keys and Secrets
- Store sensitive values in Google Secret Manager
- Use IAM for service-to-service authentication
- Rotate service account keys regularly

## Cost Optimization

### 1. Cloud Run Configuration
- Set appropriate CPU and memory limits
- Configure autoscaling (min/max instances)
- Use request-based pricing model

### 2. Speech API Usage
- Monitor transcription minutes
- Implement smart batching if needed
- Consider regional endpoints for lower latency

### 3. Monitoring
- Set up billing alerts
- Monitor usage patterns
- Optimize for your specific traffic patterns

## Scaling Considerations

### 1. Current Architecture
- Single Cloud Run service
- Stateless WebSocket connections
- Auto-scaling based on requests

### 2. Future Improvements
- Add Redis for session management
- Implement connection pooling
- Consider regional deployments
- Add health check endpoints

## Rollback Procedures

### 1. Quick Rollback
```bash
# List revisions
gcloud run revisions list --service=voice-control-backend

# Rollback to previous revision
gcloud run services update-traffic voice-control-backend \
  --to-revisions=REVISION_NAME=100 \
  --region=us-central1
```

### 2. Emergency Fallback
If cloud deployment fails, quickly revert to local deployment:

1. **Update mac-server config back to local:**
```json
{
  "backendUrl": "ws://192.168.1.x:8080"
}
```

2. **Start local backend:**
```bash
cd backend
GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json node server.js
```

3. **Update iPhone app configs back to local IP and redeploy**

This deployment guide provides a complete pathway from local development to production cloud deployment with proper error handling and rollback procedures.