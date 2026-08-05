import { describe, expect, it } from "vitest";
import { worldAppUrl } from "@/lib/world-app-link";

describe("World App browser handoff", () => {
  const appId = "app_1234567890abcdef";

  it("builds the official universal Mini App link", () => {
    expect(worldAppUrl("/", appId)).toBe(
      "https://world.org/mini-app?app_id=app_1234567890abcdef&path=%2F",
    );
  });

  it("encodes deep paths and their query strings", () => {
    expect(worldAppUrl("/task/abc?ref=person one", appId)).toBe(
      "https://world.org/mini-app?app_id=app_1234567890abcdef&path=%2Ftask%2Fabc%3Fref%3Dperson+one",
    );
  });

  it("renders no broken handoff when the registered app id is unavailable", () => {
    expect(worldAppUrl("/", undefined)).toBeNull();
    expect(worldAppUrl("/", "not-an-app-id")).toBeNull();
  });
});
