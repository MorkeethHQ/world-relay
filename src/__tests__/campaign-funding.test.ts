import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// THE PAY STEP (slice 2, 2026-09-26). A company funds its published campaign's pool
// in USDC on World Chain, to a receiving address Oscar chooses. Until he sets
// FAVOUR_POOL_ADDRESS, the pay step is closed: no address is shown and nothing can
// be marked paid. Funding state lives in its own namespace, never on the draft.

const kv = new Map<string, string>();
const sets = new Map<string, Set<string>>();
vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    get: async (k: string) => kv.get(k) ?? null,
    set: async (k: string, v: string, o?: { nx?: boolean }) => {
      if (o?.nx && kv.has(k)) return null;
      kv.set(k, v);
      return "OK";
    },
    del: async (k: string) => (kv.delete(k) ? 1 : 0),
    sadd: async (k: string, m: string) => {
      if (!sets.has(k)) sets.set(k, new Set());
      const s = sets.get(k)!;
      if (s.has(m)) return 0;
      s.add(m);
      return 1;
    },
    srem: async (k: string, m: string) => (sets.get(k)?.delete(m) ? 1 : 0),
    smembers: async (k: string) => [...(sets.get(k) ?? [])],
    lrange: async () => [],
  }),
}));

import {
  PLATFORM_FEE_BPS,
  fundingQuote,
  poolAddressOrNull,
  isTxHash,
} from "@/lib/campaign-funding-shape";
import { getCampaignFunding, markCampaignPaid, FUNDING_PREFIX } from "@/lib/campaign-funding";
import { GET as getCampaignRoute } from "@/app/api/campaigns/company/[id]/route";

const ADDR = "0x1111111111111111111111111111111111111111";
const TX = "0x" + "a".repeat(64);
const TX2 = "0x" + "b".repeat(64);
const ID = "draft_pool1";

function seedCampaign(over: Record<string, unknown> = {}) {
  const d = {
    id: ID,
    status: "published",
    company: "Example Co",
    brief: "b",
    pieces: [{ kind: "ugc", count: 5 }],
    rewardPerPiecePoints: 10,
    proposedPoolUsdc: 200,
    reviewRule: "ai",
    owner: "0x2222222222222222222222222222222222222222",
    createdAt: "2026-09-21T00:00:00.000Z",
    publishedAt: "2026-09-21T00:00:00.000Z",
    ...over,
  };
  kv.set(`campaign:draft:${ID}`, JSON.stringify(d));
  if (!sets.has("campaign:company:published")) sets.set("campaign:company:published", new Set());
  sets.get("campaign:company:published")!.add(ID);
}

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const open = { FAVOUR_POOL_ADDRESS: ADDR } as Record<string, string | undefined>;
const closed = {} as Record<string, string | undefined>;

beforeEach(() => {
  kv.clear();
  sets.clear();
  delete process.env.FAVOUR_POOL_ADDRESS;
  seedCampaign();
});

describe("the quote: pool plus a platform fee on top", () => {
  it("is one pure function, and pool + fee = total", () => {
    expect(PLATFORM_FEE_BPS).toBe(1000);
    expect(fundingQuote(200)).toEqual({ poolUsdc: 200, feeUsdc: 20, totalUsdc: 220 });
    const q = fundingQuote(123.45);
    expect(Math.round((q.poolUsdc + q.feeUsdc) * 100)).toBe(Math.round(q.totalUsdc * 100));
  });
  it("reads only a well-formed address and tx hash", () => {
    expect(poolAddressOrNull(ADDR)).toBe(ADDR);
    expect(poolAddressOrNull(`${ADDR}\n`)).toBe(ADDR);
    expect(poolAddressOrNull("")).toBeNull();
    expect(poolAddressOrNull("0x123")).toBeNull();
    expect(poolAddressOrNull(undefined)).toBeNull();
    expect(isTxHash(TX)).toBe(true);
    expect(isTxHash("0xabc")).toBe(false);
  });
});

describe("the funding view", () => {
  it("with FAVOUR_POOL_ADDRESS unset: unpaid, closed, and no address", async () => {
    const f = await getCampaignFunding(ID, closed);
    expect(f).toMatchObject({ status: "unpaid", open: false, poolUsdc: 200, feeUsdc: 20, totalUsdc: 220, reference: ID });
    expect(f && "address" in f && f.address).toBeFalsy();
  });
  it("with a valid address: open, and the address, reference, token and network are shown", async () => {
    const f = await getCampaignFunding(ID, open);
    expect(f).toMatchObject({ status: "unpaid", open: true, address: ADDR, reference: ID, token: "USDC", network: "World Chain", totalUsdc: 220 });
  });
  it("with a malformed address: closed, as if unset", async () => {
    const f = await getCampaignFunding(ID, { FAVOUR_POOL_ADDRESS: "0xnope" });
    expect(f).toMatchObject({ open: false });
    expect(f && "address" in f && f.address).toBeFalsy();
  });
});

describe("marking a pool paid (Oscar, by hand, after he reads the transfer on chain)", () => {
  it("refuses while FAVOUR_POOL_ADDRESS is unset", async () => {
    const r = await markCampaignPaid(ID, TX, 220, NOW, closed);
    expect(r.ok).toBe(false);
    expect(kv.has(`${FUNDING_PREFIX}${ID}`)).toBe(false);
  });
  it("refuses a malformed tx hash, and an amount below the quote", async () => {
    expect((await markCampaignPaid(ID, "0xabc", 220, NOW, open)).ok).toBe(false);
    expect((await markCampaignPaid(ID, TX, 219.99, NOW, open)).ok).toBe(false);
  });
  it("refuses a campaign that is not published, or hidden", async () => {
    seedCampaign({ status: "draft" });
    expect((await markCampaignPaid(ID, TX, 220, NOW, open)).ok).toBe(false);
    seedCampaign({ hiddenAt: "2026-09-25T00:00:00.000Z" });
    expect((await markCampaignPaid(ID, TX, 220, NOW, open)).ok).toBe(false);
  });
  it("marks paid once, and the view says paid with the tx", async () => {
    const r = await markCampaignPaid(ID, TX, 220, NOW, open);
    expect(r.ok).toBe(true);
    const f = await getCampaignFunding(ID, open);
    expect(f).toMatchObject({ status: "paid", paidTxHash: TX, paidAmountUsdc: 220, paidAt: new Date(NOW).toISOString() });
  });
  it("refuses a second call for the same campaign, and the same tx for another campaign", async () => {
    expect((await markCampaignPaid(ID, TX, 220, NOW, open)).ok).toBe(true);
    expect((await markCampaignPaid(ID, TX2, 220, NOW, open)).ok).toBe(false);
    const other = "draft_pool2";
    kv.set(`campaign:draft:${other}`, JSON.stringify({ ...JSON.parse(kv.get(`campaign:draft:${ID}`)!), id: other }));
    expect((await markCampaignPaid(other, TX, 220, NOW, open)).ok).toBe(false);
    expect((await markCampaignPaid(other, TX2, 220, NOW, open)).ok).toBe(true);
  });
  it("never writes funding onto the draft record", async () => {
    const before = kv.get(`campaign:draft:${ID}`);
    await markCampaignPaid(ID, TX, 220, NOW, open);
    expect(kv.get(`campaign:draft:${ID}`)).toBe(before);
    expect(before).not.toMatch(/fund|paid|pot|txHash/i);
  });
});

describe("the public campaign route carries the funding block", () => {
  const call = () => getCampaignRoute(new Request(`http://x/api/campaigns/company/${ID}`) as never, { params: Promise.resolve({ id: ID }) });
  it("unset env: status unpaid, closed, no address anywhere in the response", async () => {
    const body = await (await call()).json();
    expect(body.funding).toMatchObject({ status: "unpaid", open: false, totalUsdc: 220 });
    expect(JSON.stringify(body)).not.toContain(ADDR);
  });
  it("set env: the address and reference are in the response", async () => {
    process.env.FAVOUR_POOL_ADDRESS = ADDR;
    const body = await (await call()).json();
    expect(body.funding).toMatchObject({ open: true, address: ADDR, reference: ID });
  });
});

describe("no route can mark a pool paid", () => {
  it("markCampaignPaid is imported by no file under src/app", () => {
    const { execSync } = require("child_process") as typeof import("child_process");
    const hits = execSync(`grep -rl "markCampaignPaid" ${join(process.cwd(), "src/app")} || true`).toString().trim();
    expect(hits).toBe("");
  });
  it("the script requires FAVOUR_POOL_ADDRESS and refuses a reused tx", () => {
    const src = readFileSync(join(process.cwd(), "scripts/mark-campaign-paid.mjs"), "utf8");
    expect(src).toContain("FAVOUR_POOL_ADDRESS");
    expect(src).toContain("campaign:funding:");
    expect(src).toMatch(/SADD/);
  });
});

describe("copy says only what the code does", () => {
  it("the pay step never promises USDC per piece", () => {
    const ui = readFileSync(join(process.cwd(), "src/components/CompanyCampaign.tsx"), "utf8");
    expect(ui).toContain("Funding opens soon");
    expect(ui).toContain("After FAVOUR confirms the transfer on World Chain, this campaign shows as funded.");
    expect(ui).not.toMatch(/paid per (accepted )?piece|USDC per piece/i);
  });
});
