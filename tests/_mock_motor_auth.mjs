// Motor + Auth de mentira para probar el servidor del VPS sin tocar Supabase.
import http from 'node:http';
const recibidos = [];
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/auth/v1/user') {
    const tok = (req.headers.authorization || '').replace('Bearer ', '');
    const mails = { jony: 'admin@shukmamtakim.com', miri: 'myri@shukmamtakim.com', kids: 'kids@candyshop.com' };
    if (!mails[tok]) { res.writeHead(401); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ email: mails[tok] }));
  }
  if (u.pathname === '/motor') {
    const o = Object.fromEntries(u.searchParams.entries()); recibidos.push(o);
    if (o.vid === 'v_motor_caido') { res.writeHead(500); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}');
  }
  if (u.pathname === '/_recibidos') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(recibidos)); }
  res.writeHead(404); res.end();
}).listen(3998, () => console.log('mock listo'));
