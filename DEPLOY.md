# Voice Control Cloud Deployment Commands

## Prerequisites
- Google Cloud CLI installed and authenticated
- Project with Speech-to-Text API enabled
- Service account: `id-speech-to-text-app@YOUR_PROJECT_ID.iam.gserviceaccount.com`

## 1. Prepare Backend Code

**Remove local logger dependency in `backend/server.js`:**
```javascript
// Replace this:
const Logger = require('../logs/logger');
const logger = new Logger('backend');

// With this:
const logger = {
  log: (type, message, metadata = {}) => console.log(`LOG | backend | ${type} | ${message}`, metadata),
  error: (type, message, metadata = {}) => console.error(`ERROR | backend | ${type} | ${message}`, metadata)
};
```

**Replace file logging with console logging:**
```javascript
// Replace the entire 'log' message handler with:
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

## 2. Deploy Backend to Cloud Run

```bash
cd backend
gcloud run deploy voice-control-backend \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --service-account=id-speech-to-text-app@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

**Note the service URL from output (example):**
```
https://voice-control-backend-1007452504573.us-central1.run.app
```

## 3. Update Mac Server Configuration

**Update `mac-server/.env`:**
```env
BACKEND_URL=wss://YOUR_CLOUD_RUN_URL
```

**Update `mac-server/config.json`:**
```json
{
  "backendUrl": "wss://YOUR_CLOUD_RUN_URL"
}
```

**Restart mac-server:**
```bash
tmux kill-session -t mac-server 2>/dev/null
cd mac-server
tmux new-session -d -s mac-server 'npm start'
```

## 4. Update iPhone App Configuration

**Update `iOS app/Debug.xcconfig`:**
```
BACKEND_HOST = YOUR_CLOUD_RUN_HOST
BACKEND_PORT = 443
```

**Update `iOS app/Release.xcconfig`:**
```
BACKEND_HOST = YOUR_CLOUD_RUN_HOST
BACKEND_PORT = 443
```

**Redeploy iPhone app:**
```bash
cd "iOS app"
./run-on-iphone.sh
```

## 5. Verify Deployment

**Check mac-server connection:**
```bash
tmux capture-pane -t mac-server -p | tail -10
```

**Expected output:**
```
[LOG] Connecting to backend: wss://voice-control-backend-xxx.us-central1.run.app
[LOG] Connected to transcription backend
```

**Check Cloud Run logs:**
```bash
gcloud run logs read --service=voice-control-backend
```

## Example with Real URL

If your Cloud Run URL is `https://voice-control-backend-1007452504573.us-central1.run.app`:

**Mac server configs:**
```env
BACKEND_URL=wss://voice-control-backend-1007452504573.us-central1.run.app
```

**iPhone app configs:**
```
BACKEND_HOST = voice-control-backend-1007452504573.us-central1.run.app
BACKEND_PORT = 443
```

## Deployment Complete

All components now connect through the cloud backend with a fixed, reliable address.