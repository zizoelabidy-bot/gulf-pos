const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { build, Platform, Arch } = require('electron-builder');
const root = path.resolve(__dirname, '..');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'gulf-admin-package-'));
const output = path.join(root, 'release-admin');
const allowed = ['main.cjs','preload.cjs','license-admin.cjs','index.html','renderer.js','admin.css','commercial-store.cjs','commercial-ui.js'];
async function run() {
  try {
    for (const name of allowed) fs.copyFileSync(path.join(root,'admin-app',name),path.join(stage,name));
    for (const name of ['LICENSE','OPEN_SOURCE_LICENSES.md']) fs.copyFileSync(path.join(root,name),path.join(stage,name));
    fs.copyFileSync(path.join(root,'assets','icon.ico'),path.join(stage,'icon.ico'));
    fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify({name:'gulf-pos-admin',productName:'GULF POS Administration Center',version:'1.0.0',main:'main.cjs',description:'Internal GULF POS license and commercial administration',author:'GULF CCTV',license:'MIT'}));
    await build({projectDir:stage,targets:Platform.WINDOWS.createTarget(['nsis'],Arch.x64),publish:'never',config:{
      appId:'com.gulfcctv.gulfpos.admin',productName:'GULF POS Administration Center',
      electronVersion:require('electron/package.json').version,
      electronDist:path.join(root,'node_modules','electron','dist'),
      directories:{output},asar:true,npmRebuild:false,
      files:[...allowed,'package.json','LICENSE','OPEN_SOURCE_LICENSES.md'],
      win:{icon:path.join(stage,'icon.ico'),artifactName:'GULF-POS-Admin-Setup.exe'},
      nsis:{oneClick:false,allowToChangeInstallationDirectory:true,createDesktopShortcut:true,shortcutName:'GULF POS Administration Center',installerIcon:path.join(stage,'icon.ico'),uninstallerIcon:path.join(stage,'icon.ico')}
    }});
    const asar = require('@electron/asar');
    const entries = asar.listPackage(path.join(output,'win-unpacked','resources','app.asar')).map(p=>p.replace(/^[/\\]+/,''));
    const permitted = new Set([...allowed,'package.json','LICENSE','OPEN_SOURCE_LICENSES.md']);
    for(const entry of entries) if(!permitted.has(entry)) throw new Error('Unexpected admin package entry: '+entry);
    for(const entry of permitted) if(!entries.includes(entry)) throw new Error('Missing admin package entry: '+entry);
    console.log('Admin ASAR allowlist verified; no registry or signing key files included.');
  } finally { fs.rmSync(stage,{recursive:true,force:true}); }
}
run().catch(e=>{console.error(e);process.exitCode=1;});
