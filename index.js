const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

// Mengizinkan Express melayani file HTML statis (index.html & setup.html)
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/setup.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'setup.html'));
});

// Endpoint backend AI Chatbot (dengan Fallback Model otomatis)
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ answer: 'API Key (GEMINI_API_KEY) belum terpasang di Vercel.' });
    }

    // Daftar model cadangan jika model utama sedang tinggi beban (high demand)
    const models = [
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-1.5-pro'
    ];

    let lastError = null;
    let reply = null;

    for (const model of models) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: `Kamu adalah AI Analytics untuk sistem monitoring kualitas udara real-time. Berikan analisis atau jawaban yang singkat, padat, helpful, dan ramah dalam bahasa Indonesia:\n\n${message}`
                    }
                  ]
                }
              ]
            })
          }
        );

        const data = await response.json();

        if (data.error) {
          lastError = data.error.message;
          continue; // Jika model ini sibuk / error, otomatis ganti ke model berikutnya
        }

        reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (reply) break; // Berhasil mendapat respon, hentikan loop
      } catch (err) {
        lastError = err.message;
      }
    }

    if (reply) {
      return res.json({ answer: reply });
    } else {
      return res.status(500).json({ answer: `Error Gemini API: ${lastError || 'Semua model sedang sibuk, silakan coba beberapa saat lagi.'}` });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = app;