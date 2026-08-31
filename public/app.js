/* Civil Estimate WebApp - frontend */
let DB = null;          // full state from server
let CUR = null;         // current project object
let saveTimer = null;

const $ = id => document.getElementById(id);
const fmt = n => (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fmtMoney = n => '₹ ' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

function toast(msg, ms = 2500) {
  const t = $('toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(() => t.style.display = 'none', ms);
}

async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw data;
  return data;
}

/* ================= INIT ================= */
async function init() {
  DB = await api('/api/state');
  renderProjList();
  if (DB.projects.length) selectProject(DB.projects[DB.projects.length - 1].id);
  setupDropzone();
}
init();

/* ================= PROJECTS ================= */
function renderProjList() {
  const el = $('projList');
  el.innerHTML = '';
  [...DB.projects].reverse().forEach(p => {
    const d = document.createElement('div');
    d.className = 'proj-item' + (CUR && CUR.id === p.id ? ' active' : '');
    d.innerHTML = `<span class="nm">${esc(p.name)}</span><span class="sub">${esc(p.client || '')} ${p.date || ''}</span>`;
    d.onclick = () => selectProject(p.id);
    el.appendChild(d);
  });
}

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

async function newProject() {
  const name = prompt('Project name?', 'New House Project');
  if (name === null) return;
  const p = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name }) });
  DB.projects.push(p);
  selectProject(p.id);
  toast('✅ Project created');
}

function selectProject(id) {
  CUR = DB.projects.find(p => p.id === id);
  if (!CUR) return;
  $('emptyState').style.display = 'none';
  $('projectView').style.display = 'block';
  $('pName').value = CUR.name;
  $('pClient').value = CUR.client || '';
  $('pLocation').value = CUR.location || '';
  $('pDate').value = CUR.date || '';
  renderProjList();
  renderDrawings();
  renderMeasure();
  renderAbstract();
  renderQuickDrawing();
  loadAddons();
  showTab('drawings');
}

['pName', 'pClient', 'pLocation', 'pDate'].forEach(id => {
  document.addEventListener('input', e => {
    if (e.target.id !== id || !CUR) return;
    CUR.name = $('pName').value; CUR.client = $('pClient').value;
    CUR.location = $('pLocation').value; CUR.date = $('pDate').value;
    renderProjList();
    scheduleSave();
  });
});

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveProject, 600);
}
async function saveProject() {
  if (!CUR) return;
  await api('/api/projects/' + CUR.id, {
    method: 'PUT',
    body: JSON.stringify({
      name: CUR.name, client: CUR.client, location: CUR.location,
      date: CUR.date, measurements: CUR.measurements, notes: CUR.notes,
    }),
  }).catch(() => toast('⚠ Save failed'));
}

async function deleteProject() {
  if (!CUR) return;
  if (!confirm(`Delete "${CUR.name}"? All its drawings will also be deleted.`)) return;
  await api('/api/projects/' + CUR.id, { method: 'DELETE' });
  DB.projects = DB.projects.filter(p => p.id !== CUR.id);
  CUR = null;
  $('projectView').style.display = 'none';
  $('emptyState').style.display = 'block';
  renderProjList();
  toast('🗑 Project deleted');
}

/* ================= TABS ================= */
function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  ['drawings', 'quick', 'measure', 'abstract'].forEach(t => $('tab-' + t).style.display = t === name ? 'block' : 'none');
  if (name === 'abstract') renderAbstract();
  if (name === 'quick') renderQuickDrawing();
}

/* ================= DRAWINGS ================= */
function setupDropzone() {
  const dz = $('dropzone');
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => uploadFiles(e.dataTransfer.files));
  $('drawingFile').addEventListener('change', e => uploadFiles(e.target.files));
}

async function uploadFiles(files) {
  if (!CUR || !files.length) return;
  const fd = new FormData();
  for (const f of files) fd.append('drawings', f);
  toast('⬆ Uploading...');
  const r = await fetch(`/api/projects/${CUR.id}/drawings`, { method: 'POST', body: fd });
  if (!r.ok) { toast('❌ Upload failed — only image/PDF/CAD files allowed'); return; }
  const added = await r.json();
  CUR.drawings.push(...added);
  $('drawingFile').value = '';
  renderDrawings();
  renderQuickDrawing();
  toast(`✅ ${added.length} drawing(s) uploaded`);
  // upload hote hi AI analysis offer karo
  const analyzable = added.find(d => isImg(d.filename) || isPdf(d.filename));
  if (analyzable && confirm('🤖 Generate estimate from this drawing using AI?\n(May take 1-5 minutes)')) {
    aiAnalyze(analyzable.id);
  } else {
    showTab('quick');
  }
}

function isImg(fn) { return /\.(png|jpe?g|gif|webp|bmp)$/i.test(fn); }
function isPdf(fn) { return /\.pdf$/i.test(fn); }

function renderDrawings() {
  const g = $('drawingsGrid');
  g.innerHTML = '';
  (CUR.drawings || []).forEach(d => {
    const url = '/uploads/' + d.filename;
    const card = document.createElement('div');
    card.className = 'dcard';
    const thumb = isImg(d.filename)
      ? `<img src="${url}" alt="">`
      : `<span class="ficon">${isPdf(d.filename) ? '📄' : '📐'}</span>`;
    card.innerHTML = `
      <div class="thumb" onclick="openViewer('${d.id}')">${thumb}</div>
      <div class="dinfo"><span class="fn" title="${esc(d.original)}">${esc(d.original)}</span>
      <span>${(d.size / 1024 / 1024).toFixed(2)} MB</span></div>
      <div class="dactions">
        <button class="btn btn-ghost btn-sm" onclick="openViewer('${d.id}')">👁 View</button>
        ${(isImg(d.filename) || isPdf(d.filename)) ? `<button class="btn btn-primary btn-sm" onclick="aiAnalyze('${d.id}')">🤖 AI Estimate</button>` : ''}
        <button class="btn btn-danger btn-sm" onclick="deleteDrawing('${d.id}')">🗑</button>
      </div>`;
    g.appendChild(card);
  });
  if (!(CUR.drawings || []).length) g.innerHTML = '<p class="hint">No drawings uploaded yet.</p>';
}

async function deleteDrawing(did) {
  if (!confirm('Delete this drawing?')) return;
  await api(`/api/projects/${CUR.id}/drawings/${did}`, { method: 'DELETE' });
  CUR.drawings = CUR.drawings.filter(d => d.id !== did);
  renderDrawings(); renderQuickDrawing();
}

function openViewer(did) {
  const d = CUR.drawings.find(x => x.id === did);
  if (!d) return;
  const url = '/uploads/' + d.filename;
  $('viewerTitle').textContent = d.original;
  $('viewerBody').innerHTML = isImg(d.filename)
    ? `<img src="${url}">`
    : isPdf(d.filename)
      ? `<iframe src="${url}"></iframe>`
      : `<p class="hint">This file type cannot be previewed in the browser (${esc(d.original)}). <a href="${url}" download>⬇ Download</a> and open in CAD software.</p>`;
  $('viewerModal').style.display = 'flex';
}
function closeViewer() { $('viewerModal').style.display = 'none'; $('viewerBody').innerHTML = ''; }

function renderQuickDrawing() {
  const v = $('quickDrawingView');
  const ds = CUR ? (CUR.drawings || []) : [];
  if (!ds.length) { v.innerHTML = '<p class="hint">No drawing uploaded — upload one from the Drawings tab.</p>'; return; }
  const d = ds[ds.length - 1];
  const url = '/uploads/' + d.filename;
  v.innerHTML = isImg(d.filename) ? `<img src="${url}">`
    : isPdf(d.filename) ? `<iframe src="${url}"></iframe>`
    : `<p class="hint">${esc(d.original)} (CAD file — no preview)</p>`;
}

/* ================= QUICK ESTIMATE ================= */
/* thumb-rule coefficients per sqm of area; ground = plinth-area based item */
const COEF = {
  rcc: [
    { r: 'r1',  c: 0.25, ground: true  },  // excavation
    { r: 'r2',  c: 0.20, ground: true  },  // sand filling
    { r: 'r3',  c: 0.05, ground: true  },  // PCC
    { r: 'r4',  c: 0.25, ground: false },  // RCC
    { r: 'r5',  c: 30,   ground: false },  // steel kg
    { r: 'r6',  c: 0.60, ground: false },  // shuttering
    { r: 'r7',  c: 0.10, ground: true  },  // DPC
    { r: 'r8',  c: 0.25, ground: false },  // brickwork
    { r: 'r9',  c: 3.0,  ground: false },  // plaster
    { r: 'r10', c: 1.05, ground: false },  // flooring
    { r: 'r11', c: 3.0,  ground: false },  // painting
    { r: 'r12', c: 0.15, ground: false },  // doors windows
    { r: 'r13', c: 1.0,  ground: true  },  // anti termite
    { r: 'r14', c: 1.05, ground: true, roof: true }, // waterproofing (roof = plinth area)
  ],
  load: [
    { r: 'r1',  c: 0.35, ground: true  },
    { r: 'r2',  c: 0.20, ground: true  },
    { r: 'r3',  c: 0.07, ground: true  },
    { r: 'r4',  c: 0.10, ground: false },
    { r: 'r5',  c: 12,   ground: false },
    { r: 'r6',  c: 0.25, ground: false },
    { r: 'r7',  c: 0.12, ground: true  },
    { r: 'r8',  c: 0.45, ground: false },
    { r: 'r9',  c: 3.2,  ground: false },
    { r: 'r10', c: 1.05, ground: false },
    { r: 'r11', c: 3.2,  ground: false },
    { r: 'r12', c: 0.15, ground: false },
    { r: 'r13', c: 1.0,  ground: true  },
    { r: 'r14', c: 1.05, ground: true, roof: true },
  ],
};

function generateQuick(append) {
  if (!CUR) return;
  let area = Number($('qArea').value);
  if (!area || area <= 0) { toast('⚠ Enter built-up area first'); return; }
  if ($('qUnit').value === 'sqft') area = area * 0.0929; // -> sqm
  const floors = Number($('qFloors').value);
  const type = $('qType').value;
  const plinth = area;              // per-floor area = plinth area
  const total = area * floors;      // total BUA

  const rateMap = Object.fromEntries(DB.rates.map(r => [r.id, r]));
  const rows = COEF[type].map(cf => {
    const base = cf.ground ? plinth : total;
    const qty = +(cf.c * base).toFixed(2);
    const r = rateMap[cf.r];
    return {
      id: 'm' + Math.random().toString(36).slice(2, 9),
      itemId: cf.r,
      description: cf.roof ? 'Roof area (auto - thumb rule)' : 'Auto (thumb rule from drawing dims)',
      nos: 1, L: '', B: '', H: '',
      qty, unit: r ? r.unit : '',
    };
  });

  if (append) CUR.measurements.push(...rows);
  else {
    if (CUR.measurements.length && !confirm('Existing measurement sheet will be replaced. OK?')) return;
    CUR.measurements = rows;
  }
  scheduleSave();
  renderMeasure();
  const ab = calcAbstract();
  $('quickResult').innerHTML = `
    <div class="qsummary">
      ✅ Estimate generated! Total BUA: <b>${fmt(total)} sq.m</b> (${fmt(total / 0.0929)} sq.ft)<br>
      Estimated Cost (incl. GST): <b>${fmtMoney(ab.grand)}</b>
      &nbsp; <span class="hint">(~ ${fmtMoney(ab.grand / (total / 0.0929))}/sq.ft)</span><br>
      <small class="hint">📏 Edit any item's quantity in the Measurement Sheet tab to enter exact drawing measurements.</small>
    </div>`;
  renderAbstract();
  toast('⚡ Estimate generated!');
}

/* ================= AI DRAWING ANALYSIS ================= */
let AI_RESULT = null;
let AI_BUSY = false;
const AI_STATUS_MSGS = [
  '🤖 AI is reading the drawing...',
  '📐 Extracting dimensions...',
  '🧮 Calculating quantities...',
  '📋 Preparing measurement items...',
  '⏳ Almost there — large drawing...',
];

async function aiAnalyze(did) {
  if (!CUR || AI_BUSY) return;
  const d = CUR.drawings.find(x => x.id === did);
  if (!d) return;
  AI_BUSY = true;
  AI_RESULT = null;
  $('aiModal').style.display = 'flex';
  let msgIdx = 0;
  $('aiBody').innerHTML = `
    <div class="ai-loading">
      <div class="spinner"></div>
      <p id="aiStatusMsg">${AI_STATUS_MSGS[0]}</p>
      <p class="hint">Drawing: <b>${esc(d.original)}</b><br>May take 1-5 minutes — please don't close this window</p>
    </div>`;
  const ticker = setInterval(() => {
    const el = $('aiStatusMsg');
    if (el) { msgIdx = (msgIdx + 1) % AI_STATUS_MSGS.length; el.textContent = AI_STATUS_MSGS[msgIdx]; }
  }, 15000);
  try {
    const r = await fetch(`/api/projects/${CUR.id}/drawings/${did}/analyze`, { method: 'POST' });
    const data = await r.json().catch(() => ({ error: 'Invalid response' }));
    if (!r.ok) throw new Error(data.error || 'Analysis failed');
    AI_RESULT = data;
    d.analysis = data;
    renderAiResult(did);
  } catch (e) {
    $('aiBody').innerHTML = `
      <div class="ai-error">
        <p>❌ <b>AI analysis failed</b></p>
        <p class="hint">${esc(String(e.message || e))}</p>
        <div class="actions">
          <button class="btn btn-primary btn-sm" onclick="aiAnalyze('${did}')">🔁 Try again</button>
          <button class="btn btn-ghost btn-sm" onclick="closeAi()">Close</button>
        </div>
        <p class="hint">💡 If it keeps failing: upload a clearer image (PNG/JPG) of the drawing, or use ⚡ Quick Estimate.</p>
      </div>`;
  } finally {
    clearInterval(ticker);
    AI_BUSY = false;
  }
}

function confBadge(c) {
  const map = { high: ['#059669', 'High — dimensions clearly readable'], medium: ['#d97706', 'Medium — some assumptions were made'], low: ['#dc2626', 'Low — drawing unclear, verify carefully'] };
  const [color, label] = map[c] || map.medium;
  return `<span class="conf-badge" style="background:${color}">${c.toUpperCase()}</span> <small class="hint">${label}</small>`;
}

function renderAiResult(did) {
  const a = AI_RESULT;
  const totalAmt = a.items.reduce((s, it) => s + it.qty * (it.rate || 0), 0);
  $('aiBody').innerHTML = `
    <div class="ai-result">
      <p><b>🏗 Structure:</b> ${esc(a.structureType)} &nbsp; ${confBadge(a.confidence)}</p>
      <p class="hint">${esc(a.summary)}</p>
      ${(a.warnings || []).length ? `<div class="ai-warn">${a.warnings.map(w => `⚠️ ${esc(w)}`).join('<br>')}</div>` : ''}
      ${a.assumptions.length ? `<details open><summary><b>📌 Assumptions (${a.assumptions.length})</b> — please verify</summary><ul class="ai-list">${a.assumptions.map(s => `<li>${esc(s)}</li>`).join('')}</ul></details>` : ''}
      ${a.unreadable.length ? `<details><summary><b>⚠️ Unreadable portions (${a.unreadable.length})</b></summary><ul class="ai-list">${a.unreadable.map(s => `<li>${esc(s)}</li>`).join('')}</ul></details>` : ''}
      <div class="table-wrap" style="max-height:320px;margin-top:10px">
        <table class="tbl">
          <thead><tr><th><input type="checkbox" id="aiChkAll" checked onclick="document.querySelectorAll('.ai-chk').forEach(c=>c.checked=this.checked)"></th>
          <th>Item</th><th>Description</th><th>Nos</th><th>L</th><th>B</th><th>H</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Amount</th></tr></thead>
          <tbody>${a.items.map((it, i) => `
            <tr><td><input type="checkbox" class="ai-chk" data-ai="${i}" checked></td>
            <td>${esc(it.item)}${it.itemId ? '' : ' <small style="color:#d97706">(custom)</small>'}</td>
            <td>${esc(it.description)}</td>
            <td class="qty">${fmt(it.nos)}</td><td class="qty">${it.L === '' ? '—' : fmt(it.L)}</td>
            <td class="qty">${it.B === '' ? '—' : fmt(it.B)}</td><td class="qty">${it.H === '' ? '—' : fmt(it.H)}</td>
            <td class="qty">${fmt(it.qty)}</td><td>${esc(it.unit)}</td>
            <td class="amt">${fmt(it.rate)}</td><td class="amt">${fmt(it.qty * (it.rate || 0))}</td></tr>`).join('')}
          </tbody>
          <tfoot><tr class="tot-row"><td colspan="10">Approx. Civil Cost (selected items, excl. add-ons)</td><td class="amt">${fmtMoney(totalAmt)}</td></tr></tfoot>
        </table>
      </div>
      <div class="actions" style="margin-top:12px">
        <button class="btn btn-success" onclick="aiApply(false)">✅ Add to Measurement Sheet (replace)</button>
        <button class="btn btn-primary" onclick="aiApply(true)">＋ Append</button>
        <button class="btn btn-ghost" onclick="closeAi()">Cancel</button>
      </div>
      <p class="hint">⚠️ This estimate was generated by AI from the drawing — verify all items in the measurement sheet before tender/billing.</p>
    </div>`;
}

function aiApply(append) {
  if (!AI_RESULT || !CUR) return;
  const chosen = [...document.querySelectorAll('.ai-chk')].filter(c => c.checked).map(c => AI_RESULT.items[+c.dataset.ai]);
  if (!chosen.length) { toast('⚠ No items selected'); return; }
  const rows = chosen.map(it => ({
    id: 'm' + Math.random().toString(36).slice(2, 9),
    itemId: it.itemId || '',
    item: it.itemId ? '' : it.item,
    description: it.description,
    nos: it.nos, L: it.L, B: it.B, H: it.H,
    qty: it.qty, unit: it.unit, rate: it.itemId ? 0 : (it.rate || 0),
  }));
  if (append) CUR.measurements.push(...rows);
  else CUR.measurements = rows;
  scheduleSave();
  closeAi();
  renderMeasure();
  renderAbstract();
  showTab('abstract');
  toast(`✅ ${rows.length} items added — Abstract is ready!`);
}

function closeAi() {
  if (AI_BUSY && !confirm('AI analysis is still running — really close?')) return;
  $('aiModal').style.display = 'none';
}

/* ================= CHAT ASSISTANT ================= */
let CHAT_HISTORY = [];
let CHAT_BUSY = false;

function toggleChat() {
  const panel = $('chatPanel');
  const show = panel.style.display === 'none';
  panel.style.display = show ? 'flex' : 'none';
  if (show) $('chatInput').focus();
}

function chatBubble(text, who) {
  const div = document.createElement('div');
  div.className = 'chat-msg ' + who;
  div.innerHTML = esc(text).replace(/\n/g, '<br>');
  $('chatMsgs').appendChild(div);
  $('chatMsgs').scrollTop = $('chatMsgs').scrollHeight;
  return div;
}

async function sendChat() {
  if (CHAT_BUSY) return;
  const input = $('chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  if (!CUR) { chatBubble('Please open or create a project first 🙂', 'bot'); return; }
  input.value = '';
  chatBubble(msg, 'user');
  CHAT_HISTORY.push({ role: 'user', text: msg });
  CHAT_BUSY = true;
  $('chatSendBtn').disabled = true;
  const thinking = chatBubble('💭 thinking...', 'bot');
  try {
    const r = await fetch('/api/projects/' + CUR.id + '/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, history: CHAT_HISTORY.slice(-8), project: CUR }),
    });
    const data = await r.json().catch(() => ({ error: 'Server se galat jawab' }));
    if (!r.ok) throw new Error(data.error || 'Chat fail');
    thinking.remove();
    chatBubble(data.reply, 'bot');
    CHAT_HISTORY.push({ role: 'bot', text: data.reply });
    // changes aaye to project/rates/settings update karke UI refresh
    if (data.changes && data.changes.length) {
      CUR.measurements = data.project.measurements;
      DB.rates = data.rates;
      DB.settings = data.settings;
      const i = DB.projects.findIndex(x => x.id === CUR.id);
      if (i >= 0) DB.projects[i] = CUR;
      renderMeasure();
      renderAbstract();
      scheduleSave();
      chatBubble('📝 Changes: ' + data.changes.join(', '), 'bot changes');
      toast('✅ Estimate updated (' + data.changes.length + ' change)');
    }
  } catch (e) {
    thinking.remove();
    chatBubble('❌ ' + String(e.message || e), 'bot');
  } finally {
    CHAT_BUSY = false;
    $('chatSendBtn').disabled = false;
    input.focus();
  }
}

/* ================= MEASUREMENT SHEET ================= */
function itemOptions(sel) {
  return ['<option value="">— custom item —</option>']
    .concat(DB.rates.map(r => `<option value="${r.id}" ${sel === r.id ? 'selected' : ''}>${esc(r.item)} (${r.unit})</option>`))
    .join('');
}

function addMeasureRow() {
  if (!CUR) return;
  CUR.measurements.push({
    id: 'm' + Math.random().toString(36).slice(2, 9),
    itemId: '', item: '', description: '', nos: 1, L: '', B: '', H: '', qty: 0, unit: '', rate: 0,
  });
  renderMeasure();
  scheduleSave();
}

function calcRowQty(m) {
  const n = v => (v === '' || v === null || v === undefined) ? 1 : (Number(v) || 0);
  return +(n(m.nos) * n(m.L) * n(m.B) * n(m.H)).toFixed(2);
}

function renderMeasure() {
  const b = $('measureBody');
  b.innerHTML = '';
  const rateMap = Object.fromEntries(DB.rates.map(r => [r.id, r]));
  (CUR.measurements || []).forEach((m, i) => {
    m.qty = calcRowQty(m);
    const isCustom = !(m.itemId && rateMap[m.itemId]);
    if (!isCustom) m.unit = rateMap[m.itemId].unit;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td><select data-i="${i}" data-f="itemId">${itemOptions(m.itemId)}</select>
        ${isCustom ? `<input data-i="${i}" data-f="item" value="${esc(m.item || '')}" placeholder="Custom item name" style="margin-top:3px">` : ''}</td>
      <td><input data-i="${i}" data-f="description" value="${esc(m.description)}" placeholder="e.g. Footing F1 / Wall W2"></td>
      <td><input class="num" data-i="${i}" data-f="nos" value="${esc(m.nos)}"></td>
      <td><input class="num" data-i="${i}" data-f="L" value="${esc(m.L)}"></td>
      <td><input class="num" data-i="${i}" data-f="B" value="${esc(m.B)}"></td>
      <td><input class="num" data-i="${i}" data-f="H" value="${esc(m.H)}"></td>
      <td class="qty">${fmt(m.qty)}</td>
      <td>${isCustom ? `<input data-i="${i}" data-f="unit" value="${esc(m.unit || '')}" placeholder="unit" style="width:52px">` : esc(m.unit)}</td>
      <td>${isCustom ? `<input class="num" data-i="${i}" data-f="rate" value="${esc(m.rate || '')}" placeholder="₹">` : `<span class="hint">${fmt(rateMap[m.itemId].rate)}</span>`}</td>
      <td><span class="rowdel" onclick="delMeasureRow(${i})">✕</span></td>`;
    b.appendChild(tr);
  });
  b.querySelectorAll('input,select').forEach(el => {
    el.addEventListener('input', e => {
      const i = +e.target.dataset.i, f = e.target.dataset.f;
      const m = CUR.measurements[i];
      m[f] = e.target.value;
      if (f === 'itemId') {
        const r = DB.rates.find(x => x.id === e.target.value);
        if (r) m.unit = r.unit;
        renderMeasure();
      } else {
        m.qty = calcRowQty(m);
        e.target.closest('tr').querySelector('.qty').textContent = fmt(m.qty);
      }
      scheduleSave();
    });
  });
}

function delMeasureRow(i) {
  CUR.measurements.splice(i, 1);
  renderMeasure();
  scheduleSave();
}

/* ================= ABSTRACT ================= */
function calcAbstract() {
  const rateMap = Object.fromEntries(DB.rates.map(r => [r.id, r]));
  const groups = {};
  for (const m of CUR.measurements || []) {
    const key = m.itemId || ('c:' + (m.item || m.description || 'Item'));
    if (!groups[key]) {
      const r = rateMap[m.itemId];
      groups[key] = { item: r ? r.item : (m.item || m.description || 'Custom item'), unit: r ? r.unit : (m.unit || ''), rate: r ? Number(r.rate) : (Number(m.rate) || 0), qty: 0 };
    }
    groups[key].qty += Number(m.qty) || 0;
  }
  const rows = Object.values(groups).map((g, i) => ({ sno: i + 1, ...g, amount: g.qty * g.rate }));
  const civil = rows.reduce((s, r) => s + r.amount, 0);
  const st = DB.settings;
  const elect = civil * (st.electrification || 0) / 100;
  const plumb = civil * (st.plumbing || 0) / 100;
  const cont = civil * (st.contingency || 0) / 100;
  const sub = civil + elect + plumb + cont;
  const gst = sub * (st.gst || 0) / 100;
  return { rows, civil, elect, plumb, cont, sub, gst, grand: sub + gst };
}

function renderAbstract() {
  if (!CUR) return;
  const ab = calcAbstract();
  $('prTitle').textContent = 'Abstract of Cost — ' + CUR.name;
  $('prMeta').textContent = [CUR.client && 'Client: ' + CUR.client, CUR.location && 'Location: ' + CUR.location, CUR.date && 'Date: ' + CUR.date].filter(Boolean).join('   |   ');
  const b = $('abstractBody');
  b.innerHTML = ab.rows.map(r => `
    <tr><td>${r.sno}</td><td>${esc(r.item)}</td><td class="qty">${fmt(r.qty)}</td>
    <td>${esc(r.unit)}</td><td class="amt">${fmt(r.rate)}</td><td class="amt">${fmt(r.amount)}</td></tr>`).join('')
    || '<tr><td colspan="6" class="hint" style="padding:14px">Measurement sheet is empty — run ⚡ Quick Estimate or add rows first.</td></tr>';
  const st = DB.settings;
  $('abstractFoot').innerHTML = `
    <tr class="tot-row"><td colspan="5">Total Civil Cost</td><td class="amt">${fmt(ab.civil)}</td></tr>
    <tr><td colspan="5">Add: Electrification @ ${st.electrification || 0}%</td><td class="amt">${fmt(ab.elect)}</td></tr>
    <tr><td colspan="5">Add: Plumbing &amp; Sanitary @ ${st.plumbing || 0}%</td><td class="amt">${fmt(ab.plumb)}</td></tr>
    <tr><td colspan="5">Add: Contingency @ ${st.contingency || 0}%</td><td class="amt">${fmt(ab.cont)}</td></tr>
    <tr class="tot-row"><td colspan="5">Sub Total</td><td class="amt">${fmt(ab.sub)}</td></tr>
    <tr><td colspan="5">GST @ ${st.gst || 0}%</td><td class="amt">${fmt(ab.gst)}</td></tr>
    <tr class="grand"><td colspan="5">GRAND TOTAL</td><td class="amt">${fmtMoney(ab.grand)}</td></tr>`;
}

function loadAddons() {
  const s = DB.settings;
  $('sElect').value = s.electrification; $('sPlumb').value = s.plumbing;
  $('sCont').value = s.contingency; $('sGst').value = s.gst;
}
async function saveAddons() {
  DB.settings.electrification = Number($('sElect').value) || 0;
  DB.settings.plumbing = Number($('sPlumb').value) || 0;
  DB.settings.contingency = Number($('sCont').value) || 0;
  DB.settings.gst = Number($('sGst').value) || 0;
  await api('/api/settings', { method: 'PUT', body: JSON.stringify(DB.settings) });
  renderAbstract();
}

/* ================= CSV EXPORT ================= */
function downloadCSV(kind) {
  if (!CUR) return;
  let rows;
  if (kind === 'measure') {
    rows = [['#', 'Item', 'Description', 'Nos', 'L', 'B', 'H', 'Qty', 'Unit']];
    const rateMap = Object.fromEntries(DB.rates.map(r => [r.id, r]));
    (CUR.measurements || []).forEach((m, i) => rows.push([i + 1, rateMap[m.itemId] ? rateMap[m.itemId].item : (m.item || m.description), m.description, m.nos, m.L, m.B, m.H, m.qty, m.unit]));
  } else {
    const ab = calcAbstract();
    rows = [['S.No', 'Item of Work', 'Qty', 'Unit', 'Rate', 'Amount']];
    ab.rows.forEach(r => rows.push([r.sno, r.item, r.qty.toFixed(2), r.unit, r.rate, r.amount.toFixed(2)]));
    rows.push([], ['', 'Total Civil Cost', '', '', '', ab.civil.toFixed(2)],
      ['', 'Electrification', '', '', '', ab.elect.toFixed(2)],
      ['', 'Plumbing & Sanitary', '', '', '', ab.plumb.toFixed(2)],
      ['', 'Contingency', '', '', '', ab.cont.toFixed(2)],
      ['', 'GST', '', '', '', ab.gst.toFixed(2)],
      ['', 'GRAND TOTAL', '', '', '', ab.grand.toFixed(2)]);
  }
  const csv = rows.map(r => (r || []).map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = `${CUR.name}_${kind}.csv`;
  a.click();
}

/* ================= GOOGLE SHEET SYNC ================= */
async function syncProject() {
  if (!CUR) return;
  const el = $('syncStatus');
  el.className = 'sync-status no-print'; el.textContent = '🔄 Saving to Google Sheet...';
  await saveProject();
  try {
    // browser apna poora project data saath bhejta hai — serverless par bhi sync kabhi fail nahi hota
    const r = await api('/api/sync/' + CUR.id, { method: 'POST', body: JSON.stringify({ project: CUR }) });
    el.className = 'sync-status ok no-print';
    el.textContent = '✅ Saved to Google Sheet! (' + new Date().toLocaleTimeString() + ')';
    toast('✅ Data saved to Google Sheet');
  } catch (e) {
    el.className = 'sync-status err no-print';
    if (e && e.error === 'NO_SCRIPT_URL') {
      el.innerHTML = '⚠ Set the Apps Script URL in Settings first — without it nothing can be saved to Google Sheet. <a href="#" onclick="openSettings();return false">Open Settings</a> (setup steps are in README-SETUP.md)';
    } else {
      el.textContent = '❌ Sync failed: ' + (e.detail ? JSON.stringify(e.detail).slice(0, 200) : JSON.stringify(e).slice(0, 200));
    }
  }
}

/* ================= SETTINGS ================= */
function openSettings() {
  $('setScriptUrl').value = DB.settings.scriptUrl || '';
  $('setApiKey').value = DB.settings.apiKey || '';
  $('setGeminiKey').value = DB.settings.geminiKey || '';
  renderRates();
  $('settingsModal').style.display = 'flex';
}
function closeSettings() { $('settingsModal').style.display = 'none'; }

async function saveSettings() {
  DB.settings.scriptUrl = $('setScriptUrl').value.trim();
  DB.settings.apiKey = $('setApiKey').value.trim();
  DB.settings.geminiKey = $('setGeminiKey').value.trim();
  await api('/api/settings', { method: 'PUT', body: JSON.stringify(DB.settings) });
  toast('💾 Settings saved');
}

async function testConnection() {
  const el = $('testResult');
  el.textContent = '⏳ testing...';
  await saveSettings();
  try {
    const r = await api('/api/sync/test');
    el.textContent = r.ok ? '✅ Connected!' : '⚠ Response: ' + r.status;
  } catch (e) {
    el.textContent = '❌ ' + (e.error === 'NO_SCRIPT_URL' ? 'URL is empty' : 'could not connect');
  }
}

function renderRates() {
  $('ratesBody').innerHTML = DB.rates.map((r, i) => `
    <tr><td>${i + 1}</td>
    <td><input data-ri="${i}" data-rf="item" value="${esc(r.item)}"></td>
    <td><input data-ri="${i}" data-rf="unit" value="${esc(r.unit)}" style="width:56px"></td>
    <td><input class="num" data-ri="${i}" data-rf="rate" value="${esc(r.rate)}"></td></tr>`).join('');
  $('ratesBody').querySelectorAll('input').forEach(el => {
    el.addEventListener('input', e => {
      const r = DB.rates[+e.target.dataset.ri];
      r[e.target.dataset.rf] = e.target.dataset.rf === 'rate' ? Number(e.target.value) || 0 : e.target.value;
    });
  });
}

async function saveRates() {
  await api('/api/rates', { method: 'PUT', body: JSON.stringify(DB.rates) });
  $('ratesMsg').textContent = '✅ saved';
  setTimeout(() => $('ratesMsg').textContent = '', 2000);
  if (CUR) { renderMeasure(); renderAbstract(); }
}
