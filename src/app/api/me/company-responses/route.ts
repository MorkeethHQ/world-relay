import { NextRequest, NextResponse } from 'next/server';
import { getAuthedAddress } from '@/lib/session';
import { getRedis } from '@/lib/redis';
import { PUBLISHED_INDEX } from '@/lib/campaign-drafts';
import { contributionView } from '@/lib/contribution-responses';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(req:NextRequest){
 const wallet=getAuthedAddress(req,Date.now());if(!wallet)return reply({campaigns:[],authenticated:false});
 try{const redis=getRedis();if(!redis)throw new Error('Unavailable');const ids=await redis.smembers(PUBLISHED_INDEX);
 const campaigns=[];for(const raw of ids){const id=String(raw);const view=await contributionView(id,wallet);if(view?.cards.length)campaigns.push({id,company:view.company,role:view.owner?'company':'contributor',pieces:view.cards.length,waiting:view.cards.filter(c=>c.replyBy!==null).length});}
 return reply({campaigns,authenticated:true});
 }catch{return reply({error:'Company responses could not be loaded. Please reload.'},503);}
}
