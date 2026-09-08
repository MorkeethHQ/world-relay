import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const savedCampaigns: any[] = [];
const savedTasks: any[] = [];
let ownerAllowed = true;

vi.mock("@/lib/campaign-store", async () => {
  const actual = await vi.importActual<any>("@/lib/campaign-store");
  return {
    ...actual,
    listRequesterCampaigns: async () => savedCampaigns,
    ownerMayCreateCampaign: async () => ownerAllowed,
    persistRequesterCampaign: async (campaign: any) => { savedCampaigns.push(campaign); },
  };
});
vi.mock("@/lib/store", () => ({
  createTask: async (input: any) => {
    const task = { id: "cycle-one", ...input };
    savedTasks.push(task);
    return task;
  },
}));
vi.mock("@/lib/image-upload", () => ({ uploadCampaignImage: async () => "https://example.test/requester.jpg" }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => "127.0.0.1" }));

import { POST } from "@/app/api/campaigns/route";
import { issueSessionToken, SESSION_COOKIE } from "@/lib/session";
import { validateRequesterCampaignPolicy } from "@/lib/campaign-store";

const OWNER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

function body(requester = OWNER) {
  return {
    requester,
    requesterName: "Acme Product",
    requesterKind: "The team building Acme's mobile app",
    name: "Weekly release reality check",
    ask: "Try the current release and name the first moment that breaks trust.",
    category: "feedback",
    completion: ["Use the current release", "Name the exact screen"],
    proof: "A screenshot and one sentence about what you expected.",
    repeats: "The answer changes after every release.",
    rewardPoints: 5,
    completionsPerCycle: 3,
    intervalHours: 168,
    totalCycles: 4,
    location: "Worldwide",
  };
}

function request(payload: any, signedAs?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signedAs) {
    const token = issueSessionToken(signedAs, Date.now());
    headers.cookie = `${SESSION_COOKIE}=${token}`;
  }
  return new NextRequest("http://localhost/api/campaigns", { method: "POST", headers, body: JSON.stringify(payload) });
}

beforeEach(() => {
  process.env.SESSION_SECRET = "campaign-test-secret";
  savedCampaigns.length = 0;
  savedTasks.length = 0;
  ownerAllowed = true;
});

describe("requester campaign policy", () => {
  it("requires a signed wallet session even when the global session kill switch is off", async () => {
    delete process.env.SESSION_ENFORCE;
    expect((await POST(request(body()))).status).toBe(401);
    expect(savedTasks).toHaveLength(0);
  });

  it("refuses a requester field that does not match the session", async () => {
    expect((await POST(request(body(OTHER), OWNER))).status).toBe(403);
    expect(savedTasks).toHaveLength(0);
  });

  it("creates one bounded points task that fills and repeats", async () => {
    const response = await POST(request(body(), OWNER));
    expect(response.status).toBe(201);
    expect(savedCampaigns).toHaveLength(1);
    expect(savedCampaigns[0].owner).toBe(OWNER);
    expect(savedCampaigns[0].rewardKind).toBe("points");
    expect(savedCampaigns[0].cadence).toEqual({ completionsPerCycle: 3, intervalHours: 168, totalCycles: 4 });
    expect(savedTasks).toHaveLength(1);
    expect(savedTasks[0]).toMatchObject({
      poster: OWNER,
      rewardType: "points",
      maxCompletions: 3,
      recurring: { intervalHours: 168, totalRuns: 4 },
    });
    expect(savedTasks[0].campaignId).toBe(savedCampaigns[0].id);
  });

  it("does not let the campaign path create a one-person cycle", async () => {
    const response = await POST(request({ ...body(), completionsPerCycle: 1 }, OWNER));
    expect(response.status).toBe(400);
    expect(savedCampaigns).toHaveLength(0);
    expect(savedTasks).toHaveLength(0);
  });

  it("enforces the active-campaign ceiling on the server", async () => {
    ownerAllowed = false;
    expect((await POST(request(body(), OWNER))).status).toBe(429);
    expect(savedTasks).toHaveLength(0);
  });

  it("keeps cash outside the policy surface", () => {
    expect(validateRequesterCampaignPolicy({ rewardPoints: 11, completionsPerCycle: 3, intervalHours: 168, totalCycles: 4 })).toMatch(/points/);
  });

  it("caps the total point commitment", () => {
    expect(validateRequesterCampaignPolicy({ rewardPoints: 10, completionsPerCycle: 25, intervalHours: 168, totalCycles: 12 })).toMatch(/600 points/);
  });
});
