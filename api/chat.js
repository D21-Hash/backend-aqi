// api/chat.js — Vercel Serverless Function
// AI membaca data sensor langsung dari Supabase (server-side), sehingga tetap
// bisa menjawab walau perangkat sedang offline / belum mengirim data baru.

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

function classify(aqi) {
  if (aqi === null) return 'Tidak diketahui';
  if (aqi > 100) return 'BAHAYA';
  if (aqi > 50) return 'WASPADA';
  return 'AMAN';
}

function triggers(pm25, mq2) {
  const out = [];
  const pm = toNum(pm25), gas = toNum(mq2);
  if (pm !== null) out.push(`PM2.5 ${pm > 150 ? 'bahaya' : pm > 50 ? 'waspada' : 'aman'} (${pm} µg/m³; batas waspada >50, bahaya >150)`);
  if (gas !== null) out.push(`Gas MQ-2 ${gas > 2000 ? 'bahaya' : gas > 1000 ? 'waspada' : 'aman'} (${gas} ADC; batas waspada >1000, bahaya >2000)`);
  return out.join('; ');
}

const fmtWib = iso => new Date(iso).toLocaleString('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
}) + ' WIB';

function humanAge(sec) {
  if (sec < 60) return `${Math.round(sec)} detik lalu`;
  if (sec < 3600) return `${Math.round(sec / 60)} menit lalu`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} jam lalu`;
  return `${(sec / 86400).toFixed(1)} hari lalu`;
}

// ---------- Ambil data dari Supabase ----------
async function fetchSensorContext() {
  try {
    const url = `${SUPABASE_URL}/rest/v1/sensor_logs?select=*&order=created_at.desc&limit=20`;
    const r = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      signal: AbortSignal.timeout(6000)
    });
    if (!r.ok) throw new Error(`Supabase HTTP ${r.status}`);
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return { ok: false, text: 'Tabel sensor_logs di Supabase masih kosong (belum ada data yang pernah dikirim).' };

    const latest = rows[0];
    const aqi = calcAqi(latest.pm25, latest.mq2);
    const ageSec = (Date.now() - new Date(latest.created_at).getTime()) / 1000;
    const online = ageSec <= OFFLINE_TIMEOUT_SECONDS;

    // Tren sederhana: nilai terbaru vs rata-rata data sebelumnya (maks 19 data)
    const prev = rows.slice(1).map(x => calcAqi(x.pm25, x.mq2)).filter(v => v !== null);
    let trend = 'belum cukup data untuk tren';
    if (aqi !== null && prev.length >= 3) {
      const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
      const diff = aqi - avg;
      trend = Math.abs(diff) < 3 ? 'stabil' : diff > 0 ? 'cenderung naik' : 'cenderung turun';
    }
    const all = rows.map(x => calcAqi(x.pm25, x.mq2)).filter(v => v !== null);
    const range = all.length ? `AQI terendah ${Math.round(Math.min(...all))}, tertinggi ${Math.round(Math.max(...all))}, dari ${all.length} data terakhir` : '';

    const text = [
      `Perangkat: ${online ? 'ONLINE (mengirim data live)' : 'OFFLINE / tidak mengirim data baru'}`,
      `Data terakhir diterima: ${fmtWib(latest.created_at)} (${humanAge(ageSec)})`,
      `AQI: ${aqi === null ? '-' : Math.round(aqi)} → status ${classify(aqi)}`,
      `PM2.5: ${latest.pm25 ?? '-'} µg/m³`,
      `Gas MQ-2: ${latest.mq2 ?? '-'} ADC`,
      `Suhu: ${latest.temp ?? '-'} °C`,
      `Kelembapan: ${latest.hum ?? '-'} %`,
      `Pemicu status: ${triggers(latest.pm25, latest.mq2)}`,
      `Tren: ${trend}`,
      range
    ].filter(Boolean).join('\n');

    return { ok: true, text };
  } catch (err) {
    return { ok: false, text: `Gagal membaca Supabase (${err.message}).` };
  }
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

    const message = String(body.message || '').trim().slice(0, 1000);
    const clientContext = String(body.context || '').trim().slice(0, 600); // cadangan dari tampilan dashboard
    if (!message) return res.status(400).json({ answer: 'Pesan kosong.' });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ answer: 'API Key (GEMINI_API_KEY) belum dipasang di Vercel.' });
    }

    // Selalu ambil data sensor dari Supabase, tidak bergantung pada perangkat yang sedang mengirim
    const sensor = await fetchSensorContext();
    let dataBlock = sensor.text;
    if (!sensor.ok && clientContext) {
      dataBlock += `\nCadangan dari tampilan dashboard pengguna: ${clientContext}`;
    }

    const systemInstruction = [
      'Kamu adalah Weather-Cube AI, asisten kualitas udara pada dashboard monitoring ESP32.',
      'Jawab dalam bahasa Indonesia yang ramah dan ringkas (2-5 kalimat).',
      'Kamu SUDAH diberi data sensor terbaru dari database di bagian DATA SENSOR. Gunakan data itu untuk pertanyaan tentang kondisi saat ini. JANGAN meminta pengguna menyebutkan data, lokasi, atau angka AQI.',
      'Jika perangkat OFFLINE, tetap analisis data terakhir dan sebutkan kapan data itu diterima.',
      'Jika tabel kosong atau database gagal dibaca, katakan terus terang bahwa data belum tersedia; jangan mengarang angka.',
      'Kategori status: AMAN (AQI ≤ 50), WASPADA (AQI 51-100), BAHAYA (AQI > 100). AQI gabungan dari PM2.5 dan gas MQ-2, diambil yang terburuk.',
      'Untuk pertanyaan umum (misal "apa itu PM2.5"), jawab langsung secara sederhana lalu kaitkan singkat dengan data terkini bila relevan.',
      'Berikan saran kesehatan umum, bukan diagnosis medis.'
    ].join('\n');

    const userText = `DATA SENSOR (dibaca dari Supabase, sekarang ${fmtWib(new Date().toISOString())}):\n${dataBlock}\n\nPERTANYAAN PENGGUNA:\n${message}`;

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
              contents: [{ role: 'user', parts: [{ text: userText }] }],
              generationConfig: { temperature: 0.5, maxOutputTokens: 600 }
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

    return res.status(200).json({ answer: responseText });
  } catch (err) {
    console.error('Chat API Error:', err);
    return res.status(500).json({ answer: `⚠️ Gagal memproses AI: ${err.message}` });
  }
}