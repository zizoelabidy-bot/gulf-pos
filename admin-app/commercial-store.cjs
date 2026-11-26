'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function text(value,name,max=256,optional=false) {
  if(optional && (value===undefined || value==='')) return '';
  if(typeof value!=='string' || !value.trim() || value.trim().length>max) throw new Error('Invalid '+name);
  return value.trim();
}
function date(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid date');
  const parsed = new Date(value+'T00:00:00Z');
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value) throw new Error('Invalid date');
  return value;
}
function fils(value) {
  if(typeof value!=='string'||!/^\d{1,9}(?:\.\d{1,3})?$/.test(value)) throw new Error('Invalid KWD amount (up to three decimals)');
  const [whole,frac='']=value.split('.');
  const n=Number(whole)*1000+Number(frac.padEnd(3,'0'));
  if(!Number.isSafeInteger(n)||n<=0) throw new Error('Amount must be positive');
  return n;
}
function createCommercialStore(file, encryption) {
  function check() {
    if(!encryption.isEncryptionAvailable()) throw new Error('OS encryption unavailable');
  }
  function read() {
    check();
    if(!fs.existsSync(file)) return {version:1,customers:[],subscriptions:[],payments:[],tickets:[]};
    const state=JSON.parse(encryption.decryptString(fs.readFileSync(file)));
    if(state.version!==1||!['customers','subscriptions','payments','tickets'].every(k=>Array.isArray(state[k]))) throw new Error('Invalid commercial registry');
    return state;
  }
  function save(state) {
    check();
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const tmp=file+'.'+crypto.randomUUID()+'.tmp';
    try {
      const fd=fs.openSync(tmp,'wx',0o600);
      try {fs.writeFileSync(fd,encryption.encryptString(JSON.stringify(state)));fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
      fs.renameSync(tmp,file);
    } finally {if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
  }
  function record(input) {
    if(!input||typeof input!=='object') throw new Error('Invalid operation');
    const state=read();
    const id=crypto.randomUUID(),created_at=new Date().toISOString();
    const customer=()=> {
      const found=state.customers.find(c=>c.id===input.customer_id);
      if(!found) throw new Error('Customer not found');return found.id;
    };
    switch(input.kind) {
      case 'customer': {
        const name=text(input.name,'customer name');
        if(state.customers.some(c=>c.name.toLowerCase()===name.toLowerCase()))throw new Error('Customer already exists');
        state.customers.push({id,created_at,name,contact:text(input.contact,'contact',256,true)});
        break;
      }
      case 'subscription': {
        const customer_id=customer(),start=date(input.start),end=date(input.end);
        if(end<start)throw new Error('End date precedes start date');
        const fee_fils=fils(input.amount);
        if(state.subscriptions.some(s=>s.customer_id===customer_id&&s.start<=end&&s.end>=start))throw new Error('Overlapping subscription period');
        state.subscriptions.push({id,created_at,customer_id,start,end,fee_fils,reference:text(input.reference,'contract reference',128,true)});
        break;
      }
      case 'payment': {
        const sub=state.subscriptions.find(s=>s.id===input.subscription_id);
        if(!sub)throw new Error('Subscription not found');
        const amount_fils=fils(input.amount),reference=text(input.reference,'payment reference',128);
        if(state.payments.some(p=>p.reference.toLowerCase()===reference.toLowerCase()))throw new Error('Duplicate payment reference');
        const paid=state.payments.filter(p=>p.subscription_id===sub.id).reduce((n,p)=>n+p.amount_fils,0);
        if(amount_fils>sub.fee_fils-paid)throw new Error('Payment exceeds outstanding balance');
        state.payments.push({id,created_at,subscription_id:sub.id,amount_fils,reference,date:date(input.date)});
        break;
      }
      case 'ticket': {
        state.tickets.push({id,created_at,customer_id:customer(),subject:text(input.subject,'subject'),detail:text(input.detail,'details',2000,true),status:'open',closed_at:null});
        break;
      }
      case 'close_ticket': {
        const ticket=state.tickets.find(t=>t.id===input.ticket_id);
        if(!ticket||ticket.status!=='open')throw new Error('Open ticket not found');
        ticket.status='closed';ticket.closed_at=created_at;break;
      }
      default:throw new Error('Unknown operation');
    }
    save(state);
    return state;
  }
  return Object.freeze({read,record});
}
module.exports={createCommercialStore};
