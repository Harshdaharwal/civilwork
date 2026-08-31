/* Civil Estimate WebApp - server */
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { analyzeDrawing } = require('./analyze');

const app = express();
const PORT = process.env.PORT || 3000;
// Vercel/serverless par sirf /tmp writable hota hai (ephemeral — demo ke liye);
// local par project folder me hi data rehta hai (permanent)
const IS_SERVERLESS = !!process.env.VERCEL;
const DATA_FILE = IS_SERVERLESS ? '/tmp/civil-data/db.json' : path.join(__dirname, 'data', 'db.json');
const UPLOAD_DIR = IS_SERVERLESS ? '/tmp/civil-uploads' : path.join(__dirname, 'uploads');

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

/* ---------- tiny JSON db ---------- */
const DEFAULT_RATES = [
  { id: 'r1',  item: 'Earthwork in excavation in foundation', unit: 'cum', rate: 220 },
  { id: 'r2',  item: 'Sand filling in plinth', unit: 'cum', rate: 950 },
  { id: 'r3',  item: 'PCC 1:4:8 in foundation', unit: 'cum', rate: 5200 },
  { id: 'r4',  item: 'RCC M20 work (excl. steel & shuttering)', unit: 'cum', rate: 7800 },
  { id: 'r5',  item: 'Steel reinforcement Fe500 (supply + fixing)', unit: 'kg', rate: 75 },
  { id: 'r6',  item: 'Shuttering / Centering', unit: 'sqm', rate: 420 },
  { id: 'r7',  item: 'DPC 40mm thick CC 1:2:4', unit: 'sqm', rate: 480 },
  { id: 'r8',  item: 'Brickwork in CM 1:6', unit: 'cum', rate: 6200 },
  { id: 'r9',  item: '12mm Cement plaster 1:4', unit: 'sqm', rate: 320 },
  { id: 'r10', item: 'Vitrified tile flooring', unit: 'sqm', rate: 1250 },
  { id: 'r11', item: 'Painting - primer + 2 coats emulsion', unit: 'sqm', rate: 180 },
  { id: 'r12', item: 'Doors & Windows (supply + fixing)', unit: 'sqm', rate: 5500 },
  { id: 'r13', item: 'Anti-termite treatment', unit: 'sqm', rate: 120 },
  { id: 'r14', item: 'Roof waterproofing treatment', unit: 'sqm', rate: 550 },
];

function defaultDb() {
  return {
    settings: {
      scriptUrl: '',
      sheetId: '1MhPRSmdoXu-D9dCeM5OL6_LGoPxagnszUOAARZmCZ2o',
      contingency: 3,
      electrification: 8,
      plumbing: 8,
      gst: 18,
    },
    rates: DEFAULT_RATES,
    projects: [],
  };
}

function loadDb() {
  try {
    const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!db.rates || !db.rates.length) db.rates = DEFAULT_RATES;
    if (!db.settings) db.settings = defaultDb().settings;
    if (!db.projects) db.projects = [];
    return db;
  } catch {
    return defaultDb();
  }
}
function saveDb(db) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- uploads ---------- */
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, Date.now() + '_' + safe);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(png|jpe?g|gif|webp|bmp|pdf|dwg|dxf)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only image / PDF / DWG / DXF files allowed'), ok);
  },
});

/* ---------- API ---------- */
app.get('/api/state', (req, res) => res.json(loadDb()));

app.post('/api/projects', (req, res) => {
  const db = loadDb();
  const p = {
    id: uid(),
    name: req.body.name || 'Untitled Project',
    client: req.body.client || '',
    location: req.body.location || '',
    date: req.body.date || new Date().toISOString().slice(0, 10),
    drawings: [],
    measurements: [],
    notes: '',
    createdAt: new Date().toISOString(),
  };
  db.projects.push(p);
  saveDb(db);
  res.json(p);
});

app.put('/api/projects/:id', (req, res) => {
  const db = loadDb();
  const p = db.projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const allowed = ['name', 'client', 'location', 'date', 'measurements', 'notes'];
  for (const k of allowed) if (k in req.body) p[k] = req.body[k];
  saveDb(db);
  res.json(p);
});

app.delete('/api/projects/:id', (req, res) => {
  const db = loadDb();
  const p = db.projects.find(x => x.id === req.params.id);
  if (p) {
    for (const d of p.drawings || []) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, d.filename)); } catch {}
    }
  }
  db.projects = db.projects.filter(x => x.id !== req.params.id);
  saveDb(db);
  res.json({ ok: true });
});

app.post('/api/projects/:id/drawings', upload.array('drawings', 20), (req, res) => {
  const db = loadDb();
  const p = db.projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const added = (req.files || []).map(f => ({
    id: uid(),
    filename: f.filename,
    original: f.originalname,
    size: f.size,
    uploadedAt: new Date().toISOString(),
  }));
  p.drawings.push(...added);
  saveDb(db);
  res.json(added);
});

app.delete('/api/projects/:id/drawings/:did', (req, res) => {
  const db = loadDb();
  const p = db.projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const d = p.drawings.find(x => x.id === req.params.did);
  if (d) { try { fs.unlinkSync(path.join(UPLOAD_DIR, d.filename)); } catch {} }
  p.drawings = p.drawings.filter(x => x.id !== req.params.did);
  saveDb(db);
  res.json({ ok: true });
});

/* ---------- AI drawing analysis ---------- */
app.post('/api/projects/:id/drawings/:did/analyze', async (req, res) => {
  const db = loadDb();
  const p = db.projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const d = p.drawings.find(x => x.id === req.params.did);
  if (!d) return res.status(404).json({ error: 'Drawing not found' });
  const filePath = path.join(UPLOAD_DIR, d.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Drawing file missing on disk' });
  try {
    const result = await analyzeDrawing({
      filePath,
      rates: db.rates,
      apiKey: (db.settings.apiKey || process.env.ANTHROPIC_API_KEY || '').trim() || null,
    });
    // save analysis with the drawing for later reference
    const db2 = loadDb();
    const p2 = db2.projects.find(x => x.id === req.params.id);
    const d2 = p2 && p2.drawings.find(x => x.id === req.params.did);
    if (d2) { d2.analysis = { ...result, analyzedAt: new Date().toISOString() }; saveDb(db2); }
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.put('/api/settings', (req, res) => {
  const db = loadDb();
  db.settings = { ...db.settings, ...req.body };
  saveDb(db);
  res.json(db.settings);
});

app.put('/api/rates', (req, res) => {
  const db = loadDb();
  if (Array.isArray(req.body)) db.rates = req.body;
  saveDb(db);
  res.json(db.rates);
});

/* ---------- estimate calc ---------- */
function computeAbstract(db, p) {
  const rateMap = Object.fromEntries(db.rates.map(r => [r.id, r]));
  const groups = {};
  for (const m of p.measurements || []) {
    const key = m.itemId || ('c:' + (m.item || m.description || 'Item'));
    if (!groups[key]) {
      const r = rateMap[m.itemId];
      groups[key] = {
        item: r ? r.item : (m.item || m.description || 'Item'),
        unit: r ? r.unit : (m.unit || ''),
        rate: r ? r.rate : (Number(m.rate) || 0),
        qty: 0,
      };
    }
    groups[key].qty += Number(m.qty) || 0;
  }
  const rows = Object.values(groups).map((g, i) => ({
    sno: i + 1, ...g, qty: +g.qty.toFixed(2), amount: +(g.qty * g.rate).toFixed(2),
  }));
  const civil = rows.reduce((s, r) => s + r.amount, 0);
  const s = db.settings;
  const elect = civil * (s.electrification || 0) / 100;
  const plumb = civil * (s.plumbing || 0) / 100;
  const cont = civil * (s.contingency || 0) / 100;
  const sub = civil + elect + plumb + cont;
  const gst = sub * (s.gst || 0) / 100;
  return { rows, civil, elect, plumb, cont, sub, gst, grand: sub + gst };
}

/* ---------- Google Sheet sync via Apps Script webhook ---------- */
app.post('/api/sync/:id', async (req, res) => {
  const db = loadDb();
  const p = db.projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const url = (db.settings.scriptUrl || '').trim();
  if (!url) return res.status(400).json({ error: 'NO_SCRIPT_URL' });

  const abstract = computeAbstract(db, p);
  const rateMap = Object.fromEntries(db.rates.map(r => [r.id, r]));
  const payload = {
    action: 'sync',
    project: {
      id: p.id, name: p.name, client: p.client, location: p.location,
      date: p.date, grandTotal: +abstract.grand.toFixed(2),
      syncedAt: new Date().toISOString(),
    },
    measurements: (p.measurements || []).map(m => ({
      item: rateMap[m.itemId] ? rateMap[m.itemId].item : (m.item || m.description || ''),
      description: m.description || '',
      unit: rateMap[m.itemId] ? rateMap[m.itemId].unit : (m.unit || ''),
      nos: m.nos, L: m.L, B: m.B, H: m.H, qty: m.qty,
    })),
    abstract: abstract.rows,
    summary: {
      civil: +abstract.civil.toFixed(2),
      electrification: +abstract.elect.toFixed(2),
      plumbing: +abstract.plumb.toFixed(2),
      contingency: +abstract.cont.toFixed(2),
      gst: +abstract.gst.toFixed(2),
      grandTotal: +abstract.grand.toFixed(2),
    },
  };

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });
    const text = await r.text();
    let out; try { out = JSON.parse(text); } catch { out = { raw: text.slice(0, 300) }; }
    if (!r.ok) return res.status(502).json({ error: 'Apps Script error', detail: out });
    res.json({ ok: true, result: out });
  } catch (e) {
    res.status(502).json({ error: 'Could not reach Apps Script URL', detail: String(e) });
  }
});

app.get('/api/sync/test', async (req, res) => {
  const db = loadDb();
  const url = (db.settings.scriptUrl || '').trim();
  if (!url) return res.status(400).json({ error: 'NO_SCRIPT_URL' });
  try {
    const r = await fetch(url, { redirect: 'follow' });
    const text = await r.text();
    res.json({ ok: r.ok, status: r.status, body: text.slice(0, 300) });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e) });
  }
});

// Vercel serverless me app export hota hai; local par seedha listen
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('');
    console.log('  Civil Estimate WebApp chal raha hai:');
    console.log('  >>  http://localhost:' + PORT);
    console.log('');
  });
}

module.exports = app;
