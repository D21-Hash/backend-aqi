require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Konfigurasi Supabase (Membaca murni dari variabel lingkungan)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// 2. Konfigurasi Gemini AI (Membaca murni dari variabel lingkungan)
const geminiApiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(geminiApiKey);

// 3. Konfigurasi EMQX MQTT Broker
const mqttOptions = {
  host: process.env.MQTT_HOST || 'h181dd71.ala.asia-southeast1.emqxsl.com',
  port: process.env.MQTT_PORT ? parseInt(process.env.MQTT_PORT) : 8883,
  protocol: 'mqtts',
  username: process.env.MQTT_USERNAME || 'Daniel',
  password: process.env.MQTT_PASSWORD || 'ESLS',
};

const mqttClient = mqtt.connect(mqttOptions);

mqttClient.on('connect', () => {
  console.log('✅ MQTT Broker Terhubung!');
  mqttClient.subscribe('kualitas_udara/data');
});

mqttClient.on('message', async (topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    await supabase.from('log_kualitas_udara').insert([
      {
        pm25: payload.pm25,
        co2: payload.co2,
        aqi: payload.aqi,
      },
    ]);
    console.log('📥 Data disimpan ke Supabase:', payload);
  } catch (err) {
    console.error('❌ Gagal menyimpan data MQTT:', err.message);
  }
});

// 4. Endpoint Chatbot AI (Tanya-Jawab AQI)
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Pesan tidak boleh kosong' });
    }

    // Ambil 15 data log kualitas udara terbaru dari Supabase sebagai konteks AI
    const { data: logs, error } = await supabase
      .from('log_kualitas_udara')
      .select('created_at, pm25, co2, aqi')
      .order('id', { ascending: false })
      .limit(15);

    if (error) {
      throw error;
    }

    // Format data log menjadi teks agar dipahami AI
    const contextData = JSON.stringify(logs, null, 2);

    // Instruksi sistem untuk Gemini AI
    const prompt = `
Kamu adalah Asisten Pakar Kualitas Udara untuk sistem pemantauan AQI.
Berikut adalah 15 data riwayat kualitas udara terbaru dari sensor ESP32 (dalam JSON):
${contextData}

Pertanyaan pengguna: "${message}"

Tugasmu:
1. Jawab pertanyaan pengguna secara akurat berdasarkan data riwayat di atas.
2. Berikan analisis ringkas mengenai tren AQI/PM2.5/CO2 jika ditanyakan.
3. Berikan saran kesehatan yang praktis dan relevan jika kondisi udara buruk.
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server Backend & AI berjalan di port ${PORT}`);
});