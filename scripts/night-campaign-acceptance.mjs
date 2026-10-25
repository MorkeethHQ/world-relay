// Actual HTTP routes + actual local Redis. TEST DATA sessions/checker, no real human/payment.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
const APP=process.argv[2]||'http://localhost:3195',STORE='http://127.0.0.1:17180';
if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(APP))throw Error('Loopback fixture only');
const fx=JSON.parse(readFileSync(new URL('./review-fixture.json',import.meta.url),'utf8'));
const cmd=async(...c)=>{const r=await fetch(STORE,{method:'POST',headers:{Authorization:'Bearer local-fake-not-a-secret'},body:JSON.stringify(c)});const j=await r.json();if(j.error)throw Error(j.error);return j.result;};
const m=JSON.parse(await cmd('GET','night:fixturemanifest'));if(!m.fixture||!m.noPayment)throw Error('Fixture manifest missing');
const actor=k=>fx.participants.find(p=>p.key===k).address;
function cookie(a){const p=`${a.toLowerCase()}.${Date.now()+86400000}`;return `favour_session=${Buffer.from(p).toString('base64url')}.${createHmac('sha256',fx.sessionSecret).update(p).digest('base64url')}`;}
const requests=[];
async function api(path,who,body){const start=Date.now();const res=await fetch(APP+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(who?{Cookie:cookie(who)}:{})},body:body?JSON.stringify(body):undefined});const data=await res.json();requests.push({path,status:res.status,ms:Date.now()-start});return {status:res.status,data};}
const ok=(x,msg)=>{if(!x)throw Error(msg);};
async function snapshot(){return {ana:(await api('/api/proof-of-favour?address='+actor('ana'),actor('ana'))).data.profile,ben:(await api('/api/proof-of-favour?address='+actor('ben'),actor('ben'))).data.profile,contributions:(await api('/api/me/contributions',actor('ana'))).data.contributions,welcome:(await api('/api/welcome',actor('ana'))).data.welcome};}
if(process.argv.includes('--verify')){const before=JSON.parse(readFileSync(process.argv[process.argv.indexOf('--verify')+1],'utf8'));const now=await snapshot();ok(now.ana.totalPoints===before.after.ana.totalPoints,'Points changed across restart');for(const id of before.acceptedTaskIds)ok(now.contributions.some(c=>c.taskId===id),'Accepted proof lost across restart');ok(now.welcome.done===before.after.welcome.done,'Welcome progress lost');console.log(JSON.stringify({fixture:true,actualRedis:true,restartRetained:true,points:now.ana.totalPoints,contributions:now.contributions.length,done:now.welcome.done,requests},null,2));process.exit(0);}
const fixtureOwner='0x7e57da7a'+Date.now().toString(16).padStart(32,'0');
const draft=(await api('/api/campaigns/drafts',fixtureOwner,fx.company)).data.draft;
const company=(await api('/api/campaigns/drafts/'+draft.id+'/publish',fixtureOwner,{})).data.campaign;const companyTask=company.pieceTaskIds.review;
const claim=await api('/api/tasks/'+companyTask+'/claim',actor('ana'),{claimant:actor('ana')});ok(claim.status===200,'Claim failed: '+JSON.stringify(claim.data));
const before=await snapshot();
const proof=readFileSync(new URL('../public/campaign-friends.jpg',import.meta.url)).toString('base64');
const welcomeProof=readFileSync(new URL('../public/hero/coffee.jpg',import.meta.url)).toString('base64');
const base={taskId:companyTask,submitter:actor('ana'),proofImages:[proof],proofImageBase64:proof,proofNote:'TEST DATA: simulated contribution about the fixture teapot. No real person used the product.'};
const refused=await api('/api/verify-proof',actor('ana'),base);ok(refused.status===422,'Missing consent was not refused');
const cross=await api('/api/verify-proof',actor('ben'),{...base,proofConsent:true});ok(cross.status===403,'Other wallet could submit as Ana');
const accepted=await api('/api/verify-proof',actor('ana'),{...base,proofConsent:true});ok(accepted.status===200&&accepted.data.verification?.verdict==='pass','Fixture check failed: '+JSON.stringify({error:accepted.data.error,verification:accepted.data.verification}));
const mid=await snapshot();ok(mid.ana.totalPoints-before.ana.totalPoints===accepted.data.pointsAwarded,'Reward receipt does not match durable points');ok(mid.contributions.some(c=>c.taskId===companyTask),'No contribution history');
const replay=await api('/api/verify-proof',actor('ana'),{...base,proofConsent:true});const replayState=await snapshot();ok(replayState.ana.totalPoints===mid.ana.totalPoints,'Duplicate proof awarded twice');
const started=await api('/api/welcome/start',actor('ana'),{address:actor('ana'),sourceTaskId:m.welcomeSourceIds[0]});ok(started.status===200,'Welcome start failed');const instance=started.data.task;
const welcome=await api('/api/verify-proof',actor('ana'),{taskId:instance.id,submitter:actor('ana'),proofConsent:true,proofImages:[welcomeProof],proofNote:'TEST DATA: fixture photo and city note. No real participant.'});ok(welcome.status===200&&welcome.data.verification?.verdict==='pass','Welcome check failed: '+JSON.stringify({error:welcome.data.error,verification:welcome.data.verification}));
const after=await snapshot();ok(after.welcome.done>=1,'Welcome was not marked done');ok(after.ben.totalPoints===before.ben.totalPoints,'Other wallet balance changed');
const privateRecord=await api('/api/proof-of-favour?address='+actor('ana'),actor('ben'));ok(privateRecord.status===403,'Other wallet read private points');
const consent=JSON.parse(await cmd('GET',`proof:consent:${companyTask}:${actor('ana').toLowerCase()}`));ok(consent.version==='proof-review-20261025','Consent receipt missing');
const out={fixture:true,simulatedPeople:true,simulatedVerifier:true,noPayment:true,actualRedis:true,app:APP,companyRequest:{id:company.id,brief:company.brief},acceptedTaskIds:[companyTask,instance.id],recordedPoints:{company:accepted.data.pointsAwarded,welcome:welcome.data.pointsAwarded},consent,checks:{missingConsent:refused.status,crossWallet:cross.status,replay:replay.status,replayNoSecondReward:true,privateRecord:privateRecord.status},before,after,requests};const outPath=process.argv[3]||'/tmp/favour-night-acceptance.json';writeFileSync(outPath,JSON.stringify(out,null,2));console.log(JSON.stringify({outPath,recordedPoints:out.recordedPoints,checks:out.checks,afterPoints:after.ana.totalPoints,welcomeDone:after.welcome.done,fixture:true,noPayment:true},null,2));
