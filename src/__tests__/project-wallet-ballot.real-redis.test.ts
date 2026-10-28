import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {getRedis} from '@/lib/redis';
import {castWalletBallot,walletBallotView,utcWalletWeek,CAST_WALLET_BALLOT} from '@/lib/project-wallet-ballot';
import {readFileSync} from 'fs';
const on=!!process.env.FAVOUR_BALLOT_REAL_CONFIG;
const config=on?JSON.parse(readFileSync(process.env.FAVOUR_BALLOT_REAL_CONFIG!,'utf8')):null;
if(config){process.env.KV_REST_API_URL=`http://127.0.0.1:${config.gateway_port}`;process.env.KV_REST_API_TOKEN=config.rest_token;}
const wallets=['a1','b2','c1','c2','c3','d1'].map(x=>'0x7e57da7a000000000000000000000000000000'+x);
const now=Date.parse('2026-10-28T12:00:00Z'),week=utcWalletWeek(now),meta=`project:wallet-ballot:v1:${week.id}:`;
const redis=()=>getRedis()!;
async function seed(id:string,owner=wallets[0]){await redis().set('campaign:draft:'+id,{id,owner,status:'published',productName:'SYNTHETIC '+id,productUrl:'https://example.com/'+id,pieceTaskIds:{review:'task-'+id}});}
async function accept(id:string,wallet:string,verdict='pass'){await redis().set(`company:completion:task-${id}:${wallet}`,{taskId:'task-'+id,verification:{verdict},pointsAwarded:10,streakBonus:0});}
beforeAll(async()=>{if(!on)return;expect(await redis().ping()).toBe('PONG');expect(await redis().dbsize()).toBe(0);await seed('alpha');await seed('beta');});
afterAll(()=>{delete process.env.FAVOUR_WEEKLY_MIN_BALLOTS;});
describe.skipIf(!on)('actual Redis wallet ballot Lua',()=>{
 it('safe closed default, own campaign and unaccepted/flagged reviews never vote',async()=>{
  delete process.env.FAVOUR_WEEKLY_MIN_BALLOTS;await accept('alpha',wallets[1]);expect(await castWalletBallot(wallets[1],'alpha',week.id,now)).toBe('policy_required');expect(await redis().get(meta+'round')).toBeNull();
  process.env.FAVOUR_WEEKLY_MIN_BALLOTS='2';expect(await castWalletBallot(wallets[0],'alpha',week.id,now)).toBe('self_vote');expect(await castWalletBallot(wallets[2],'alpha',week.id,now)).toBe('review_required');await accept('alpha',wallets[2],'flag');expect(await castWalletBallot(wallets[2],'alpha',week.id,now)).toBe('review_required');expect(await redis().get(meta+'round')).toBeNull();
 });
 it('two concurrent choices share one per-wallet ballot, with no points touched',async()=>{
  await accept('beta',wallets[1]);await redis().set('pof:'+wallets[1],{totalPoints:123,favoursCompleted:9});
  const results=await Promise.all([castWalletBallot(wallets[1],'alpha',week.id,now),castWalletBallot(wallets[1],'beta',week.id,now)]);expect(results.sort()).toEqual(['already_voted','cast']);
  expect(await redis().hlen(meta+'wallets')).toBe(1);const counts=await redis().hgetall<Record<string,number>>(meta+'counts');expect(Object.values(counts!).reduce((a,b)=>a+Number(b),0)).toBe(1);expect(await redis().get('pof:'+wallets[1])).toEqual({totalPoints:123,favoursCompleted:9});
 });
 it('duplicate retries recover without increment and first-ballot minimum is frozen',async()=>{
  const chosen=await redis().hget<string>(meta+'wallets',wallets[1]);expect(chosen).toBeTruthy();const before=await redis().hgetall(meta+'counts');process.env.FAVOUR_WEEKLY_MIN_BALLOTS='99';expect(await castWalletBallot(wallets[1],chosen!,week.id,now)).toBe('recovered');expect(await redis().hgetall(meta+'counts')).toEqual(before);expect((await walletBallotView(undefined,wallets[1],chosen!,now)).round?.minimum).toBe(2);
  await accept('alpha',wallets[3]);expect(await castWalletBallot(wallets[3],'alpha',week.id,now)).toBe('cast');expect((await walletBallotView(week.id,null,undefined,now)).round?.minimum).toBe(2);
 });
 it('cutoff closes the round permanently; next week uses its own policy',async()=>{
  const before=await redis().hgetall(meta+'counts');await accept('alpha',wallets[4]);expect(await castWalletBallot(wallets[4],'alpha',week.id,week.end)).toBe('closed');
  const raw=await redis().eval(CAST_WALLET_BALLOT,[meta+'round',meta+'wallets',meta+'counts',meta+'candidates','campaign:draft:alpha',`company:completion:task-alpha:${wallets[4]}`],[week.end,week.id,week.start,week.end,2,wallets[4],'alpha']);expect(raw).toBe('closed');expect(await redis().hgetall(meta+'counts')).toEqual(before);
  const history=await walletBallotView(week.id,null,undefined,week.end);expect(['tie','winner']).toContain(history.status);expect(history.round?.minimum).toBe(2);
  const next=utcWalletWeek(week.end);delete process.env.FAVOUR_WEEKLY_MIN_BALLOTS;expect(await castWalletBallot(wallets[4],'alpha',next.id,week.end)).toBe('policy_required');expect((await walletBallotView(next.id,null,undefined,week.end)).status).toBe('awaiting_policy');
 });
 it('wrong-type red control has no partial ballot or policy mutation',async()=>{
  const id='2026-11-02',w=utcWalletWeek(week.end),p=`project:wallet-ballot:v1:${id}:`;await redis().set(p+'counts','wrongtype');await accept('alpha',wallets[5]);
  await expect(redis().eval(CAST_WALLET_BALLOT,[p+'round',p+'wallets',p+'counts',p+'candidates','campaign:draft:alpha',`company:completion:task-alpha:${wallets[5]}`],[w.start,w.id,w.start,w.end,2,wallets[5],'alpha'])).rejects.toThrow(/type mismatch/);expect(await redis().get(p+'round')).toBeNull();expect(await redis().exists(p+'wallets')).toBe(0);expect(await redis().get(p+'counts')).toBe('wrongtype');
 });
});
