import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const fetched = vi.hoisted(() => vi.fn());
const saveDraft = vi.hoisted(() => vi.fn());
const publishDraft = vi.hoisted(() => vi.fn());
const savePictureRecord = vi.hoisted(() => vi.fn());
const limit = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("@/lib/product-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/product-fetch")>()), fetchProduct: fetched }));
vi.mock("@/lib/campaign-drafts", async (orig) => ({ ...(await orig<typeof import("@/lib/campaign-drafts")>()), saveDraft, publishDraft }));
vi.mock("@/lib/campaign-pictures", () => ({ savePictureRecord }));
vi.mock("@/lib/store", () => ({ createTask: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: limit, getClientIp: () => "test" }));

import { POST as post } from "@/app/api/post-app/route";
import { POST as read } from "@/app/api/post-app/read/route";
import { SESSION_COOKIE, issueSessionToken } from "@/lib/session";
import { validateDraftInput } from "@/lib/campaign-drafts";
import { campaignPicture } from "@/lib/campaign-picture";
import { POST_POINTS, POST_REVIEWS, pictureOf, pictureRecord, pictureRecordOrNull, postBody, postReason } from "@/lib/post-app";

const MAKER = "0x1111111111111111111111111111111111111111";
const ASK = "Open the app, bring one real session from your coding agent, and tell me in two sentences what confused you on the first screen and what you would change.";
const GOOD = { productUrl: "https://agentic-strava.vercel.app", productName: "STRIVE", ask: ASK };
const PAGE = { url: "https://agentic-strava.vercel.app/", name: "STRIVE", line: "Strava is for people who ran.", image: "https://striverun.app/api/og", icon: "https://agentic-strava.vercel.app/favicon.svg", screenshots: [], colour: "#5e6ad2" };
const req = (path: string, body: unknown, who?: string) => new NextRequest(`http://localhost${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(who ? { cookie: `${SESSION_COOKIE}=${issueSessionToken(who, Date.now())}` } : {}) },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SESSION_SECRET = "local-test-only";
  limit.mockResolvedValue({ ok: true });
  fetched.mockResolvedValue({ ok: true, proposal: PAGE });
  saveDraft.mockImplementation(async (owner: string, draft: object) => ({ ok: true, draft: { ...draft, id: "draft_1", owner } }));
  savePictureRecord.mockResolvedValue(true);
  publishDraft.mockResolvedValue({ ok: true, campaign: { id: "draft_1", status: "published" } });
});

describe("the body a posted app becomes", () => {
  it("passes the existing draft rules, asks for reviews at points, and proposes no pool", () => {
    const body = postBody(GOOD);
    expect(body).toMatchObject({ company: "STRIVE", productName: "STRIVE", pieces: [{ kind: "review", count: POST_REVIEWS }], rewardPerPiecePoints: POST_POINTS, proposedPoolUsdc: 0, reviewRule: "ai" });
    const checked = validateDraftInput(body);
    expect(checked.ok && checked.draft.status).toBe("draft");
  });

  it("carries nothing a caller adds: no pool, no status, no owner, no funding", () => {
    const body = postBody({ ...GOOD, proposedPoolUsdc: 9000, status: "published", owner: "0xbad", funded: true, unlock: { pot: 5 } } as never);
    expect(Object.keys(body).sort()).toEqual(["brief", "company", "pieces", "productName", "productUrl", "proposedPoolUsdc", "reviewRule", "rewardPerPiecePoints"]);
    expect(body.proposedPoolUsdc).toBe(0);
  });

  it("says what is missing, in the order the screen asks", () => {
    const pic = campaignPicture({ productName: "STRIVE", shareImage: PAGE.image });
    expect(postReason({ ...GOOD, productUrl: "http://plain.test" }, pic)).toMatch(/https/);
    expect(postReason({ ...GOOD, productName: " " }, pic)).toMatch(/name/);
    expect(postReason({ ...GOOD, ask: "Try it please" }, pic)).toMatch(/at least 20 words. You have 3/);
    expect(postReason(GOOD, campaignPicture({ productName: "STRIVE" }))).toMatch(/needs a picture/);
    expect(postReason(GOOD, pic)).toBeNull();
  });
});

describe("the picture record", () => {
  it("keeps only https links and a plain hex colour", () => {
    const r = pictureRecord({ ...PAGE, image: "http://plain.test/a.png", icon: "javascript:alert(1)", colour: "red; background:url(x)" }, "data:image/png;base64,AAAA", 0);
    expect(r).toMatchObject({ makerImage: null, shareImage: null, icon: null, colour: null });
    expect(pictureRecord(PAGE, "https://cdn.test/mine.png", 0)).toMatchObject({ makerImage: "https://cdn.test/mine.png", shareImage: PAGE.image, colour: "#5e6ad2" });
  });

  it("lets the maker's picture lead, and says where each picture came from", () => {
    expect(pictureOf(pictureRecord(PAGE, "https://cdn.test/mine.png", 0), "STRIVE", GOOD.productUrl)).toMatchObject({ source: "maker", credit: "Picture added by the maker" });
    expect(pictureOf(pictureRecord(PAGE, null, 0), "STRIVE", GOOD.productUrl)).toMatchObject({ source: "share", credit: "From agentic-strava.vercel.app" });
    expect(pictureOf(null, "STRIVE", GOOD.productUrl).source).toBe("none");
  });

  it("checks a stored record again on the way out", () => {
    expect(pictureRecordOrNull("{not json")).toBeNull();
    expect(pictureRecordOrNull(JSON.stringify({ shareImage: "javascript:alert(1)", colour: "#16a34a", makerImage: 7 }))).toMatchObject({ shareImage: null, makerImage: null, colour: "#16a34a" });
  });
});

describe("POST /api/post-app/read", () => {
  it("refuses a caller with no session, and a session that is not a wallet, before any fetch", async () => {
    expect((await read(req("/api/post-app/read", { url: GOOD.productUrl }))).status).toBe(403);
    const res = await read(req("/api/post-app/read", { url: GOOD.productUrl }, "dev_user"));
    expect(res.status).toBe(403);
    expect(fetched).not.toHaveBeenCalled();
  });

  it("stops at the rate limit before any fetch", async () => {
    limit.mockResolvedValue({ ok: false });
    expect((await read(req("/api/post-app/read", { url: GOOD.productUrl }, MAKER))).status).toBe(429);
    expect(fetched).not.toHaveBeenCalled();
  });

  it("returns the proposal, or the fence's reason", async () => {
    const ok = await read(req("/api/post-app/read", { url: GOOD.productUrl }, MAKER));
    expect(ok.status).toBe(200);
    expect((await ok.json()).proposal.name).toBe("STRIVE");
    fetched.mockResolvedValue({ ok: false, reason: "That link does not point to a public site." });
    const no = await read(req("/api/post-app/read", { url: "https://inside.test" }, MAKER));
    expect(no.status).toBe(422);
    expect((await no.json()).error).toBe("That link does not point to a public site.");
  });
});

describe("POST /api/post-app", () => {
  it("refuses a caller with no session before anything is read or saved", async () => {
    expect((await post(req("/api/post-app", GOOD))).status).toBe(403);
    expect((await post(req("/api/post-app", GOOD, "dev_user"))).status).toBe(403);
    expect(fetched).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("publishes for the session's wallet, with the picture the SERVER read", async () => {
    const res = await post(req("/api/post-app", { ...GOOD, owner: "0x2222222222222222222222222222222222222222", shareImage: "https://evil.test/x.png", proposedPoolUsdc: 5000 }, MAKER));
    expect(res.status).toBe(201);
    expect(saveDraft.mock.calls[0][0]).toBe(MAKER);
    expect(saveDraft.mock.calls[0][1]).toMatchObject({ productName: "STRIVE", proposedPoolUsdc: 0, rewardPerPiecePoints: 10 });
    expect(savePictureRecord).toHaveBeenCalledWith("draft_1", expect.objectContaining({ shareImage: PAGE.image, makerImage: null }));
    expect(publishDraft.mock.calls[0].slice(0, 2)).toEqual([MAKER, "draft_1"]);
  });

  it("no picture, no launch: nothing is saved when the page declares none and the maker adds none", async () => {
    fetched.mockResolvedValue({ ok: true, proposal: { ...PAGE, image: null } });
    const res = await post(req("/api/post-app", GOOD, MAKER));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("picture_required");
    expect(saveDraft).not.toHaveBeenCalled();
    fetched.mockResolvedValue({ ok: false, reason: "The site could not be read." });
    expect((await post(req("/api/post-app", GOOD, MAKER))).status).toBe(400);
    expect((await post(req("/api/post-app", { ...GOOD, makerImage: "https://cdn.test/mine.png" }, MAKER))).status).toBe(201);
  });

  it("refuses a short ask or a bad link before the page is read", async () => {
    expect((await post(req("/api/post-app", { ...GOOD, ask: "Try it please" }, MAKER))).status).toBe(400);
    expect((await post(req("/api/post-app", { ...GOOD, productUrl: "javascript:alert(1)" }, MAKER))).status).toBe(400);
    expect(fetched).not.toHaveBeenCalled();
  });

  it("does not publish when the picture record cannot be saved, and reports a publish that is refused", async () => {
    savePictureRecord.mockResolvedValue(false);
    expect((await post(req("/api/post-app", GOOD, MAKER))).status).toBe(503);
    expect(publishDraft).not.toHaveBeenCalled();
    savePictureRecord.mockResolvedValue(true);
    publishDraft.mockResolvedValue({ ok: false, error: "One campaign a day.", status: 429 });
    const res = await post(req("/api/post-app", GOOD, MAKER));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "One campaign a day.", draftId: "draft_1" });
  });
});
