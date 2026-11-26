'use strict';
(() => {
const el=id=>document.getElementById(id);
const dict={
ar:{nav:'العملاء والاشتراكات',title:'الإدارة التجارية',operation:'نوع العملية',customer:'عميل جديد',subscription:'اشتراك جديد',payment:'تسجيل تحصيل',ticket:'تذكرة دعم',name:'اسم العميل',contact:'بيانات التواصل (اختياري)',client:'العميل',start:'بداية الاشتراك',end:'نهاية الاشتراك',amount:'المبلغ (د.ك)',reference:'المرجع',contract:'مرجع العقد (اختياري)',sub:'الاشتراك',date:'تاريخ التحصيل',subject:'الموضوع',detail:'التفاصيل',save:'حفظ',none:'لا توجد سجلات',saved:'تم الحفظ',ready:'سجل محلي؛ التحصيل مسجّل يدويًا وليس بوابة دفع، والدعم ليس متصلًا بخادم العملاء.',failed:'تعذرت العملية',clients:'العملاء',due:'إجمالي المستحقات',received:'المحصّل',open:'تذاكر مفتوحة',balance:'المتبقي',status:'الحالة',closed:'مغلقة',close:'إغلاق',paid:'المدفوع',period:'الفترة',choose:'اختر',confirm:'تأكيد تسجيل العملية؟'},
en:{nav:'Customers & subscriptions',title:'Commercial administration',operation:'Operation',customer:'New customer',subscription:'New subscription',payment:'Record collection',ticket:'Support ticket',name:'Customer name',contact:'Contact (optional)',client:'Customer',start:'Subscription start',end:'Subscription end',amount:'Amount (KWD)',reference:'Reference',contract:'Contract reference (optional)',sub:'Subscription',date:'Collection date',subject:'Subject',detail:'Details',save:'Save',none:'No records',saved:'Saved',ready:'Local registry; collections are recorded manually, not processed through a payment gateway. Support is not connected to customer servers.',failed:'Operation failed',clients:'Customers',due:'Total billed',received:'Collected',open:'Open tickets',balance:'Outstanding',status:'Status',closed:'Closed',close:'Close',paid:'Paid',period:'Period',choose:'Choose',confirm:'Confirm recording this operation?'}
};
const t=k=>dict[document.documentElement.lang==='ar'?'ar':'en'][k]||k;
let state=null,busy=false;
const money=n=>(n/1000).toFixed(3)+' KWD';
const client=id=>state.customers.find(c=>c.id===id)?.name||id;
const paid=id=>state.payments.filter(p=>p.subscription_id===id).reduce((n,p)=>n+p.amount_fils,0);
function status(msg,bad=false){el('commercialStatus').textContent=msg;el('commercialStatus').classList.toggle('bad',bad);}
function node(tag,value){const n=document.createElement(tag);if(value!==undefined)n.textContent=value;return n;}
function field(id,label,type,required=true,options) {
 const l=node('label');l.append(node('span',t(label)));
 const input=node(options?'select':type==='textarea'?'textarea':'input');
 input.name=id;input.required=required;
 if(options){const empty=node('option',t('choose'));empty.value='';input.append(empty);for(const o of options){const n=node('option',o.label);n.value=o.value;input.append(n);}}
 else if(type!=='textarea'){input.type=type;if(id==='amount'){input.inputMode='decimal';input.placeholder='0.000';input.pattern='[0-9]{1,9}([.][0-9]{1,3})?';}}
 l.append(input);return l;
}
function labels(){
 el('commercialNav').textContent=t('nav');el('commercialTitle').textContent=t('title');el('operationLabel').textContent=t('operation');el('commercialSave').textContent=t('save');
 for(const o of el('operation').options)o.textContent=t(o.value);
}
function render() {
 labels();if(!state)return;
 const kind=el('operation').value;
 const summary=el('commercialSummary');summary.replaceChildren();
 const totals=[['clients',state.customers.length],['due',money(state.subscriptions.reduce((n,s)=>n+s.fee_fils,0))],['received',money(state.payments.reduce((n,p)=>n+p.amount_fils,0))],['open',state.tickets.filter(t=>t.status==='open').length]];
 for(const [name,value] of totals){const a=node('article');a.append(node('small',t(name)),node('strong',String(value)));summary.append(a);}
 const clients=state.customers.map(c=>({value:c.id,label:c.name}));
 const subs=state.subscriptions.filter(s=>s.fee_fils>paid(s.id)).map(s=>({value:s.id,label:client(s.customer_id)+' / '+s.start+' – '+s.end+' / '+money(s.fee_fils-paid(s.id))}));
 const fields=el('commercialFields');fields.replaceChildren();
 if(kind==='customer')fields.append(field('name','name','text'),field('contact','contact','text',false));
 if(kind==='subscription')fields.append(field('customer_id','client','select',true,clients),field('start','start','date'),field('end','end','date'),field('amount','amount','text'),field('reference','contract','text',false));
 if(kind==='payment')fields.append(field('subscription_id','sub','select',true,subs),field('amount','amount','text'),field('reference','reference','text'),field('date','date','date'));
 if(kind==='ticket')fields.append(field('customer_id','client','select',true,clients),field('subject','subject','text'),field('detail','detail','textarea',false));
 let headers=[],rows=[];
 if(kind==='customer'){headers=['name','contact'];rows=state.customers.map(c=>[c.name,c.contact]);}
 if(kind==='subscription'){headers=['client','period','amount','paid','balance'];rows=state.subscriptions.map(s=>[client(s.customer_id),s.start+' – '+s.end,money(s.fee_fils),money(paid(s.id)),money(s.fee_fils-paid(s.id))]);}
 if(kind==='payment'){headers=['sub','amount','reference','date'];rows=state.payments.map(p=>{const s=state.subscriptions.find(s=>s.id===p.subscription_id);return [(s?client(s.customer_id)+' / '+s.start:p.subscription_id),money(p.amount_fils),p.reference,p.date];});}
 if(kind==='ticket'){headers=['client','subject','detail','status','close'];rows=state.tickets.map(q=>[client(q.customer_id),q.subject,q.detail,t(q.status),q]);}
 const tr=node('tr');for(const k of headers)tr.append(node('th',t(k)));el('commercialHead').replaceChildren(tr);
 const body=el('commercialRows');body.replaceChildren();
 for(const row of rows.slice().reverse()){const tr=node('tr');for(const v of row){const td=node('td');if(typeof v==='object'){if(v.status==='open'){const b=node('button',t('close'));b.className='secondary';b.disabled=busy;b.addEventListener('click',()=>record({kind:'close_ticket',ticket_id:v.id}));td.append(b);}}else td.textContent=String(v??'');tr.append(td);}body.append(tr);}
 if(!rows.length){const tr=node('tr'),td=node('td',t('none'));td.colSpan=headers.length;tr.append(td);body.append(tr);}
 el('commercialSave').disabled=busy;
}
async function load(){try{const r=await window.gulfAdmin.commercialList();if(!r.ok)throw Error(r.error);state=r.data;render();status(t('ready'));}catch(e){state=null;el('commercialSave').disabled=true;status(t('failed')+' — '+e.message,true);}}
async function record(payload){if(busy||!state||!window.confirm(t('confirm')))return;busy=true;el('commercialSave').disabled=true;try{const r=await window.gulfAdmin.commercialRecord(payload);if(!r.ok)throw Error(r.error);state=r.data;render();status(t('saved')+' — '+t('ready'));}catch(e){status(t('failed')+' — '+e.message,true);}finally{busy=false;el('commercialSave').disabled=!state;}}
el('commercialForm').addEventListener('submit',e=>{e.preventDefault();record({kind:el('operation').value,...Object.fromEntries(new FormData(e.currentTarget))});});
el('operation').addEventListener('change',render);
el('commercialNav').addEventListener('click',load);
new MutationObserver(()=>{labels();if(!el('commercial').hidden)render();}).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
labels();el('commercialSave').disabled=true;
})();
