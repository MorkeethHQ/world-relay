// THE WELCOME JOURNEY, the store part (2026-10-05). See welcome-shape.ts for
// what was measured and why a Welcome step is done on a per-person instance.
//
// WHAT AN INSTANCE CAN AND CANNOT DO.
//   - It is a normal points task row, so the proof goes through the one existing
//     check and credit path (POST /api/verify-proof). No second award path.
//   - It takes one reply and belongs to one wallet. verify-proof refuses anyone
//     else on it.
//   - It is bound to its source: a pass takes the person's completion slot on
//     the SOURCE row (completed_claimants:<sourceId>), so a step is credited
//     once per person however they reach it.
//   - It never carries money and its campaign has no cash unlock (welcomeCampaign
//     refuses one that does), so campaign-unlock.ts has nothing to pay.
//   - Making one writes one new row. It does not touch the source row.
import { createHash } from "crypto";
import type { Task } from "./types";
import { getRedis } from "./redis";
import { getTask, listTasks, createWelcomeInstanceRow, listWelcomeInstances } from "./store";
import { checkCompletedTask } from "./completions";
import {
  WELCOME_PROVENANCE,
  isWelcomeSourceRow,
  welcomeCampaign,
  welcomeSources,
  welcomeStepState,
  type WelcomeStepView,
  type WelcomeView,
} from "./welcome-shape";

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

// One id per (source, wallet), in the shape of a task id. The same person asking
// twice gets the same row.
export function welcomeInstanceId(sourceTaskId: string, wallet: string): string {
  const h = createHash("sha256").update(`welcome-instance:${sourceTaskId}:${wallet.toLowerCase()}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export type EnsureInstance =
  | { ok: true; task: Task; shared: boolean }
  | { ok: false; status: number; error: string; code: string };

// The row this person submits their proof to for one Welcome step.
export async function ensureWelcomeInstance(sourceTaskId: string, wallet: string, now: number = Date.now()): Promise<EnsureInstance> {
  if (!WALLET_RE.test(wallet)) {
    return { ok: false, status: 403, error: "Open FAVOUR in World App to do a Welcome favour.", code: "wallet_required" };
  }
  if (!getRedis()) return { ok: false, status: 503, error: "Storage is unavailable. Nothing was started.", code: "storage_unavailable" };
  const me = wallet.toLowerCase();
  const source = await getTask(sourceTaskId);
  if (!source || !isWelcomeSourceRow(source, now)) {
    return { ok: false, status: 404, error: "This is not an open Welcome favour.", code: "not_welcome" };
  }
  // The earlier person whose proof is on the shared row keeps that claim and
  // continues there. They do not get a second copy of the same step.
  if (source.status === "claimed" && source.claimant?.toLowerCase() === me) {
    return { ok: true, task: source, shared: true };
  }
  const done = await checkCompletedTask(sourceTaskId, me);
  if (done === "yes") {
    return { ok: false, status: 409, error: "You already completed this favour. Your points and proof are in History.", code: "already_completed" };
  }
  if (done === "unknown") {
    return { ok: false, status: 503, error: "We could not check whether you have already done this favour. Nothing was started. Please try again.", code: "completion_check_unavailable" };
  }
  const id = welcomeInstanceId(sourceTaskId, me);
  const existing = await getTask(id);
  if (existing) {
    if (existing.welcomeFor !== me || existing.welcomeSourceId !== sourceTaskId) {
      return { ok: false, status: 409, error: "This Welcome favour could not be opened.", code: "instance_mismatch" };
    }
    if (existing.status === "completed") {
      return { ok: false, status: 409, error: "You already completed this favour. Your points and proof are in History.", code: "already_completed" };
    }
    return { ok: true, task: existing, shared: false };
  }
  const campaign = welcomeCampaign(now)!;
  const instance: Task = {
    id,
    poster: source.poster,
    claimant: null,
    category: source.category,
    campaignId: source.campaignId,
    // The original text, copied and never edited.
    description: source.description,
    location: source.location,
    lat: source.lat,
    lng: source.lng,
    bountyUsdc: source.bountyUsdc,
    deadline: campaign.endsAt,
    status: "open",
    proofImageUrl: null,
    proofImages: null,
    proofNote: null,
    verificationResult: null,
    attestationTxHash: null,
    agent: source.agent,
    aiFollowUp: null,
    recurring: null,
    callbackUrl: null,
    // Money fields are written as constants, not copied, so no source row can
    // hand an instance an escrow.
    onChainId: null,
    escrowTxHash: null,
    claimCode: null,
    taskType: "standard",
    rewardType: "points",
    donOnChainId: null,
    donStakeTxHash: null,
    claimantVerification: null,
    requiresClaim: false,
    pendingRelease: false,
    maxCompletions: 1,
    completionCount: 0,
    createdAt: new Date(now).toISOString(),
    welcomeSourceId: sourceTaskId,
    welcomeFor: me,
  };
  const saved = await createWelcomeInstanceRow(instance);
  if (!saved || saved.welcomeFor !== me) {
    return { ok: false, status: 503, error: "The Welcome favour could not be started. Nothing was saved.", code: "storage_unavailable" };
  }
  return { ok: true, task: saved, shared: false };
}

// What the Welcome screen shows. Signed out: the steps, all "todo". Signed in:
// each step's state for this wallet only. Nobody reads another person's instance.
export async function welcomeView(wallet: string | null, now: number = Date.now()): Promise<WelcomeView | null> {
  const campaign = welcomeCampaign(now);
  if (!campaign) return null;
  const sources = welcomeSources(await listTasks(), now);
  const me = wallet && WALLET_RE.test(wallet) ? wallet.toLowerCase() : null;
  const mine = me ? await listWelcomeInstances(me) : [];
  const steps: WelcomeStepView[] = await Promise.all(sources.map(async (s) => {
    const base = { sourceTaskId: s.id, description: s.description, category: s.category, points: Math.round(s.bountyUsdc) };
    if (!me) return { ...base, state: "todo" as const };
    const completed = (await checkCompletedTask(s.id, me)) === "yes";
    if (!completed && s.status === "claimed" && s.claimant?.toLowerCase() === me) {
      return { ...base, state: welcomeStepState(s, false), onSharedRow: true, proofNote: s.proofNote, hasPhoto: !!s.proofImageUrl };
    }
    const inst = mine.find((t) => t.welcomeSourceId === s.id) ?? null;
    return {
      ...base,
      state: welcomeStepState(inst, completed),
      ...(inst ? { instanceId: inst.id, proofNote: inst.proofNote, hasPhoto: !!inst.proofImageUrl, reviewNote: inst.welcomeReviewNote ?? null } : {}),
    };
  }));
  return {
    campaign: {
      id: campaign.id, name: campaign.name, tagline: campaign.tagline, description: campaign.description,
      heroImage: campaign.heroImage, endsAt: campaign.endsAt, rewardPerTask: campaign.rewardPerTask,
    },
    provenance: WELCOME_PROVENANCE,
    authenticated: !!me,
    steps,
    done: steps.filter((s) => s.state === "done").length,
  };
}
