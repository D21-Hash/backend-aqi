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

// Endpoint backend AI Chatbot (Terintegrasi Gemini API)
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ answer: 'API Key (GEMINI_API_KEY) belum terpasang di Vercel.' });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
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
      return res.status(500).json({ answer: `Error Gemini API: ${data.error.message}` });
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Tidak ada balasan dari AI.';
    res.json({ answer: reply });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = app;