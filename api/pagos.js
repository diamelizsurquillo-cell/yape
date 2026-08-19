import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-API-Key, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Variables de entorno de Supabase no configuradas en Vercel' });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. REGISTRAR PAGO (DESDE APP ANDROID SENSOR)
  if (req.method === 'POST') {
    const apiKey = req.headers['x-api-key'];
    const expectedApiKey = process.env.YAPE_API_KEY || 'mi_yape_secreto_123';

    if (!apiKey || apiKey !== expectedApiKey) {
      return res.status(401).json({ error: 'API Key inválida o no proporcionada' });
    }

    const { remitente, monto, timestamp, codigo_seguridad } = req.body;

    if (!remitente || monto === undefined || !timestamp) {
      return res.status(400).json({ error: 'Faltan campos obligatorios: remitente, monto, timestamp' });
    }

    const { data, error } = await supabase
      .from('pagos')
      .insert([
        {
          remitente,
          monto: parseFloat(monto),
          timestamp: parseInt(timestamp),
          codigo_seguridad: codigo_seguridad || null,
          validado: 0
        }
      ])
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json({
      mensaje: 'Pago registrado exitosamente en Supabase',
      pago: data
    });
  }

  // 2. LISTAR PAGOS
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('pagos')
      .select('*')
      .order('timestamp', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json(data);
  }

  // 3. LIMPIAR HISTORIAL
  if (req.method === 'DELETE') {
    const { error } = await supabase.from('pagos').delete().neq('id', 0);
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ mensaje: 'Historial eliminado' });
  }

  return res.status(405).json({ error: 'Método no permitido' });
}
