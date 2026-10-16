# ⌁ changewatch — Website Change Detector

> **A full-stack, intelligent web page monitoring service.** Renders public web pages using a real Playwright headless browser, establishes baselines, intelligently filters dynamic noise, and dispatches rich visual/text diff alerts only when meaningful content changes occur.

---

## 📌 Project Overview

**changewatch** was designed to solve the problem of noisy web monitoring by combining real browser rendering with advanced noise-suppression and differential analysis:

- **Real Browser Execution**: Uses Playwright (Chromium) to execute JavaScript, bypass client-side rendering traps, and capture high-fidelity full-page screenshots.
- **De-duplication & Throttling**: Shares one browser fetch per URL across multiple monitors, with per-domain throttling and randomized jitter to prevent rate-limiting.
- **Smart Noise Filters**: Filters out ephemeral noise (timestamps, dates, follower/view counters, rotating banners, and transient UUID tokens) so alerts only fire on genuine content edits.
- **Version Timeline & Visual Diffs**: Maintains version history with side-by-side text diffs (via `diff-match-patch`) and pixel-level screenshot diff overlays (via `pixelmatch`).
- **Multi-Channel Alerts**: Webhooks (Discord/Slack), Telegram, Resend Email, and RSS feed endpoints per target.
- **Interactive Visual Selector & Chrome Extension**: In-app point-and-click visual region picker and lightweight Chromium extension for 1-click URL monitoring.

---

## 🌐 Public Access & Live Evaluation Links

- **🚀 Live Deployed Web Dashboard (Public HTTPS)**: [https://c4321f92b238da.lhr.life](https://c4321f92b238da.lhr.life)
- **📦 GitHub Repository**: [https://github.com/samarth1234-dev/changewatch](https://github.com/samarth1234-dev/changewatch)
- **⚡ Vercel Deployment**: [https://changewatch-web.vercel.app](https://changewatch-web.vercel.app)
- **Local Dashboard**: [http://localhost:3000](http://localhost:3000)
- **API Health Endpoint**: [http://localhost:3001/health](http://localhost:3001/health)
- **Target Watchlist API**: [http://localhost:3001/api/targets](http://localhost:3001/api/targets)

*(Evaluators can immediately open the live public link above to interact with the responsive glassmorphic dashboard, trigger real-time Playwright checks, view pixel/text diffs, and inspect version timelines).*

---

## ⚙️ Setup Instructions for Code Submissions

### 1. Prerequisites
- **Node.js**: v20 or higher (`node -v`)
- **Redis**: Running locally on port `6379`
  ```bash
  # macOS (Homebrew)
  brew services start redis
  # Linux (Ubuntu/Debian)
  sudo systemctl start redis-server
  ```

### 2. Installation
Clone the repository and install dependencies for both frontend and backend:

```bash
cd "/Users/samarthsingh/Documents/New project"

# Install backend dependencies & Playwright Chromium
npm --prefix backend install
npx --prefix backend playwright install chromium

# Install frontend dependencies
npm --prefix frontend install
```

### 3. Running the Service
Launch both the backend API worker and Next.js frontend concurrently with a single command from the project root:

```bash
npm run dev
```

- **Frontend**: `http://localhost:3000`
- **Backend API**: `http://localhost:3001`
- **Redis Queue**: `redis://127.0.0.1:6379`

> **Note on Data Store**: Do **not** run Prisma commands. This project intentionally uses an embedded zero-friction JSON store (`backend/data/monitor-data.json`) for effortless reviewer setup and reproducible evaluation.

---

## 🧪 Automated Verification & Testing

An end-to-end automated test suite is included to verify all core system components (API, Redis, Playwright rendering, BullMQ queue, version snapshots, and RSS generation).

Run the verification test suite anytime with:

```bash
npm test
```

### Verification Checks Performed:
1. **API Health & Redis**: Asserts API responsiveness and active Redis connection.
2. **Next.js Dashboard**: Verifies HTTP 200 and client-side page rendering.
3. **Monitor Target Creation**: Validates target registration with selectors and sensitivity thresholds.
4. **Watchlist Retrieval**: Confirms in-memory/JSON persistence and retrieval.
5. **BullMQ Job Queue & Playwright Render**: Enqueues an on-demand check, launches headless Chromium, and captures page text and baseline screenshot.
6. **Version Snapshots**: Verifies cryptographic content hashing and version history creation.
7. **RSS Feed Generation**: Confirms valid XML RSS channel creation.
8. **Daily Digest Engine**: Tests batch digest summarization and dispatching.
9. **Automated Cleanup**: Removes test artifacts after completion.

---

## 📂 Project Structure

```
├── backend/
│   ├── data/                 # JSON database and screenshot artifacts
│   ├── src/
│   │   ├── alerts.js         # Webhook, Telegram, Email, and Digest dispatchers
│   │   ├── index.js          # Express REST API routes & scheduler
│   │   ├── monitoring.js     # Playwright capture, text/pixel diffing, noise filtering
│   │   ├── redis.js          # Redis connection pool & options
│   │   ├── security.js       # URL validation (SSRF and private IP protections)
│   │   ├── store.js          # File-backed JSON store adapter
│   │   ├── summarizer.js     # Factual text summarization & optional AI integration
│   │   └── services/
│   │       └── worker.js     # BullMQ background worker
│   ├── start.js              # Fast-bind entrypoint for API and worker
│   └── package.json          # Backend dependencies
├── frontend/
│   ├── pages/                # Next.js React pages (Interactive Dashboard)
│   ├── styles/               # Glassmorphic, responsive CSS styles
│   └── package.json          # Frontend dependencies
├── browser-extension/        # Chromium extension for 1-click URL monitoring
├── scripts/
│   ├── dev.js                # Concurrent launcher for API and Frontend
│   └── test-verification.js  # Automated E2E test suite (`npm test`)
├── package.json              # Root orchestration and scripts
└── README.md                 # Submission documentation
```

---

## 🚀 Deployment Guide (Production)

For deploying to production environments:
1. **Frontend**: Deploy `frontend/` to **Vercel** or **Netlify** (`npm run build`). Set `NEXT_PUBLIC_API_URL` to your backend domain.
2. **Backend API & Worker**: Deploy `backend/` to **Railway**, **Render**, or a **Docker** container with persistent volume for `data/`.
3. **Queue**: Provision a managed Redis instance (e.g. **Upstash** or **Redis Cloud**) and set `REDIS_URL`.
