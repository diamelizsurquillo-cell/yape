export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-API-Key, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    const { username, password } = req.body || {};
    const expectedUser = process.env.DASHBOARD_USERNAME || 'admin';
    const expectedPass = process.env.DASHBOARD_PASSWORD || 'yape1234';

    if (username === expectedUser && password === expectedPass) {
      return res.status(200).json({
        mensaje: 'Autenticación exitosa',
        token: 'supabase_auth_token_active'
      });
    }

    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  return res.status(405).json({ error: 'Método no permitido' });
}
