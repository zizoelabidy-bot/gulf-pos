const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gulf-license-admin-test-'));
const cli = path.resolve(__dirname, '../admin-app/license-admin.cjs');
const env = { ...process.env, GULF_LICENSE_KEYS_DIR: dir };
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' });
try {
  const fp = '1234567890abcdef'.repeat(2);
  assert.equal(run('init').status, 0);
  assert.notEqual(run('init').status, 0);
  assert.notEqual(run('issue', '--customer', 'Test Cafe', '--device', fp).status, 0);
  assert.notEqual(run('issue', '--development-key', '--customer', 'Test Cafe').status, 0);
  assert.notEqual(run('issue', '--development-key', '--customer', 'Test Cafe', '--device', fp, '--days', '1abc').status, 0);
  assert.notEqual(run('issue', '--development-key', '--customer', 'Test Cafe', '--device', fp, '--max-devices', '0').status, 0);
  const issued = run('issue', '--development-key', '--customer', 'Test Cafe', '--device', fp);
  assert.equal(issued.status, 0, issued.stderr);
  const key = issued.stdout.match(/GPL1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)[0];
  assert.equal(run('inspect', '--key', key).status, 0);
  const listed = run('list');
  assert.equal(listed.status, 0);
  assert.match(listed.stdout, /Test Cafe/);
  assert.ok(!listed.stdout.includes(key));
  const row = JSON.parse(fs.readFileSync(path.join(dir, 'issued-licenses.jsonl'), 'utf8').trim());
  const claim = 'GPLR1.' + Buffer.from(row.lic_id + '|' + fp + '|' + new Date().toISOString()).toString('base64url') + '.' + '0'.repeat(24);
  const checked = run('verify-receipt', '--receipt', claim);
  assert.equal(checked.status, 2);
  assert.match(checked.stdout, /UNVERIFIED CLAIM/);
  console.log('GULF license admin CLI checks passed');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
