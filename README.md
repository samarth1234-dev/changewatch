# ⌁ changewatch — Intelligent Website Change Detector

> **A modern, full-stack website change detection service.** Built with Next.js, Playwright (Chromium), Express, and Upstash Serverless Redis. Captures high-fidelity full-page screenshots, establishes baseline versions, suppresses dynamic ephemeral noise, and dispatches rich visual/text diff alerts when meaningful content changes occur.

---

## 🌐 Public Access & Live Cloud Submission Links

| Service | Platform | Live URL / Endpoint |
| :--- | :--- | :--- |
| **🚀 Production Web Dashboard** | **Vercel** | [https://changewatch-five.vercel.app](https://changewatch-five.vercel.app) |
| **⚙️ Production Backend API** | **Render** | [https://changewatch-backend.onrender.com](https://changewatch-backend.onrender.com) |
| **📦 GitHub Repository** | **GitHub** | [https://github.com/samarth1234-dev/changewatch](https://github.com/samarth1234-dev/changewatch) |
| **⚡ Message Queue & Cache** | **Upstash** | `rediss://...upstash.io:6379` (Serverless Redis) |
| **🩺 API Health Endpoint** | **Render** | [https://changewatch-backend.onrender.com/health](https://changewatch-backend.onrender.com/health) |

*(The entire system is deployed 100% in the cloud. Evaluators can immediately test the live dashboard on any device without local setup).*

---

## 📌 Core Features & Technical Highlights

1. **Headless Browser Execution (Playwright Chromium)**:
   - Evaluates client-side JavaScript, handles single-page apps (SPAs), dynamic hydration, and captures full-resolution screenshots.
2. **De-duplication & Throttling Queue (BullMQ + Upstash Redis)**:
   - Shares one browser fetch per URL across multiple monitors, with per-domain throttling and randomized jitter to prevent target rate-limiting.
3. **Smart Ephemeral Noise Suppression**:
   - Advanced regex and DOM tree filtering to discard timestamps, relative dates ("3 minutes ago"), follower/view counters, rotating banners, and transient UUID tokens.
4. **Dual Differential Analysis (Text & Pixels)**:
   - **Text Diffing**: Character and word-level diffs via `diff-match-patch` with added/removed metrics.
   - **Visual Pixel Diffing**: High-precision visual pixel difference heatmaps via `pixelmatch` and `pngjs`.
5. **Interactive Visual Region Selector & Chrome Extension**:
   - Point-and-click in-app visual inspector to target specific elements (`#pricing`, `.stock-count`).
   - Packaged Chromium browser extension in [`browser-extension/`](./browser-extension) for 1-click URL monitoring directly from your browser.
6. **Multi-Channel Delivery Engine**:
   - Immediate dispatch via Webhook (Discord/Slack), Telegram Bot, Resend Email, and target-specific RSS feeds (`/api/targets/:id/rss.xml`).
7. **Daily Digest & Number Tracking**:
   - Batch summary digests sent at user-configured hours.
   - Live numerical extraction with SVG sparkline chart history (`NumberChart`).

---

## 🧪 Automated Verification & Testing

An end-to-end automated test suite verifies all system components (API, Redis, Playwright rendering, BullMQ queue, version snapshots, and RSS generation).

To run verification locally:

```bash
# Clone the repository
git clone https://github.com/samarth1234-dev/changewatch.git
cd changewatch

# Run the 9-point verification suite
npm test
```

### Verification Checks Performed:
```
✔ PASS  API Health & Redis — Status OK, Redis: connected
✔ PASS  Next.js Dashboard — HTTP 200 OK at http://localhost:3000
✔ PASS  Monitor Target Creation — Created target ID with selectors and thresholds
✔ PASS  Watchlist Target Retrieval — Found active monitors in data store
✔ PASS  BullMQ Job Enqueue — Enqueued on-demand job with stable URL hash
✔ PASS  Playwright Browser Capture — Rendered page, computed SHA256, saved baseline screenshot
✔ PASS  Version Snapshots — Recorded version history and cryptographic hash
✔ PASS  RSS Feed Endpoint — Generated valid XML RSS channel
✔ PASS  Daily Digest Engine — Triggered batch digest summarization
✔ ALL 9 CHANGEWATCH VERIFICATION CHECKS PASSED!
```

---

## ⚙️ Local Setup Instructions (For Evaluators)

### 1. Prerequisites
- **Node.js**: v20 or higher (`node -v`)
- **Redis**: Running locally on port `6379` (`brew services start redis` or `docker run -d -p 6379:6379 redis`)

### 2. Installation
```bash
# Install backend dependencies & Playwright Chromium
npm --prefix backend install
npx --prefix backend playwright install chromium

# Install frontend dependencies
npm --prefix frontend install
```

### 3. Launching Locally
Launch both the backend API worker and Next.js frontend concurrently with a single command from the project root:

```bash
npm run dev
```

- **Frontend**: `http://localhost:3000`
- **Backend API**: `http://localhost:3001`
- **Redis Queue**: `redis://127.0.0.1:6379`

> **Note on Data Store**: This project uses a zero-friction JSON store (`backend/data/monitor-data.json`) for reproducible reviewer setup without database migrations.

---

## 📂 Project Architecture

```
changewatch/
├── frontend/                 # Next.js 15 + React 19 Frontend (Deployed on Vercel)
│   ├── pages/
│   │   ├── _app.js           # Global layout & styles
│   │   └── index.js          # Glassmorphic dashboard, visual picker & diff reviewer
│   ├── styles/
│   │   └── globals.css       # Responsive, dark-mode glassmorphic theme
│   ├── next.config.js        # Next.js configuration
│   └── package.json
├── backend/                  # Node.js + Express API & Worker (Deployed on Render)
│   ├── src/
│   │   ├── alerts.js         # Webhook, Telegram, Email, and Digest dispatchers
│   │   ├── index.js          # Express REST API routes & scheduler
│   │   ├── monitoring.js     # Playwright capture, text/pixel diffing, noise filtering
│   │   ├── redis.js          # Upstash & local Redis connection pool with TLS
│   │   ├── security.js       # URL validation (SSRF and private IP protections)
│   │   ├── store.js          # File-backed JSON store adapter
│   │   ├── summarizer.js     # Factual text summarization & optional AI integration
│   │   └── services/
│   │       └── worker.js     # BullMQ background worker
│   ├── start.js              # Production fast-bind entrypoint
│   └── package.json          # Playwright, BullMQ, Express dependencies
├── browser-extension/        # Chromium extension for 1-click monitoring
│   ├── manifest.json         # Manifest V3 configuration
│   ├── popup.html            # Extension popup UI
│   └── popup.js              # 1-click monitoring integration
├── scripts/
│   ├── dev.js                # Concurrent launcher for API and Frontend
│   └── test-verification.js  # Automated E2E test suite (`npm test`)
├── render.yaml               # Render Cloud deployment blueprint
├── package.json              # Root orchestration and scripts
└── README.md                 # Complete submission documentation
```
