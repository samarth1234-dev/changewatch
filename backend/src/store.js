const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'monitor-data.json');
const EMPTY_STORE = { targets: [], histories: [], versions: [], notifications: [] };

fs.mkdirSync(DATA_DIR, { recursive: true });

function readStore() {
  try {
    const value = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    return {
      targets: Array.isArray(value.targets) ? value.targets : [],
      histories: Array.isArray(value.histories) ? value.histories : [],
      versions: Array.isArray(value.versions) ? value.versions : [],
      notifications: Array.isArray(value.notifications) ? value.notifications : [],
    };
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(EMPTY_STORE);
    throw error;
  }
}

let store = readStore();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const save = () => fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');

function createTarget(input) {
  const createdAt = now();
  const target = {
    id: id('target'), ...input,
    active: true,
    status: 'PENDING',
    statusMessage: 'Waiting for its first check.',
    lastCheckedAt: null,
    lastChangedAt: null,
    nextCheckAt: createdAt,
    lastHash: null,
    lastText: '',
    lastScreenshotPath: null,
    lastVersionId: null,
    lastAlertHash: null,
    lastDigestDate: null,
    createdAt,
    updatedAt: createdAt,
  };
  store.targets.unshift(target);
  save();
  return target;
}

const getTarget = (targetId) => store.targets.find((target) => target.id === targetId) || null;
const getTargets = () => [...store.targets].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
const getTargetsByUrl = (url) => store.targets.filter((target) => target.url === url);

function updateTarget(targetId, patch) {
  const target = getTarget(targetId);
  if (!target) return null;
  Object.assign(target, patch, { updatedAt: now() });
  save();
  return target;
}

function deleteTarget(targetId) {
  const original = store.targets.length;
  store.targets = store.targets.filter((target) => target.id !== targetId);
  store.histories = store.histories.filter((entry) => entry.targetId !== targetId);
  store.versions = store.versions.filter((version) => version.targetId !== targetId);
  store.notifications = store.notifications.filter((entry) => entry.targetId !== targetId);
  if (store.targets.length === original) return false;
  save();
  return true;
}

function createVersion(targetId, version) {
  const record = { id: id('version'), targetId, createdAt: now(), ...version };
  store.versions.unshift(record);
  if (store.versions.length > 5_000) store.versions.length = 5_000;
  save();
  return record;
}

const getVersion = (targetId, versionId) => store.versions.find((version) => version.targetId === targetId && version.id === versionId) || null;
const getVersions = (targetId) => store.versions
  .filter((version) => version.targetId === targetId)
  .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

function addHistory(targetId, entry) {
  const history = { id: id('history'), targetId, checkedAt: now(), ...entry };
  store.histories.unshift(history);
  if (store.histories.length > 10_000) store.histories.length = 10_000;
  save();
  return history;
}

const getHistories = (targetId) => store.histories
  .filter((entry) => entry.targetId === targetId)
  .sort((a, b) => new Date(b.checkedAt) - new Date(a.checkedAt));

function addNotification(targetId, notification) {
  const entry = { id: id('notification'), targetId, sentAt: now(), ...notification };
  store.notifications.unshift(entry);
  if (store.notifications.length > 5_000) store.notifications.length = 5_000;
  save();
  return entry;
}

const getNotifications = (targetId) => store.notifications.filter((entry) => entry.targetId === targetId);

function getStats() {
  const targets = getTargets();
  return {
    total: targets.length,
    active: targets.filter((target) => target.active).length,
    changed: targets.filter((target) => target.status === 'CHANGED').length,
    issues: targets.filter((target) => ['ERROR', 'BLOCKED'].includes(target.status)).length,
  };
}

module.exports = {
  addHistory,
  addNotification,
  createTarget,
  createVersion,
  deleteTarget,
  getHistories,
  getNotifications,
  getStats,
  getTarget,
  getTargets,
  getTargetsByUrl,
  getVersion,
  getVersions,
  updateTarget,
};
