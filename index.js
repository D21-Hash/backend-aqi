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

// Helper function untuk jeda waktu (delay)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Endpoint backend AI Chatbot (Menggunakan Model Gemini 3.x yang Aktif)
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ answer: 'API Key (GEMINI_API_KEY) belum terpasang di Vercel.' });
    }

    // Daftar model aktif resmi dari Google Gemini API (Oktober 2026)
    const models = [
      'gemini-3.8-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite'
    ];

    let lastError = '';
    let reply = null;

    for (const model of models) {
      for (let attempt = 0; attempt < 2; attempt++) {
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
            if (data.error.code === 429 || data.error.message?.includes('demand')) {
              await sleep(1000);
              continue;
            }
            break;
          }

          reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (reply) break;
        } catch (err) {
          lastError = err.message;
        }
      }

      if (reply) break;
    }

    if (reply) {
      return res.json({ answer: reply });
    } else {
      return res.status(500).json({ answer: `⚠️ Gemini Error: ${lastError || 'Layanan sedang sibuk, silakan coba beberapa saat lagi.'}` });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = app;