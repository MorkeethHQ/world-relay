import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// LOG-ONLY NOTIFICATIONS (2026-09-27). Outside production, with no World API key,
// a push is written to the log and never sent. Red before the change: the old
// transport returned false silently and logged nothing, so a local journey could
// not show that a party was notified.

const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

beforeEach(() => {
  fetchSpy.mockClear();
  logSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  delete process.env.WORLD_NOTIFICATION_API_KEY;
  delete process.env.NOTIFY_MODE;
});
afterEach(() => vi.unstubAllGlobals());

import { notifyPieceAccepted, notifyPiecePaid, notifyVerified } from "@/lib/notifications";

describe("notifications outside production", () => {
  it("logs LOG-ONLY and does not call World when there is no API key", async () => {
    await notifyPieceAccepted("0x3333333333333333333333333333333333333333", "TEST Co", 10, "pending", "pool_unfunded");
    expect(fetchSpy).not.toHaveBeenCalled();
    const line = String(logSpy.mock.calls.at(-1)?.[0] ?? "");
    expect(line).toContain("[Notify] LOG-ONLY, not sent");
    expect(line).toContain("0x3333333333333333333333333333333333333333");
    expect(line).toContain("pool unfunded");
  });
  it("logs instead of sending with NOTIFY_MODE=log even when a key is set", async () => {
    process.env.WORLD_NOTIFICATION_API_KEY = "k";
    process.env.NEXT_PUBLIC_WORLD_APP_ID = "app_x";
    process.env.NOTIFY_MODE = "log";
    await notifyPiecePaid("0x3333333333333333333333333333333333333333", 10);
    await notifyVerified("0x3333333333333333333333333333333333333333", 10, "points");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logSpy.mock.calls.filter((c) => String(c[0]).includes("LOG-ONLY")).length).toBe(2);
  });
  it("never logs for a non-wallet address (nothing to notify)", async () => {
    await notifyPiecePaid("dev_abc", 10);
    expect(logSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
