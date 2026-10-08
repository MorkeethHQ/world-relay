import { describe, expect, it } from "vitest";
import { campaignPicture, hueOf, safePicture } from "@/lib/campaign-picture";

const all = {
  productName: "STRIVE", productUrl: "https://www.striverun.app/x",
  makerImage: "https://cdn.test/maker.png", captureImage: "https://cdn.test/capture.png",
  shareImage: "https://cdn.test/share.png", icon: "https://cdn.test/icon.png",
};

describe("which picture a campaign shows", () => {
  it("lets the maker's picture win, then the capture, then the share picture", () => {
    expect(campaignPicture(all)).toMatchObject({ source: "maker", url: all.makerImage, credit: "Picture added by the maker" });
    expect(campaignPicture({ ...all, makerImage: null })).toMatchObject({ source: "capture", credit: "The live product at striverun.app" });
    expect(campaignPicture({ ...all, makerImage: null, captureImage: null })).toMatchObject({ source: "share", credit: "From striverun.app" });
  });

  it("says where a picture came from even without a product link", () => {
    expect(campaignPicture({ shareImage: all.shareImage }).credit).toBe("From the product's site");
    expect(campaignPicture({ captureImage: all.captureImage, productUrl: "not a link" }).credit).toBe("The live product");
  });

  it("falls back to the name, never to another picture", () => {
    const none = campaignPicture({ productName: " wave radio " });
    expect(none).toMatchObject({ source: "none", url: null, credit: "No picture yet" });
    expect(none.fallback).toEqual({ initial: "W", hue: hueOf("wave radio") });
    expect(campaignPicture({}).fallback).toEqual({ initial: "?", hue: 0 });
    expect(campaignPicture(all).fallback).toBeNull();
  });

  it("gives one product the same fallback colour every time", () => {
    expect(hueOf("STRIVE")).toBe(hueOf(" strive "));
    expect(hueOf("STRIVE")).not.toBe(hueOf("Wave Radio"));
    expect(hueOf("STRIVE")).toBeGreaterThanOrEqual(0);
    expect(hueOf("STRIVE")).toBeLessThan(360);
  });

  it("skips an unsafe picture and uses the next one", () => {
    for (const bad of ["http://cdn.test/a.png", "javascript:alert(1)", "data:image/png;base64,AA", "https://u:p@cdn.test/a.png", "", 7, "x".repeat(2100)]) {
      expect(safePicture(bad), String(bad).slice(0, 30)).toBeNull();
    }
    expect(campaignPicture({ ...all, makerImage: "javascript:alert(1)" }).source).toBe("capture");
    expect(campaignPicture({ ...all, icon: "http://cdn.test/i.png" }).icon).toBeNull();
  });
});
