const { addNotification, getHistories, getTargets, updateTarget } = require('./store');

const appBaseUrl = () => (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const apiBaseUrl = () => (process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');

function changedKeywords(target, summary) {
  const keywords = String(target.keywordFilters || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (!keywords.length) return { allowed: true, matches: [] };
  const subject = `${summary?.added || ''} ${summary?.removed || ''}`.toLowerCase();
  const matches = keywords.filter((keyword) => subject.includes(keyword));
  return { allowed: matches.length > 0, matches };
}

async function safeRequest(channel, request) {
  try {
    const response = await fetch(request.url, request.options);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { channel, delivered: true };
  } catch (error) {
    console.error(`${channel} notification failed: ${error.message}`);
    return { channel, delivered: false, error: error.message };
  }
}

function detailLinks(target, detail) {
  const compareUrl = detail.previousVersionId && detail.versionId
    ? `${appBaseUrl()}/?target=${encodeURIComponent(target.id)}&left=${encodeURIComponent(detail.previousVersionId)}&right=${encodeURIComponent(detail.versionId)}`
    : `${appBaseUrl()}/?target=${encodeURIComponent(target.id)}`;
  return {
    compareUrl,
    screenshotUrl: detail.screenshotPath ? `${apiBaseUrl()}${detail.screenshotPath}` : null,
    visualDiffUrl: detail.visualDiffPath ? `${apiBaseUrl()}${detail.visualDiffPath}` : null,
  };
}

async function deliver(target, { subject, text, detail, kind }) {
  const links = detailLinks(target, detail || {});
  const enriched = [text, `Monitor: ${target.url}`, `Timeline: ${links.compareUrl}`, links.visualDiffUrl ? `Visual diff: ${links.visualDiffUrl}` : null]
    .filter(Boolean).join('\n');
  const results = [];

  if (target.webhookUrl) {
    results.push(safeRequest('webhook', {
      url: target.webhookUrl,
      options: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: `**${subject}**\n${enriched}`, text: enriched, target: target.name, detail, links }),
      },
    }));
  }
  if (target.email && process.env.RESEND_API_KEY && process.env.ALERT_FROM_EMAIL) {
    results.push(safeRequest('email', {
      url: 'https://api.resend.com/emails',
      options: {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: process.env.ALERT_FROM_EMAIL, to: [target.email], subject, text: enriched }),
      },
    }));
  }
  if (target.telegramChatId && process.env.TELEGRAM_BOT_TOKEN) {
    results.push(safeRequest('telegram', {
      url: `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      options: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: target.telegramChatId, text: `${subject}\n${enriched}`, disable_web_page_preview: true }),
      },
    }));
  }

  const outcomes = await Promise.all(results);
  for (const outcome of outcomes) addNotification(target.id, { kind, ...outcome, subject, versionId: detail?.versionId || null });
  return outcomes.some((outcome) => outcome.delivered);
}

async function sendChangeAlert(target, detail) {
  if (target.lastAlertHash === detail.hash) return { skipped: 'duplicate' };
  const keyword = changedKeywords(target, detail.summary);
  if (!keyword.allowed) return { skipped: 'keyword-filter' };

  const cooldownMinutes = Number(target.alertCooldownMinutes || 0);
  if (cooldownMinutes && target.lastAlertAt && Date.now() - new Date(target.lastAlertAt).getTime() < cooldownMinutes * 60_000) {
    return { skipped: 'cooldown' };
  }

  const keywordText = keyword.matches.length ? ` Matching keywords: ${keyword.matches.join(', ')}.` : '';
  const delivered = await deliver(target, {
    kind: 'change',
    subject: `Change detected: ${target.name}`,
    text: `${detail.aiSummary || `${detail.changePercent}% of monitored text changed.`}${keywordText}`,
    detail,
  });
  // Mark the hash even when delivery is not configured, preventing duplicate work on retries.
  updateTarget(target.id, { lastAlertHash: detail.hash, lastAlertAt: new Date().toISOString() });
  return { delivered };
}

async function runDailyDigests({ force = false } = {}) {
  const today = new Intl.DateTimeFormat('en-CA').format(new Date());
  const hour = new Date().getHours();
  const targets = getTargets().filter((target) => target.active && target.dailyDigest
    && (force || (target.lastDigestDate !== today && hour >= Number(target.dailyDigestHour ?? 9))));
  const results = [];
  for (const target of targets) {
    const since = target.lastDigestAt ? new Date(target.lastDigestAt).getTime() : Date.now() - 24 * 60 * 60 * 1000;
    const changes = getHistories(target.id).filter((entry) => entry.status === 'CHANGED' && new Date(entry.checkedAt).getTime() >= since);
    if (changes.length) {
      const latest = changes[0];
      await deliver(target, {
        kind: 'daily-digest',
        subject: `Daily digest: ${target.name}`,
        text: `${changes.length} meaningful change${changes.length === 1 ? '' : 's'} were detected in the last digest period. Latest: ${latest.aiSummary || latest.message}`,
        detail: latest,
      });
    }
    updateTarget(target.id, { lastDigestDate: today, lastDigestAt: new Date().toISOString() });
    results.push({ targetId: target.id, changes: changes.length });
  }
  return results;
}

module.exports = { runDailyDigests, sendChangeAlert };
