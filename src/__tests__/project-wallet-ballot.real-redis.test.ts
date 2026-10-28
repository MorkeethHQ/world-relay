import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import {getRedis} from '@/lib/redis';
import {castWalletBallot,walletBallotView,utcWalletWeek,CAST_WALLET_BALLOT} from '@/lib/project-wallet-ballot';
import {readFileSync} from 'fs';
const on=!!process.env.FAVOUR_BALLOT_REAL_CONFIG;
const config=on?JSON.parse(readFileSync(process.env.FAVOUR_BALLOT_REAL_CONFIG!,'utf8')):null;
if(config){process.env.KV_REST_API_URL=`http://127.0.0.1:${config.gateway_port}`;process.env.KV_REST_API_TOKEN=config.rest_token;}
const wallets=Array.from({length:10},(_,i)=>'0x'+(i+1).toString(16).padStart(40,'0'));
const now=Date.parse('2026-10-28T12:00:00Z'),week=utcWalletWeek(now),meta=`project:wallet-ballot:v1:${week.id}:`;
const redis=()=>getRedis()!;
async function seed(id:string,owner=wallets[0]){await redis().set('campaign:draft:'+id,{id,owner,status:'published',productName:'SYNTHETIC '+id,productUrl:'https://example.com/'+id,pieceTaskIds:{review:'task-'+id}});}
async function accept(id:string,wallet:string,verdict='pass'){await redis().set(`company:completion:task-${id}:${wallet}`,{taskId:'task-'+id,verification:{verdict},pointsAwarded:10,streakBonus:0});}
async function cast(i:number,id='alpha'){await accept(id,wallets[i]);return castWalletBallot(wallets[i],id,week.id,now);}
async function snapshot(){const ks=(await redis().keys('*')).filter(k=>!k.startsWith('project:wallet-ballot:')).sort();return Promise.all(ks.map(async k=>[k,await redis().get(k)]));}
beforeAll(async()=>{if(!on)return;expect(await redis().ping()).toBe('PONG');expect(await redis().dbsize()).toBe(0);});
beforeEach(async()=>{if(!on)return;await redis().flushdb();delete process.env.FAVOUR_WEEKLY_MIN_BALLOTS;await seed('alpha');await seed('beta');});
afterAll(()=>{delete process.env.FAVOUR_WEEKLY_MIN_BALLOTS;});
describe.skipIf(!on)('actual Redis five-wallet ballot policy',()=>{
 it('uses approved five without an env binding; conflicting configuration fails closed without writes',async()=>{
  expect((await walletBallotView(undefined,null,undefined,now)).round?.minimum).toBe(5);expect(await redis().get(meta+'round')).toBeNull();
  await accept('alpha',wallets[1]);process.env.FAVOUR_WEEKLY_MIN_BALLOTS='4';
  expect((await walletBallotView(undefined,null,undefined,now)).status).toBe('awaiting_policy');expect(await castWalletBallot(wallets[1],'alpha',week.id,now)).toBe('policy_required');expect(await redis().get(meta+'round')).toBeNull();expect(await redis().exists(meta+'wallets')).toBe(0);
  process.env.FAVOUR_WEEKLY_MIN_BALLOTS='5';expect(await castWalletBallot(wallets[1],'alpha',week.id,now)).toBe('cast');expect((await walletBallotView(undefined,null,undefined,now)).round?.minimum).toBe(5);
 });
 it('rejects self votes and absent or flagged reviews without freezing a round',async()=>{
  expect(await castWalletBallot(wallets[0],'alpha',week.id,now)).toBe('self_vote');expect(await castWalletBallot(wallets[1],'alpha',week.id,now)).toBe('review_required');await accept('alpha',wallets[1],'flag');expect(await castWalletBallot(wallets[1],'alpha',week.id,now)).toBe('review_required');expect(await redis().get(meta+'round')).toBeNull();
 });
 it('four ballots are insufficient; fifth across two projects qualifies only after cutoff; no rewards or other records change',async()=>{
  for(let i=1;i<=5;i++){const id=i<=3?'alpha':'beta';await accept(id,wallets[i]);await redis().set('pof:'+wallets[i],{totalPoints:123,favoursCompleted:9});}
  await redis().set('escrow:test-sentinel',{settled:false});const original=await snapshot();
  for(let i=1;i<=4;i++)expect(await castWalletBallot(wallets[i],i<=3?'alpha':'beta',week.id,now)).toBe('cast');
  expect((await walletBallotView(week.id,null,undefined,week.end)).status).toBe('insufficient');
  expect(await castWalletBallot(wallets[5],'beta',week.id,now)).toBe('cast');
  const open=await walletBallotView(week.id,null,undefined,week.end-1);expect(open.total).toBe(5);expect(open.winner).toBeNull();expect(open.round?.minimum).toBe(5);
  const closed=await walletBallotView(week.id,null,undefined,week.end);expect(closed.status).toBe('winner');expect(closed.winner?.id).toBe('alpha');expect(closed.winner?.votes).toBe(3);expect(await snapshot()).toEqual(original);
 });
 it('concurrent choices consume one wallet ballot; retries never inflate participation',async()=>{
  await accept('alpha',wallets[1]);await accept('beta',wallets[1]);
  expect((await Promise.all([castWalletBallot(wallets[1],'alpha',week.id,now),castWalletBallot(wallets[1],'beta',week.id,now)])).sort()).toEqual(['already_voted','cast']);
  const chosen=await redis().hget<string>(meta+'wallets',wallets[1]);expect(chosen).toBeTruthy();expect(await castWalletBallot(wallets[1],chosen!,week.id,now)).toBe('recovered');expect((await walletBallotView(week.id,null,undefined,now)).total).toBe(1);
  for(let i=2;i<=4;i++)await cast(i);await accept('alpha',wallets[5]);await accept('beta',wallets[6]);expect(await Promise.all([castWalletBallot(wallets[5],'alpha',week.id,now),castWalletBallot(wallets[6],'beta',week.id,now)])).toEqual(['cast','cast']);expect((await walletBallotView(week.id,null,undefined,now)).total).toBe(6);
 });
 it('tie above five has no winner; cutoff rejects new ballots and cannot reopen the old round',async()=>{
  for(let i=1;i<=6;i++)await cast(i,i<=3?'alpha':'beta');expect((await walletBallotView(week.id,null,undefined,week.end)).status).toBe('tie');
  const before=await redis().hgetall(meta+'counts');await accept('alpha',wallets[7]);expect(await castWalletBallot(wallets[7],'alpha',week.id,week.end)).toBe('closed');expect(await redis().hgetall(meta+'counts')).toEqual(before);
  const next=utcWalletWeek(week.end);expect((await walletBallotView(next.id,null,undefined,week.end)).round?.minimum).toBe(5);
 });
 it('never rewrites a previously frozen policy when the approved default or env changes',async()=>{
  const old={...week,minimum:2,version:1};await redis().set(meta+'round',old);process.env.FAVOUR_WEEKLY_MIN_BALLOTS='99';
  expect(await cast(1)).toBe('cast');expect((await walletBallotView(week.id,null,undefined,now)).round).toEqual(old);expect(await redis().get(meta+'round')).toEqual(old);
 });
 it('real wrong-type failure has no partial ballot/policy write',async()=>{
  await redis().set(meta+'counts','wrongtype');await accept('alpha',wallets[1]);
  await expect(redis().eval(CAST_WALLET_BALLOT,[meta+'round',meta+'wallets',meta+'counts',meta+'candidates','campaign:draft:alpha',`company:completion:task-alpha:${wallets[1]}`],[now,week.id,week.start,week.end,5,wallets[1],'alpha'])).rejects.toThrow(/type mismatch/);
  expect(await redis().get(meta+'round')).toBeNull();expect(await redis().exists(meta+'wallets')).toBe(0);expect(await redis().get(meta+'counts')).toBe('wrongtype');
 });
});
