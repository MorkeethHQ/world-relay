import { NextRequest, NextResponse } from 'next/server';
import { getAuthedAddress } from '@/lib/session';
import { rateLimit,getClientIp } from '@/lib/rate-limit';
import { castWalletBallot,walletBallotView,walletRoundId } from '@/lib/project-wallet-ballot';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(req:NextRequest){
 const id=req.nextUrl.searchParams.get('round');if(id&&!walletRoundId(id))return reply({error:'Invalid UTC round.'},400);
 const campaign=req.nextUrl.searchParams.get('campaign')??undefined;if(campaign&&(!/^[a-zA-Z0-9_-]{1,100}$/.test(campaign)))return reply({error:'Invalid campaign.'},400);
 try{return reply(await walletBallotView(id??undefined,getAuthedAddress(req,Date.now()),campaign));}catch{return reply({error:'Ballots could not load. No result is being claimed.'},503);}
}
export async function POST(req:NextRequest){
 const wallet=getAuthedAddress(req,Date.now());if(!wallet||!/^0x[0-9a-f]{40}$/i.test(wallet))return reply({error:'Sign in with your wallet to vote.',code:'reauth_required'},403);
 if(!(await rateLimit('wallet-ballot:'+getClientIp(req),20,60000)).ok)return reply({error:'Please wait before retrying.'},429);
 try{const b=await req.json();if(!b||typeof b.campaignId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(b.campaignId)||!walletRoundId(b.roundId))return reply({error:'Choose a campaign and its current round.'},400);
 const result=await castWalletBallot(wallet,b.campaignId,b.roundId);
 const errors:Record<string,string>={closed:'This round is closed. Reload the current week.',policy_required:'Voting is temporarily closed because the round policy could not be confirmed.',already_voted:'This wallet already used its ballot this week.',self_vote:'You cannot vote for your own campaign.',review_required:'An accepted review of this project is required before voting.',ineligible:'This project is not eligible.',invalid_policy:'This round policy could not be verified.'};
 return result==='cast'||result==='recovered'?reply({result}):reply({error:errors[result]??'Vote not confirmed. Reload before retrying.',result},409);
 }catch{return reply({error:'Vote not confirmed. It may already be saved; reload before retrying.'},503);}
}
