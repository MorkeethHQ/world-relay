import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getRedis } from '@/lib/redis';
import * as redisModule from '@/lib/redis';
import { issueSessionToken } from '@/lib/session';
import { recordCompanyEvidence, EVIDENCE_PREFIX, REGISTER_COMPANY_EVIDENCE, getCompanyCompletion, companyCompletionKey } from '@/lib/company-review';
import { GET, POST } from '@/app/api/campaigns/company/[id]/contributions/route';
import { POST as VERIFY } from '@/app/api/verify-proof/route';
import { GET as MY_RESPONSES } from '@/app/api/me/company-responses/route';
import { campaignIntakePaused } from '@/lib/contribution-responses';
vi.mock('@/lib/track',()=>({trackEvent:async()=>{}}));
const run=process.env.FAVOUR_RESPONSE_REAL_TEST==='1';
const owner='0x1111111111111111111111111111111111111111',person='0x2222222222222222222222222222222222222222',other='0x3333333333333333333333333333333333333333';
const id='draft_response_test';const params={params:Promise.resolve({id})};
function req(wallet?:string,body?:unknown){return new NextRequest(`http://127.0.0.1/api/campaigns/company/${id}/contributions`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(wallet?{cookie:`favour_session=${issueSessionToken(wallet,Date.now())}`}:{})},...(body?{body:JSON.stringify(body)}:{})});}
describe.skipIf(!run)('contribution response API against isolated real Redis',()=>{
 afterEach(()=>vi.restoreAllMocks());
 beforeAll(async()=>{
 process.env.KV_REST_API_URL='http://127.0.0.1:8087';process.env.KV_REST_API_TOKEN='test-only';process.env.SESSION_SECRET='TEST DATA response secret';
 const r=getRedis()!;await r.del('company:responses:'+id,'campaign:company:private-evidence:'+id);
 await r.set('campaign:draft:'+id,JSON.stringify({id,owner,status:'published',company:'TEST DATA Company',brief:'TEST DATA original brief',reviewWithinHours:48}));
 await r.sadd('campaign:company:published',id);
 await recordCompanyEvidence(id,{taskId:'test-piece',kind:'review',verdict:'pass',reason:'TEST DATA verifier result',participant:'test contributor',at:new Date(Date.now()-49*3600000).toISOString()},'TEST DATA private original',[],person);
 });
 it('commits proof, completion and slot together across faults and retry',async()=>{
   const r=getRedis()!;const campaign='draft_registration_fault';const taskId='fault-task';
   await r.del(EVIDENCE_PREFIX+campaign,'completed_claimants:'+taskId,'failed_claimants:'+taskId,companyCompletionKey(taskId,person),'pof:'+person,'contributions:'+person,'rep:'+person,'rl:verify:198.51.100.77');
   const task={id:taskId,companyCampaignId:campaign,status:'claimed',claimant:person,proofSubmissionId:'proof-a',proofNote:'Original retained proof',description:'TEST DATA original trial',bountyUsdc:9,rewardType:'points',maxCompletions:5,completionCount:0};
   await r.set('task:'+taskId,JSON.stringify(task));
   const result={taskId,kind:'review' as const,verdict:'pass' as const,reason:'TEST DATA verified original',participant:'TEST DATA participant',at:new Date().toISOString()};
   const verification={verdict:'pass' as const,reasoning:'TEST DATA valid proof',confidence:0.95};
   const key='test-registration-'+Date.now();
   const save=()=>recordCompanyEvidence(campaign,result,'Original retained proof',[],person,key,verification,'proof-a');
   const original=r.eval.bind(r);
   const before=vi.spyOn(redisModule,'getRedis').mockReturnValue(new Proxy(r,{get:(target,key)=>key==='eval' ?async(script: string,keys: string[],args: string[])=>{if(script===REGISTER_COMPANY_EVIDENCE)throw new Error('TEST DATA before Redis write');return original(script,keys,args);} : Reflect.get(target,key)}));
   await expect(save()).rejects.toThrow('before Redis');before.mockRestore();
   expect(await r.lrange(EVIDENCE_PREFIX+campaign,0,-1)).toHaveLength(0);
   expect(await r.smembers('completed_claimants:'+taskId)).toHaveLength(0);
   expect(await r.get('pof:'+person)).toBeNull();
   expect(await r.lrange('contributions:'+person,0,-1)).toHaveLength(0);
   expect(await r.get('task:'+taskId)).toMatchObject({status:'claimed',completionCount:0});
   // A bad History key must be rejected before ANY task, slot or points write.
   await r.set('contributions:'+person,'TEST DATA wrong storage type');
   await expect(save()).rejects.toThrow();
   expect(await r.get('pof:'+person)).toBeNull();
   expect(await r.get('task:'+taskId)).toMatchObject({status:'claimed',completionCount:0});
   expect(await r.lrange(EVIDENCE_PREFIX+campaign,0,-1)).toHaveLength(0);
   await r.del('contributions:'+person);
   // A competing slot and a replaced proof both reject without publishing evidence.
   await r.sadd('completed_claimants:'+taskId,person);await expect(save()).rejects.toThrow();
   expect(await r.lrange(EVIDENCE_PREFIX+campaign,0,-1)).toHaveLength(0);
   await r.del('completed_claimants:'+taskId);
   await r.set('task:'+taskId,JSON.stringify({...task,proofSubmissionId:'proof-b'}));await expect(save()).rejects.toThrow();
   expect(await r.lrange(EVIDENCE_PREFIX+campaign,0,-1)).toHaveLength(0);
   await r.set('task:'+taskId,JSON.stringify({...task,completionCount:5}));await expect(save()).rejects.toThrow();
   expect(await r.lrange(EVIDENCE_PREFIX+campaign,0,-1)).toHaveLength(0);
   await r.set('task:'+taskId,JSON.stringify(task));
   const raced=vi.spyOn(redisModule,'getRedis').mockReturnValue(new Proxy(r,{get:(target,key)=>key==='eval' ?async(script: string,keys: string[],args: string[])=>{if(script===REGISTER_COMPANY_EVIDENCE)await r.set('task:'+taskId,JSON.stringify({...task,proofSubmissionId:'proof-race'}));return original(script,keys,args);} : Reflect.get(target,key)}));
   await expect(save()).rejects.toThrow();raced.mockRestore();
   expect(await r.lrange(EVIDENCE_PREFIX+campaign,0,-1)).toHaveLength(0);
   expect(await r.smembers('completed_claimants:'+taskId)).toHaveLength(0);
   await r.set('task:'+taskId,JSON.stringify(task));
   const after=vi.spyOn(redisModule,'getRedis').mockReturnValue(new Proxy(r,{get:(target,key)=>key==='eval' ?async(script: string,keys: string[],args: string[])=>{const value=await original(script,keys,args);if(script===REGISTER_COMPANY_EVIDENCE)throw new Error('TEST DATA reply lost after Redis write');return value;} : Reflect.get(target,key)}));
   await expect(save()).rejects.toThrow('reply lost');after.mockRestore();
   expect(await r.lrange(EVIDENCE_PREFIX+campaign,0,-1)).toHaveLength(1);
   expect(await r.smembers('completed_claimants:'+taskId)).toEqual([person]);
   expect(await r.get('task:'+taskId)).toMatchObject({status:'open',completionCount:1});
   await expect(save()).rejects.toThrow();
   expect(await r.lrange(EVIDENCE_PREFIX+campaign,0,-1)).toHaveLength(1);
   expect(await r.get('task:'+taskId)).toMatchObject({completionCount:1});
   expect(await r.get('pof:'+person)).toMatchObject({totalPoints:10,favoursCompleted:1});
   expect(await r.lrange('contributions:'+person,0,-1)).toHaveLength(1);
   expect(await r.get('rep:'+person)).toMatchObject({tasksCompleted:1,totalPointsEarned:9,totalEarnedUsdc:0});
   for(let i=0;i<3;i++) expect(await getCompanyCompletion(taskId,person)).toMatchObject({pointsAwarded:10,streakBonus:1});
   expect(await r.get('pof:'+person)).toMatchObject({totalPoints:10,favoursCompleted:1});
   expect(await getCompanyCompletion(taskId,other)).toBeNull();
   // Run the actual authenticated HTTP handler: even a now-full task recovers
   // its saved award before the status/duplicate/intake gates or another AI call.
   await r.set('task:'+taskId,JSON.stringify({...task,status:'completed',completionCount:5,claimant:other,proofNote:'ANOTHER PERSON PRIVATE PROOF'}));
   const retry=(wallet:string,as=wallet)=>VERIFY(new NextRequest('http://localhost/api/verify-proof',{method:'POST',headers:{'Content-Type':'application/json',cookie:`favour_session=${issueSessionToken(wallet,Date.now())}`,'x-forwarded-for':'198.51.100.77'},body:JSON.stringify({taskId,submitter:as,proofNote:'Original retained proof'})}));
   for(let i=0;i<3;i++) {const response=await retry(person);expect(response.status).toBe(200);const body=await response.json();expect(body).toMatchObject({recovered:true,pointsAwarded:10,streakBonus:1});expect(JSON.stringify(body)).not.toContain('ANOTHER PERSON');}
   expect((await retry(other,person)).status).toBe(403);
   expect((await retry(other)).status).not.toBe(200);
   expect(await r.get('pof:'+person)).toMatchObject({totalPoints:10,favoursCompleted:1});
   expect(await r.lrange('contributions:'+person,0,-1)).toHaveLength(1);
   expect(await r.get('rep:'+person)).toMatchObject({tasksCompleted:1,totalPointsEarned:9,totalEarnedUsdc:0});


   // Rejected proof also commits its reopen and private evidence together;
   // retrying identical rejected work never creates a second response obligation.
   await r.del('completed_claimants:'+taskId);
   const reject=()=>recordCompanyEvidence(campaign,{...result,verdict:'fail'},'Rejected original',[],person,key+'-fail',{...verification,verdict:'fail'},'proof-a');
   for(let i=0;i<2;i++){await r.set('task:'+taskId,JSON.stringify(task));await reject();}
   expect(await r.lrange(EVIDENCE_PREFIX+campaign,0,-1)).toHaveLength(2);
   expect(await r.get('task:'+taskId)).toMatchObject({status:'open',completionCount:0});
   expect(await r.smembers('completed_claimants:'+taskId)).toHaveLength(0);
 });
 it('walks private read, revision, stale write, use, consent, revoke and rejects spoofing',async()=>{
 expect((await(await MY_RESPONSES(req(person))).json()).campaigns.some((c:{id:string})=>c.id===id)).toBe(true);
 expect((await(await MY_RESPONSES(req(other))).json()).campaigns.some((c:{id:string})=>c.id===id)).toBe(false);
 let data=await (await GET(req(person),params)).json();const eid=data.cards[0].id;expect(data.intakePaused).toBe(true);expect(JSON.stringify(data)).not.toContain(person);
 expect((await POST(req(undefined,{evidenceId:eid,action:'respond'}),params)).status).toBe(403);
 expect((await POST(req(other,{evidenceId:eid,action:'respond'}),params)).status).toBe(404);
 expect((await POST(req(owner,{evidenceId:eid,version:0,action:'respond',status:'revision_requested',message:'Please explain what you expected after that step.'}),params)).status).toBe(200);
 expect(await campaignIntakePaused(id)).toBe(false);
 expect((await POST(req(person,{evidenceId:eid,version:1,action:'revise',note:'I expected the photograph to stay selected after returning.'}),params)).status).toBe(200);
 expect((await POST(req(owner,{evidenceId:eid,version:1,action:'respond',status:'not_selected',message:'This stale response must not overwrite the new revision.'}),params)).status).toBe(409);
 expect((await POST(req(owner,{evidenceId:eid,version:2,action:'respond',status:'used',message:'TEST DATA We changed the selection after reading your report.',before:'TEST DATA The image was lost on return.',after:'TEST DATA The chosen image is restored on return.',evidenceUrl:'https://example.test/change'}),params)).status).toBe(200);
 data=await(await GET(req(),params)).json();expect(data.cards).toEqual([]);expect(data.reveals).toEqual([]);expect(JSON.stringify(data)).not.toContain('private original');
 expect((await POST(req(owner,{evidenceId:eid,version:3,action:'consent',allow:true,credit:'Forged'}),params)).status).toBe(409);
 expect((await POST(req(person,{evidenceId:eid,version:3,action:'consent',allow:true,credit:'TEST DATA Contributor'}),params)).status).toBe(200);
 data=await(await GET(req(),params)).json();expect(data.reveals).toHaveLength(1);expect(data.reveals[0].credit).toBe('TEST DATA Contributor');expect(JSON.stringify(data)).not.toContain('private original');
 expect((await POST(req(person,{evidenceId:eid,version:4,action:'consent',allow:false}),params)).status).toBe(200);
 expect((await(await GET(req(),params)).json()).reveals).toEqual([]);
 const final=await(await GET(req(person),params)).json();expect(final.cards[0].thread.revisions).toHaveLength(1);expect(final.cards[0].note).toBe('TEST DATA private original');
 const race=await Promise.all(['First concurrent decision is retained.','Second concurrent decision must reload.'].map(message=>POST(req(owner,{evidenceId:eid,version:5,action:'respond',status:'not_selected',message}),params)));
 expect(race.map(r=>r.status).sort()).toEqual([200,409]);
 expect(await getRedis()!.get('pof:'+person)).toMatchObject({totalPoints:10,favoursCompleted:1});
 });
});
