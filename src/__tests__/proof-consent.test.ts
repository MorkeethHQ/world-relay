import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state=vi.hoisted(()=>({ owner: true, writes:0, available:true }));
vi.mock("@/lib/session",()=>({ ownerRefusal:()=>state.owner?null:{error:"Sign in",code:"reauth_required"},getAuthedAddress:()=>state.owner?"0x"+"a".repeat(40):null }));
vi.mock("@/lib/rate-limit",()=>({rateLimit:async()=>({ok:true}),getClientIp:()=>"test"}));
vi.mock("@/lib/proof-consent",()=>({recordProofConsent:async()=>{state.writes++;return state.available;}}));
import { POST } from "@/app/api/verify-proof/route";
import { POST as precheck } from "@/app/api/proof-precheck/route";
const req=(body:unknown)=>new NextRequest("http://localhost/api/verify-proof",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
beforeEach(()=>{state.owner=true;state.writes=0;state.available=true;});
describe("proof permission before uploads, locks or AI spend",()=>{
 it("refuses an unauthenticated sender before recording any consent",async()=>{state.owner=false;expect((await POST(req({taskId:"t",submitter:"0x"+"a".repeat(40),proofConsent:true}))).status).toBe(403);expect(state.writes).toBe(0);});
 it("refuses missing or declined permission without storing it",async()=>{for(const proofConsent of [undefined,false])expect((await POST(req({taskId:"t",submitter:"0x"+"a".repeat(40),proofConsent}))).status).toBe(422);expect(state.writes).toBe(0);});
 it("refuses unavailable consent storage instead of claiming proof was sent",async()=>{state.available=false;const r=await POST(req({taskId:"t",submitter:"0x"+"a".repeat(40),proofConsent:true}));expect(r.status).toBe(503);expect(await r.json()).toMatchObject({code:"storage_unavailable"});});
 it("does not send a photo to precheck without permission",async()=>{expect((await precheck(req({imageBase64:"AAAA",taskDescription:"An honest photo"}))).status).toBe(422);});
 it("does not invent a passing photo assessment when there is no checker",async()=>{vi.stubEnv("ANTHROPIC_API_KEY","");vi.stubEnv("FAVOUR_TEST_FIXTURE","");expect((await precheck(req({imageBase64:"AAAA",taskDescription:"An honest photo",proofConsent:true}))).status).toBe(503);});
});
