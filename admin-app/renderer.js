'use strict';
const $ = id => document.getElementById(id);
const strings = {
 ar: {workspace:'مساحة الإدارة',overview:'نظرة عامة',registry:'سجل التراخيص',issue:'إصدار ترخيص',local:'مركز إدارة محلي مستقل',internal:'الاستخدام الداخلي لشركة جلف',title:'مركز إدارة GULF POS',refresh:'تحديث',newLicense:'إصدار ترخيص جديد',issued:'التراخيص الصادرة',customers:'العملاء في السجل',current:'لم يتجاوز تاريخ الانتهاء',expired:'تجاوز تاريخ الانتهاء',registryNote:'نطاق مركز الإدارة',limits:'السجل يعرض التراخيص الصادرة محليًا وليس حالة تفعيل الأجهزة الحية. لا يتضمن هذا الإصدار إلغاءً مركزيًا أو مراقبة للفروع عبر الإنترنت.',customer:'العميل',id:'الترخيص',type:'النوع',expiry:'الانتهاء',devices:'الأجهزة المرتبطة',annual:'سنوي',perpetual:'دائم',trial:'تجريبي',days:'مدة الترخيص بالأيام',maxDevices:'الحد المعلن للأجهزة',maxBranches:'الحد المعلن للفروع',fingerprints:'بصمات الأجهزة (واحدة في كل سطر)',issueHint:'الترخيص يشمل جميع الوحدات. حدود الفروع ليست رقابة مركزية. استخدم بصمات الأجهزة الفعلية فقط.',confirm:'راجعت بيانات العميل والأجهزة وأوافق على إصدار المفتاح وتسجيله.',success:'تم إصدار الترخيص',keyHint:'انسخ المفتاح للعميل المعني فقط. لا تشارك مفتاح التوقيع الخاص.',copy:'نسخ مفتاح الترخيص',clear:'إخفاء المفتاح',search:'اسم العميل أو رقم الترخيص',none:'لا توجد نتائج',never:'بدون انتهاء',ready:'مفتاح الإصدار الإنتاجي متاح ومتطابق',unavailable:'إصدار المفاتيح غير متاح: تحقق من إعداد مجلد المفاتيح الإنتاجية',error:'تعذر إكمال العملية',copied:'تم النسخ',copyFailed:'تعذر النسخ، يمكنك تحديد النص ونسخه يدويًا',loading:'جارٍ تحميل السجل',invalid:'تحقق من بصمات الأجهزة والحد المعلن للأجهزة.'},
 en: {workspace:'Workspace',overview:'Overview',registry:'License registry',issue:'Issue license',local:'Independent local administration',internal:'GULF internal use',title:'GULF POS Administration Center',refresh:'Refresh',newLicense:'Issue new license',issued:'Issued licenses',customers:'Customers in registry',current:'Not past expiry',expired:'Past expiry',registryNote:'Administration scope',limits:'The registry shows local issuance records, not live device activation. Central revocation and online branch monitoring are not included in this release.',customer:'Customer',id:'License ID',type:'Type',expiry:'Expiry',devices:'Bound devices',annual:'Annual',perpetual:'Perpetual',trial:'Trial',days:'License duration (days)',maxDevices:'Declared device limit',maxBranches:'Declared branch limit',fingerprints:'Device fingerprints (one per line)',issueHint:'All modules are included. Branch limits are not centrally enforced. Use actual device fingerprints only.',confirm:'I have reviewed the customer and device details and approve issuance and recording.',success:'License issued',keyHint:'Copy the key only for the intended customer. Never share the private signing key.',copy:'Copy license key',clear:'Hide key',search:'Customer or license ID',none:'No records found',never:'Never',ready:'Production signing key is available and matches',unavailable:'Issuance unavailable: configure the production key directory',error:'Operation failed',copied:'Copied',copyFailed:'Copy failed; select the text and copy manually',loading:'Loading registry',invalid:'Check the device fingerprints and declared device limit.'}
};
let lang='ar', rows=[], ready=false, busy=false, loaded=false, statusKnown=false;
const t=k=>strings[lang][k]||k;
function notice(key, bad=false, detail='') { $('notice').textContent=t(key)+(detail?' — '+detail:''); $('notice').classList.toggle('bad',bad); }
function setLanguage() {
 document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';
 document.querySelectorAll('[data-i]').forEach(el=>el.textContent=t(el.dataset.i));
 $('search').placeholder=t('search');$('lang').textContent=lang==='ar'?'English':'العربية';
 notice(!statusKnown?'loading':ready?'ready':'unavailable',statusKnown&&!ready);render();
}
function show(view) {
 document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==view);
 document.querySelectorAll('nav [data-view]').forEach(el=>{el.classList.toggle('active',el.dataset.view===view);if(el.dataset.view===view)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
 if(view!=='issue') clearKey();
}
function clearKey() { $('key').value='';$('result').hidden=true; }
function render() {
 const query=$('search').value.trim().toLowerCase();
 const total=rows.length;
 const current=rows.filter(r=>r.expires_at===null||Date.parse(r.expires_at)>=Date.now()).length;
 $('total').textContent=loaded?String(total):'—';
 $('customers').textContent=loaded?String(new Set(rows.map(r=>r.customer.trim().toLowerCase())).size):'—';
 $('current').textContent=loaded?String(current):'—';$('expired').textContent=loaded?String(total-current):'—';
 const filtered=rows.filter(r=>(r.customer+' '+r.lic_id).toLowerCase().includes(query)).slice().reverse();
 const body=$('records');body.replaceChildren();
 for(const r of filtered) {
  const tr=document.createElement('tr');
  const values=[r.customer,r.lic_id,t(r.type),r.expires_at?r.expires_at.slice(0,10):t('never'),String(r.devices.length)];
  for(const value of values){const td=document.createElement('td');td.textContent=value;td.dir='auto';tr.append(td);}body.append(tr);
 }
 $('empty').hidden=filtered.length>0;$('empty').textContent=loaded?t('none'):t('loading');
 $('submit').disabled=!ready||busy||!$('confirm').checked;
}
async function refresh() {
 try {
  const [status,list]=await Promise.all([window.gulfAdmin.status(),window.gulfAdmin.list()]);
  if(!status.ok||!list.ok)throw new Error(status.error||list.error);
  statusKnown=true;ready=status.data.configured&&status.data.ready;rows=list.data;loaded=true;
  notice(ready?'ready':'unavailable',!ready);render();
 } catch(e){ready=false;statusKnown=true;loaded=false;rows=[];notice('error',true,e.message);render();}
}
document.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',()=>show(el.dataset.view)));
$('lang').addEventListener('click',()=>{lang=lang==='ar'?'en':'ar';setLanguage();});
$('refresh').addEventListener('click',refresh);
$('search').addEventListener('input',render);
$('confirm').addEventListener('change',render);
$('type').addEventListener('change',()=>{$('days').disabled=$('type').value==='perpetual';$('days').value=$('type').value==='trial'?'14':'365';});
$('form').addEventListener('submit',async event=>{
 event.preventDefault();if(!ready||busy||!$('confirm').checked)return;
 const devices=$('fingerprints').value.trim().split(/\s+/).filter(Boolean);
 const max_devices=Number($('maxDevices').value);
 if(!devices.length||devices.length>max_devices||new Set(devices).size!==devices.length||devices.some(v=>!/^[a-f0-9]{32}$/.test(v))){notice('invalid',true);return;}
 busy=true;clearKey();render();
 try {
  const result=await window.gulfAdmin.issue({customer:$('customer').value.trim(),type:$('type').value,days:Number($('days').value),max_devices,max_branches:Number($('maxBranches').value),devices});
  if(!result.ok)throw new Error(result.error);
  $('key').value=result.data.key;$('result').hidden=false;$('confirm').checked=false;
  await refresh();
 }catch(e){notice('error',true,e.message);}finally{busy=false;render();}
});
$('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('key').value);notice('copied');}catch{notice('copyFailed',true);}});
$('clear').addEventListener('click',clearKey);
setLanguage();refresh();
