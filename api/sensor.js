import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { temp, hum, pm25, mq2, aqi } = req.body;

    const { data, error } = await supabase
      .from('sensor_logs')
      .insert([
        { temp, hum, pm25, mq2, aqi }
      ]);

    if (error) {
      console.error("Gagal menyimpan ke Supabase:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    return res.status(200).json({ 
      success: true, 
      message: "Data berhasil disimpan di Supabase", 
      data 
    });
  }

  return res.status(405).json({ message: "Method not allowed" });
}