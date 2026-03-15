/* ================================================================
   Earnings Record Book – Frontend Logic
   ================================================================ */

'use strict';

/* ── State ─────────────────────────────────────────────────────── */
let state = {
  settings: { usd_rate: 92.54 },
  records:  []
};

let currentUser = null;

/* ── Filter state ───────────────────────────────────────────────── */
let filter = { mode: 'all', month: '', from: '', to: '' };

/* ── Clear-sources undo state ───────────────────────────────────── */
const pendingClears = {}; // recordId → { challenges, timer }
let currentUndoCb   = null;

/* ── API helper ─────────────────────────────────────────────────── */
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res  = await fetch(path, opts);
  const data = await res.json();
  if (res.status === 401) { window.location.replace('/login.html'); return; }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/* ── Format helpers ─────────────────────────────────────────────── */
function fmtUSD(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtINR(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(str) {
  if (!str) return '';
  // Regex extract so "2026-03-28" and "2026-03-28T00:00:00.000Z" both work
  const match = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(str);
  const [, y, m, d] = match;
  const dt = new Date(+y, +m - 1, +d); // local midnight — no timezone shift
  if (isNaN(dt.getTime())) return String(str);
  // Shows as: "Saturday, 28/03/2026"
  const weekday = dt.toLocaleDateString('en-GB', { weekday: 'long' });
  return `${weekday}, ${d}/${m}/${y}`;
}
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── Completeness ───────────────────────────────────────────────── */
function isComplete(c) {
  return c.actual_usd !== null && c.actual_usd !== undefined && c.actual_usd !== '';
}

/* ── Filter logic ───────────────────────────────────────────────── */
function getFilteredRecords() {
  if (filter.mode === 'all') return state.records;
  if (filter.mode === 'month' && filter.month) {
    return state.records.filter(r => r.date.startsWith(filter.month));
  }
  if (filter.mode === 'range') {
    return state.records.filter(r => {
      if (filter.from && r.date < filter.from) return false;
      if (filter.to   && r.date > filter.to)   return false;
      return true;
    });
  }
  return state.records;
}

/* ── Totals ─────────────────────────────────────────────────────── */
function calcRecordTotals(record) {
  const expTotal    = record.challenges.reduce((s, c) => s + (c.expected_usd ?? 0), 0);
  const actUSDTotal = record.challenges.reduce((s, c) => s + (isComplete(c) ? (c.actual_usd ?? 0) : 0), 0);
  const actINRTotal = record.challenges.reduce((s, c) => s + (isComplete(c) ? (c.actual_inr ?? 0) : 0), 0);
  return { expTotal, actUSDTotal, actINRTotal };
}

function calcGrandTotals(records) {
  const src = records || getFilteredRecords();
  let expTotal = 0, actUSDTotal = 0, actINRTotal = 0;
  src.forEach(r => r.challenges.forEach(c => {
    expTotal    += c.expected_usd ?? 0;
    actUSDTotal += isComplete(c) ? (c.actual_usd ?? 0) : 0;
    actINRTotal += isComplete(c) ? (c.actual_inr ?? 0) : 0;
  }));
  return { expTotal, actUSDTotal, actINRTotal };
}

/* ── Render date section ────────────────────────────────────────── */
function renderDateSection(record) {
  const { id, date, challenges } = record;
  const pending     = pendingClears[id];
  const allComplete = challenges.length > 0 && challenges.every(isComplete);
  const { expTotal, actUSDTotal, actINRTotal } = calcRecordTotals(record);

  /* source column headers */
  const chHeaders = challenges.map(c => {
    const done    = isComplete(c);
    const hasLink = c.link && c.link.trim();
    const linkHref = hasLink ? esc(c.link.trim()) : '#';
    return `
      <th class="challenge-th${done ? ' col-complete' : ''}" data-challenge-id="${c.id}">
        <div class="challenge-header">
          <input type="text" class="challenge-name-input"
            value="${esc(c.name)}"
            data-challenge-id="${c.id}" data-field="name"
            placeholder="Source name…" title="Click to rename" />
          <button class="btn-icon delete-challenge-btn"
            data-challenge-id="${c.id}" data-record-id="${id}"
            title="Remove source">×</button>
        </div>
        <div class="challenge-link-row">
          <input type="text" class="challenge-link-input"
            value="${esc(c.link || '')}"
            data-challenge-id="${c.id}" data-field="link"
            placeholder="🔗 Paste source link…" />
          <a href="${linkHref}" target="_blank" rel="noopener noreferrer"
            class="link-open-btn${hasLink ? '' : ' link-open-btn-hidden'}"
            data-challenge-id="${c.id}"
            title="Open link">↗</a>
        </div>
      </th>`;
  }).join('');

  /* helper: build a data cell */
  function dataCell(c, field, sym, readonly, displayVal) {
    const done = isComplete(c);
    const cls  = `challenge-td${done ? ' col-complete' : ''}`;
    if (readonly) {
      return `<td class="${cls}" data-challenge-id="${c.id}">
        ${done
          ? `<span class="inr-display">${displayVal}</span>`
          : `<span class="empty-dash">—</span>`}
      </td>`;
    }
    const val = c[field] !== null && c[field] !== undefined ? c[field] : '';
    return `<td class="${cls}" data-challenge-id="${c.id}">
      <div class="amount-wrap">
        <span class="currency-sym">${sym}</span>
        <input type="number" min="0" step="0.01" class="amount-input"
          value="${val}"
          data-challenge-id="${c.id}" data-field="${field}" data-record-id="${id}"
          placeholder="0.00" />
      </div>
    </td>`;
  }

  const expCells    = challenges.map(c => dataCell(c, 'expected_usd', '$', false)).join('');
  const actUSDCells = challenges.map(c => dataCell(c, 'actual_usd',   '$', false)).join('');
  const actINRCells = challenges.map(c => {
    const inr = (isComplete(c) && c.actual_inr !== null && c.actual_inr !== undefined)
      ? fmtINR(c.actual_inr) : null;
    return dataCell(c, 'actual_inr', '₹', true, inr);
  }).join('');

  const completeSub = allComplete
    ? 'All earnings received ✓'
    : `${challenges.filter(isComplete).length} / ${challenges.length} received`;

  /* Table area — shows pending-clear state if applicable */
  let tableHTML;
  if (pending) {
    const cnt = pending.challenges.length;
    tableHTML = `
      <div class="clear-pending">
        <div class="clear-pending-icon">⊘</div>
        <div class="clear-pending-text">
          <strong>${cnt} source${cnt !== 1 ? 's' : ''} cleared</strong>
          <span>Will be permanently deleted in 2 minutes</span>
        </div>
        <button class="btn btn-sm btn-secondary undo-clear-btn" data-record-id="${id}">↩ Undo</button>
      </div>`;
  } else if (challenges.length === 0) {
    tableHTML = `
      <div class="no-challenges">
        <p>No sources yet for this date.</p>
        <button class="btn btn-sm btn-primary add-challenge-btn" data-record-id="${id}">+ Add First Source</button>
      </div>`;
  } else {
    tableHTML = `
      <table class="earnings-table">
        <thead>
          <tr>
            <th class="metric-th">Metric</th>
            ${chHeaders}
            <th class="total-th">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="metric-td"><div class="metric-row-label"><span class="metric-badge badge-expected">Expected USD</span></div></td>
            ${expCells}
            <td class="total-td" data-record-id="${id}" data-total="expected">${fmtUSD(expTotal)}</td>
          </tr>
          <tr>
            <td class="metric-td"><div class="metric-row-label"><span class="metric-badge badge-actual">Actual USD</span></div></td>
            ${actUSDCells}
            <td class="total-td" data-record-id="${id}" data-total="actual-usd">${fmtUSD(actUSDTotal)}</td>
          </tr>
          <tr>
            <td class="metric-td"><div class="metric-row-label"><span class="metric-badge badge-inr">Actual INR</span></div></td>
            ${actINRCells}
            <td class="total-td" data-record-id="${id}" data-total="actual-inr">${fmtINR(actINRTotal)}</td>
          </tr>
        </tbody>
      </table>`;
  }

  /* Date action buttons */
  const actionsHTML = `
    <div class="date-actions">
      ${!pending ? `<button class="btn btn-sm btn-secondary add-challenge-btn" data-record-id="${id}">+ Add Source</button>` : ''}
      ${challenges.length > 0 && !pending
        ? `<button class="btn btn-sm btn-warning clear-sources-btn" data-record-id="${id}" title="Clear all sources (undo within 2 min)">⊘ Clear All</button>`
        : ''}
      <button class="btn btn-sm btn-danger delete-date-btn" data-record-id="${id}">🗑 Delete</button>
    </div>`;

  return `
    <div class="date-section${allComplete ? ' section-complete' : ''}" data-record-id="${id}">
      <div class="date-header">
        <div class="date-info">
          <div class="date-badge">${allComplete ? '✓' : '📅'}</div>
          <div>
            <div class="date-title">${fmtDate(date)}</div>
            <div class="date-sub">${pending ? '<span class="pending-badge">⊘ Pending deletion</span>' : completeSub}</div>
          </div>
        </div>
        ${actionsHTML}
      </div>
      <div class="table-wrapper">${tableHTML}</div>
    </div>`;
}

/* ── Full render ────────────────────────────────────────────────── */
function render() {
  const container = document.getElementById('records-container');
  const filtered  = getFilteredRecords();

  if (state.records.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📊</div>
        <div class="empty-title">No earnings recorded yet</div>
        <div class="empty-sub">Click "+ Add Date" to start tracking.</div>
      </div>`;
    document.getElementById('grand-total').classList.add('hidden');
  } else if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-title">No dates match this filter</div>
        <div class="empty-sub">Try a different month or date range.</div>
      </div>`;
    document.getElementById('grand-total').classList.add('hidden');
  } else {
    container.innerHTML = filtered.map(renderDateSection).join('');
    document.getElementById('grand-total').classList.remove('hidden');
  }

  updateSummary();
  updateGrandTotal();
  updateFilterResult();
  document.getElementById('usd-rate-input').value = state.settings.usd_rate ?? 92.54;
}

/* ── Re-render one date section ─────────────────────────────────── */
function rerenderSection(recordId) {
  const record   = state.records.find(r => String(r.id) === String(recordId));
  if (!record) return;

  // If this record is filtered out, don't try to render it
  const filtered = getFilteredRecords();
  if (!filtered.find(r => String(r.id) === String(recordId))) {
    updateSummary();
    updateGrandTotal();
    return;
  }

  const existing = document.querySelector(`.date-section[data-record-id="${recordId}"]`);
  if (!existing) { render(); return; }
  const tmp = document.createElement('div');
  tmp.innerHTML = renderDateSection(record);
  existing.replaceWith(tmp.firstElementChild);
  updateSummary();
  updateGrandTotal();
}

/* ── Summary bar ────────────────────────────────────────────────── */
function updateSummary() {
  const filtered = getFilteredRecords();
  const gt = calcGrandTotals(filtered);
  document.getElementById('sum-expected').textContent   = fmtUSD(gt.expTotal);
  document.getElementById('sum-actual-usd').textContent = fmtUSD(gt.actUSDTotal);
  document.getElementById('sum-actual-inr').textContent = fmtINR(gt.actINRTotal);
  const completed = filtered.filter(r =>
    r.challenges.length > 0 && r.challenges.every(isComplete)
  ).length;
  document.getElementById('sum-complete').textContent = `${completed} / ${filtered.length}`;
}

/* ── Grand total ────────────────────────────────────────────────── */
function updateGrandTotal() {
  const gt = calcGrandTotals(getFilteredRecords());
  document.getElementById('grand-expected').textContent   = fmtUSD(gt.expTotal);
  document.getElementById('grand-actual-usd').textContent = fmtUSD(gt.actUSDTotal);
  document.getElementById('grand-actual-inr').textContent = fmtINR(gt.actINRTotal);
}

/* ── Filter result label ────────────────────────────────────────── */
function updateFilterResult() {
  const el = document.getElementById('filter-result');
  if (!el) return;
  if (filter.mode === 'all') {
    el.textContent = '';
    return;
  }
  const filtered = getFilteredRecords();
  el.textContent = `${filtered.length} of ${state.records.length} date${state.records.length !== 1 ? 's' : ''}`;
}

/* ── Filter controls (inputs shown per mode) ────────────────────── */
function updateFilterControls() {
  const ctrl = document.getElementById('filter-controls');
  if (!ctrl) return;

  if (filter.mode === 'month') {
    if (!filter.month) filter.month = new Date().toISOString().slice(0, 7);
    ctrl.innerHTML = `
      <input type="month" id="filter-month-input" class="filter-input"
        value="${filter.month}" title="Select month" />`;
  } else if (filter.mode === 'range') {
    ctrl.innerHTML = `
      <input type="date" id="filter-from" class="filter-input" value="${filter.from}" placeholder="From" />
      <span class="filter-range-sep">→</span>
      <input type="date" id="filter-to" class="filter-input" value="${filter.to}" placeholder="To" />`;
  } else {
    ctrl.innerHTML = '';
  }
}

/* ── Inline DOM update (no full re-render) ──────────────────────── */
function updateInlineDom(record) {
  const recordId = record.id;

  record.challenges.forEach(c => {
    const done = isComplete(c);
    document.querySelectorAll(`[data-challenge-id="${c.id}"]`).forEach(el => {
      el.classList.toggle('col-complete', done);
    });

    const inrCell = document.querySelector(
      `.challenge-td[data-challenge-id="${c.id}"] .inr-display, .challenge-td[data-challenge-id="${c.id}"] .empty-dash`
    );
    if (inrCell) {
      if (done && c.actual_inr !== null && c.actual_inr !== undefined) {
        inrCell.className = 'inr-display';
        inrCell.textContent = fmtINR(c.actual_inr);
      } else {
        inrCell.className = 'empty-dash';
        inrCell.textContent = '—';
      }
    }
  });

  const { expTotal, actUSDTotal, actINRTotal } = calcRecordTotals(record);
  const sel = t => document.querySelector(`.total-td[data-record-id="${recordId}"][data-total="${t}"]`);
  const expEl = sel('expected');   if (expEl)   expEl.textContent = fmtUSD(expTotal);
  const actEl = sel('actual-usd'); if (actEl)   actEl.textContent = fmtUSD(actUSDTotal);
  const inrEl = sel('actual-inr'); if (inrEl)   inrEl.textContent = fmtINR(actINRTotal);

  const allDone = record.challenges.length > 0 && record.challenges.every(isComplete);
  const section = document.querySelector(`.date-section[data-record-id="${recordId}"]`);
  if (section) {
    section.classList.toggle('section-complete', allDone);
    const badge = section.querySelector('.date-badge');
    const sub   = section.querySelector('.date-sub');
    if (badge) badge.textContent = allDone ? '✓' : '📅';
    if (sub && !pendingClears[recordId]) {
      const cnt = record.challenges.filter(isComplete).length;
      sub.textContent = allDone
        ? 'All earnings received ✓'
        : `${cnt} / ${record.challenges.length} received`;
    }
  }

  updateSummary();
  updateGrandTotal();
}

/* ── Toast ──────────────────────────────────────────────────────── */
let toastTimer;

function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.innerHTML = `<span class="toast-msg">${esc(msg)}</span>`;
  el.className = `toast toast-${type}`;
  currentUndoCb = null;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

function showToastUndo(msg) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span class="toast-msg">${esc(msg)}</span><button class="toast-undo-btn">↩ Undo</button>`;
  el.className = 'toast toast-warning';
  clearTimeout(toastTimer);
  // Toast auto-hides after 15s; undo window stays open 2 min regardless
  toastTimer = setTimeout(() => el.classList.add('hidden'), 15000);
}

/* ── Clear sources with undo ────────────────────────────────────── */
async function initiateClearSources(recordId) {
  const record = state.records.find(r => String(r.id) === String(recordId));
  if (!record || record.challenges.length === 0) return;

  if (!confirm(`Clear all ${record.challenges.length} source${record.challenges.length !== 1 ? 's' : ''} for this date?`)) return;

  const clearedChallenges = [...record.challenges];
  const cnt = clearedChallenges.length;

  // Delete from server immediately
  try {
    await api('DELETE', `/api/records/${recordId}/challenges`);
  } catch (e) {
    showToast('Failed to clear sources: ' + e.message, 'error');
    return;
  }

  // Clear from state
  record.challenges = [];

  // Store in pending (2-min window to undo by re-inserting)
  const timer = setTimeout(() => {
    delete pendingClears[recordId];
    const r = state.records.find(r => String(r.id) === String(recordId));
    if (r) rerenderSection(recordId);
  }, 2 * 60 * 1000);
  pendingClears[recordId] = { challenges: clearedChallenges, timer };

  rerenderSection(recordId);

  // Set global undo callback and show toast
  currentUndoCb = () => undoClearSources(recordId);
  showToastUndo(`${cnt} source${cnt !== 1 ? 's' : ''} cleared. Undo within 2 min.`);
}

async function undoClearSources(recordId) {
  const pending = pendingClears[recordId];
  if (!pending) { showToast('Undo window has expired.', 'error'); return; }

  clearTimeout(pending.timer);

  try {
    const data = await api('POST', `/api/records/${recordId}/challenges/restore`, {
      challenges: pending.challenges
    });
    const record = state.records.find(r => String(r.id) === String(recordId));
    if (record) record.challenges = data.challenges.map(c => ({
      ...c,
      id:           +c.id,
      expected_usd: c.expected_usd != null ? +c.expected_usd : null,
      actual_usd:   c.actual_usd   != null ? +c.actual_usd   : null,
      actual_inr:   c.actual_inr   != null ? +c.actual_inr   : null,
    }));
    delete pendingClears[recordId];
    rerenderSection(recordId);
    showToast('Sources restored!');
    currentUndoCb = null;
  } catch (e) {
    showToast('Undo failed: ' + e.message, 'error');
  }
}

/* ── Modal ──────────────────────────────────────────────────────── */
function openModal() {
  const overlay = document.getElementById('modal-overlay');
  const picker  = document.getElementById('date-picker');
  const err     = document.getElementById('modal-error');
  overlay.classList.remove('hidden');
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  picker.value = `${d}/${m}/${y}`;
  err.classList.add('hidden');
  err.textContent = '';
  picker.focus();
  picker.select();
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

/* ── Add date ───────────────────────────────────────────────────── */
async function addDate() {
  const picker = document.getElementById('date-picker');
  const err    = document.getElementById('modal-error');
  const raw    = picker.value.trim();
  if (!raw) { err.textContent = 'Please enter a date.'; err.classList.remove('hidden'); return; }
  const parts = raw.split('/');
  if (parts.length !== 3 || parts[0].length !== 2 || parts[1].length !== 2 || parts[2].length !== 4) {
    err.textContent = 'Use DD/MM/YYYY format (e.g. 15/03/2026).';
    err.classList.remove('hidden'); return;
  }
  const [dd, mm, yyyy] = parts.map(Number);
  const testDate = new Date(yyyy, mm - 1, dd);
  if (testDate.getFullYear() !== yyyy || testDate.getMonth() !== mm - 1 || testDate.getDate() !== dd) {
    err.textContent = 'Invalid date.'; err.classList.remove('hidden'); return;
  }
  const date = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
  try {
    const record = await api('POST', '/api/records', { date });
    record.id   = +record.id;
    record.date = String(record.date).substring(0, 10);
    // Insert into local state in sorted order — avoids a second GET round-trip
    state.records.push(record);
    state.records.sort((a, b) => (a.date > b.date) - (a.date < b.date));
    render();
    closeModal();
    showToast(`Added: ${fmtDate(date)}`);
    setTimeout(() => {
      const el = document.querySelector(`.date-section[data-record-id="${record.id}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
}

/* ── Delete date ────────────────────────────────────────────────── */
async function deleteDate(recordId) {
  if (!confirm('Delete this entire date entry and all its sources?')) return;

  // Cancel any pending clear for this date
  if (pendingClears[recordId]) {
    clearTimeout(pendingClears[recordId].timer);
    delete pendingClears[recordId];
  }

  try {
    await api('DELETE', `/api/records/${recordId}`);
    state.records = state.records.filter(r => String(r.id) !== String(recordId));
    document.querySelector(`.date-section[data-record-id="${recordId}"]`)?.remove();
    if (state.records.length === 0) render();
    updateSummary();
    updateGrandTotal();
    showToast('Date deleted.');
  } catch (e) { showToast(e.message, 'error'); }
}

/* ── Add challenge ──────────────────────────────────────────────── */
async function addChallenge(recordId) {
  const record = state.records.find(r => String(r.id) === String(recordId));
  if (!record) {
    showToast('Could not find record — try refreshing the page.', 'error');
    return;
  }
  try {
    const challenge = await api('POST', `/api/records/${recordId}/challenges`, {});
    challenge.id = +challenge.id;
    record.challenges.push(challenge);
    rerenderSection(recordId);
    showToast('Source added.');
  } catch (e) { showToast(e.message, 'error'); }
}

/* ── Delete challenge ───────────────────────────────────────────── */
async function deleteChallenge(challengeId, recordId) {
  if (!confirm('Remove this source?')) return;
  try {
    await api('DELETE', `/api/challenges/${challengeId}`);
    const record = state.records.find(r => String(r.id) === String(recordId));
    if (record) record.challenges = record.challenges.filter(c => String(c.id) !== String(challengeId));
    rerenderSection(recordId);
    showToast('Source removed.');
  } catch (e) { showToast(e.message, 'error'); }
}

/* ── Save challenge field (debounced) ───────────────────────────── */
const saveTimers = {};
function scheduleSave(challengeId) {
  clearTimeout(saveTimers[challengeId]);
  saveTimers[challengeId] = setTimeout(() => saveChallengeToServer(challengeId), 700);
}

async function saveChallengeToServer(challengeId) {
  const record    = state.records.find(r => r.challenges.some(c => String(c.id) === String(challengeId)));
  const challenge = record?.challenges.find(c => String(c.id) === String(challengeId));
  if (!challenge) return;
  try {
    await api('PATCH', `/api/challenges/${challengeId}`, {
      name:         challenge.name,
      expected_usd: challenge.expected_usd,
      actual_usd:   challenge.actual_usd,
      actual_inr:   challenge.actual_inr ?? null,
      link:         challenge.link ?? null
    });
  } catch (e) { showToast('Save failed: ' + e.message, 'error'); }
}

/* ── USD rate ───────────────────────────────────────────────────── */
async function saveUSDRate() {
  const val = parseFloat(document.getElementById('usd-rate-input').value);
  if (isNaN(val) || val <= 0) { showToast('Enter a valid USD rate.', 'error'); return; }
  try {
    await api('PUT', '/api/settings/usd_rate', { value: val });
    state.settings.usd_rate = val;
    updateSummary();
    updateGrandTotal();
    showToast(`Rate updated to ₹${val}. Previous INR values are preserved.`);
  } catch (e) { showToast(e.message, 'error'); }
}

/* ── Print / Passbook ───────────────────────────────────────────── */
function generatePassbook() {
  const rate = state.settings.usd_rate || 0;
  const now  = new Date();
  const genFull = now.toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  }) + ', ' + now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  // Passbook uses the currently filtered records
  const records = getFilteredRecords();
  const { expTotal, actUSDTotal, actINRTotal } = calcGrandTotals(records);
  const completedDates  = records.filter(r => r.challenges.length > 0 && r.challenges.every(isComplete)).length;
  const totalChallenges = records.reduce((s, r) => s + r.challenges.length, 0);

  const filterNote = filter.mode !== 'all'
    ? `<div class="pb-info-item"><span class="pb-info-label">Filter</span>
        <span class="pb-info-val">${filter.mode === 'month' ? filter.month : `${filter.from || '—'} → ${filter.to || '—'}`}</span></div>`
    : '';

  const infoBar = `
    <div class="pb-info-bar">
      <div class="pb-info-item"><span class="pb-info-label">Statement Period</span>
        <span class="pb-info-val">${records.length ? fmtDate(records[0].date) + ' – ' + fmtDate(records[records.length - 1].date) : '—'}</span></div>
      <div class="pb-info-item"><span class="pb-info-label">Total Dates</span>
        <span class="pb-info-val">${records.length}</span></div>
      <div class="pb-info-item"><span class="pb-info-label">Dates Completed</span>
        <span class="pb-info-val">${completedDates} / ${records.length}</span></div>
      <div class="pb-info-item"><span class="pb-info-label">Total Sources</span>
        <span class="pb-info-val">${totalChallenges}</span></div>
      <div class="pb-info-item"><span class="pb-info-label">Grand Expected</span>
        <span class="pb-info-val">${fmtUSD(expTotal)}</span></div>
      <div class="pb-info-item"><span class="pb-info-label">Grand Actual</span>
        <span class="pb-info-val">${fmtUSD(actUSDTotal)}</span></div>
      ${filterNote}
    </div>`;

  const sections = records.map(record => {
    const { date, challenges } = record;
    const allDone  = challenges.length > 0 && challenges.every(isComplete);
    const someDone = challenges.some(isComplete);
    const statusCls  = allDone ? 'pb-status-complete' : (someDone ? 'pb-status-partial' : 'pb-status-pending');
    const statusText = allDone ? 'Complete' : (someDone ? 'Partial' : 'Pending');
    const { expTotal: dExp, actUSDTotal: dAct, actINRTotal: dINR } = calcRecordTotals(record);

    const rows = challenges.length === 0
      ? `<tr><td colspan="5" class="pb-no-data">No sources recorded for this date.</td></tr>`
      : challenges.map((c, i) => {
          const done   = isComplete(c);
          const inrVal = (done && c.actual_inr !== null && c.actual_inr !== undefined) ? fmtINR(c.actual_inr) : '—';
          const linkTag = c.link && c.link.trim()
            ? `<a href="${esc(c.link.trim())}" class="pb-link-tag">🔗 link</a>` : '';
          return `
            <tr class="${done ? 'row-complete' : ''}">
              <td style="width:30px;color:#94a3b8;text-align:center;font-size:11px">${i + 1}</td>
              <td class="pb-challenge-name">${esc(c.name)}${linkTag}</td>
              <td class="col-amount">${c.expected_usd !== null && c.expected_usd !== undefined ? fmtUSD(c.expected_usd) : '—'}</td>
              <td class="col-amount">${done ? fmtUSD(c.actual_usd) : '—'}</td>
              <td class="col-amount">${inrVal}</td>
            </tr>`;
        }).join('');

    const tfoot = challenges.length > 0 ? `
      <tfoot>
        <tr>
          <td></td><td><strong>Day Total</strong></td>
          <td class="col-amount"><strong>${fmtUSD(dExp)}</strong></td>
          <td class="col-amount"><strong>${fmtUSD(dAct)}</strong></td>
          <td class="col-amount"><strong>${fmtINR(dINR)}</strong></td>
        </tr>
      </tfoot>` : '';

    return `
      <div class="pb-section">
        <div class="pb-date-bar">
          <span class="pb-date-text">📅 ${fmtDate(date)}</span>
          <span class="pb-status ${statusCls}">${statusText}</span>
        </div>
        <table class="pb-table">
          <thead><tr>
            <th style="width:30px">#</th><th>Source</th>
            <th class="col-amount">Expected (USD)</th>
            <th class="col-amount">Actual (USD)</th>
            <th class="col-amount">Actual (INR)</th>
          </tr></thead>
          <tbody>${rows}</tbody>
          ${tfoot}
        </table>
      </div>`;
  }).join('');

  const grandTotal = `
    <div class="pb-grand-section">
      <table class="pb-grand-table" style="width:100%">
        <tr>
          <td class="pb-grand-label-cell" style="width:30px"></td>
          <td class="pb-grand-label-cell">Grand Total — ${filter.mode !== 'all' ? 'Filtered Dates' : 'All Dates'}</td>
          <td class="col-amount">${fmtUSD(expTotal)}</td>
          <td class="col-amount">${fmtUSD(actUSDTotal)}</td>
          <td class="col-amount pb-grand-inr">${fmtINR(actINRTotal)}</td>
        </tr>
      </table>
    </div>`;

  return `
    <div class="pb-header">
      <div class="pb-header-left">
        <div class="pb-logo-box">₹</div>
        <div>
          <div class="pb-app-name">Earnings Record Book</div>
          <div class="pb-app-sub">Challenge Earnings Statement</div>
        </div>
      </div>
      <div class="pb-header-right">
        <div class="pb-gen-label">Generated on</div>
        <div class="pb-gen-date">${genFull}</div>
        <div class="pb-rate">Exchange Rate: ₹${rate} / $1 USD</div>
      </div>
    </div>
    ${infoBar}
    <div class="pb-body">${sections}</div>
    ${grandTotal}
    <div class="pb-footer">
      <p>This is a computer-generated statement from <strong>Earnings Record Book</strong>.</p>
      <p>Generated on ${genFull} &nbsp;·&nbsp; USD Exchange Rate: ₹${rate} per $1</p>
    </div>`;
}

function openPrintPreview() {
  const records = getFilteredRecords();
  if (records.length === 0) { showToast('No data to print.', 'info'); return; }
  document.getElementById('print-view').innerHTML = generatePassbook();
  document.getElementById('print-preview').classList.remove('hidden');
  document.querySelector('.pp-body').scrollTop = 0;
}
function closePrintPreview() {
  document.getElementById('print-preview').classList.add('hidden');
}

/* ── Theme ──────────────────────────────────────────────────────── */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  const iconDark  = document.querySelectorAll('.theme-icon-dark, .theme-label-dark');
  const iconLight = document.querySelectorAll('.theme-icon-light, .theme-label-light');
  if (theme === 'dark') {
    iconDark.forEach(el  => el.style.display = '');
    iconLight.forEach(el => el.style.display = 'none');
  } else {
    iconDark.forEach(el  => el.style.display = 'none');
    iconLight.forEach(el => el.style.display = '');
  }
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

/* ── Event delegation ───────────────────────────────────────────── */
function attachEvents() {
  document.body.addEventListener('click', async (e) => {
    const t = e.target;

    // Toast undo button
    if (t.closest('.toast-undo-btn')) {
      if (currentUndoCb) { const cb = currentUndoCb; currentUndoCb = null; await cb(); }
      clearTimeout(toastTimer);
      document.getElementById('toast').classList.add('hidden');
      return;
    }

    // Undo clear button inside date section
    const undoClearBtn = t.closest('.undo-clear-btn');
    if (undoClearBtn) { await undoClearSources(+undoClearBtn.dataset.recordId); return; }

    // Clear all sources button
    const clearBtn = t.closest('.clear-sources-btn');
    if (clearBtn) { await initiateClearSources(+clearBtn.dataset.recordId); return; }

    // Header / modal buttons
    if (t.id === 'add-date-btn'      || t.closest('#add-date-btn'))       { openModal(); return; }
    if (t.id === 'modal-close-btn'   || t.closest('#modal-close-btn'))    { closeModal(); return; }
    if (t.id === 'modal-cancel-btn'  || t.closest('#modal-cancel-btn'))   { closeModal(); return; }
    if (t.id === 'modal-confirm-btn' || t.closest('#modal-confirm-btn'))  { await addDate(); return; }
    if (t.id === 'save-rate-btn'     || t.closest('#save-rate-btn'))      { await saveUSDRate(); return; }
    if (t.id === 'theme-toggle-btn'  || t.closest('#theme-toggle-btn'))   { toggleTheme(); return; }
    if (t.id === 'print-btn'         || t.closest('#print-btn'))          { openPrintPreview(); return; }
    if (t.id === 'pp-close-btn'      || t.closest('#pp-close-btn'))       { closePrintPreview(); return; }
    if (t.id === 'pp-print-btn'      || t.closest('#pp-print-btn'))       { window.print(); return; }
    if (t.id === 'modal-overlay')                                          { closeModal(); return; }

    // Logout
    if (t.id === 'logout-btn' || t.closest('#logout-btn')) {
      await api('POST', '/api/auth/logout').catch(() => {});
      window.location.href = '/login.html';
      return;
    }

    const addCh   = t.closest('.add-challenge-btn');
    if (addCh)   { await addChallenge(+addCh.dataset.recordId); return; }

    const delCh   = t.closest('.delete-challenge-btn');
    if (delCh)   { await deleteChallenge(+delCh.dataset.challengeId, +delCh.dataset.recordId); return; }

    const delDate = t.closest('.delete-date-btn');
    if (delDate) { await deleteDate(+delDate.dataset.recordId); return; }

    // Filter chips
    const chip = t.closest('.filter-chip');
    if (chip) {
      filter.mode = chip.dataset.mode;
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('active', c === chip));
      updateFilterControls();
      render();
      return;
    }
  });

  // Filter inputs (delegated on the filter bar)
  document.getElementById('filter-bar')?.addEventListener('input', (e) => {
    if (e.target.id === 'filter-month-input') { filter.month = e.target.value; render(); }
    if (e.target.id === 'filter-from')        { filter.from  = e.target.value; render(); }
    if (e.target.id === 'filter-to')          { filter.to    = e.target.value; render(); }
  });

  /* Amount inputs */
  document.body.addEventListener('input', (e) => {
    const input = e.target;
    if (!input.classList.contains('amount-input')) return;
    const challengeId = +input.dataset.challengeId;
    const field       = input.dataset.field;
    const recordId    = +input.dataset.recordId;
    const rawVal      = input.value.trim();
    const numVal      = rawVal === '' ? null : parseFloat(rawVal);

    const record    = state.records.find(r => String(r.id) === String(recordId));
    const challenge = record?.challenges.find(c => String(c.id) === String(challengeId));
    if (!challenge) return;

    challenge[field] = numVal;
    if (field === 'actual_usd') {
      challenge.actual_inr = (numVal !== null && !isNaN(numVal))
        ? Math.round(numVal * (state.settings.usd_rate || 0) * 100) / 100
        : null;
    }
    updateInlineDom(record);
    scheduleSave(challengeId);
  });

  /* Challenge name */
  document.body.addEventListener('input', (e) => {
    const input = e.target;
    if (!input.classList.contains('challenge-name-input')) return;
    const challengeId = +input.dataset.challengeId;
    const record    = state.records.find(r => r.challenges.some(c => String(c.id) === String(challengeId)));
    const challenge = record?.challenges.find(c => String(c.id) === String(challengeId));
    if (!challenge) return;
    challenge.name = input.value;
    scheduleSave(challengeId);
  });

  /* Challenge link */
  document.body.addEventListener('input', (e) => {
    const input = e.target;
    if (!input.classList.contains('challenge-link-input')) return;
    const challengeId = +input.dataset.challengeId;
    const record    = state.records.find(r => r.challenges.some(c => String(c.id) === String(challengeId)));
    const challenge = record?.challenges.find(c => String(c.id) === String(challengeId));
    if (!challenge) return;
    const linkVal = input.value.trim() || null;
    challenge.link = linkVal;
    const openBtn = document.querySelector(`.link-open-btn[data-challenge-id="${challengeId}"]`);
    if (openBtn) {
      if (linkVal) { openBtn.href = linkVal; openBtn.classList.remove('link-open-btn-hidden'); }
      else         { openBtn.href = '#';     openBtn.classList.add('link-open-btn-hidden'); }
    }
    scheduleSave(challengeId);
  });

  /* Enter keys */
  document.getElementById('date-picker').addEventListener('keydown', e => {
    if (e.key === 'Enter') addDate();
  });
  document.getElementById('usd-rate-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveUSDRate();
  });
}

/* ── Init ───────────────────────────────────────────────────────── */
async function init() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  applyTheme(savedTheme);

  try {
    // Check authentication first
    const authData = await fetch('/api/auth/me').then(r => r.json());
    if (!authData.user) {
      window.location.replace('/login.html');
      return;
    }
    currentUser = authData.user;
    const userInfoEl = document.getElementById('user-info');
    if (userInfoEl) {
      document.getElementById('username-display').textContent = authData.user.username;
      userInfoEl.style.display = '';
    }

    const data = await api('GET', '/api/data');
    state.settings = data.settings;
    state.records  = data.records;
    // Normalize IDs and numeric fields so arithmetic never produces NaN
    state.records.forEach(r => {
      r.id = +r.id;
      r.challenges.forEach(c => {
        c.id           = +c.id;
        c.expected_usd = c.expected_usd != null ? +c.expected_usd : null;
        c.actual_usd   = c.actual_usd   != null ? +c.actual_usd   : null;
        c.actual_inr   = c.actual_inr   != null ? +c.actual_inr   : null;
      });
    });

    document.getElementById('usd-rate-input').value = state.settings.usd_rate ?? 92.54;

    updateFilterControls();
    render();
    attachEvents();
  } catch (e) {
    document.getElementById('records-container').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">Could not load data</div>
        <div class="empty-sub">${esc(e.message)}</div>
      </div>`;
  }
}

init();
