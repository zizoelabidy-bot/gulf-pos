const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'gulf-admin-service-'));
process.env.GULF_LICENSE_KEYS_DIR = dir;
try {
  const api = require('../admin-app/license-admin.cjs');
  assert.equal(api.issuerStatus().ready,false);
  assert.deepEqual(api.listLicenses(),[]);
  const cli = path.resolve(__dirname,'../admin-app/license-admin.cjs');
  const run = (...args) => spawnSync(process.execPath,[cli,...args],{encoding:'utf8',env:process.env});
  assert.equal(run('init').status,0);
  assert.equal(api.issuerStatus().ready,false,'test keys must not be accepted in production UI');
  const input = {customer:'Test Cafe',type:'annual',days:365,max_devices:1,max_branches:1,devices:['a'.repeat(32)],developmentKey:true};
  assert.throws(()=>api.issueFromForm(input),/unavailable/);
  assert.equal(run('issue','--development-key','--customer','Test Cafe','--device','a'.repeat(32)).status,0);
  const records = api.listLicenses();
  assert.equal(records.length,1);
  assert.equal(records[0].customer,'Test Cafe');
  assert.ok(!Object.hasOwn(records[0],'key'));
  assert.ok(!JSON.stringify(records).includes('GPL1.'));
  for (const name of ['main.cjs','preload.cjs','renderer.js']) {
    const checked = spawnSync(process.execPath,['--check',path.resolve(__dirname,'../admin-app',name)],{encoding:'utf8'});
    assert.equal(checked.status,0,checked.stderr);
  }
  console.log('Administration issuer API and source syntax checks passed');
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
