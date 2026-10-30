// api/chat.js — Vercel Serverless Function
// AI membaca data sensor langsung dari Supabase (server-side), sehingga tetap
// bisa menjawab walau perangkat sedang offline / belum mengirim data baru.
// Mendukung jawaban multi-bahasa: id, en, zh, es, ar (dikirim dari dashboard lewat field "lang").

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rkhbttzscoqceeuemrlq.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJraGJ0dHpzY29xY2VldWVtcmxxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3MTIxNTUsImV4cCI6MjEwODI4ODE1NX0.T5SFF5XNgOYh2WF4JRIqJoGN02lT6pXhSAoPlXCQXqs';
const OFFLINE_TIMEOUT_SECONDS = 45; // samakan dengan index.html

const DEFAULT_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-4-argon',
  // cadangan terakhir bila semua model di atas gagal
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
];
// Bisa di-override lewat env: GEMINI_MODELS="modelA,modelB"
const MODELS = process.env.GEMINI_MODELS
  ? process.env.GEMINI_MODELS.split(',').map(s => s.trim()).filter(Boolean)
  : DEFAULT_MODELS;

// Kata status HARUS sama dengan LANGS[x].tok di index.html agar lencana warna di chat muncul.
const LANGS = {
  id: { name: 'Indonesian (Bahasa Indonesia)', loc: 'id-ID', tok: ['AMAN', 'WASPADA', 'BAHAYA'], advice: 'Saran' },
  en: { name: 'English', loc: 'en-GB', tok: ['SAFE', 'WARNING', 'DANGER'], advice: 'Advice' },
  zh: { name: 'Simplified Chinese (简体中文)', loc: 'zh-CN', tok: ['安全', '警戒', '危险'], advice: '建议' },
  es: { name: 'Spanish (Español)', loc: 'es-ES', tok: ['SEGURO', 'PRECAUCIÓN', 'PELIGRO'], advice: 'Consejo' },
  ar: { name: 'Arabic (العربية)', loc: 'ar-u-nu-latn', tok: ['آمن', 'تحذير', 'خطر'], advice: 'نصيحة' }
};

// ---------- AQI & status (HARUS sama dengan Arduino & index.html) ----------
const toNum = v => (v === null || v === undefined || v === '' || !isFinite(Number(v))) ? null : Number(v);

function calcAqi(pm25, mq2) {
  const pm = toNum(pm25), gas = toNum(mq2);
  if (pm === null && gas === null) return null;
  const p = Math.max(0, pm ?? 0), g = Math.max(0, gas ?? 0);

  const aqiPm = p <= 50 ? p : p <= 150 ? 50 + (p - 50) * 0.5 : 100 + (p - 150);
  const aqiGas = g <= 1000 ? g * 0.05 : g <= 2000 ? 50 + (g - 1000) * 0.05 : 100 + (g - 2000) * 0.05;
  return Math.min(500, Math.max(aqiPm, aqiGas));
}

const sevOf = aqi => (aqi === null ? null : aqi > 100 ? 2 : aqi > 50 ? 1 : 0);
const statusWord = (aqi, L) => (aqi === null ? 'N/A' : L.tok[sevOf(aqi)]);

function triggers(pm25, mq2, L) {
  const out = [];
  const pm = toNum(pm25), gas = toNum(mq2);
  if (pm !== null) out.push(`PM2.5 ${L.tok[pm > 150 ? 2 : pm > 50 ? 1 : 0]} (${pm} ug/m3; warning above 50, danger above 150)`);
  if (gas !== null) out.push(`MQ-2 gas ${L.tok[gas > 2000 ? 2 : gas > 1000 ? 1 : 0]} (${gas} ADC; warning above 1000, danger above 2000)`);
  return out.join('; ');
}

const fmtWib = (iso, L) => new Date(iso).toLocaleString(L.loc, {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
}) + ' WIB';

function humanAge(sec) {
  if (sec < 60) return `${Math.round(sec)} seconds ago`;
  if (sec < 3600) return `${Math.round(sec / 60)} minutes ago`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} hours ago`;
  return `${(sec / 86400).toFixed(1)} days ago`;
}

// ---------- Ambil data dari Supabase ----------
async function fetchSensorContext(L) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/sensor_logs?select=*&order=created_at.desc&limit=20`;
    const r = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      signal: AbortSignal.timeout(6000)
    });
    if (!r.ok) throw new Error(`Supabase HTTP ${r.status}`);
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return { ok: false, text: 'The sensor_logs table in Supabase is still empty (the device has never sent data).' };

    const latest = rows[0];
    const aqi = calcAqi(latest.pm25, latest.mq2);
    const ageSec = (Date.now() - new Date(latest.created_at).getTime()) / 1000;
    const online = ageSec <= OFFLINE_TIMEOUT_SECONDS;

    // Tren sederhana: nilai terbaru vs rata-rata data sebelumnya (maks 19 data)
    const prev = rows.slice(1).map(x => calcAqi(x.pm25, x.mq2)).filter(v => v !== null);
    let trend = 'not enough data for a trend';
    if (aqi !== null && prev.length >= 3) {
      const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
      const diff = aqi - avg;
      trend = Math.abs(diff) < 3 ? 'stable' : diff > 0 ? 'tending to rise' : 'tending to fall';
    }
    const all = rows.map(x => calcAqi(x.pm25, x.mq2)).filter(v => v !== null);
    const range = all.length ? `Lowest AQI ${Math.round(Math.min(...all))}, highest ${Math.round(Math.max(...all))}, from the last ${all.length} readings` : '';

    const text = [
      `Device: ${online ? 'ONLINE (sending live data)' : 'OFFLINE / not sending new data'}`,
      `Last data received: ${fmtWib(latest.created_at, L)} (${humanAge(ageSec)})`,
      `AQI: ${aqi === null ? '-' : Math.round(aqi)} -> status ${statusWord(aqi, L)}`,
      `PM2.5: ${latest.pm25 ?? '-'} ug/m3`,
      `MQ-2 gas: ${latest.mq2 ?? '-'} ADC`,
      `Temperature: ${latest.temp ?? '-'} C`,
      `Humidity: ${latest.hum ?? '-'} %`,
      `Status triggers: ${triggers(latest.pm25, latest.mq2, L)}`,
      `Trend: ${trend}`,
      range
    ].filter(Boolean).join('\n');

    return { ok: true, text };
  } catch (err) {
    return { ok: false, text: `Failed to read Supabase (${err.message}).` };
  }
}

// ---------- Riwayat percakapan (agar AI paham pertanyaan lanjutan) ----------
function buildContents(history, finalText) {
  const out = [];
  for (const h of (Array.isArray(history) ? history : []).slice(-6)) {
    const role = h && h.role === 'user' ? 'user' : 'model';
    const text = String((h && h.text) || '').slice(0, 600).trim();
    if (!text) continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].parts[0].text += '\n' + text;
    else out.push({ role, parts: [{ text }] });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (out.length && out[out.length - 1].role === 'user') out.pop(); // hindari dua giliran user berurutan
  out.push({ role: 'user', parts: [{ text: finalText }] });
  return out;
}

// ---------- Rapikan keluaran AI: tanpa tanda bintang markdown ----------
function cleanAnswer(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/^\s*[*•]\s+/gm, '- ')      // bullet * -> -
    .replace(/\*\*(.+?)\*\*/g, '$1')     // **tebal** -> tebal
    .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|[.,!?:;)]|$)/g, '$1$2') // *miring*
    .replace(/\*/g, '')                  // sisa tanda bintang
    .replace(/^#{1,4}\s+/gm, '')         // heading markdown
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------- Handler ----------
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
    body = body || {};

    const L = LANGS[body.lang] || LANGS.id;
    const message = String(body.message || '').trim().slice(0, 1000);
    const clientContext = String(body.context || '').trim().slice(0, 600); // cadangan dari tampilan dashboard
    if (!message) return res.status(400).json({ answer: '...' });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ answer: 'API Key (GEMINI_API_KEY) belum dipasang di Vercel.' });
    }

    // Selalu ambil data sensor dari Supabase, tidak bergantung pada perangkat yang sedang mengirim
    const sensor = await fetchSensorContext(L);
    let dataBlock = sensor.text;
    if (!sensor.ok && clientContext) {
      dataBlock += `\nFallback from the user's dashboard view: ${clientContext}`;
    }

    const systemInstruction = [
      'You are Weather-Cube AI, the air quality assistant of an ESP32 monitoring dashboard.',
      `Reply ONLY in ${L.name}, in a friendly and concise tone, whatever language the user or the data block uses.`,
      'You are ALREADY given the latest sensor data from the database in the SENSOR DATA block. Use it for questions about current conditions. NEVER ask the user for data, location or an AQI number.',
      'If the device is OFFLINE, still analyze the last data and say when it was received.',
      'If the table is empty or the database could not be read, say so honestly; never invent numbers.',
      `Status words, from best to worst: ${L.tok[0]} (AQI <= 50), ${L.tok[1]} (AQI 51-100), ${L.tok[2]} (AQI > 100). AQI combines PM2.5 and MQ-2 gas, taking the worse of the two.`,
      'STRICT FORMAT: never use asterisks (*), bold/italic markdown or # headings.',
      `For a condition analysis: line 1 is a one-sentence summary that contains exactly one status word (${L.tok.join(' / ')}) written exactly as shown, plus the AQI value. Then 2-3 short points, each starting with "- ". Finally one line starting with "${L.advice}: ".`,
      'Separate sections with one blank line. Each point is one short sentence.',
      'For general questions (for example "what is PM2.5"), answer directly in simple words (max 4 sentences) and briefly tie it to the current data when relevant.',
      'Give general health advice, not medical diagnosis.'
    ].join('\n');

    const userText = `SENSOR DATA (read from Supabase, now ${fmtWib(new Date().toISOString(), L)}):\n${dataBlock}\n\nUSER QUESTION:\n${message}`;
    const contents = buildContents(body.history, userText);

    let responseText = null;
    let lastError = null;

    for (const modelName of MODELS) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(15000),
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemInstruction }] },
              contents,
              generationConfig: { temperature: 0.5, maxOutputTokens: 700 }
            })
          }
        );

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();

        if (response.ok && text) {
          responseText = text;
          break;
        } else {
          lastError = data.error?.message || `HTTP status ${response.status} pada ${modelName}`;
        }
      } catch (err) {
        lastError = `${modelName}: ${err.message}`;
      }
    }

    if (!responseText) {
      throw new Error(lastError || 'Semua model Gemini gagal merespons.');
    }

    return res.status(200).json({ answer: cleanAnswer(responseText) });
  } catch (err) {
    console.error('Chat API Error:', err);
    return res.status(500).json({ answer: `⚠️ ${err.message}` });
  }
}