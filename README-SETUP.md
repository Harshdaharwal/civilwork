# 🏗️ Civil Estimate WebApp — Setup Guide (हिंदी में)

Civil work के लिए app: **drawing upload → estimate बनाओ → Google Sheet में save करो।**

---

## 1️⃣ App चलाना (localhost)

Project folder में terminal खोलकर:

```
npm install
npm start
```

फिर browser में खोलो: **http://localhost:3000**

बस! App चल गई। Data local में `data/db.json` में भी save होता रहता है (offline backup)।

---

## 2️⃣ Google Sheet से जोड़ना (एक बार का setup — 5 मिनट)

आपकी sheet: https://docs.google.com/spreadsheets/d/1MhPRSmdoXu-D9dCeM5OL6_LGoPxagnszUOAARZmCZ2o/edit

Google किसी भी app को बिना permission के sheet में लिखने नहीं देता, इसलिए एक छोटा सा **Apps Script** (Google का free tool) sheet में लगाना होगा:

1. अपनी **Google Sheet खोलो** (ऊपर वाला link)
2. Menu में जाओ: **Extensions → Apps Script**
3. जो भी code पहले से दिख रहा है उसे **delete** कर दो
4. इस project के folder में `apps-script/Code.gs` file खोलो, **पूरा code copy** करके Apps Script editor में **paste** कर दो
5. **💾 Save** (Ctrl+S) दबाओ
6. ऊपर right में **Deploy → New deployment** दबाओ
7. ⚙️ (gear icon) → **Web app** चुनो
8. Settings ऐसे रखो:
   - **Execute as:** `Me` (आपका अपना account)
   - **Who has access:** `Anyone`
9. **Deploy** दबाओ → Google permission माँगेगा → **Authorize** करो (अपना account चुनो → Advanced → Go to project → Allow)
10. जो **Web app URL** मिलेगा (`https://script.google.com/macros/s/...../exec`) उसे **copy** करो
11. अब app में जाओ (http://localhost:3000) → **⚙️ Settings** → URL paste करो → **Save** → **Test Connection** ✅

अब **💰 Abstract of Cost** tab में **🔄 Save to Google Sheet** दबाते ही data आपकी sheet में चला जाएगा — 3 tabs अपने आप बनेंगे:

| Tab | क्या save होता है |
|---|---|
| **Projects** | Project name, client, location, grand total |
| **Measurements** | पूरी measurement sheet (Nos × L × B × H) |
| **Abstract** | Item-wise cost + GST + Grand Total |

दोबारा sync करने पर उसी project की पुरानी rows update हो जाती हैं (duplicate नहीं बनतीं)।

---

## 3️⃣ App कैसे use करें

1. **＋ New Project** — project बनाओ (name, client, location)
2. **📐 Drawings** — drawing upload करो (PDF / JPG / PNG / DWG)
   - 🤖 **Upload होते ही AI पूछेगा** — "AI se estimate banayein?" → OK दबाओ → Claude drawing पढ़कर items, dimensions, quantities खुद निकालेगा → review करके एक click में measurement sheet + abstract बन जाएगा
   - AI analysis आपके computer पर installed **Claude Code** से चलती है — कोई API key नहीं चाहिए (1-5 min लगते हैं)
   - House, building, **ROB/bridge, culvert, road** — सब type की drawings समझता है; जो item rate-list में नहीं है (piles, girders, bearings…) उसे custom item बनाकर approximate rate भी देता है
   - AI हर assumption लिखकर देता है — tender/bill से पहले verify कर लेना
3. **⚡ Quick Estimate** — drawing side में देखते हुए built-up area, floors, structure type डालो → **Generate** दबाओ → पूरा item-wise estimate ban jayega (standard thumb-rule से)
4. **📏 Measurement Sheet** — हर item की exact measurement (Nos, L, B, H) drawing से डालकर fine-tune करो — quantity अपने आप calculate होती है
5. **💰 Abstract of Cost** — final estimate: rates × qty, Electrification %, Plumbing %, Contingency %, GST % → **Grand Total**
   - **🖨 Print / PDF** — client को देने के लिए
   - **⬇ CSV** — Excel में खोलने के लिए
   - **🔄 Save to Google Sheet** — आपकी sheet में save
6. **⚙️ Settings** — अपने area के हिसाब से **rates edit** करो (SOR)

> ⚠️ Quick Estimate के quantities standard thumb-rule (approximate) हैं। Tender/bill के लिए Measurement Sheet में drawing से exact dimensions डालो।

---

## Files

- `server.js` — Node.js server (port 3000)
- `public/` — app UI
- `data/db.json` — सारा data local backup
- `uploads/` — uploaded drawings
- `apps-script/Code.gs` — Google Sheet में paste करने वाला code

---

## 6️⃣ Internet पर live करना (Vercel)

Code GitHub पर है: **https://github.com/Harshdaharwal/civilwork**

### Vercel पर deploy (एक बार, ~2 minute):
1. [vercel.com](https://vercel.com) पर GitHub से login करो
2. **Add New → Project** → `civilwork` repo **Import** करो
3. कुछ मत बदलो, सीधा **Deploy** दबाओ
4. 🤖 AI online चलाने के लिए (🆓 **FREE — Google Gemini**):
   - [aistudio.google.com/apikey](https://aistudio.google.com/apikey) खोलो → Google से login → **Create API key** → key copy करो (बिल्कुल free, कोई card नहीं)
   - Vercel में Project → **Settings → Environment Variables** → naam `GEMINI_API_KEY`, value में वो key → Save
   - **Deployments** tab → latest → ⋯ → **Redeploy**
   - (Paid option: `ANTHROPIC_API_KEY` — best quality, [console.anthropic.com](https://console.anthropic.com) से)

### ⚠️ Online version की limitations (जान लो):
- **Data temporary है** — Vercel पर projects/drawings कुछ time बाद reset हो सकते हैं। **रोज़ के काम के लिए localhost use करो** (data permanent रहता है), final estimate Google Sheet में sync कर लो — वो हमेशा safe है
- Online पर drawing upload **max ~4 MB** (localhost पर 50 MB)
- Online पर AI के लिए Gemini की free key ज़रूरी है (localhost पर Claude Code से बिना key चलता है)

### 🔒 Security:
- API key, projects data, drawings — **कुछ भी GitHub पर नहीं जाता** (.gitignore में block है)
- API key सिर्फ Vercel के Environment Variables में डालो — कभी code/README में मत लिखो
