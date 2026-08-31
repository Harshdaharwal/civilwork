/* AI Drawing Analysis engine — Claude se drawing padh kar estimate items nikalta hai.
 * Engine 1 (default): claude CLI (Claude Code subscription — koi API key nahi chahiye)
 * Engine 2 (optional): Anthropic API SDK (Settings me API key dalne par)
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

/* ---------- prompt (the estimator brain) ---------- */
function buildPrompt(rates, filePathForCli) {
  const rateList = rates.map(r => `  - id "${r.id}": ${r.item} | unit: ${r.unit} | rate: Rs.${r.rate}`).join('\n');
  return `You are a senior civil quantity surveyor (QS) engineer in India with 25 years of experience preparing detailed estimates from construction drawings (buildings, bridges, ROBs, culverts, roads).

${filePathForCli ? `First, use the Read tool to read the drawing file at: ${filePathForCli}
If it is a PDF, read pages 1-10.` : 'A construction drawing is attached.'}

TASK — analyse the drawing carefully and prepare a detailed quantity estimate:

1. Identify the structure type (house/building, ROB/bridge, culvert, road, retaining wall, etc.).
2. Read EVERY dimension you can. Drawing dimensions in India are usually in mm — CONVERT ALL DIMENSIONS TO METERS in your output.
3. Break the work into measurable items. For each item work out Nos, L, B, H (in meters) exactly as a measurement sheet entry, so that quantity = Nos x L x B x H (blank dimension = 1).
   - For area items (sqm): give Nos, L, B and leave H blank.
   - For linear items (rmt): give Nos, L only.
   - For direct-quantity items (kg, nos, tonne): put the quantity in "nos" and leave L, B, H blank.
4. Map each item to this standard rate list where possible, using the exact id:
${rateList}
5. If an item is NOT in the list (e.g. bored piles, steel girders, elastomeric bearings, reinforced earth wall, expansion joints, wearing coat, crash barrier), set "itemId": null and provide your own "item" name, "unit" and an approximate current Indian market "rate" in Rs. If web search is available to you, search for the current Indian market/CPWD rate of such items instead of guessing (max 3-4 quick searches).
6. The estimate must be COMPLETE for the structure as drawn: always include consequential items even if not explicitly written on the drawing — steel reinforcement for all RCC (use standard thumb rules per cum if no bar schedule), shuttering/centering for all RCC, DPC, plaster on brick surfaces, flooring, painting, doors/windows (assume sizes if not scheduled). Record every such assumption in "assumptions".
7. For deductions (openings in brickwork/plaster etc.) use a NEGATIVE "nos" — that row subtracts from the quantity.
8. Where the drawing does not give a dimension you need, make a sensible engineering assumption and record it in "assumptions".
9. Do NOT add works outside the drawn structure (no compound wall, landscaping, external development etc. unless shown). If a portion is unreadable, list it in "unreadable".

Return ONLY a JSON object (no markdown fences, no commentary) with EXACTLY this shape — put "items" FIRST and keep every item's description short (under 12 words):
{
  "items": [
    {
      "itemId": "r4" | null,
      "item": "item name (required when itemId is null, else may repeat the standard name)",
      "description": "location/element e.g. 'Deck slab span 1'",
      "unit": "cum|sqm|rmt|kg|nos|tonne|LS",
      "rate": number | null,
      "nos": number (negative for deduction rows),
      "L": number | null,
      "B": number | null,
      "H": number | null
    }
  ],
  "structureType": "string",
  "summary": "2-3 line summary of what the drawing shows (English + thodi Hindi mix is fine)",
  "confidence": "high" | "medium" | "low",
  "assumptions": ["string", ...],
  "unreadable": ["string", ...]
}`;
}

/* ---------- robust JSON extraction ---------- */
function extractJson(text) {
  if (!text) throw new Error('Empty AI response');
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in AI response: ' + t.slice(0, 200));
  return JSON.parse(t.slice(start, end + 1));
}

/* ---------- validate + recompute (never trust model arithmetic) ---------- */
function sanitizeResult(raw, rates) {
  const rateMap = Object.fromEntries(rates.map(r => [r.id, r]));
  const numPos = v => {                       // dimensions: positive only
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const numAny = v => {                       // nos: negative allowed (deduction rows)
    const n = Number(v);
    return Number.isFinite(n) && n !== 0 ? n : null;
  };
  const items = (Array.isArray(raw.items) ? raw.items : []).map(it => {
    const known = it.itemId && rateMap[it.itemId] ? rateMap[it.itemId] : null;
    let nos = numAny(it.nos) ?? 1;
    const L = numPos(it.L), B = numPos(it.B), H = numPos(it.H);
    // direct-qty item: if AI put quantity in "qty" instead of "nos", recover it
    if (L === null && B === null && H === null && nos === 1) {
      const q = numAny(it.qty);
      if (q !== null) nos = q;
    }
    // qty always recomputed — never trust model arithmetic; blank dim = 1
    const qty = +(nos * (L ?? 1) * (B ?? 1) * (H ?? 1)).toFixed(3);
    return {
      itemId: known ? it.itemId : '',
      item: known ? known.item : String(it.item || 'Item').slice(0, 160),
      description: String(it.description || '').slice(0, 200),
      unit: known ? known.unit : String(it.unit || '').slice(0, 12),
      rate: known ? known.rate : (Math.abs(numAny(it.rate) ?? 0)),
      nos, L: L ?? '', B: B ?? '', H: H ?? '',
      qty,
    };
  }).filter(it => Number.isFinite(it.qty) && it.qty !== 0);
  if (!items.length) throw new Error('AI ne koi valid item nahi nikala — drawing clear nahi hai ya format issue');

  // completeness warnings — RCC bina steel/shuttering, brickwork bina plaster
  const warnings = [];
  const has = re => items.some(it => re.test(it.item));
  if (has(/RCC|concrete M\d/i)) {
    if (!has(/steel|reinforce/i)) warnings.push('RCC hai par steel reinforcement ka item nahi mila — khud add karo ya dobara AI chalao');
    if (!has(/shutter|centering|formwork/i)) warnings.push('RCC hai par shuttering/centering ka item nahi mila');
  }
  if (has(/brickwork/i) && !has(/plaster/i)) warnings.push('Brickwork hai par plaster ka item nahi mila');

  return {
    structureType: String(raw.structureType || 'Unknown').slice(0, 120),
    summary: String(raw.summary || '').slice(0, 1000),
    confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'medium',
    assumptions: (Array.isArray(raw.assumptions) ? raw.assumptions : []).map(s => String(s).slice(0, 300)).slice(0, 30),
    unreadable: (Array.isArray(raw.unreadable) ? raw.unreadable : []).map(s => String(s).slice(0, 300)).slice(0, 30),
    warnings,
    items,
  };
}

/* ---------- Engine 1: claude CLI ---------- */
function runClaudeCli(prompt, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--output-format', 'json', '--allowedTools', 'Read WebSearch'], {
      shell: true, windowsHide: true,
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'civil-estimate' },
    });
    let out = '', err = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error('AI analysis timeout (' + Math.round(timeoutMs / 60000) + ' min) — bada PDF hai to ek page ki image upload karke try karo'));
    }, timeoutMs);
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('error', e => { clearTimeout(timer); reject(new Error('claude CLI launch failed: ' + e.message)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 && !out.trim()) return reject(new Error('claude CLI exit ' + code + ': ' + (err || out).slice(0, 300)));
      try {
        const envelope = JSON.parse(out);
        if (envelope.is_error) return reject(new Error('claude CLI error: ' + String(envelope.result).slice(0, 300)));
        resolve(envelope.result ?? out);
      } catch {
        resolve(out); // not an envelope — treat as raw text
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/* ---------- Engine 2: Google Gemini API (FREE tier) ---------- */
async function runGemini(prompt, filePath, geminiKey) {
  // 503 (high demand) par 2 baar auto-retry, 20s gap se
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await runGeminiOnce(prompt, filePath, geminiKey);
    } catch (e) {
      lastErr = e;
      if (attempt < 3 && /503|high demand|UNAVAILABLE|overloaded/i.test(String(e.message))) {
        await new Promise(r => setTimeout(r, 20000));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function runGeminiOnce(prompt, filePath, geminiKey) {
  const ext = path.extname(filePath).toLowerCase();
  const data = fs.readFileSync(filePath).toString('base64');
  const mime = ext === '.pdf' ? 'application/pdf' : (MIME[ext] || 'image/png');
  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5 * 60 * 1000);
  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: mime, data } }, { text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 65536, temperature: 0.2 },
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      if (resp.status === 429) throw new Error('Gemini free quota abhi khatam hai — 1-2 minute baad dobara try karo');
      if ((resp.status === 400 || resp.status === 403) && /API key|permission/i.test(errText)) throw new Error('Gemini API key galat/expired hai — aistudio.google.com se nayi key banao aur Settings me dalo');
      throw new Error('Gemini API error ' + resp.status + ': ' + errText.slice(0, 200));
    }
    const json = await resp.json();
    const cand = json.candidates && json.candidates[0];
    const parts = (cand && cand.content && cand.content.parts) || [];
    const text = parts.map(p => p.text || '').join('');
    if (!text) throw new Error('Gemini se khali jawab aaya' + (cand && cand.finishReason ? ' (' + cand.finishReason + ')' : '') + ' — dobara try karo');
    return text;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Gemini analysis timeout (5 min) — chhoti/saaf image se try karo');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Engine 3: Anthropic API SDK ---------- */
async function runApi(prompt, filePath, apiKey) {
  const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const ext = path.extname(filePath).toLowerCase();
  const data = fs.readFileSync(filePath).toString('base64');
  const fileBlock = ext === '.pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: MIME[ext] || 'image/png', data } };

  const stream = client.messages.stream({
    model: 'claude-opus-5',
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }],
    messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: prompt }] }],
  });
  const response = await stream.finalMessage();
  if (response.stop_reason === 'refusal') {
    throw new Error('AI ne request decline kar di' + (response.stop_details ? ' (' + response.stop_details.category + ')' : ''));
  }
  let text = '';
  for (const block of response.content) if (block.type === 'text') text += block.text;
  return text;
}

/* ---------- main entry ---------- */
async function analyzeDrawing({ filePath, rates, apiKey, geminiKey }) {
  const ext = path.extname(filePath).toLowerCase();
  if (!MIME[ext] && ext !== '.pdf') {
    throw new Error('Yeh file format AI nahi padh sakta (' + ext + ') — PNG, JPG, WEBP, GIF ya PDF upload karo. DWG/DXF ko PDF me export kar lo. Phone photo (HEIC) ho to JPG me convert karo.');
  }
  // Engine priority: Gemini (free) > Anthropic API > claude CLI (sirf local)
  let text;
  if (geminiKey) {
    text = await runGemini(buildPrompt(rates, null), filePath, geminiKey);
  } else if (apiKey) {
    text = await runApi(buildPrompt(rates, null), filePath, apiKey);
  } else if (process.env.VERCEL) {
    throw new Error('Online (Vercel) version par AI ke liye key chahiye — FREE Gemini key aistudio.google.com se banao aur Vercel me GEMINI_API_KEY environment variable set karo (ya app Settings me dalo). Bina key ke AI sirf localhost par chalta hai (Claude Code se).');
  } else {
    text = await runClaudeCli(buildPrompt(rates, filePath), 8 * 60 * 1000);
  }
  return sanitizeResult(extractJson(text), rates);
}

module.exports = { analyzeDrawing };
