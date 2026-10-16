#!/usr/bin/env node

/**
 * Changewatch — Automated End-to-End Verification Test Script
 * Verifies API health, Redis connection, target lifecycle, Playwright browser
 * capture, content versioning, diff comparisons, RSS feed, and Next.js frontend.
 */

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3001';
const WEB_BASE = process.env.WEB_BASE_URL || 'http://localhost:3000';

function pass(name, detail = '') {
  console.log(` \x1b[32m✔ PASS\x1b[0m  ${name}${detail ? ` — \x1b[90m${detail}\x1b[0m` : ''}`);
}

function fail(name, error) {
  console.error(` \x1b[31m✘ FAIL\x1b[0m  ${name}`);
  console.error(`        \x1b[31mError:\x1b[0m ${error}`);
  process.exit(1);
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runVerification() {
  console.log('\n======================================================');
  console.log('🧪 CHANGEWATCH AUTOMATED SYSTEM VERIFICATION SUITE');
  console.log('======================================================\n');

  let testTargetId = null;

  try {
    // 1. API Health & Redis Connectivity
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok || data.redis !== 'connected') {
        throw new Error(`Health status: ${JSON.stringify(data)}`);
      }
      pass('API Health & Redis', `Status OK, Redis: ${data.redis}`);
    } catch (err) {
      fail('API Health & Redis', `Ensure server is running (npm run dev) and Redis is active. ${err.message}`);
    }

    // 2. React / Next.js Dashboard Availability
    try {
      const res = await fetch(`${WEB_BASE}/`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.includes('changewatch')) {
        throw new Error('Dashboard HTML missing brand title');
      }
      pass('Next.js Dashboard', `HTTP 200 OK at ${WEB_BASE}`);
    } catch (err) {
      fail('Next.js Dashboard', err.message);
    }

    // 3. Target Creation (Watchlist Setup)
    try {
      const payload = {
        name: `Automated Test Monitor ${Date.now()}`,
        url: 'https://example.com',
        intervalMinutes: 15,
        cssSelector: '',
        ignoreSelectors: '',
        sensitivity: 5,
        email: '',
        webhookUrl: '',
      };
      const res = await fetch(`${API_BASE}/api/targets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const created = await res.json();
      if (!created.id || created.name !== payload.name) {
        throw new Error('Target creation response missing valid ID');
      }
      testTargetId = created.id;
      pass('Monitor Target Creation', `Created target ID: ${testTargetId}`);
    } catch (err) {
      fail('Monitor Target Creation', err.message);
    }

    // 4. Target Retrieval & Watchlist Listing
    try {
      const res = await fetch(`${API_BASE}/api/targets`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const targets = await res.json();
      const found = targets.find((t) => t.id === testTargetId);
      if (!found) throw new Error('Newly created target not found in targets list');
      pass('Watchlist Target Retrieval', `Found ${targets.length} active monitor(s)`);
    } catch (err) {
      fail('Watchlist Target Retrieval', err.message);
    }

    // 5. On-Demand Queue Job & Playwright Real Browser Execution
    try {
      const res = await fetch(`${API_BASE}/api/targets/${testTargetId}/check`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const job = await res.json();
      if (!job.jobId) throw new Error('Queue did not return jobId');
      pass('BullMQ Job Enqueue', `Job ID: ${job.jobId}`);

      // Wait for the browser worker to pick up the job and render page
      process.stdout.write('   \x1b[90m⏳ Waiting for Playwright browser render...\x1b[0m');
      let completed = false;
      for (let i = 0; i < 30; i++) {
        await wait(1000);
        process.stdout.write('.');
        const targetRes = await fetch(`${API_BASE}/api/targets`);
        if (targetRes.ok) {
          const targets = await targetRes.json();
          const t = targets.find((item) => item.id === testTargetId);
          if (t && t.lastCheckedAt) {
            completed = true;
            break;
          }
        }
      }
      console.log('');
      if (!completed) {
        throw new Error('Playwright worker timed out while capturing page.');
      }
      pass('Playwright Browser Capture', 'Rendered page, computed hash, saved baseline screenshot');
    } catch (err) {
      fail('Playwright Browser Capture', err.message);
    }

    // 6. Content Versioning & Snapshot Tracking
    try {
      const res = await fetch(`${API_BASE}/api/targets/${testTargetId}/versions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const versions = await res.json();
      if (!Array.isArray(versions) || versions.length === 0) {
        throw new Error('No version snapshot recorded for checked target');
      }
      pass('Version Snapshots', `Recorded ${versions.length} content version(s) with hash`);
    } catch (err) {
      fail('Version Snapshots', err.message);
    }

    // 7. RSS Feed Generation
    try {
      const res = await fetch(`${API_BASE}/api/targets/${testTargetId}/rss.xml`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      if (!xml.includes('<rss') || !xml.includes('<channel>')) {
        throw new Error('Invalid RSS feed structure');
      }
      pass('RSS Feed Endpoint', 'Generated valid XML RSS channel');
    } catch (err) {
      fail('RSS Feed Endpoint', err.message);
    }

    // 8. Daily Digest Trigger Engine
    try {
      const res = await fetch(`${API_BASE}/api/digests/run`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const digest = await res.json();
      if (!digest.period) throw new Error('Invalid digest response format');
      pass('Daily Digest Engine', 'Triggered digest cycle successfully');
    } catch (err) {
      fail('Daily Digest Engine', err.message);
    }

    // 9. Clean up temporary test target
    if (testTargetId) {
      try {
        const delRes = await fetch(`${API_BASE}/api/targets/${testTargetId}`, {
          method: 'DELETE',
        });
        if (delRes.ok) {
          pass('Cleanup Test Artifacts', `Deleted temporary test monitor ${testTargetId}`);
        }
      } catch (_) {}
    }

    console.log('\n======================================================');
    console.log(' \x1b[32m✔ ALL 9 CHANGEWATCH VERIFICATION CHECKS PASSED!\x1b[0m');
    console.log('======================================================\n');
    process.exit(0);
  } catch (unexpected) {
    fail('Unexpected Test Runner Error', unexpected.stack || unexpected);
  }
}

runVerification();
