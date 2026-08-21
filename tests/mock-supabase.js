'use strict';
/* A stand-in for the parts of Supabase the app uses: password sign-in, token
   refresh, sign-up, membership lookup and the es_records table.

   It exists because the suite must be able to run anywhere, offline, and must
   be able to stage things a real server will not stage on demand — an expired
   token, a rejected refresh, a sign-up awaiting email confirmation. It is not a
   Supabase emulator and does not try to be: it implements exactly the requests
   the app makes, so that a change to those requests fails here loudly. */

const http = require('http');

function startMockSupabase(port, opts) {
  opts = opts || {};
  const USER    = { email: opts.email || 'akram@environmsafe.com',
                    password: opts.password || 'Aden#2026', id: 'user-1' };
  const COMPANY = 'company-uuid-1';
  const rows    = new Map();
  let seq = 0;
  // Monotonic timestamps so "changed since" ordering is deterministic.
  const stamp = () => new Date(Date.UTC(2026, 7, 20) + (++seq) * 1000).toISOString();

  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'apikey,authorization,content-type,prefer,x-client-info'
      };
      const send = (code, obj) => {
        res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, cors));
        res.end(JSON.stringify(obj));
      };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

      let p = {};
      try { p = JSON.parse(body || '{}'); } catch (e) { /* not json */ }
      const u = req.url;

      if (u.startsWith('/auth/v1/token') && u.includes('grant_type=password')) {
        if (p.email === USER.email && p.password === USER.password)
          return send(200, { access_token:'AT-1', refresh_token:'RT-1', expires_in:3600,
                             user:{ id:USER.id, email:USER.email } });
        return send(400, { error_description: 'Invalid login credentials' });
      }
      if (u.startsWith('/auth/v1/token') && u.includes('grant_type=refresh_token')) {
        if (p.refresh_token === 'RT-1')
          return send(200, { access_token:'AT-' + (++srv.refreshes + 1), refresh_token:'RT-1',
                             expires_in:3600, user:{ id:USER.id, email:USER.email } });
        return send(400, { error_description: 'Invalid Refresh Token' });   // ends the session
      }
      if (u.startsWith('/auth/v1/signup')) {
        if (p.email === USER.email)          return send(400, { msg: 'User already registered' });
        if ((p.password || '').length < 6)   return send(422, { msg: 'Password should be at least 6 characters' });
        return send(200, { user: { id:'new-user', email:p.email } });       // confirmation required
      }

      if (u.startsWith('/rest/v1/')) {
        if (!(req.headers.authorization || '').startsWith('Bearer '))
          return send(401, { message: 'JWT required' });

        if (u.startsWith('/rest/v1/es_members'))
          return send(200, [{ company_id: COMPANY, role: 'Administrator' }]);

        if (u.startsWith('/rest/v1/es_records')) {
          if (req.method === 'POST') {
            (Array.isArray(p) ? p : [p]).forEach(r => {
              rows.set(r.collection + '/' + r.record_id, {
                company_id:r.company_id, collection:r.collection, record_id:r.record_id,
                data:r.data, deleted:!!r.deleted, updated_at:stamp() });
            });
            return send(201, null);
          }
          if (req.method === 'GET') {
            const m = /updated_at=gt\.([^&]+)/.exec(u);
            const since = m ? decodeURIComponent(m[1]) : '1970-01-01T00:00:00Z';
            return send(200, [...rows.values()]
              .filter(r => r.updated_at > since)
              .sort((a, b) => a.updated_at.localeCompare(b.updated_at)));
          }
        }
      }
      send(404, { message: 'not found' });
    });
  });

  srv.refreshes = 0;
  srv.stored = () => rows;
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r(srv)));
}

module.exports = { startMockSupabase };
