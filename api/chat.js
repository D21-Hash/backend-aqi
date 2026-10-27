import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ answer: 'API Key (GEMINI_API_KEY) belum dipasang di Vercel.' });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const prompt = `Kamu adalah AI Analytics untuk sistem monitoring kualitas udara real-time. Berikan analisis atau jawaban yang singkat, padat, helpful, dan ramah dalam bahasa Indonesia berdasarkan data/pertanyaan berikut:\n\n${message}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    return res.status(200).json({ answer: responseText });
  } catch (err) {
    console.error('Chat API Error:', err);
    return res.status(500).json({ answer: `⚠️ Gagal memproses AI: ${err.message}` });
  }
}