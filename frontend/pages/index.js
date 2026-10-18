import { useEffect, useMemo, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';
const emptyForm = {
  name: '', url: '', intervalMinutes: 60, cssSelector: '', ignoreSelectors: '', sensitivity: 5,
  email: '', webhookUrl: '', telegramChatId: '', keywordFilters: '', numberSelector: '',
  alertCooldownMinutes: 0, dailyDigest: false, dailyDigestHour: 9, aiSummaryEnabled: false,
};

function formatDate(value) {
  if (!value) return 'Not checked yet';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatNumber(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function statusClass(status) {
  return `status status--${String(status || 'pending').toLowerCase()}`;
}

function publicUrl(filePath) {
  return filePath ? `${API_BASE}${filePath}` : null;
}

function asForm(target) {
  return {
    ...emptyForm,
    ...target,
    dailyDigest: Boolean(target.dailyDigest),
    aiSummaryEnabled: Boolean(target.aiSummaryEnabled),
  };
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request failed.');
  return result;
}

export default function Dashboard() {
  const [targets, setTargets] = useState([]);
  const [stats, setStats] = useState({ total: 0, active: 0, changed: 0, issues: 0 });
  const [health, setHealth] = useState('Checking');
  const [form, setForm] = useState(emptyForm);
  const [editingTargetId, setEditingTargetId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [history, setHistory] = useState([]);
  const [versions, setVersions] = useState([]);
  const [numbers, setNumbers] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [leftVersionId, setLeftVersionId] = useState('');
  const [rightVersionId, setRightVersionId] = useState('');
  const [comparison, setComparison] = useState(null);
  const [inspectUrl, setInspectUrl] = useState('');
  const [preview, setPreview] = useState(null);
  const [pickerMode, setPickerMode] = useState('watch');
  const [inspecting, setInspecting] = useState(false);

  const [lastPickedSelector, setLastPickedSelector] = useState('');

  const selected = useMemo(
    () => targets.find((target) => target.id === selectedTarget) || null,
    [targets, selectedTarget],
  );

  async function fetchSelectedTargetData(targetId) {
    if (!targetId) {
      setHistory([]); setVersions([]); setNumbers([]); setNotifications([]); setComparison(null);
      return;
    }
    try {
      const [historyData, versionData, numberData, notificationData] = await Promise.all([
        api(`/api/targets/${targetId}/history`),
        api(`/api/targets/${targetId}/versions`),
        api(`/api/targets/${targetId}/number-series`),
        api(`/api/targets/${targetId}/notifications`),
      ]);
      setHistory(historyData);
      setVersions(versionData);
      setNumbers(numberData);
      setNotifications(notificationData);
      if (versionData.length >= 2) {
        setLeftVersionId((current) => current || versionData[1].id);
        setRightVersionId((current) => current || versionData[0].id);
      } else if (versionData.length === 1) {
        setRightVersionId((current) => current || versionData[0].id);
      }
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function refresh() {
    try {
      const [targetData, dashboardData, healthData] = await Promise.all([
        api('/api/targets'), api('/api/dashboard'), api('/health'),
      ]);
      setTargets(targetData);
      setStats(dashboardData);
      setHealth(healthData.redis === 'connected' ? 'Online' : 'Redis starting');
      setError('');
      if (selectedTarget) {
        await fetchSelectedTargetData(selectedTarget);
      }
    } catch (_requestError) {
      setHealth('Offline');
      setError('Cannot reach the backend. Check the server connection.');
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = params.get('target');
    const url = params.get('url');
    const left = params.get('left');
    const right = params.get('right');
    if (target) setSelectedTarget(target);
    if (url) setForm((current) => ({ ...current, url }));
    if (left) setLeftVersionId(left);
    if (right) setRightVersionId(right);
    refresh();
    const interval = setInterval(refresh, 8_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchSelectedTargetData(selectedTarget);
  }, [selectedTarget]);

  useEffect(() => {
    if (!selectedTarget || !leftVersionId || !rightVersionId || leftVersionId === rightVersionId) {
      setComparison(null);
      return undefined;
    }
    let cancelled = false;
    api(`/api/targets/${selectedTarget}/compare?left=${encodeURIComponent(leftVersionId)}&right=${encodeURIComponent(rightVersionId)}`)
      .then((data) => { if (!cancelled) setComparison(data); })
      .catch((requestError) => { if (!cancelled) setError(requestError.message); });
    return () => { cancelled = true; };
  }, [selectedTarget, leftVersionId, rightVersionId]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingTargetId(null);
    setPreview(null);
  }

  function beginEdit(target) {
    setForm(asForm(target));
    setEditingTargetId(target.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveTarget(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const isEditing = Boolean(editingTargetId);
      const saved = await api(isEditing ? `/api/targets/${editingTargetId}` : '/api/targets', {
        method: isEditing ? 'PATCH' : 'POST', body: JSON.stringify(form),
      });
      setMessage(isEditing ? `“${saved.name}” settings saved and a fresh check was queued.` : `“${saved.name}” is queued for its first check.`);
      resetForm();
      setSelectedTarget(saved.id);
      await refresh();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function runCheck(target) {
    setMessage('');
    try {
      await api(`/api/targets/${target.id}/check`, { method: 'POST' });
      setMessage(`A check for “${target.name}” is queued. Checking now…`);
      await refresh();
      setTimeout(refresh, 2500);
      setTimeout(refresh, 6000);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function toggleTarget(target) {
    try {
      await api(`/api/targets/${target.id}`, { method: 'PATCH', body: JSON.stringify({ active: !target.active }) });
      await refresh();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function removeTarget(target) {
    if (!window.confirm(`Delete “${target.name}” and its timeline?`)) return;
    try {
      await api(`/api/targets/${target.id}`, { method: 'DELETE' });
      if (target.id === selectedTarget) setSelectedTarget(null);
      if (target.id === editingTargetId) resetForm();
      await refresh();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function inspectPage() {
    const url = inspectUrl || form.url;
    if (!url) {
      setError('Enter a public URL before opening the visual picker.');
      return;
    }
    setInspecting(true);
    setError('');
    try {
      const result = await api('/api/inspect', { method: 'POST', body: JSON.stringify({ url }) });
      setPreview(result);
      setInspectUrl(url);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setInspecting(false);
    }
  }

  function selectRegion(selector) {
    setLastPickedSelector(selector);
    if (pickerMode === 'ignore') {
      const items = form.ignoreSelectors.split(',').map((value) => value.trim()).filter(Boolean);
      updateForm('ignoreSelectors', [...new Set([...items, selector])].join(', '));
      setMessage(`Added ${selector} to ignored regions.`);
    } else if (pickerMode === 'number') {
      updateForm('numberSelector', selector);
      setMessage(`Selected ${selector} for number tracking.`);
    } else {
      updateForm('cssSelector', selector);
      setMessage(`Selected ${selector} as the watched region.`);
    }
  }

  async function applySelectorToSelectedTarget() {
    if (!selected || !lastPickedSelector) return;
    try {
      const patch = {};
      if (pickerMode === 'ignore') {
        const items = (selected.ignoreSelectors || '').split(',').map((v) => v.trim()).filter(Boolean);
        patch.ignoreSelectors = [...new Set([...items, lastPickedSelector])].join(', ');
      } else if (pickerMode === 'number') {
        patch.numberSelector = lastPickedSelector;
      } else {
        patch.cssSelector = lastPickedSelector;
      }
      await api(`/api/targets/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setMessage(`Saved ${lastPickedSelector} to “${selected.name}”!`);
      await refresh();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function selectVersions(previousVersionId, currentVersionId) {
    setLeftVersionId(previousVersionId || '');
    setRightVersionId(currentVersionId || '');
    document.getElementById('comparison')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function runDigest() {
    try {
      const result = await api('/api/digests/run', { method: 'POST' });
      setMessage(`Digest run finished for ${result.results.length} eligible monitor(s).`);
      if (selectedTarget) {
        const data = await api(`/api/targets/${selectedTarget}/notifications`);
        setNotifications(data);
      }
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Changewatch dashboard"><span className="brand-mark">⌁</span><span>changewatch</span></a>
        <div className="top-actions"><button className="text-button" onClick={runDigest}>Run daily digest</button><div className="connection"><span className={`signal ${health === 'Online' ? 'signal--on' : ''}`} />{health}</div></div>
      </header>

      <section className="hero" id="top">
        <div><p className="eyebrow">PAGE INTELLIGENCE</p><h1>Catch what changed.<br /><em>Skip the noise.</em></h1><p className="hero-copy">Monitor public pages with a real browser, focus on the exact region that matters, and keep visual proof of every meaningful change.</p></div>
        <div className="hero-note"><b>15 min</b><span>minimum respectful check interval</span></div>
      </section>

      {(error || message) && <div className={`notice ${error ? 'notice--error' : 'notice--success'}`}>{error || message}</div>}

      <section className="stat-grid" aria-label="Monitor summary"><Stat number={stats.total} label="Total monitors" /><Stat number={stats.active} label="Actively watching" accent="blue" /><Stat number={stats.changed} label="Changes awaiting review" accent="amber" /><Stat number={stats.issues} label="Needs attention" accent="red" /></section>

      <section className="workspace">
        <aside className="panel create-panel">
          <div className="panel-heading"><div><p className="eyebrow">{editingTargetId ? 'EDIT MONITOR' : 'NEW MONITOR'}</p><h2>{editingTargetId ? 'Monitor settings' : 'Watch a page'}</h2></div><span className="step">01</span></div>
          <form onSubmit={saveTarget}>
            <Field label="Display name"><input required value={form.name} onChange={(event) => updateForm('name', event.target.value)} placeholder="e.g. Product pricing" /></Field>
            <Field label="Public URL" hint="Private networks, credentials, and localhost are blocked."><input required type="url" value={form.url} onChange={(event) => updateForm('url', event.target.value)} placeholder="https://example.com/pricing" /></Field>
            <div className="two-fields"><Field label="Interval"><select value={form.intervalMinutes} onChange={(event) => updateForm('intervalMinutes', Number(event.target.value))}><option value={15}>Every 15 min</option><option value={30}>Every 30 min</option><option value={60}>Every hour</option><option value={360}>Every 6 hours</option><option value={1440}>Daily</option></select></Field><Field label="Min. change"><select value={form.sensitivity} onChange={(event) => updateForm('sensitivity', Number(event.target.value))}><option value={1}>1% · high</option><option value={5}>5% · balanced</option><option value={15}>15% · low</option></select></Field></div>
            <Field label="Watch selector" hint="Optional — use the visual picker"><input value={form.cssSelector} onChange={(event) => updateForm('cssSelector', event.target.value)} placeholder="#pricing or .price-card" /></Field>
            <Field label="Ignore selector" hint="Optional, comma-separated"><input value={form.ignoreSelectors} onChange={(event) => updateForm('ignoreSelectors', event.target.value)} placeholder=".cookie-banner, footer" /></Field>
            <details className="notification-details"><summary>Alert, digest & analytics settings</summary>
              <Field label="Keyword-only alerts" hint="Optional comma-separated words; only matching changes alert."><input value={form.keywordFilters} onChange={(event) => updateForm('keywordFilters', event.target.value)} placeholder="price, availability, sale" /></Field>
              <Field label="Number selector" hint="Track a live number and see its chart."><input value={form.numberSelector} onChange={(event) => updateForm('numberSelector', event.target.value)} placeholder=".subscriber-count" /></Field>
              <Field label="Alert cooldown"><select value={form.alertCooldownMinutes} onChange={(event) => updateForm('alertCooldownMinutes', Number(event.target.value))}><option value={0}>No cooldown</option><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={360}>6 hours</option><option value={1440}>24 hours</option></select></Field>
              <div className="check-stack"><Check label="Send a daily digest" checked={form.dailyDigest} onChange={(value) => updateForm('dailyDigest', value)} />{form.dailyDigest && <Field label="Digest hour (local server time)"><select value={form.dailyDigestHour} onChange={(event) => updateForm('dailyDigestHour', Number(event.target.value))}>{[0, 6, 9, 12, 18, 21].map((hour) => <option value={hour} key={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></Field>}<Check label="Use an AI one-line summary when configured" checked={form.aiSummaryEnabled} onChange={(value) => updateForm('aiSummaryEnabled', value)} /></div>
              <Field label="Email"><input type="email" value={form.email} onChange={(event) => updateForm('email', event.target.value)} placeholder="you@example.com" /></Field>
              <Field label="Discord / webhook URL"><input type="url" value={form.webhookUrl} onChange={(event) => updateForm('webhookUrl', event.target.value)} placeholder="https://…" /></Field>
              <Field label="Telegram chat ID"><input value={form.telegramChatId} onChange={(event) => updateForm('telegramChatId', event.target.value)} placeholder="e.g. 123456789" /></Field>
            </details>
            <button className="button button--primary" disabled={saving}>{saving ? 'Saving…' : editingTargetId ? 'Save monitor →' : 'Start monitoring →'}</button>{editingTargetId && <button className="button button--secondary" type="button" onClick={resetForm}>Cancel editing</button>}
          </form>
        </aside>

        <section className="monitor-area"><div className="section-title"><div><p className="eyebrow">YOUR WATCHLIST</p><h2>Monitors</h2></div><button className="text-button" onClick={refresh}>Refresh</button></div><div className="panel monitor-list">{targets.length === 0 ? <EmptyMonitors /> : targets.map((target) => <MonitorRow key={target.id} target={target} selected={target.id === selectedTarget} onSelect={() => setSelectedTarget(target.id)} onRun={() => runCheck(target)} onToggle={() => toggleTarget(target)} onEdit={() => beginEdit(target)} onDelete={() => removeTarget(target)} />)}</div></section>
      </section>

      <section className="details-grid">
        <section className="panel timeline-panel"><div className="section-title"><div><p className="eyebrow">VERSION TIMELINE</p><h2>{selected ? selected.name : 'Select a monitor'}</h2></div>{selected && <span className={statusClass(selected.active ? selected.status : 'PAUSED')}>{selected.active ? selected.status : 'PAUSED'}</span>}</div>{selected && <div className="monitor-meta"><span>Last checked <b>{formatDate(selected.lastCheckedAt)}</b></span><span>Last changed <b>{formatDate(selected.lastChangedAt)}</b></span><a href={`${API_BASE}/api/targets/${selected.id}/rss.xml`} target="_blank" rel="noreferrer">RSS feed ↗</a></div>}{!selected ? <p className="empty-copy">Choose a monitor to see its snapshots, alerts, visual diffs, and number history.</p> : <Timeline entries={history} onCompare={selectVersions} />}</section>
        <section className="panel picker-panel"><div className="section-title"><div><p className="eyebrow">VISUAL PICKER</p><h2>Choose a region</h2></div><span className="step">02</span></div><p className="picker-intro">This opens the real public URL in the monitoring browser. Pick an element to watch, ignore, or use as a live number.</p><div className="picker-mode" role="group" aria-label="Visual picker action"><button className={pickerMode === 'watch' ? 'is-active' : ''} onClick={() => setPickerMode('watch')}>Watch</button><button className={pickerMode === 'ignore' ? 'is-active' : ''} onClick={() => setPickerMode('ignore')}>Ignore</button><button className={pickerMode === 'number' ? 'is-active' : ''} onClick={() => setPickerMode('number')}>Track number</button></div><div className="picker-controls"><input value={inspectUrl} onChange={(event) => setInspectUrl(event.target.value)} placeholder="https://example.com" /><button className="button button--dark" onClick={inspectPage} disabled={inspecting}>{inspecting ? 'Loading…' : 'Open picker'}</button></div><Picker preview={preview} onSelect={selectRegion} selectedSelector={lastPickedSelector} pickerMode={pickerMode} selectedTargetName={selected?.name} onApplyToCurrent={selected ? applySelectorToSelectedTarget : null} /></section>
      </section>

      {selected && <section className="panel comparison-panel" id="comparison"><div className="section-title"><div><p className="eyebrow">SIDE-BY-SIDE REVIEW</p><h2>Compare any two versions</h2></div>{comparison && <span className="compare-percent">{comparison.changePercent}% changed</span>}</div><div className="version-selectors"><VersionSelect label="Before" value={leftVersionId} versions={versions} onChange={setLeftVersionId} /><VersionSelect label="After" value={rightVersionId} versions={versions} onChange={setRightVersionId} /></div><Comparison comparison={comparison} /></section>}

      {selected && numbers.length > 0 && <section className="panel chart-panel"><div className="section-title"><div><p className="eyebrow">NUMBER TRACKING</p><h2>{selected.numberSelector || 'Tracked number'}</h2></div><span className="number-latest">Latest {formatNumber(numbers[numbers.length - 1].value)}</span></div><NumberChart points={numbers} /></section>}

      {selected && <section className="panel notification-panel"><div className="section-title"><div><p className="eyebrow">DELIVERY LOG</p><h2>Alerts & digests</h2></div><span className="delivery-count">{notifications.length} attempt{notifications.length === 1 ? '' : 's'}</span></div>{notifications.length ? <div className="delivery-list">{notifications.slice(0, 8).map((entry) => <div key={entry.id}><span className={entry.delivered ? 'delivery-ok' : 'delivery-failed'}>{entry.delivered ? 'Delivered' : 'Not delivered'}</span><b>{entry.kind}</b><span>{entry.channel} · {formatDate(entry.sentAt)}</span>{entry.error && <small>{entry.error}</small>}</div>)}</div> : <p className="empty-copy">No alert has been sent. Configure a webhook, Telegram, or email delivery in monitor settings.</p>}</section>}
    </main>
  );
}

function Stat({ number, label, accent = 'ink' }) { return <article className={`stat stat--${accent}`}><strong>{number}</strong><span>{label}</span></article>; }
function Field({ label, hint, children }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
function Check({ label, checked, onChange }) { return <label className="check"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>; }
function EmptyMonitors() { return <div className="empty-state"><span>◌</span><h3>No monitors yet</h3><p>Add a public URL above. The first check captures a baseline; later snapshots are saved only when its monitored content changes.</p></div>; }

function MonitorRow({ target, selected, onSelect, onRun, onToggle, onEdit, onDelete }) {
  let hostname = target.url;
  try { hostname = new URL(target.url).hostname; } catch (_error) { /* show stored URL */ }
  return <article className={`monitor-row ${selected ? 'monitor-row--selected' : ''}`}><button className="monitor-main" onClick={onSelect}><span className="favicon">{target.name.charAt(0).toUpperCase()}</span><span><b>{target.name}</b><small>{hostname} · checked {formatDate(target.lastCheckedAt)} · changed {formatDate(target.lastChangedAt)}</small></span></button><span className={statusClass(target.active ? target.status : 'PAUSED')}>{target.active ? target.status : 'PAUSED'}</span><div className="row-actions"><button title="Check now" aria-label={`Check ${target.name} now`} onClick={onRun}>↻</button><button title="Edit monitor" aria-label={`Edit ${target.name}`} onClick={onEdit}>⚙</button><button title={target.active ? 'Pause monitor' : 'Resume monitor'} aria-label={target.active ? `Pause ${target.name}` : `Resume ${target.name}`} onClick={onToggle}>{target.active ? 'Ⅱ' : '▶'}</button><button title="Delete monitor" aria-label={`Delete ${target.name}`} onClick={onDelete}>×</button></div></article>;
}

function Timeline({ entries, onCompare }) {
  if (!entries.length) return <p className="empty-copy">The first check has not completed yet.</p>;
  return <div className="timeline">{entries.map((entry) => <article className="timeline-entry" key={entry.id}><span className={`timeline-dot timeline-dot--${String(entry.status).toLowerCase()}`} /><div className="timeline-body"><div><b>{entry.status === 'INITIAL' ? 'Baseline saved' : entry.message}</b><time>{formatDate(entry.checkedAt)}</time></div>{entry.changePercent > 0 && <p>{entry.changePercent}% of monitored text changed.</p>}{entry.aiSummary && <p className="ai-summary">✦ {entry.aiSummary}</p>}{Number.isFinite(entry.numberValue) && <p className="number-note">Tracked number: {formatNumber(entry.numberValue)}{entry.numberRaw ? ` (${entry.numberRaw})` : ''}</p>}{entry.summary?.added && <p className="diff diff--add">+ {entry.summary.added}</p>}{entry.summary?.removed && <p className="diff diff--remove">− {entry.summary.removed}</p>}{(entry.screenshotPath || entry.visualDiffPath) && <div className="screens">{entry.screenshotPath && <a href={publicUrl(entry.screenshotPath)} target="_blank" rel="noreferrer">Screenshot ↗</a>}{entry.visualDiffPath && <a href={publicUrl(entry.visualDiffPath)} target="_blank" rel="noreferrer">Visual diff ↗</a>}{entry.previousVersionId && entry.versionId && <button onClick={() => onCompare(entry.previousVersionId, entry.versionId)}>Compare ↗</button>}</div>}</div></article>)}</div>;
}

function Picker({ preview, onSelect, selectedSelector, pickerMode, selectedTargetName, onApplyToCurrent }) {
  if (!preview) return <div className="picker-empty"><span>⌖</span><p>Your interactive browser preview will appear here.</p></div>;
  return (
    <div>
      {selectedSelector && (
        <div className="picker-selected-card">
          <div className="picker-selected-info">
            <span className="picker-selected-badge">✓ {pickerMode === 'number' ? 'Track Number' : pickerMode === 'ignore' ? 'Ignore' : 'Watch'}</span>
            <code>{selectedSelector}</code>
          </div>
          <div className="picker-selected-actions">
            <button type="button" className="text-button" onClick={() => document.querySelector('.create-panel')?.scrollIntoView({ behavior: 'smooth' })}>
              View in Form ↑
            </button>
            {onApplyToCurrent && (
              <button type="button" className="button button--dark button--small" onClick={onApplyToCurrent}>
                Save to “{selectedTargetName}”
              </button>
            )}
          </div>
        </div>
      )}
      <div className="preview-wrap">
        <img src={publicUrl(preview.screenshotPath)} alt="Page preview for visual selector" />
        {preview.elements.map((element, index) => {
          const isSelected = selectedSelector === element.selector;
          return (
            <button
              type="button"
              key={`${element.selector}-${index}`}
              className={`pick-region ${isSelected ? 'pick-region--active' : ''}`}
              style={{
                left: `${(element.x / preview.width) * 100}%`,
                top: `${(element.y / preview.height) * 100}%`,
                width: `${(element.width / preview.width) * 100}%`,
                height: `${(element.height / preview.height) * 100}%`,
              }}
              onClick={() => onSelect(element.selector)}
              title={`${element.label} — ${element.selector}`}
            >
              <span>{isSelected ? '✓' : index + 1}</span>
            </button>
          );
        })}
      </div>
      <div className="candidate-list">
        {preview.elements.map((element, index) => {
          const isSelected = selectedSelector === element.selector;
          return (
            <button
              type="button"
              key={`${element.selector}-item-${index}`}
              className={isSelected ? 'is-selected' : ''}
              onClick={() => onSelect(element.selector)}
            >
              <i>{isSelected ? '✓' : index + 1}</i>
              <span>{element.label || element.selector}</span>
              <code>{element.selector}</code>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VersionSelect({ label, value, versions, onChange }) { return <label className="version-select"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Choose a version</option>{versions.map((version) => <option value={version.id} key={version.id}>{formatDate(version.createdAt)}{version.numberValue !== null && version.numberValue !== undefined ? ` · ${formatNumber(version.numberValue)}` : ''}</option>)}</select></label>; }

function Comparison({ comparison }) {
  if (!comparison) return <p className="empty-copy">Select two saved versions after the monitor has captured a baseline and a change.</p>;
  return <div className="comparison"><div className="comparison-images"><VersionImage label="Before" version={comparison.left} /><VersionImage label="After" version={comparison.right} /></div><div className="compare-summary"><div><span>Added</span><p>{comparison.summary.added || '—'}</p></div><div><span>Removed</span><p>{comparison.summary.removed || '—'}</p></div></div><div className="text-diff" aria-label="Text difference">{comparison.segments.map((segment, index) => <span key={index} className={`text-diff--${segment.type}`}>{segment.text.slice(0, 2_000)}</span>)}</div></div>;
}

function VersionImage({ label, version }) { return <figure><figcaption>{label} · {formatDate(version.createdAt)}</figcaption>{version.screenshotPath ? <a href={publicUrl(version.screenshotPath)} target="_blank" rel="noreferrer"><img src={publicUrl(version.screenshotPath)} alt={`${label} version screenshot`} /></a> : <div className="missing-image">No screenshot available</div>}</figure>; }

function NumberChart({ points }) {
  const width = 760; const height = 180; const pad = 20;
  const values = points.map((point) => point.value); const min = Math.min(...values); const max = Math.max(...values); const range = max - min || 1;
  const line = points.map((point, index) => `${pad + (index / Math.max(points.length - 1, 1)) * (width - pad * 2)},${height - pad - ((point.value - min) / range) * (height - pad * 2)}`).join(' ');
  return <div className="number-chart"><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Tracked number history"><line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} /><polyline points={line} /></svg><div><span>{formatDate(points[0].checkedAt)}</span><b>{min === max ? `Value ${formatNumber(max)}` : `${formatNumber(min)} — ${formatNumber(max)}`}</b><span>{formatDate(points[points.length - 1].checkedAt)}</span></div></div>;
}
