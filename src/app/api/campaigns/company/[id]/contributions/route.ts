import { NextRequest, NextResponse } from 'next/server';
import { getAuthedAddress } from '@/lib/session';
import { contributionView, saveContributionResponse } from '@/lib/contribution-responses';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { const result = await contributionView((await params).id, getAuthedAddress(req, Date.now())); return result ? reply(result) : reply({error:'Campaign not found.'},404); }
  catch { return reply({error:'Could not load company responses. Please retry.'},503); }
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const wallet = getAuthedAddress(req, Date.now());
  if (!wallet || !/^0x[0-9a-f]{40}$/i.test(wallet)) return reply({error:'Open FAVOUR in World App and sign in again.',code:'reauth_required'},403);
  if (!(await rateLimit(`contribution-response:${getClientIp(req)}`,30,60000)).ok) return reply({error:'Please wait a minute before trying again.'},429);
  try { const body = await req.json(); if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({error:'Invalid response.'},400); const result = await saveContributionResponse((await params).id,wallet,body); return reply(result,result.status); }
  catch { return reply({error:'Save not confirmed. Reload before trying again.'},503); }
}
