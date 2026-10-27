#!/usr/bin/env node
/* Build statis untuk Vercel: menyalin HANYA file publik ke dist/ dan membuat assets/js/supabase-config.js dari environment variables.
   Variabel: SUPABASE_URL, SUPABASE_ANON_KEY (anon / publishable key). service_role / secret key DITOLAK. */
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'dist');
const PUBLIC_EXT = new Set(['.html', '.json', '.xml', '.txt', '.png', '.ico', '.svg', '.webp', '.jpg', '.jpeg']);
const PUBLIC_ROOT_JS = new Set(['sw.js']);
const SKIP = new Set(['package.json', 'package-lock.json', 'vercel.json']);

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else if (!e.name.endsWith('.php')) fs.copyFileSync(s, d);
  }
}
function jwtRole(k) { try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString('utf8')).role; } catch (e) { return null; } }

const url = (process.env.SUPABASE_URL || '').trim(), key = (process.env.SUPABASE_ANON_KEY || '').trim();
if (key && (jwtRole(key) === 'service_role' || /^sb_secret_/.test(key))) {
  console.error('GAGAL: SUPABASE_ANON_KEY berisi service_role/secret key. Itu rahasia dan tidak boleh dipublikasikan ke browser. Gunakan anon/publishable key.');
  process.exit(1);
}
if (url && !/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(url)) { console.error('GAGAL: SUPABASE_URL tidak valid: ' + url); process.exit(1); }

rmrf(out); fs.mkdirSync(out, { recursive: true });
for (const e of fs.readdirSync(root, { withFileTypes: true })) {
  if (e.isDirectory()) { if (e.name === 'assets') copyDir(path.join(root, e.name), path.join(out, e.name)); continue; }
  const ext = path.extname(e.name).toLowerCase();
  if (SKIP.has(e.name)) continue;
  if (PUBLIC_EXT.has(ext) || PUBLIC_ROOT_JS.has(e.name)) fs.copyFileSync(path.join(root, e.name), path.join(out, e.name));
}
const cfg = '/* dibuat otomatis oleh scripts/build.js dari environment variables */\nwindow.PB_SUPABASE = ' + JSON.stringify({ url: url.replace(/\/$/, ''), anonKey: key }) + ';\n';
fs.writeFileSync(path.join(out, 'assets', 'js', 'supabase-config.js'), cfg);
console.log('Build selesai: dist/ (' + fs.readdirSync(out).length + ' entri di root).');
if (!url || !key) console.warn('PERINGATAN: SUPABASE_URL / SUPABASE_ANON_KEY belum diisi. Website & aplikasi tetap jalan, tetapi halaman konsultasi akan menampilkan "belum dikonfigurasi".');
