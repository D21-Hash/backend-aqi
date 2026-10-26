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

// Endpoint backend AI Chatbot
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    // Nanti logika AI Gemini ditaruh di sini
    res.json({ answer: `AI menerima pesan: ${message}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = app;