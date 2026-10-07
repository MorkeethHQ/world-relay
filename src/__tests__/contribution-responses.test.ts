import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeThread, isOverdue } from '@/lib/contribution-responses';
import { EMPTY_THREAD } from '@/lib/contribution-response-shape';
import type { CompanyEvidence } from '@/lib/company-review-shape';
vi.mock('@/lib/track',()=>({trackEvent:async()=>{}}));
const now = Date.parse('2026-10-07T12:00:00Z');
const response={action:'respond',version:0,status:'revision_requested',message:'Please name the exact step where the upload stopped.'};
it('preserves original response history through revision and use, invalidates consent on edit',()=>{
 let t=changeThread(EMPTY_THREAD,'company',response,now);
 expect(()=>changeThread(t,'company',{...response,version:0},now+1)).toThrow(/changed/);
 t=changeThread(t,'contributor',{action:'revise',version:1,note:'The upload stopped after I selected the third photograph.'},now+1000);
 expect(()=>changeThread(t,'contributor',{action:'revise',version:2,note:'Repeated revision while the company has not yet replied.'},now+2000)).toThrow(/Wait/);
 expect(()=>changeThread(t,'company',{action:'respond',version:2,status:'used',message:'We changed our upload process after your report.'},now+3000)).toThrow(/before and after/);
 t=changeThread(t,'company',{action:'respond',version:2,status:'used',message:'We changed our upload process after your report.',before:'The upload had no progress message.',after:'The upload now shows each photo as it saves.',evidenceUrl:'https://example.test/use'},now+3000);
 t=changeThread(t,'contributor',{action:'consent',version:3,allow:true,credit:'TEST DATA Contributor'},now+4000);
 expect(t.consent?.responseAt).toBe(t.responses.at(-1)?.at);
 t=changeThread(t,'company',{...response,version:4,status:'acknowledged'},now+5000);
 expect(t.consent).toBeUndefined();expect(t.responses).toHaveLength(3);expect(t.revisions).toHaveLength(1);
});
it('owner cannot grant contributor credit and contributor cannot create company use',()=>{
 const used=changeThread(EMPTY_THREAD,'company',{action:'respond',version:0,status:'used',message:'We changed the photo flow after this submission.',before:'The photograph was lost on return.',after:'The photograph now persists on return.',evidenceUrl:'https://example.test/change'},now);
 expect(()=>changeThread(used,'company',{action:'consent',version:1,credit:'Fake',allow:true},now+1)).toThrow(/not available/);
 expect(()=>changeThread(EMPTY_THREAD,'contributor',{...response,status:'used'},now)).toThrow(/not available/);
});
it('pauses overdue intake and starts a new window on revision, without imposing promises on old campaigns',()=>{
 const evidence=[{id:'e',at:new Date(now-49*3600000).toISOString()} as CompanyEvidence];
 expect(isOverdue({},evidence,{},now)).toBe(false);expect(isOverdue({reviewWithinHours:48},evidence,{},now)).toBe(true);
 const responded=changeThread(EMPTY_THREAD,'company',response,now-1000);
 expect(isOverdue({reviewWithinHours:48},evidence,{e:responded},now)).toBe(false);
 const revised=changeThread(responded,'contributor',{action:'revise',version:1,note:'This is the new information requested by the company.'},now);
 expect(isOverdue({reviewWithinHours:48},evidence,{e:revised},now+49*3600000)).toBe(true);
});
