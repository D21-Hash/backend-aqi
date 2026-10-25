require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Konfigurasi Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// 2. Konfigurasi Gemini AI
const geminiApiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(geminiApiKey);

// 3. Endpoint Chatbot AI
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Pesan tidak boleh kosong' });
    }

    const { data: logs, error } = await supabase
      .from('log_kualitas_udara')
      .select('created_at, pm25, co2, aqi')
      .order('id', { ascending: false })
      .limit(15);

    if (error) {
      throw error;
    }

    const contextData = JSON.stringify(logs, null, 2);

    const prompt = `
Kamu adalah Asisten Pakar Kualitas Udara untuk sistem pemantauan AQI.
Berikut adalah 15 data riwayat kualitas udara terbaru dari sensor ESP32 (dalam JSON):
${contextData}

Pertanyaan pengguna: "${message}"

Tugasmu:
1. Jawab pertanyaan pengguna secara akurat berdasarkan data riwayat di atas.
2. Berikan analisis ringkas mengenai tren AQI/PM2.5/CO2 jika ditanyakan.
3. Berikan saran kesehatan yang practical dan relevan jika kondisi udara buruk.
Gunakan bahasa Indonesia yang ramah, jelas, dan profesional.
    `;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    res.json({ answer: responseText });
  } catch (err) {
    console.error('❌ Error AI Endpoint:', err);
    res.status(500).json({ error: 'Gagal memproses pertanyaan AI' });
  }
});

module.exports = app;