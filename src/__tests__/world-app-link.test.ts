import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { worldAppUrl } from "@/lib/world-app-link";

describe("World App browser handoff", () => {
  const appId = "app_1234567890abcdef1234567890abcdef";

  it("builds the official universal Mini App link", () => {
    expect(worldAppUrl("/", appId)).toBe(
      "https://world.org/mini-app?app_id=app_1234567890abcdef1234567890abcdef&path=%2F",
    );
  });

  it("encodes deep paths and their query strings", () => {
    expect(worldAppUrl("/task/abc?ref=person one", appId)).toBe(
      "https://world.org/mini-app?app_id=app_1234567890abcdef1234567890abcdef&path=%2Ftask%2Fabc%3Fref%3Dperson+one",
    );
  });

  it("renders no broken handoff when the registered app id is unavailable", () => {
    expect(worldAppUrl("/", undefined)).toBeNull();
    expect(worldAppUrl("/", "not-an-app-id")).toBeNull();
    expect(worldAppUrl("/", "app_your_registered_id")).toBeNull();
    expect(worldAppUrl("/", "app_1234567890abcdef")).toBeNull();
  });
});

describe("outbound distribution uses the World App handoff", () => {
  it("routes both task and referral shares through worldAppUrl", () => {
    const helpers = readFileSync(
      join(process.cwd(), "src", "lib", "minikit-helpers.ts"),
      "utf8",
    );

    expect(helpers).toContain('import { worldAppUrl } from "./world-app-link"');
    expect(helpers.match(/worldAppUrl\(path\)/g)).toHaveLength(2);
  });
});
