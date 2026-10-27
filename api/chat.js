export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ answer: 'API Key (GEMINI_API_KEY) belum dipasang di Vercel.' });
    }

    // Prompt dibuat ringkas agar waktu pemrosesan AI jauh lebih cepat
    const prompt = `Kamu adalah AI Analytics kualitas udara. Berikan analisis singkat (maksimal 2-3 kalimat) dan saran kesehatan ramah dalam bahasa Indonesia berdasarkan data berikut:\n\n${message}`;

    // Khusus model seri 3.0 ke atas, diurutkan dari yang tercepat (Lite/Flash)
    const modelsToTry = [
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.8-flash',
      'gemini-3.6-flash',
      'gemini-3-flash-preview',
      'gemini-3.1-pro-preview',
      'gemini-4-argon'
    ];

    let responseText = null;
    let lastError = null;

    for (const modelName of modelsToTry) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }]
            })
          }
        );

        const data = await response.json();

        if (response.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
          responseText = data.candidates[0].content.parts[0].text;
          break; // Berhasil, keluar dari loop
        } else {
          lastError = data.error?.message || `HTTP status ${response.status} pada ${modelName}`;
        }
      } catch (err) {
        lastError = err.message;
      }
    }

    if (!responseText) {
      throw new Error(lastError || 'Semua model Gemini 3.0+ gagal merespons.');
    }

    return res.status(200).json({ answer: responseText });
  } catch (err) {
    console.error('Chat API Error:', err);
    return res.status(500).json({ answer: `⚠️ Gagal memproses AI: ${err.message}` });
  }
}