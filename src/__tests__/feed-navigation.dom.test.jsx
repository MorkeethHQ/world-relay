// @vitest-environment jsdom
import {beforeEach,afterEach,test,expect,vi} from "vitest";
// Actual Feed, ProjectReviewCampaign, SubmitProof and QuickPost mounted in ReactDOM.
// Synthetic API effects and external UI/SDK rendering only. No browser/GUI, network or funds.
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
vi.mock('next/dynamic',()=>({default:()=>()=>null}));
vi.mock('@worldcoin/minikit-js',()=>({MiniKit:{isInstalled:()=>false,sendTransaction:()=>{throw Error('NO TRANSACTIONS IN THIS TEST');}}}));
vi.mock('@worldcoin/mini-apps-ui-kit-react',async()=>{
 const R=await import('react');
 const el=tag=>({children,...p})=>R.createElement(tag,p,children);
 const result=Object.fromEntries(['Typography','Spinner','Skeleton','SkeletonTypography','Pill','AlertDialogContent','AlertDialogHeader','AlertDialogTitle','AlertDialogDescription','AlertDialogFooter','AlertDialogClose','CircularIcon','LiveFeedback'].map(n=>[n,el('div')]));
 return {...result,Button:el('button'),TextArea:el('textarea'),AlertDialog:({open,children})=>open?R.createElement('div',null,children):null,TopBar:({title,startAdornment,endAdornment})=>R.createElement('header',null,title,startAdornment,endAdornment)};
});
vi.mock('@/lib/minikit-helpers',()=>Object.fromEntries(['hapticSuccess','hapticError','hapticTap','hapticHeavy','hapticMedium','hapticSelection','shareTask'].map(n=>[n,()=>{}])));
vi.mock('@/hooks/useWorldUser',()=>({useWorldUsers:()=>{},displayName:a=>a?.slice(0,8)??'Synthetic'}));
vi.mock('@/components/WeeklyWalletBallot',()=>({WeeklyWalletBallot:()=>null}));
vi.mock('@/components/CompanyCampaign',()=>Object.fromEntries(['ForCompaniesView','CompanyTrust','ProductLine','CampaignDraftForm','CampaignDraftList','CompanyCampaignCard','CompanyCampaignView'].map(n=>[n,()=>null])));
vi.mock('@/components/CampaignPage',()=>({CampaignPage:()=>null,FeaturedCampaignBanner:()=>null}));
vi.mock('@/components/Polls',()=>({PollsFeed:()=>null}));
import {Feed} from '@/components/Feed';
import {PENDING_MISSION_KEY} from '@/components/Onboarding';
const ALICE='0x000000000000000000000000000000000000a11c';
const task=(id,companyCampaignId=null)=>({id,description:'SYNTHETIC '+id+' write a useful local test finding',poster:'0x0000000000000000000000000000000000000009',claimant:null,bountyUsdc:5,rewardType:'points',status:'open',category:'feedback',location:'Online',deadline:new Date(Date.now()+86400000).toISOString(),createdAt:new Date().toISOString(),companyCampaignId,campaignId:null,taskType:'single',onChainId:null,maxCompletions:10,completionCount:0,proofImageUrl:null,proofNote:null,verificationResult:null,agent:null,requiresClaim:false});
const projectTask=task('project_review','draft_one'),boardTask=task('board_review');
const campaign={id:'draft_one',status:'published',company:'SYNTHETIC Project',productName:'SYNTHETIC Project',productUrl:'https://example.invalid/test',pieces:[{kind:'review',count:10}],pieceTaskIds:{review:projectTask.id},brief:'Try one synthetic feature and return with a useful finding about what happened.',rewardPerPiecePoints:10,proposedPoolUsdc:0,reviewRule:'ai_and_jury',companyChecked:false};
const projectTaskTwo=task('project_review_two','draft_two');
const campaignTwo={...campaign,id:'draft_two',company:'SYNTHETIC Second Project',productName:'SYNTHETIC Second Project',pieceTaskIds:{review:projectTaskTwo.id}};
let host,root,calls,verification,unexpected;
const flush=async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,5));});};
const button=(text)=>[...host.querySelectorAll('button')].find(n=>n.textContent.trim()===text);
const click=async(text)=>{const b=button(text);expect(b,'button '+text+' in '+host.textContent.slice(-1600)).toBeTruthy();expect(b.disabled).toBe(false);await act(async()=>b.click());await flush();};
const enter=async(node,value)=>{expect(node).toBeTruthy();const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;await act(async()=>{setter.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));});await flush();};
beforeEach(async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();localStorage.setItem('relay_first_run_coach_dismissed','true');
 window.history.replaceState({},'','/?campaign=project-reviews&project=draft_one');window.scrollTo=()=>{};
 vi.stubGlobal('EventSource',class{addEventListener(){}close(){}});
 vi.stubGlobal('IntersectionObserver',class{observe(){}unobserve(){}disconnect(){}});
 calls=[];unexpected=[];verification={verification:{verdict:'pass',reasoning:'SYNTHETIC accepted by API fixture'},pointsAwarded:5};
 vi.stubGlobal('fetch',vi.fn(async(path,options={})=>{
  calls.push({path:String(path),method:options.method??'GET',body:options.body?JSON.parse(options.body):null});
  if(path==='/api/tasks')return Response.json({tasks:[projectTask,projectTaskTwo,boardTask]});
  if(path==='/api/campaigns/company')return Response.json({campaigns:[campaign,campaignTwo]});
  if(path==='/api/projects')return Response.json({projects:[]});
  if(String(path).endsWith('/contributions')&&path!=='/api/me/contributions')return Response.json({intakePaused:false,owner:false,cards:[],reveals:[]});
  if(path==='/api/campaigns/company/draft_one')return Response.json({campaign});
  if(path==='/api/campaigns/company/draft_two')return Response.json({campaign:campaignTwo});
  if(path==='/api/me/contributions')return Response.json({contributions:[]});
  if(path==='/api/campaigns/drafts')return Response.json({drafts:[]});
  if(path==='/api/welcome')return Response.json({welcome:null});
  if(String(path).startsWith('/api/jury'))return Response.json({cards:[],waiting:0});
  if(path==='/api/verify-proof')return Response.json(verification,{status:verification.error?429:200});
  if(path==='/api/escrow-v2')return Response.json({enabled:false},{status:404});
  if(path==='/api/track')return Response.json({ok:true});
  unexpected.push(path);throw Error('Unexpected synthetic request: '+path);
 }));
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root.render(React.createElement(Feed,{userId:ALICE,verificationLevel:'wallet'})));await flush();
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.restoreAllMocks();expect(unexpected).toEqual([]);});
async function projectProof(){
 const fields=host.querySelectorAll('textarea');expect(fields).toHaveLength(2);
 await enter(fields[0],'I tried the synthetic save feature');await enter(fields[1],'The synthetic saved item vanished on reload');
 await act(async()=>host.querySelector('input[name=outcome]').click());
 await click('Continue to consent and send proof');
 expect(host.querySelector('textarea').value).toContain('The synthetic saved item vanished on reload');
}
async function submitProof(){
 const consent=host.querySelector('.proof-consent-panel input[type=checkbox]');expect(consent).toBeTruthy();await act(async()=>consent.click());await flush();
 const available=[...host.querySelectorAll('button')].filter(n=>/Submit|Send|Finish/.test(n.textContent));
 const b=available.find(n=>!n.disabled&&n.textContent.trim()!=='Send a new proof');
 expect(b,'proof submit controls '+available.map(n=>n.textContent)).toBeTruthy();await act(async()=>b.click());await flush();
}
test('actual Feed project proof -> accepted -> Create -> actual QuickPost cancel -> board clears marker',async()=>{
 await projectProof();await submitProof();expect(button('+ Post a favour')).toBeTruthy();
 await click('+ Post a favour');expect(window.location.search).toBe('');expect(window.history.state?.favourProjectProof).not.toBe(true);
 await click('Cancel');
 expect(button('Explore projects ↗')).toBeTruthy();
 expect(calls.filter(c=>c.path==='/api/verify-proof')).toHaveLength(1);
});

test('actual Feed project proof -> jury-cap response -> actual Judge -> board clears proof marker',async()=>{
 await projectProof();verification={error:'SYNTHETIC daily cap; judge instead',nextAction:'jury'};
 await submitProof();await click('Judge proofs instead');
 expect(window.location.pathname+window.location.search).toBe('/');expect(window.history.state?.favourProjectProof).not.toBe(true);
 await act(async()=>host.querySelector('button[aria-label=Close]').click());await flush();expect(button('Explore projects ↗')).toBeTruthy();
});

test('actual Feed board proof opened by the real pending-mission handoff ignores a stale project marker',async()=>{
 await act(async()=>root.unmount());
 window.history.replaceState({favourProjectProof:true},'','/');
 localStorage.setItem(PENDING_MISSION_KEY,JSON.stringify({id:boardTask.id,date:new Date().toISOString().slice(0,10)}));
 root=createRoot(host);await act(async()=>root.render(React.createElement(Feed,{userId:ALICE,verificationLevel:'wallet'})));await flush();
 expect(host.textContent).toContain('Answer');expect(button('← Return to project campaign')).toBeFalsy();
 await enter(host.querySelector('textarea'),'A synthetic answer for the board favour');await submitProof();
 const back=vi.spyOn(window.history,'back');await click('Discover more favours');
 expect(back).not.toHaveBeenCalled();expect(button('Explore projects ↗')).toBeTruthy();back.mockRestore();
});

test('actual Feed sign-in preserves visible active finding and separately retains the other project account draft',async()=>{
 await act(async()=>root.render(React.createElement(Feed,{userId:null,verificationLevel:'wallet',onReauth:()=>root.render(React.createElement(Feed,{userId:ALICE,verificationLevel:'wallet'}))})));await flush();
 const stored={did:'An older saved account action',finding:'An older account finding must not replace current text',outcome:'broke',preference:''};
 localStorage.setItem('favour:project-finding:'+ALICE+':draft_one',JSON.stringify(stored));
 localStorage.setItem('favour:project-finding:'+ALICE+':draft_two',JSON.stringify({...stored,did:'Older saved second-project action'}));
 localStorage.setItem('favour:project-finding:'+ALICE+':draft_other',JSON.stringify({...stored,did:'Keep separate other-project account text'}));
 await enter(host.querySelectorAll('textarea')[0],'Unsigned first-project action');await enter(host.querySelectorAll('textarea')[1],'Unsigned first-project finding with details');
 await click('Next →');
 const fields=host.querySelectorAll('textarea');expect(fields[0].value).toBe('');
 await enter(fields[0],'Currently visible unsigned action');await enter(fields[1],'Currently visible unsigned finding with details');
 await act(async()=>host.querySelector('input[name=outcome]').click());await click('Sign in to continue');
 expect(host.querySelectorAll('textarea')[0].value).toBe('Currently visible unsigned action');
 expect(host.querySelectorAll('textarea')[1].value).toBe('Currently visible unsigned finding with details');
 expect(JSON.parse(localStorage.getItem('favour:project-finding:'+ALICE+':draft_other')).did).toBe('Keep separate other-project account text');
 await click('← Previous');expect(host.querySelectorAll('textarea')[0].value).toBe('An older saved account action');
 await click('Next →');expect(host.querySelectorAll('textarea')[0].value).toBe('Currently visible unsigned action');
});
