export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ answer: 'API Key Gemini tidak terdeteksi di Vercel.' });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Kamu adalah AI Analytics untuk sistem monitoring kualitas udara. Jawab pertanyaan atau analisis data pengguna secara singkat, padat, dan ramah:\n\n${message}`
                }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Tidak ada respons dari AI.';

    return res.status(200).json({ answer: reply });
  } catch (error) {
    return res.status(500).json({ answer: `Error server: ${error.message}` });
  }
}