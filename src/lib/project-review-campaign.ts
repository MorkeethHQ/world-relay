import { briefWords, hasProduct, productNameOrNull, productUrlOrNull, type PublicCompanyCampaign } from "./campaign-draft-shape";
import type { Task } from "./types";

export type ProjectReviewInput = { name:string; url:string; ask:string; optionA:string; optionB:string; responseCommitment:boolean };
export type ProjectFinding = { did:string; finding:string; outcome:""|"works"|"broke"|"would_return"; preference:""|"A"|"B"|"neither" };
const line=(s:string)=>s.replace(/\s+/g," ").trim();
export function projectPlanError(v:ProjectReviewInput):string|null {
  if(!productNameOrNull(v.name))return "Name the project.";
  const url=productUrlOrNull(v.url);if(!url||!url.startsWith("https://"))return "Use an https link to the project.";
  const host=new URL(url).hostname;if(/^[0-9.]+$/.test(host)||/(?:^|\.)(?:localhost|local|internal)$/.test(host))return "Use the project’s public site, not a local address.";
  if(briefWords(v.ask)<20||v.ask.trim().length>500)return "Describe what people should try and report in 20 words or more, up to 500 characters.";
  if(!!v.optionA.trim()!==!!v.optionB.trim())return "Name both A/B alternatives, or leave both blank.";
  if(v.optionA.trim()&&(line(v.optionA).length<2||line(v.optionB).length<2||line(v.optionA).length>80||line(v.optionB).length>80||line(v.optionA).toLowerCase()===line(v.optionB).toLowerCase()))return "Give A and B two different names, 2–80 characters each.";
  if(/[\[\]]/.test(v.optionA+v.optionB))return "Use plain names for the alternatives, without brackets.";
  if(projectBrief(v).length>500)return "Shorten the ask or A/B names to fit the campaign’s 500 character brief.";
  if(!v.responseCommitment)return "Confirm you can respond to contributors within 48 hours.";
  return null;
}
function projectBrief(v:ProjectReviewInput):string {
  return line(v.ask)+(v.optionA.trim()?` [A/B A: ${line(v.optionA)}] [A/B B: ${line(v.optionB)}]`:"");
}
export function projectPlanBody(v:ProjectReviewInput) {
  const error=projectPlanError(v);if(error)throw new Error(error);
  return {company:line(v.name),productName:line(v.name),productUrl:productUrlOrNull(v.url)!,brief:projectBrief(v),pieces:[{kind:"review" as const,count:10}],rewardPerPiecePoints:10,proposedPoolUsdc:0,reviewRule:"ai_and_jury" as const,reviewWithinHours:48};
}
export function projectAlternatives(brief:string):{A:string;B:string}|null {
  const A=brief.match(/\[A\/B A: ([^\]]{2,80})\]/)?.[1];const B=brief.match(/\[A\/B B: ([^\]]{2,80})\]/)?.[1];return A&&B?{A,B}:null;
}
export function projectFindingError(v:ProjectFinding,ab:boolean):string|null {
  if(!v.outcome)return "Choose what happened when you tried the project.";
  if(line(v.did).length<8||v.did.length>300)return "Say what you actually tried, 8–300 characters.";
  if(line(v.finding).length<12||v.finding.length>1000)return "Share one useful finding, 12–1000 characters.";
  if(ab&&!v.preference)return "Choose A, B or neither after trying the alternatives.";
  return null;
}
export function projectFindingNote(v:ProjectFinding,ab:{A:string;B:string}|null):string {
  const error=projectFindingError(v,!!ab);if(error)throw new Error(error);
  const outcome=v.outcome?{works:"Worked for me",broke:"I hit a problem",would_return:"I would return"}[v.outcome]:"";
  return `What I tried: ${v.did.trim()}\nWhat happened: ${v.finding.trim()}\nMy assessment: ${outcome}`+(ab?`\nMy preference: ${v.preference}${v.preference==="A"||v.preference==="B"?` — ${ab[v.preference]}`:""}\nThis is my review preference, not a weekly ballot or a verified quality score.`:"");
}
// The project shown follows the address, so browser back/forward moves between
// projects instead of leaving FAVOUR.
export function projectFromSearch(search:string):string|null{const id=new URLSearchParams(search).get("project");return id&&id.trim()?id:null;}
export function projectHref(id:string|null):string{return id?`/?campaign=project-reviews&project=${encodeURIComponent(id)}`:"/?campaign=project-reviews";}

// An unsent finding is kept per account AND per campaign, so it survives a project
// switch or a return from the proof screen but never appears for another wallet or
// under another project. Signed out, nothing is written to the device.
export const EMPTY_FINDING:ProjectFinding={did:"",finding:"",outcome:"",preference:""};
type DraftStore=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export function findingDraftKey(userId:string|null,campaignId:string):string|null{return userId&&campaignId?`favour:project-finding:${userId}:${campaignId}`:null;}
export function loadFindingDraft(store:DraftStore|null,userId:string|null,campaignId:string):ProjectFinding{
  const key=findingDraftKey(userId,campaignId);if(!store||!key)return EMPTY_FINDING;
  try{const v=JSON.parse(store.getItem(key)??"null");if(!v||typeof v!=="object")return EMPTY_FINDING;
    const s=(x:unknown,max:number)=>typeof x==="string"?x.slice(0,max):"";
    const outcome=["works","broke","would_return"].includes(v.outcome)?v.outcome:"";const preference=["A","B","neither"].includes(v.preference)?v.preference:"";
    return {did:s(v.did,300),finding:s(v.finding,1000),outcome,preference};}catch{return EMPTY_FINDING;}
}
export function saveFindingDraft(store:DraftStore|null,userId:string|null,campaignId:string,v:ProjectFinding):void{
  const key=findingDraftKey(userId,campaignId);if(!store||!key)return;
  try{if(v.did.trim()||v.finding.trim()||v.outcome||v.preference)store.setItem(key,JSON.stringify(v));else store.removeItem(key);}catch{}
}
export function clearFindingDraft(store:DraftStore|null,userId:string|null,campaignId:string):void{const key=findingDraftKey(userId,campaignId);if(!store||!key)return;try{store.removeItem(key);}catch{}}
export function reviewCampaigns(campaigns:PublicCompanyCampaign[]):PublicCompanyCampaign[]{return campaigns.filter(c=>c.status==="published"&&hasProduct(c)&&c.pieces.some(p=>p.kind==="review"&&p.count>0));}
export function projectReviewAvailability(c:PublicCompanyCampaign,tasks:Task[],completed:Set<string>,paused:boolean,owner=false):{task:Task|null;left:number;state:string} {
  if(owner)return {task:null,left:0,state:"This is your campaign. Read the findings and respond to contributors."};
  const id=c.pieceTaskIds?.review;const task=id?tasks.find(t=>t.id===id):null;
  if(id&&completed.has(id))return {task:null,left:0,state:"Your review is accepted. Return to the campaign responses below."};
  if(paused)return {task:null,left:0,state:"New contributions paused while the organiser answers earlier work."};
  if(!task||task.status!=="open")return {task:null,left:0,state:"No review place is open right now."};
  const left=Math.max(0,(task.maxCompletions??c.pieces.find(p=>p.kind==="review")?.count??0)-(task.completionCount??0));
  return {task:left>0?task:null,left,state:left>0?`${left} review places still open`:"All review places have been filled."};
}
