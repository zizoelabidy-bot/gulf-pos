#!/usr/bin/env node
// Builds a per-client delivery folder + zip: installer, license key, AR/EN one-page guide, SHA256.
// Runs only on the GULF CCTV machine (needs keys/license-private.pem). Never commit output.
// Usage:
//   node make-delivery-package.cjs --customer "Cafe X" --type annual --days 365 \
//     --max-devices 2 --max-branches 1 --modules '*' --installer /path/GULF-POS-Setup.exe [--device FP]...
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const a = process.argv.slice(2);
const val = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const vals = (k) => a.flatMap((x, i) => (x === '--' + k ? [a[i + 1]] : []));
const customer = val('customer');
const installer = val('installer');
if (!customer || !installer) { console.error('Required: --customer and --installer (path to GULF-POS-Setup.exe)'); process.exit(1); }
if (!fs.existsSync(installer)) { console.error('Installer not found: ' + installer); process.exit(1); }

const issueArgs = ['license-admin.cjs', val('type') === 'trial' ? 'trial' : 'issue', '--customer', customer,
  '--type', val('type', 'annual'), '--days', val('days', '365'), '--max-devices', val('max-devices', '1'),
  '--max-branches', val('max-branches', '1')];
(vals('modules').length ? vals('modules') : ['*']).forEach((m) => issueArgs.push('--modules', m));
vals('device').forEach((d) => issueArgs.push('--device', d));
const r = spawnSync('node', issueArgs, { cwd: __dirname, encoding: 'utf8' });
if (r.status !== 0 || !/GPL1\.\S+/.test(r.stdout)) { console.error(r.stdout + r.stderr); process.exit(1); }
const key = r.stdout.match(/GPL1\.\S+/)[0];
const expires = (r.stdout.match(/Expires: (.*)/) || [])[1] || '';

const safe = customer.replace(/[^\w\-]+/g, '_');
const out = path.join(__dirname, 'delivery', safe);
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(installer, path.join(out, 'GULF-POS-Setup.exe'));
const sha = crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex');
fs.writeFileSync(path.join(out, 'SHA256.txt'), `${sha}  GULF-POS-Setup.exe\n`);
fs.writeFileSync(path.join(out, 'license-key.txt'), key + '\n');
const guide = `GULF POS - Quick start / دليل البدء السريع
Client / العميل: ${customer}
License expires / ينتهي الترخيص: ${expires}

[العربية]
1. شغّل GULF-POS-Setup.exe. إذا ظهر تحذير Windows SmartScreen اضغط More info ثم Run anyway (النسخة غير موقعة رقمياً).
2. افتح GULF POS وأنشئ حساب المالك.
3. اذهب إلى الإعدادات > الترخيص والصق المفتاح الموجود في license-key.txt.
4. للتأكد من سلامة الملف قارن SHA256.txt مع: certutil -hashfile GULF-POS-Setup.exe SHA256
5. للدعم: [رقم الدعم - يُملأ يدوياً]

[English]
1. Run GULF-POS-Setup.exe. If Windows SmartScreen warns, click More info then Run anyway (the build is unsigned).
2. Open GULF POS and create the owner account.
3. Go to Settings > License and paste the key from license-key.txt.
4. To verify the file, compare SHA256.txt with: certutil -hashfile GULF-POS-Setup.exe SHA256
5. Support: [support contact - fill in manually]

Powered by GULF CCTV
`;
fs.writeFileSync(path.join(out, 'QuickStart-AR-EN.txt'), guide, 'utf8');
const zip = out + '.zip';
if (fs.existsSync(zip)) fs.unlinkSync(zip);
const z = spawnSync('zip', ['-j', '-q', zip, ...fs.readdirSync(out).map((f) => path.join(out, f))]);
console.log(z.status === 0 ? `Package: ${zip}` : `Folder ready (zip tool missing): ${out}`);
console.log('SHA256 installer: ' + sha);
