# V380 personal gateway

Private test stack for connecting one owned V380 camera by device ID and exposing video/audio through WebRTC plus PTZ through a token-protected API.

## Components

- `V380Decoder` pinned to commit `0fc25b77d75fbca689dec1f871d3578336a96d21` connects to the V380 cloud relay and exposes private RTSP + control API.
- `MediaMTX` pulls `rtsp://decoder:8554/live` and exposes WHEP/WebRTC.
- `gateway/server.mjs` is the only HTTP service exposed to the browser. It protects status, PTZ, snapshot and WHEP signaling with `GATEWAY_TOKEN`.

Camera credentials are passed only to the decoder container. Do not expose ports 8080 or 8554 publicly.

## Start on a Linux VPS

1. Install Docker Engine with the Compose plugin.
2. Copy this `gateway` directory to the VPS.
3. Copy `.env.example` to `.env` and fill in the camera ID, temporary password, public VPS IP/DNS name, and a long gateway token.
4. Allow inbound TCP 8787 and UDP 8189 in the VPS firewall.
5. Start the stack with Docker Compose from this directory.
6. Open the web console, click **Подключить**, enter `http://VPS_IP:8787` and the gateway token, then run the connection test.

For a published HTTPS console, place the gateway behind HTTPS on a hostname such as `camera-api.example.com`, set `ALLOWED_ORIGIN` to the exact console origin, and keep UDP 8189 routed directly to the VPS.

## Verification order

1. `GET /health` returns `{ "ok": true }` without a token.
2. `GET /api/status` with `Authorization: Bearer …` returns the decoder status.
3. The browser receives tracks from `/whep/live`.
4. POST requests to `/api/ptz/up`, `/down`, `/left`, `/right` move the camera.
5. Leave the stream running for 15–30 minutes and test reconnect after restarting the decoder container.

## Known limits

- The upstream decoder reports testing on two device-version-31 H.264 cameras. Other firmware and H.265 must be verified on the real camera.
- Incoming camera audio is supported when the browser and stream negotiate a compatible codec. Talkback is not included.
- HTTP is suitable only for an initial local/VPS test opened from an HTTP page. A published HTTPS console requires an HTTPS gateway to avoid mixed-content blocking.
