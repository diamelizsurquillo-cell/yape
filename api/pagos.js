import { createClient } from '@supabase/supabase-js';

let supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
if (supabaseUrl && !supabaseUrl.startsWith('http://') && !supabaseUrl.startsWith('https://')) {
  supabaseUrl = `https://${supabaseUrl}`;
}
supabaseUrl = supabaseUrl.replace(/\/+$/, '');

const supabaseKey = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ''
).trim();

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
    return res.status(500).json({ 
      error: 'Variables de entorno de Supabase no configuradas en Vercel',
      hasUrl: Boolean(supabaseUrl),
      hasKey: Boolean(supabaseKey)
    });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. REGISTRAR PAGO (DESDE APP ANDROID SENSOR)
  if (req.method === 'POST') {
    const apiKey = req.headers['x-api-key'];
    const expectedApiKey = process.env.YAPE_API_KEY || 'mi_yape_secreto_123';

    if (!apiKey || apiKey !== expectedApiKey) {
      return res.status(401).json({ error: 'API Key inválida o no proporcionada' });
    }

    const { remitente, monto, timestamp, codigo_seguridad, banco } = req.body;

    if (!remitente || monto === undefined || !timestamp) {
      return res.status(400).json({ error: 'Faltan campos obligatorios: remitente, monto, timestamp' });
    }

    const bankName = (banco || 'YAPE').toUpperCase();
    const codSeguridad = codigo_seguridad || (bankName === 'BBVA' ? 'BBVA' : null);
    const payload = {
      remitente,
      monto: parseFloat(monto),
      timestamp: parseInt(timestamp),
      codigo_seguridad: codSeguridad,
      banco: bankName,
      validado: 0
    };

    let { data, error } = await supabase
      .from('pagos')
      .insert([payload])
      .select()
      .single();

    // Si falla porque la columna 'banco' aún no fue creada en la tabla de Supabase, reintentar sin 'banco'
    if (error && error.message && error.message.toLowerCase().includes('banco')) {
      const fallbackPayload = {
        remitente,
        monto: parseFloat(monto),
        timestamp: parseInt(timestamp),
        codigo_seguridad: codSeguridad,
        validado: 0
      };
      const retry = await supabase.from('pagos').insert([fallbackPayload]).select().single();
      data = retry.data ? { ...retry.data, banco: bankName } : null;
      error = retry.error;
    }

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json({
      mensaje: 'Pago registrado exitosamente en Supabase',
      pago: data || { ...payload, id: Date.now() }
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

    // Si la tabla aún no tiene columna 'banco', inferirlo de los datos existentes
    const enriched = (data || []).map(p => {
      if (p.banco) return p; // Ya tiene la columna
      // Inferir: si codigo_seguridad contiene 'BBVA' o 'QR', o es null con remitente TODO MAYÚSCULAS sin código Yape
      const cod = (p.codigo_seguridad || '').toUpperCase();
      const rem = p.remitente || '';
      const isBbva = cod === 'BBVA' || cod.includes('QR-BBVA') || cod.includes('QR BBVA')
        || (cod === '' && rem === rem.toUpperCase() && rem.length > 5 && /^[A-ZÁÉÍÓÚÑ\s]+$/.test(rem));
      return { ...p, banco: isBbva ? 'BBVA' : 'YAPE' };
    });

    return res.status(200).json(enriched);
  }

  // 3. LIMPIAR O BORRAR HISTORIAL DE PAGOS
  if (req.method === 'DELETE') {
    const { id } = req.query || {};

    if (id) {
      const { error } = await supabase.from('pagos').delete().eq('id', id);
      if (error) {
        return res.status(500).json({ error: error.message });
      }
      return res.status(200).json({ mensaje: `Pago ${id} eliminado` });
    }

    // Borrado total de la tabla pagos en Supabase
    let { error } = await supabase.from('pagos').delete().not('id', 'is', null);
    if (error) {
      const fallback = await supabase.from('pagos').delete().gte('timestamp', 0);
      error = fallback.error;
    }

    if (error) {
      console.error('Error al limpiar pagos en Supabase:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ mensaje: 'Historial eliminado con éxito' });
  }

  return res.status(405).json({ error: 'Método no permitido' });
}
