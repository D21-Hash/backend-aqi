export default function handler(req, res) {
  if (req.method === 'POST') {
    const data = req.body;
    console.log("Data diterima dari EMQX:", data);
    
    // Kirim respons 200 OK agar EMQX mengetahui data berhasil diterima
    return res.status(200).json({ success: true, data });
  }
  
  return res.status(405).json({ message: "Method not allowed" });
}