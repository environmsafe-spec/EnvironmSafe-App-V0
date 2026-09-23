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
  // Monotonic timestamps so "changed since" ordering is deterministic. One
  // stamp per request, not per row: a real database writes a whole batch in a
  // single instant, so records genuinely do share an updated_at.
  const stamp = () => new Date(Date.UTC(2026, 7, 20) + (++seq) * 1000).toISOString();

  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'apikey,authorization,content-type,prefer,x-client-info,x-upsert'
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

        /* The company's document-number counter. Blocks handed out here never
           overlap, which is the whole reason the app asks rather than counting
           on its own. */
        if (u.startsWith('/rest/v1/rpc/es_reserve_numbers')) {
          if (req.method !== 'POST') return send(405, { message: 'method not allowed' });
          const prefix = String(p.p_prefix || ''), count = Number(p.p_count);
          if (!/^[A-Z]{2,6}$/.test(prefix) || !(count >= 1 && count <= 200))
            return send(400, { message: 'not a document prefix' });
          if (srv.counterFails) { srv.counterFails--; return send(500, { message: 'staged failure' }); }
          if (!(prefix in srv.counters)) {
            // Seeded above every number the books already carry, deleted rows
            // included, so a retired number is never handed out again.
            let max = 0;
            for (const r of rows.values()) {
              const id = (r.data && r.data.id) || '';
              if (typeof id !== 'string' || id.indexOf(prefix + '-') !== 0) continue;
              const m = /([0-9]+)$/.exec(id);
              if (m) max = Math.max(max, Number(m[1]));
            }
            srv.counters[prefix] = max + 1;
          }
          const start = srv.counters[prefix];
          srv.counters[prefix] = start + count;
          srv.reserves++;
          return send(200, start);
        }

        if (u.startsWith('/rest/v1/es_records')) {
          if (req.method === 'POST') {
            const at = stamp();
            (Array.isArray(p) ? p : [p]).forEach(r => {
              rows.set(r.collection + '/' + r.record_id, {
                company_id:r.company_id, collection:r.collection, record_id:r.record_id,
                data:r.data, deleted:!!r.deleted, updated_at:at });
            });
            return send(201, null);
          }
          if (req.method === 'GET') {
            const m = /updated_at=gt\.([^&]+)/.exec(u);
            const since = m ? decodeURIComponent(m[1]) : '1970-01-01T00:00:00Z';
            const one = (re, dflt) => { const x = re.exec(u); return x ? Number(x[1]) : dflt; };
            const offset = one(/[?&]offset=(\d+)/, 0);
            // PostgREST answers with at most max-rows however large a limit is
            // asked for, and says nothing about having held anything back.
            const limit  = Math.min(one(/[?&]limit=(\d+)/, srv.maxRows), srv.maxRows);
            const all = [...rows.values()]
              .filter(r => r.updated_at > since)
              .sort((a, b) => a.updated_at.localeCompare(b.updated_at)
                           || a.record_id.localeCompare(b.record_id));
            return send(200, all.slice(offset, offset + limit));
          }
        }
      }
      /* ---- Storage: the private attachments bucket ---- */
      if (u.startsWith('/storage/v1/object/')) {
        if (!(req.headers.authorization || '').startsWith('Bearer '))
          return send(401, { message: 'JWT required' });
        const sign = /^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/.exec(u);
        if (sign && req.method === 'POST') {
          const key = sign[1] + '/' + decodeURIComponent(sign[2]);
          if (!srv.objects.has(key)) return send(404, { message: 'Object not found' });
          return send(200, { signedURL: '/object/sign/' + sign[1] + '/' + sign[2] + '?token=T' });
        }
        const obj = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(u);
        if (obj) {
          const key = obj[1] + '/' + decodeURIComponent(obj[2]);
          if (obj[1] !== 'es-attachments') return send(404, { message: 'Bucket not found' });
          if (!key.split('/')[1] || key.split('/')[1] !== COMPANY)
            return send(403, { message: 'new row violates row-level security policy' });
          if (req.method === 'POST') {
            if (srv.objects.has(key)) return send(409, { message: 'The resource already exists' });
            srv.objects.set(key, { type: req.headers['content-type'], size: body.length });
            return send(200, { Key: key });
          }
          if (req.method === 'DELETE') { srv.objects.delete(key); return send(200, [{ name: key }]); }
        }
      }
      /* ---- Google Drive, enough of it to exercise the backup ---- */
      if (u.startsWith('/drive/v3/files') || u.startsWith('/upload/drive/v3/files')) {
        if (!(req.headers.authorization || '').startsWith('Bearer '))
          return send(401, { error: { message: 'Invalid Credentials' } });
        if (srv.driveFails) { const f = srv.driveFails; srv.driveFails = 0;
          return send(f, { error: { message: 'staged failure' } }); }

        if (u.startsWith('/upload/drive/v3/files') && req.method === 'POST') {
          // The body is multipart/related: metadata part, then the file itself.
          const meta = /\{[\s\S]*?\}/.exec(body);
          let name = 'unnamed', parents = [];
          try { const m = JSON.parse(meta[0]); name = m.name; parents = m.parents || []; } catch (e) {}
          const id = 'file-' + (++srv.driveSeq);
          srv.driveFiles.set(id, { id, name, parents,
            mimeType:'application/json', createdTime: new Date(Date.now() + srv.driveSeq * 1000).toISOString(),
            size: body.length });
          return send(200, { id, name });
        }
        const del = /^\/drive\/v3\/files\/([^?]+)/.exec(u);
        if (del && req.method === 'DELETE') { srv.driveFiles.delete(del[1]); return send(204, null); }

        if (req.method === 'POST') {                       // create a folder
          const id = 'folder-' + (++srv.driveSeq);
          srv.driveFiles.set(id, { id, name: p.name, mimeType: p.mimeType, parents: [],
            createdTime: new Date().toISOString() });
          return send(200, { id, name: p.name });
        }
        if (req.method === 'GET') {                        // list / search
          const q = decodeURIComponent((/[?&]q=([^&]*)/.exec(u) || [,''])[1]);
          let files = [...srv.driveFiles.values()];
          const byName = /name='([^']+)'/.exec(q);
          const inParent = /'([^']+)' in parents/.exec(q);
          if (byName)   files = files.filter(f => f.name === byName[1]);
          if (/mimeType='application\/vnd\.google-apps\.folder'/.test(q))
            files = files.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
          if (inParent) files = files.filter(f => (f.parents || []).includes(inParent[1]));
          files.sort((a, b) => b.createdTime.localeCompare(a.createdTime));   // newest first
          return send(200, { files });
        }
      }

      send(404, { message: 'not found' });
    });
  });

  srv.refreshes = 0;
  srv.counters = Object.create(null);   // prefix -> the next number to hand out
  srv.reserves = 0;
  srv.counterFails = 0;                 // stage this many refusals from the counter
  srv.objects = new Map();             // bucket/path -> { type, size }
  srv.driveFiles = new Map();
  srv.driveSeq = 0;
  srv.driveFails = 0;
  // What the real server caps a single answer at. Lowered in tests that need
  // to prove the app reads past the end of one page.
  srv.maxRows = 1000;
  srv.stored = () => rows;
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r(srv)));
}

module.exports = { startMockSupabase };
