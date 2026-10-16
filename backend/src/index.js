const express = require('express');
const cors = require('cors');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
// Load only the queue primitive. BullMQ's root entry point eagerly loads every
// optional backend, which makes local cold starts unnecessarily slow.
const { Queue } = require('bullmq/dist/cjs/classes/queue');
require('dotenv').config();
const { redisConnectionOptions } = require('./redis');
const {
  createTarget,
  deleteTarget,
  getHistories,
  getNotifications,
  getTarget,
  getTargets,
  getVersion,
  getVersions,
  getStats,
  updateTarget,
} = require('./store');
const { validatePublicUrl } = require('./security');
const { runDailyDigests } = require('./alerts');

const PORT = Number(process.env.PORT || 3001);
const DATA_DIR = path.join(__dirname, '..', 'data');
const app = express();
let monitorQueue;
let redisStatus = 'starting';

function getMonitorQueue() {
  if (monitorQueue) return monitorQueue;
  monitorQueue = new Queue('website-monitor', {
    connection: redisConnectionOptions(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      // A URL has one in-flight job at a time. Completed jobs are removed so the
      // next scheduled/manual check can reuse the stable job id.
      removeOnComplete: true,
      removeOnFail: true,
    },
  });
  monitorQueue.waitUntilReady()
    .then(() => { redisStatus = 'connected'; })
    .catch(() => { redisStatus = 'unavailable'; });
  return monitorQueue;
}

fs.mkdirSync(DATA_DIR, { recursive: true });
app.use(cors({ origin: true }));
app.use(express.json({ limit: '100kb' }));
app.use('/files', express.static(DATA_DIR));

function asPublicTarget(target) {
  if (!target) return null;
  const { lastText, ...safeTarget } = target;
  return safeTarget;
}

function asPublicVersion(version) {
  if (!version) return null;
  const { text, ...safeVersion } = version;
  return safeVersion;
}

const toBoolean = (value) => value === true || value === 'true';
const xml = (value) => String(value || '').replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]);

async function parseTargetInput(input) {
  const url = String(input.url || '').trim();
  const intervalMinutes = Number(input.intervalMinutes);
  const sensitivity = Number(input.sensitivity ?? 5);
  const alertCooldownMinutes = Number(input.alertCooldownMinutes ?? 0);
  const dailyDigestHour = Number(input.dailyDigestHour ?? 9);

  if (!String(input.name || '').trim()) throw new Error('A monitor name is required.');
  await validatePublicUrl(url);
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 15 || intervalMinutes > 1_440) {
    throw new Error('Check interval must be between 15 minutes and 24 hours.');
  }
  if (!Number.isFinite(sensitivity) || sensitivity < 0 || sensitivity > 100) {
    throw new Error('Sensitivity must be between 0 and 100.');
  }
  if (!Number.isInteger(alertCooldownMinutes) || alertCooldownMinutes < 0 || alertCooldownMinutes > 1_440) {
    throw new Error('Alert cooldown must be between 0 and 1,440 minutes.');
  }
  if (!Number.isInteger(dailyDigestHour) || dailyDigestHour < 0 || dailyDigestHour > 23) {
    throw new Error('Daily digest hour must be between 0 and 23.');
  }

  return {
    name: String(input.name).trim().slice(0, 100),
    url,
    intervalMinutes,
    cssSelector: String(input.cssSelector || '').trim(),
    ignoreSelectors: String(input.ignoreSelectors || '').trim(),
    sensitivity,
    webhookUrl: String(input.webhookUrl || '').trim(),
    email: String(input.email || '').trim(),
    telegramChatId: String(input.telegramChatId || '').trim(),
    keywordFilters: String(input.keywordFilters || '').trim(),
    numberSelector: String(input.numberSelector || '').trim(),
    alertCooldownMinutes,
    dailyDigest: toBoolean(input.dailyDigest),
    dailyDigestHour,
    aiSummaryEnabled: toBoolean(input.aiSummaryEnabled),
  };
}

async function enqueueUrl(url, reason = 'scheduled') {
  const jobId = `url-${crypto.createHash('sha256').update(url).digest('hex')}`;
  const queue = getMonitorQueue();
  const existing = await queue.getJob(jobId);
  if (existing) return existing;
  return queue.add('check-url', { url, reason }, { jobId });
}

async function enqueueDueTargets() {
  const now = Date.now();
  const dueUrls = new Set(
    getTargets()
      .filter((target) => target.active && (!target.nextCheckAt || new Date(target.nextCheckAt).getTime() <= now))
      .map((target) => target.url),
  );
  await Promise.all([...dueUrls].map((url) => enqueueUrl(url)));
}

app.get('/health', async (_req, res) => {
  // Do not make the dashboard wait on a cold queue connection. The worker and
  // enqueue route surface Redis errors normally; this endpoint remains useful
  // during application startup.
  res.json({ ok: true, redis: redisStatus, stats: getStats() });
});

app.get('/api/dashboard', (_req, res) => res.json(getStats()));
app.get('/api/targets', (_req, res) => res.json(getTargets().map(asPublicTarget)));

app.post('/api/targets', async (req, res, next) => {
  try {
    const target = createTarget(await parseTargetInput(req.body));
    await enqueueUrl(target.url, 'new-target');
    res.status(201).json(asPublicTarget(target));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/targets/:id', async (req, res, next) => {
  try {
    const current = getTarget(req.params.id);
    if (!current) return res.status(404).json({ error: 'Monitor not found.' });
    const input = await parseTargetInput({ ...current, ...req.body });
    const target = updateTarget(req.params.id, {
      ...input,
      active: typeof req.body.active === 'boolean' ? req.body.active : current.active,
      nextCheckAt: req.body.active === true ? new Date().toISOString() : current.nextCheckAt,
    });
    if (target.active) await enqueueUrl(target.url, 'updated-target');
    res.json(asPublicTarget(target));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/targets/:id', (req, res) => {
  if (!deleteTarget(req.params.id)) return res.status(404).json({ error: 'Monitor not found.' });
  res.status(204).end();
});

app.post('/api/targets/:id/check', async (req, res) => {
  const target = getTarget(req.params.id);
  if (!target) return res.status(404).json({ error: 'Monitor not found.' });
  try {
    const job = await enqueueUrl(target.url, 'manual');
    res.status(202).json({ jobId: job.id, message: 'Check queued.' });
  } catch (error) {
    res.status(503).json({ error: 'Redis is unavailable. Start Redis, then try again.', detail: error.message });
  }
});

app.get('/api/targets/:id/history', (req, res) => {
  if (!getTarget(req.params.id)) return res.status(404).json({ error: 'Monitor not found.' });
  res.json(getHistories(req.params.id));
});

app.get('/api/targets/:id/versions', (req, res) => {
  if (!getTarget(req.params.id)) return res.status(404).json({ error: 'Monitor not found.' });
  res.json(getVersions(req.params.id).map(asPublicVersion));
});

app.get('/api/targets/:id/compare', (req, res) => {
  const { id } = req.params;
  if (!getTarget(id)) return res.status(404).json({ error: 'Monitor not found.' });
  const left = getVersion(id, String(req.query.left || ''));
  const right = getVersion(id, String(req.query.right || ''));
  if (!left || !right) return res.status(400).json({ error: 'Choose two valid versions to compare.' });
  const { compareVersions } = require('./monitoring');
  res.json(compareVersions(left, right));
});

app.get('/api/targets/:id/number-series', (req, res) => {
  if (!getTarget(req.params.id)) return res.status(404).json({ error: 'Monitor not found.' });
  res.json(getHistories(req.params.id)
    .filter((entry) => Number.isFinite(entry.numberValue))
    .map((entry) => ({ checkedAt: entry.checkedAt, value: entry.numberValue, raw: entry.numberRaw }))
    .reverse());
});

app.get('/api/targets/:id/notifications', (req, res) => {
  if (!getTarget(req.params.id)) return res.status(404).json({ error: 'Monitor not found.' });
  res.json(getNotifications(req.params.id));
});

app.get('/api/targets/:id/rss.xml', (req, res) => {
  const target = getTarget(req.params.id);
  if (!target) return res.status(404).send('Monitor not found.');
  const base = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const entries = getHistories(target.id).filter((entry) => entry.status === 'CHANGED').slice(0, 25);
  const items = entries.map((entry) => {
    const link = `${base}/?target=${encodeURIComponent(target.id)}&left=${encodeURIComponent(entry.previousVersionId || '')}&right=${encodeURIComponent(entry.versionId || '')}`;
    return `<item><title>${xml(`Change detected: ${target.name}`)}</title><link>${xml(link)}</link><guid>${xml(entry.id)}</guid><pubDate>${new Date(entry.checkedAt).toUTCString()}</pubDate><description>${xml(entry.aiSummary || entry.message || 'A meaningful change was detected.')}</description></item>`;
  }).join('');
  res.type('application/rss+xml').send(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xml(`${target.name} changes`)}</title><link>${xml(base)}</link><description>${xml(`Meaningful changes for ${target.url}`)}</description>${items}</channel></rss>`);
});

app.post('/api/inspect', async (req, res, next) => {
  try {
    const { inspectPage } = require('./monitoring');
    res.json(await inspectPage(String(req.body.url || '').trim()));
  } catch (error) {
    next(error);
  }
});

app.post('/api/digests/run', async (_req, res, next) => {
  try {
    res.json({ period: 'current digest period', results: await runDailyDigests({ force: true }) });
  } catch (error) {
    next(error);
  }
});


app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(400).json({ error: error.message || 'Request failed.' });
});

function startScheduler() {
  // Begin Redis setup only after Express has bound its port. This keeps the
  // dashboard reachable while the local queue warms up.
  setImmediate(() => getMonitorQueue());
  enqueueDueTargets().catch((error) => console.error('Initial scheduling failed:', error.message));
  setInterval(() => {
    enqueueDueTargets().catch((error) => console.error('Scheduling failed:', error.message));
    runDailyDigests().catch((error) => console.error('Digest scheduling failed:', error.message));
  }, 60_000).unref();
}

function startServer() {
  return app.listen(PORT, () => {
    console.log(`API ready at http://localhost:${PORT}`);
    startScheduler();
  });
}

module.exports = { app, enqueueUrl, getMonitorQueue, startServer };
