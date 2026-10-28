// TEST DATA only. Actual local Redis persistence; simulated people and verifier, no money.
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
const APP=process.argv[2]||'http://localhost:3195', STORE=process.argv[3]||'http://127.0.0.1:17180';
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(APP)||!/^http:\/\/127\.0\.0\.1:\d+$/.test(STORE)) throw Error('Loopback review only');
const fx=JSON.parse(readFileSync(new URL('./review-fixture.json',import.meta.url),'utf8'));
const marker=await fetch(STORE+'/__log').then(r=>r.json());
if (!marker.fixture||!marker.durable||marker.engine!=='Redis') throw Error('This seed requires actual isolated durable Redis');
const cmd=async(...args)=>{const r=await fetch(STORE,{method:'POST',headers:{Authorization:'Bearer local-fake-not-a-secret'},body:JSON.stringify(args)});const j=await r.json();if(j.error)throw Error(j.error);return j.result;};
const existing=await cmd('GET','night:fixturemanifest');
if(existing){console.log(existing);process.exit(0);}
function cookie(address){const p=`${address.toLowerCase()}.${Date.now()+86400000}`;return `favour_session=${Buffer.from(p).toString('base64url')}.${createHmac('sha256',fx.sessionSecret).update(p).digest('base64url')}`;}
const api=async(path,body,who)=>{const r=await fetch(APP+path,{method:'POST',headers:{'Content-Type':'application/json',...(who?{Cookie:cookie(who)}:{})},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(`${path} ${r.status}: ${j.error}`);return j;};
// Source texts and points are the original Welcome fixture, unchanged.
const original=JSON.parse(readFileSync(new URL('./first-favour.json',import.meta.url),'utf8')).tasks.slice(0,8);
const welcome=await api('/api/seed',{secret:fx.adminSecret,tasks:original});
for(const p of fx.participants){await cmd('SET',`verified:${p.address.toLowerCase()}`,JSON.stringify({verificationLevel:'wallet',nullifier:p.address,verifiedAt:new Date().toISOString(),fixture:true}));await cmd('SET',`orbcheck:${p.address.toLowerCase()}`,'no','EX',86400);}
const owner=fx.participants.find(p=>p.key==='company').address;
const draft=(await api('/api/campaigns/drafts',fx.company,owner)).draft;
const company=(await api(`/api/campaigns/drafts/${draft.id}/publish`,{},owner)).campaign;
const out={fixture:true,simulatedPeople:true,simulatedVerifier:true,noPayment:true,backend:'actual Redis AOF',app:APP,welcomeSourceIds:welcome.tasks.map(t=>t.id),companyId:company.id,companyChecked:false,source:'scripts/review-fixture.json and original scripts/first-favour.json',seededAt:new Date().toISOString()};
await cmd('SET','night:fixturemanifest',JSON.stringify(out));console.log(JSON.stringify(out,null,2));
