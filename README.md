# Video Delay (Safari-safe)

Minimal, reliable video delay web app that works on iOS/Safari by using a canvas ring buffer (no MediaRecorder/MSE).

## Files
- `index.html` – UI + canvas + hidden `<video>`
- `script.js` – logic for camera capture, buffering, and playback
- `.nojekyll` – prevents Jekyll from trying to process the repo on GitHub Pages

## Run over HTTPS (GitHub Pages)
1. Create a repo (e.g., `video-delay`).
2. Upload these three files to the repo root.
3. In **Settings → Pages**, set:
   - **Source**: `main`
   - **Folder**: `/ (root)`
4. Wait ~30s, then open:
   `https://<your-username>.github.io/<repo-name>/`

Tap **Start**, allow camera. You’ll see the canvas display your camera with the selected delay (default 12s).

## Notes for iOS
- iOS blocks camera on `file://` and other non-secure contexts. Use HTTPS.
- The app uses `playsinline` and `muted` to satisfy iOS autoplay rules.
- If `createImageBitmap` isn’t available, it falls back to canvas snapshots.
- Target FPS is adjustable to reduce CPU if needed.
