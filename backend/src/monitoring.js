const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { diff_match_patch } = require('diff-match-patch');
const { PNG } = require('pngjs');
const { addHistory, createVersion, updateTarget } = require('./store');
const { sendChangeAlert } = require('./alerts');
const { summarizeChange } = require('./summarizer');
const { validatePublicUrl } = require('./security');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SCREENSHOT_DIR = path.join(DATA_DIR, 'screenshots');
const PREVIEW_DIR = path.join(DATA_DIR, 'previews');
const dmp = new diff_match_patch();
const hostNextAllowedAt = new Map();
let chromium;
const AUTO_IGNORE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe', '[aria-live]',
  '[id*="advert" i]', '[class*="advert" i]', '[id*="banner" i]', '[class*="banner" i]',
  '[class*="carousel" i]', '[class*="swiper" i]', '[class*="rotat" i]', '[data-rotating]',
];

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
fs.mkdirSync(PREVIEW_DIR, { recursive: true });

function getChromium() {
  if (!chromium) ({ chromium } = require('playwright'));
  return chromium;
}

function filterNoise(value) {
  return String(value || '')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:AM|PM|UTC|GMT)?\b/gi, '[time]')
    .replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g, '[date]')
    .replace(/\b(?:\d{1,3}(?:,\d{3})+|\d+)\s+(?:views?|likes?|followers?|comments?)\b/gi, '[counter]')
    .replace(/\b[a-f0-9]{8}-[a-f0-9-]{9,}\b/gi, '[token]')
    .replace(/\s+/g, ' ').trim();
}

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const publicFilePath = (filePath) => `/files/${path.relative(DATA_DIR, filePath).split(path.sep).join('/')}`;

function changePercent(previous, current) {
  if (!previous) return 100;
  const diffs = dmp.diff_main(previous, current);
  const changed = diffs.reduce((total, [type, text]) => total + (type === 0 ? 0 : text.length), 0);
  return Number(((changed / Math.max(previous.length, current.length, 1)) * 100).toFixed(2));
}

function diffSummary(previous, current) {
  const diffs = dmp.diff_main(previous || '', current || '');
  dmp.diff_cleanupSemantic(diffs);
  return {
    added: diffs.filter(([type]) => type === 1).map(([, text]) => text).join(' ').replace(/\s+/g, ' ').trim().slice(0, 1_200),
    removed: diffs.filter(([type]) => type === -1).map(([, text]) => text).join(' ').replace(/\s+/g, ' ').trim().slice(0, 1_200),
  };
}

function parseNumber(value) {
  const match = String(value || '').replace(/\s/g, '').match(/[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/);
  return match ? Number(match[0].replace(/,/g, '')) : null;
}

async function waitForDomain(url) {
  const hostname = new URL(url).hostname;
  const earliest = hostNextAllowedAt.get(hostname) || 0;
  const wait = Math.max(0, earliest - Date.now());
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  hostNextAllowedAt.set(hostname, Date.now() + 2_500);
}

async function extractTargetText(page, target) {
  return page.evaluate(({ cssSelector, ignoreSelectors, automaticIgnores }) => {
    const root = document.body.cloneNode(true);
    const ignored = [...automaticIgnores, ...String(ignoreSelectors || '').split(',').map((item) => item.trim()).filter(Boolean)];
    for (const selector of ignored) {
      try { root.querySelectorAll(selector).forEach((node) => node.remove()); } catch (_error) { /* Invalid custom selectors are ignored here. */ }
    }
    const watched = cssSelector ? root.querySelector(cssSelector) : root;
    if (!watched) throw new Error(`Watch selector not found: ${cssSelector}`);
    return watched.innerText || watched.textContent || '';
  }, { cssSelector: target.cssSelector, ignoreSelectors: target.ignoreSelectors, automaticIgnores: AUTO_IGNORE_SELECTORS });
}

async function extractNumber(page, selector) {
  if (!selector) return { raw: null, value: null };
  const locator = page.locator(selector).first();
  if (!await locator.count()) throw new Error(`Number selector not found: ${selector}`);
  const raw = await locator.innerText({ timeout: 5_000 });
  return { raw: raw.slice(0, 200), value: parseNumber(raw) };
}

async function takeScreenshot(page, target, filePath) {
  if (target.cssSelector) {
    const locator = page.locator(target.cssSelector).first();
    if (await locator.count()) {
      await locator.screenshot({ path: filePath });
      return;
    }
  }
  await page.screenshot({ path: filePath, fullPage: false });
}

async function makeVisualDiff(previousPath, currentPath, targetId) {
  if (!previousPath || !fs.existsSync(previousPath) || !fs.existsSync(currentPath)) return null;
  const previous = PNG.sync.read(fs.readFileSync(previousPath));
  const current = PNG.sync.read(fs.readFileSync(currentPath));
  if (previous.width !== current.width || previous.height !== current.height) return null;
  const { default: pixelmatch } = await import('pixelmatch');
  const output = new PNG({ width: current.width, height: current.height });
  const pixels = pixelmatch(previous.data, current.data, output.data, current.width, current.height, { threshold: 0.12, includeAA: false });
  const filePath = path.join(SCREENSHOT_DIR, `${targetId}-${Date.now()}-diff.png`);
  fs.writeFileSync(filePath, PNG.sync.write(output));
  return { path: publicFilePath(filePath), pixels };
}

async function checkUrlForTargets(url, targets) {
  await validatePublicUrl(url);
  await waitForDomain(url);
  const browser = await getChromium().launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const checkedAt = new Date();
  let response;

  try {
    response = await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
    const statusCode = response?.status() || 0;
    await validatePublicUrl(page.url());
    const pageText = (await page.locator('body').innerText({ timeout: 5_000 })).toLowerCase();
    if (statusCode === 401 || statusCode === 403 || /captcha|verify you are human|access denied/.test(pageText)) {
      throw Object.assign(new Error('The page appears blocked or protected by a CAPTCHA.'), { monitorStatus: 'BLOCKED' });
    }
    if (statusCode >= 400) throw Object.assign(new Error(`Page returned HTTP ${statusCode}.`), { monitorStatus: 'ERROR' });

    for (const target of targets) {
      try {
        const text = filterNoise(await extractTargetText(page, target)).slice(0, 100_000);
        const currentHash = hash(text);
        const previousHash = target.lastHash;
        const didChange = Boolean(previousHash && previousHash !== currentHash);
        const percentage = didChange ? changePercent(target.lastText || '', text) : 0;
        const meaningful = didChange && percentage >= target.sensitivity;
        const isNewVersion = !previousHash || didChange || !target.lastVersionId;
        const number = await extractNumber(page, target.numberSelector);
        const summary = didChange ? diffSummary(target.lastText || '', text) : { added: '', removed: '' };
        let screenshotPath = target.lastScreenshotPath;
        let visualDiff = null;
        let version = null;

        if (isNewVersion) {
          const diskPath = path.join(SCREENSHOT_DIR, `${target.id}-${Date.now()}.png`);
          await takeScreenshot(page, target, diskPath);
          screenshotPath = diskPath;
          visualDiff = didChange ? await makeVisualDiff(target.lastScreenshotPath, diskPath, target.id) : null;
          version = createVersion(target.id, {
            hash: currentHash,
            text,
            screenshotPath: publicFilePath(screenshotPath),
            numberValue: number.value,
            numberRaw: number.raw,
            sourceUrl: page.url(),
          });
        }

        const status = meaningful ? 'CHANGED' : didChange ? 'SUPPRESSED' : 'OK';
        const ai = meaningful
          ? await summarizeChange({ targetName: target.name, summary, percent: percentage, enabled: target.aiSummaryEnabled })
          : { text: '', provider: null };
        const message = !previousHash
          ? 'Initial baseline captured.'
          : meaningful ? 'Meaningful change detected.'
            : didChange ? 'Change suppressed by sensitivity threshold.' : 'No meaningful change.';
        const history = addHistory(target.id, {
          status: previousHash ? status : 'INITIAL',
          statusCode,
          changePercent: percentage,
          summary,
          aiSummary: ai.text,
          aiProvider: ai.provider,
          numberValue: number.value,
          numberRaw: number.raw,
          versionId: version?.id || target.lastVersionId || null,
          previousVersionId: didChange ? target.lastVersionId : null,
          screenshotPath: version?.screenshotPath || null,
          visualDiffPath: visualDiff?.path || null,
          visualDiffPixels: visualDiff?.pixels || 0,
          message,
        });
        const updatedTarget = updateTarget(target.id, {
          status: meaningful ? 'CHANGED' : 'OK',
          statusMessage: message,
          lastHash: currentHash,
          lastText: text,
          lastCheckedAt: checkedAt.toISOString(),
          lastChangedAt: meaningful ? checkedAt.toISOString() : target.lastChangedAt,
          lastScreenshotPath: screenshotPath,
          lastVersionId: version?.id || target.lastVersionId || null,
          nextCheckAt: new Date(checkedAt.getTime() + target.intervalMinutes * 60_000 + Math.floor(Math.random() * 45_000)).toISOString(),
        });
        if (meaningful) {
          await sendChangeAlert(updatedTarget, {
            ...history,
            hash: currentHash,
            versionId: version?.id || target.lastVersionId,
            previousVersionId: target.lastVersionId,
          });
        }
      } catch (error) {
        updateTarget(target.id, {
          status: 'ERROR', statusMessage: error.message, lastCheckedAt: checkedAt.toISOString(),
          nextCheckAt: new Date(checkedAt.getTime() + target.intervalMinutes * 60_000).toISOString(),
        });
        addHistory(target.id, { status: 'ERROR', message: error.message });
      }
    }
    return { targets: targets.length, statusCode };
  } catch (error) {
    const status = error.monitorStatus || 'ERROR';
    for (const target of targets) {
      updateTarget(target.id, {
        status, statusMessage: error.message, lastCheckedAt: checkedAt.toISOString(),
        nextCheckAt: new Date(checkedAt.getTime() + target.intervalMinutes * 60_000).toISOString(),
      });
      addHistory(target.id, { status, message: error.message, statusCode: response?.status() || null });
    }
    return { targets: targets.length, status };
  } finally {
    await browser.close();
  }
}

function compareVersions(left, right) {
  const diffs = dmp.diff_main(left.text || '', right.text || '');
  dmp.diff_cleanupSemantic(diffs);
  return {
    left: { ...left, text: (left.text || '').slice(0, 30_000) },
    right: { ...right, text: (right.text || '').slice(0, 30_000) },
    changePercent: changePercent(left.text || '', right.text || ''),
    summary: diffSummary(left.text || '', right.text || ''),
    segments: diffs.map(([type, text]) => ({ type: type === 1 ? 'added' : type === -1 ? 'removed' : 'equal', text })).filter((segment) => segment.text.trim()).slice(0, 120),
  };
}

async function inspectPage(url) {
  await validatePublicUrl(url);
  const browser = await getChromium().launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  try {
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
    if (!response || response.status() >= 400) throw new Error(`Page returned HTTP ${response?.status() || 0}.`);
    const diskPath = path.join(PREVIEW_DIR, `picker-${Date.now()}.png`);
    await page.screenshot({ path: diskPath, fullPage: false });
    const elements = await page.evaluate(() => {
      const cssEscape = (value) => window.CSS?.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
      const selectorFor = (element) => {
        if (element.id) return `#${cssEscape(element.id)}`;
        const buildPart = (node) => {
          const tag = node.tagName.toLowerCase();
          const classes = [...node.classList].filter((name) => /^[a-zA-Z_-][\w-]*$/.test(name)).slice(0, 2);
          const base = classes.length ? `${tag}.${classes.map(cssEscape).join('.')}` : tag;
          const siblings = node.parentElement ? [...node.parentElement.children].filter((child) => child.tagName === node.tagName) : [];
          return siblings.length > 1 ? `${base}:nth-of-type(${siblings.indexOf(node) + 1})` : base;
        };
        const parts = [];
        let current = element;
        while (current && current !== document.body) {
          parts.unshift(buildPart(current));
          const candidate = parts.join(' > ');
          try { if (document.querySelectorAll(candidate).length === 1) return candidate; } catch (_error) { /* continue */ }
          current = current.parentElement;
        }
        return `body > ${parts.join(' > ')}`;
      };
      return [...document.querySelectorAll('h1, h2, h3, p, a, button, img, [data-testid], [class*="price" i], [id*="price" i]')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          if (rect.width < 16 || rect.height < 12 || rect.top < 0 || rect.top > 720) return null;
          return {
            selector: selectorFor(element),
            label: (element.innerText || element.getAttribute('alt') || element.getAttribute('aria-label') || element.tagName).trim().replace(/\s+/g, ' ').slice(0, 90),
            x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height),
          };
        }).filter(Boolean).slice(0, 40);
    });
    return { screenshotPath: publicFilePath(diskPath), width: 1280, height: 720, elements };
  } finally {
    await browser.close();
  }
}

module.exports = { checkUrlForTargets, compareVersions, inspectPage, validatePublicUrl };
