import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { city = 'Jakarta' } = req.body;

    // Ambil data AQI live dari API publik (contoh: WAQI)
    const waqiRes = await fetch(
      `https://api.waqi.info/feed/${city}/?token=${process.env.WAQI_API_KEY}`
    );
    const waqiData = await waqiRes.json();

    if (waqiData.status !== 'ok') {
      return res.status(400).json({ error: 'Gagal mengambil data AQI live' });
    }

    const { aqi, city: cityDetail, iaqi } = waqiData.data;

    // Analisis data pakai AI Gemini
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `
Analisis data kualitas udara (AQI) berikut dan berikan ringkasan kesehatan serta rekomendasi singkat:
- Lokasi: ${cityDetail.name}
- Skor AQI: ${aqi}
- Detail Polutan: ${JSON.stringify(iaqi)}

Tolong berikan respons dalam bentuk:
1. Status Kualitas Udara
2. Ringkasan Dampak Kesehatan
3. Rekomendasi Aktivitas Sehari-hari
`;

    const result = await model.generateContent(prompt);
    const aiAnalysis = result.response.text();

    // Simpan log analisis ke Supabase
    await supabase.from('aqi_logs').insert([
      {
        city: cityDetail.name,
        aqi,
        analysis: aiAnalysis,
        created_at: new Date().toISOString(),
      },
    ]);

    return res.status(200).json({
      success: true,
      data: {
        city: cityDetail.name,
        aqi,
        analysis: aiAnalysis,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}