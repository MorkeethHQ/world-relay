import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { toApiTask, toApiTasks, PUBLIC_TASK_KEYS, PRIVATE_TASK_KEYS } from "@/lib/task-serializer";
import type { Task } from "@/lib/types";

// THE PUBLIC SHAPE OF A TASK IS AN ALLOW LIST, bound to the type.
//
// Measured on production 2026-10-12: GET /api/tasks sent 40 keys per row,
// among them claimCode (the only lock on a claim-coded task) and callbackUrl.
// Both were null on every live row that day, so the first task to set one
// would have shown it to every reader. toApiTask returned {...task}; the
// detail route removed claimCode alone ("all except X"), which leaks the next
// private field by default.
//
// Two gates. The compile-time one in task-serializer.ts makes `tsc` and
// `next build` fail when a Task key is in neither list. This runtime one
// parses src/lib/types.ts with the TypeScript compiler, so `vitest` fails on
// the same day: esbuild strips types, so a type-only check alone would be
// green in this runner forever.

function taskKeysFromSource(): string[] {
  const file = resolve(__dirname, "../lib/types.ts");
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const keys: string[] = [];
  ts.forEachChild(src, (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === "Task" && ts.isTypeLiteralNode(node.type)) {
      for (const m of node.type.members) {
        if (ts.isPropertySignature(m) && m.name && ts.isIdentifier(m.name)) keys.push(m.name.text);
      }
    }
  });
  return keys;
}

// Every key set to a non-null value, so a key that leaks cannot hide behind
// "it was null anyway".
function fullTask(): Task {
  return {
    id: "t1",
    poster: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    claimant: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    category: "custom",
    campaignId: "c1",
    companyCampaignId: "cc1",
    description: "d",
    location: "l",
    lat: 1,
    lng: 2,
    bountyUsdc: 3,
    deadline: "2026-10-13T00:00:00.000Z",
    status: "completed",
    proofSubmissionId: "sub-1",
    proofImageUrl: "https://img.example/1.jpg",
    proofImages: ["https://img.example/1.jpg"],
    proofNote: "note",
    verificationResult: { verdict: "pass", confidence: 0.9, reasoning: "r", models: [] } as unknown as Task["verificationResult"],
    humanReview: { caseId: "case", outcome: "cleared", at: "2026-10-13T00:00:00.000Z" },
    attestationTxHash: "0x" + "1".repeat(64),
    agent: { id: "scout", name: "Scout", icon: "i", color: "c" },
    aiFollowUp: { question: "q", status: "resolved", initialConfidence: 0.5 } as unknown as Task["aiFollowUp"],
    recurring: { interval: "daily" } as unknown as Task["recurring"],
    callbackUrl: "https://hook.example/secret-path",
    onChainId: 7,
    escrowTxHash: "0x" + "2".repeat(64),
    claimCode: "SECRET-CODE",
    taskType: "standard",
    rewardType: "points",
    donOnChainId: 9,
    donStakeTxHash: "0x" + "3".repeat(64),
    claimantVerification: "orb",
    requiresClaim: true,
    pendingRelease: false,
    settlementTx: "0x" + "4".repeat(64),
    escrowV2Address: "0xcccccccccccccccccccccccccccccccccccccccc",
    escrowV2Version: 2,
    escrowV2RefundTx: "0x" + "5".repeat(64),
    maxCompletions: 1,
    completionCount: 1,
    createdAt: "2026-10-12T00:00:00.000Z",
    hiddenAt: "2026-10-12T00:00:00.000Z",
    hiddenReason: "operator note",
    welcomeSourceId: "w1",
    welcomeFor: "0xdddddddddddddddddddddddddddddddddddddddd",
    welcomeReviewNote: { outcome: "upheld", at: "2026-10-12T00:00:00.000Z", reasons: ["r"] },
  };
}

describe("every Task key is classified public or private", () => {
  it("binds both lists to the type as written in src/lib/types.ts", () => {
    const fromType = taskKeysFromSource().sort();
    expect(fromType.length).toBeGreaterThan(30);
    const classified = [...PUBLIC_TASK_KEYS, ...PRIVATE_TASK_KEYS].sort();
    // A key added to Task tomorrow fails here until it is put on one list.
    expect(classified).toEqual(fromType);
    const both = PUBLIC_TASK_KEYS.filter((k) => (PRIVATE_TASK_KEYS as readonly string[]).includes(k));
    expect(both).toEqual([]);
  });

  it("the fixture sets every key, so a leak cannot hide behind null", () => {
    expect(Object.keys(fullTask()).sort()).toEqual(taskKeysFromSource().sort());
  });
});

describe("toApiTask sends the allow list and nothing else", () => {
  it("emits exactly the public keys, in list order", () => {
    const out = toApiTask(fullTask());
    expect(Object.keys(out)).toEqual([...PUBLIC_TASK_KEYS]);
  });

  it("never carries claimCode, callbackUrl, hidden markers or the welcome owner, even when set", () => {
    const out = toApiTask(fullTask()) as Record<string, unknown>;
    for (const k of PRIVATE_TASK_KEYS) expect(out, k).not.toHaveProperty(k);
    expect(JSON.stringify(out)).not.toContain("SECRET-CODE");
    expect(JSON.stringify(out)).not.toContain("secret-path");
  });

  it("keeps the fields the app reads", () => {
    const out = toApiTask(fullTask());
    expect(out.id).toBe("t1");
    expect(out.requiresClaim).toBe(true);
    expect(out.welcomeSourceId).toBe("w1");
    expect(out.humanReview?.outcome).toBe("cleared");
  });

  it("still rewrites inline proof blobs to the streaming path", () => {
    const t = fullTask();
    t.proofImageUrl = "data:image/jpeg;base64,AAAA";
    t.proofImages = [t.proofImageUrl, "https://img.example/2.jpg"];
    const out = toApiTask(t);
    expect(out.proofImageUrl).toBe("/api/tasks/t1/proof-image?i=0");
    expect(out.proofImages).toEqual(["/api/tasks/t1/proof-image?i=0", "https://img.example/2.jpg"]);
  });

  it("toApiTasks maps every row through the same list", () => {
    const rows = toApiTasks([fullTask(), { ...fullTask(), id: "t2" }]);
    for (const r of rows) expect(Object.keys(r)).toEqual([...PUBLIC_TASK_KEYS]);
  });
});
