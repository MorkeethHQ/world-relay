import { getRedis } from './redis';
import { companyCompletionKey } from './company-review';
import { DRAFT_PREFIX } from './campaign-drafts';
import type { CampaignDraft } from './campaign-draft-shape';

const PREFIX = 'project:wallet-ballot:v1:';
const WEEK = 7 * 86400000;
export type WalletRound = { id:string; start:number; end:number; minimum:number; version:1 };
type Candidate = { id:string; name:string; votes:number };
const parse = <T>(v:unknown):T => (typeof v === 'string' ? JSON.parse(v) : v) as T;
export function utcWalletWeek(now:number) {
  const d = new Date(now); d.setUTCHours(0,0,0,0); d.setUTCDate(d.getUTCDate() - (d.getUTCDay()+6)%7);
  const start=d.getTime(); return {id:d.toISOString().slice(0,10),start,end:start+WEEK};
}
export function walletRoundId(id:unknown):string|null {
  if(typeof id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(id))return null;
  const time=Date.parse(id+'T00:00:00Z');return Number.isFinite(time)&&utcWalletWeek(time).id===id?id:null;
}
export function walletMinimum(value:string|undefined):number|null {
  if(!value || !/^[1-9]\d{0,5}$/.test(value))return null;
  const n=Number(value);return n<=100000?n:null;
}
const keys=(id:string)=>[PREFIX+id+':round',PREFIX+id+':wallets',PREFIX+id+':counts',PREFIX+id+':candidates'];
export function walletResult(round:WalletRound|null,candidates:Candidate[],now:number) {
  const total=candidates.reduce((n,c)=>n+c.votes,0);
  if(!round)return {status:'awaiting_policy',total,winner:null};
  if(now<round.end)return {status:'open',total,winner:null};
  if(total<round.minimum)return {status:'insufficient',total,winner:null};
  const top=Math.max(0,...candidates.map(c=>c.votes));const leaders=candidates.filter(c=>c.votes===top);
  return leaders.length===1?{status:'winner',total,winner:leaders[0]}:{status:'tie',total,winner:null};
}
// All eligibility, frozen-policy and dedup writes are one real Redis transaction.
// There is no award, wallet profile, money, Orb or unique-person claim here.
export const CAST_WALLET_BALLOT = `
local wants={'string','hash','hash','hash','string','string'}
for i=1,#KEYS do local t=redis.call('TYPE',KEYS[i]).ok; if t~='none' and t~=wants[i] then return redis.error_reply('Ballot store type mismatch') end end
local now=tonumber(ARGV[1]); local start=tonumber(ARGV[3]); local finish=tonumber(ARGV[4]);
if now<start or now>=finish then return 'closed' end
local stored=redis.call('GET',KEYS[1]); local policy=nil
if stored then
 policy=cjson.decode(stored)
 if policy.id~=ARGV[2] or policy.start~=start or policy['end']~=finish or policy.version~=1 or not policy.minimum or policy.minimum<1 then return 'invalid_policy' end
else
 local minimum=tonumber(ARGV[5]); if not minimum or minimum<1 or minimum>100000 or minimum~=math.floor(minimum) then return 'policy_required' end
 policy={id=ARGV[2],start=start,['end']=finish,minimum=minimum,version=1}
end
local prior=redis.call('HGET',KEYS[2],ARGV[6]); if prior then if prior==ARGV[7] then return 'recovered' else return 'already_voted' end end
local raw=redis.call('GET',KEYS[5]); if not raw then return 'ineligible' end
local campaign=cjson.decode(raw)
if campaign.id~=ARGV[7] or campaign.status~='published' or (campaign.hiddenAt and campaign.hiddenAt~=cjson.null) or type(campaign.productName)~='string' or campaign.productName=='' or type(campaign.productUrl)~='string' or campaign.productUrl=='' then return 'ineligible' end
if campaign.owner==ARGV[6] then return 'self_vote' end
local review=campaign.pieceTaskIds and campaign.pieceTaskIds.review
local receiptRaw=redis.call('GET',KEYS[6]); if not review or not receiptRaw then return 'review_required' end
local receipt=cjson.decode(receiptRaw)
if receipt.taskId~=review or not receipt.verification or receipt.verification.verdict~='pass' then return 'review_required' end
if not stored then redis.call('SET',KEYS[1],cjson.encode(policy)) end
redis.call('HSET',KEYS[2],ARGV[6],ARGV[7]); redis.call('HINCRBY',KEYS[3],ARGV[7],1)
redis.call('HSETNX',KEYS[4],ARGV[7],cjson.encode({id=ARGV[7],name=campaign.productName}))
return 'cast'`;
export async function castWalletBallot(wallet:string,campaignId:string,roundId:string,now=Date.now()) {
  const redis=getRedis();if(!redis)throw new Error('Ballot storage unavailable');
  const week=utcWalletWeek(now);if(roundId!==week.id)return 'closed';
  const raw=await redis.get(DRAFT_PREFIX+campaignId);if(!raw)return 'ineligible';
  const campaign=parse<CampaignDraft>(raw);const review=campaign.pieceTaskIds?.review;if(!review)return 'review_required';
  return String(await redis.eval(CAST_WALLET_BALLOT,[...keys(roundId),DRAFT_PREFIX+campaignId,companyCompletionKey(review,wallet)],
    [now,week.id,week.start,week.end,walletMinimum(process.env.FAVOUR_WEEKLY_MIN_BALLOTS)??0,wallet.toLowerCase(),campaignId]));
}
export async function walletBallotView(id:string|undefined,wallet:string|null,campaignId:string|undefined,now=Date.now()) {
  const redis=getRedis();if(!redis)throw new Error('Ballot storage unavailable');
  const week=id?utcWalletWeek(Date.parse(id+'T00:00:00Z')):utcWalletWeek(now);
  const [raw,counts,names,myBallot]=await Promise.all([redis.get(keys(week.id)[0]),redis.hgetall<Record<string,number>>(keys(week.id)[2]),redis.hgetall<Record<string,string>>(keys(week.id)[3]),wallet?redis.hget<string>(keys(week.id)[1],wallet.toLowerCase()):null]);
  const frozen=raw?parse<WalletRound>(raw):null;
  if(frozen&&(frozen.id!==week.id||frozen.start!==week.start||frozen.end!==week.end||frozen.version!==1||!Number.isInteger(frozen.minimum)||frozen.minimum<1))throw new Error('Invalid frozen ballot policy');
  const minimum=walletMinimum(process.env.FAVOUR_WEEKLY_MIN_BALLOTS);
  const round=frozen??(week.id===utcWalletWeek(now).id&&minimum?{...week,minimum,version:1 as const}:null);
  const candidates=Object.entries(counts??{}).map(([key,v])=>{const candidate=names?.[key]?parse<{name:string}>(names[key]):null;const votes=Number(v);if(!candidate||!Number.isInteger(votes)||votes<1)throw new Error('Invalid ballot tally');return {id:key,name:candidate.name,votes};}).sort((a,b)=>b.votes-a.votes||a.id.localeCompare(b.id));
  let eligible=false;
  if(wallet&&campaignId){const c=await redis.get(DRAFT_PREFIX+campaignId);if(c){const d=parse<CampaignDraft>(c);if(d.owner!==wallet.toLowerCase()&&d.status==='published'&&!d.hiddenAt&&d.productName&&d.productUrl&&d.pieceTaskIds?.review){const r=await redis.get(companyCompletionKey(d.pieceTaskIds.review,wallet));eligible=!!r&&parse<{verification?:{verdict:string};taskId:string}>(r).verification?.verdict==='pass'&&parse<{taskId:string}>(r).taskId===d.pieceTaskIds.review;}}}
  return {week,round,frozen:!!frozen,...walletResult(round,candidates,now),candidates,myBallot:myBallot??null,eligible,previous:utcWalletWeek(week.start-1).id};
}
