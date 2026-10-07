import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getRedis } from '@/lib/redis';
import { issueSessionToken } from '@/lib/session';
import { recordCompanyEvidence } from '@/lib/company-review';
import { GET, POST } from '@/app/api/campaigns/company/[id]/contributions/route';
import { GET as MY_RESPONSES } from '@/app/api/me/company-responses/route';
import { campaignIntakePaused } from '@/lib/contribution-responses';
vi.mock('@/lib/track',()=>({trackEvent:async()=>{}}));
const run=process.env.FAVOUR_RESPONSE_REAL_TEST==='1';
const owner='0x1111111111111111111111111111111111111111',person='0x2222222222222222222222222222222222222222',other='0x3333333333333333333333333333333333333333';
const id='draft_response_test';const params={params:Promise.resolve({id})};
function req(wallet?:string,body?:unknown){return new NextRequest(`http://127.0.0.1/api/campaigns/company/${id}/contributions`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(wallet?{cookie:`favour_session=${issueSessionToken(wallet,Date.now())}`}:{})},...(body?{body:JSON.stringify(body)}:{})});}
describe.skipIf(!run)('contribution response API against isolated real Redis',()=>{
 beforeAll(async()=>{
 process.env.KV_REST_API_URL='http://127.0.0.1:8087';process.env.KV_REST_API_TOKEN='test-only';process.env.SESSION_SECRET='TEST DATA response secret';
 const r=getRedis()!;await r.del('company:responses:'+id,'campaign:company:private-evidence:'+id);
 await r.set('campaign:draft:'+id,JSON.stringify({id,owner,status:'published',company:'TEST DATA Company',brief:'TEST DATA original brief',reviewWithinHours:48}));
 await r.sadd('campaign:company:published',id);
 await recordCompanyEvidence(id,{taskId:'test-piece',kind:'review',verdict:'pass',reason:'TEST DATA verifier result',participant:'test contributor',at:new Date(Date.now()-49*3600000).toISOString()},'TEST DATA private original',[],person);
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
 expect(await getRedis()!.get('pof:'+person)).toBeNull();
 });
});
