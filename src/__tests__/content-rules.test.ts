import { describe, expect, it } from "vitest";
import { campaignPicture } from "@/lib/campaign-picture";
import { clamp, groundOf, hostIfLink, lineText, LINE_MAX, NAME_MAX, nameText, PICTURE_MIN_PX, pictureSteps, pictureTooSmall, stepsOf, textOrNull } from "@/lib/content-rules";

describe("the picture chain is one chain everywhere", () => {
  it("goes share picture, then icon on the app's ground, then the first letter", () => {
    const steps = pictureSteps({ url: "https://a.example/og.png", icon: "https://a.example/icon.png", colour: "#1d4ed8", name: "Strive" });
    expect(steps.map((s) => s.kind)).toEqual(["picture", "icon", "initial"]);
    expect(steps[1]).toMatchObject({ url: "https://a.example/icon.png", ground: "#1d4ed8" });
    expect(steps[2]).toMatchObject({ letter: "S", ground: "#1d4ed8" });
  });

  it("always ends in a letter, so a tile is never empty", () => {
    expect(pictureSteps({ name: "wave radio" })).toEqual([{ kind: "initial", letter: "W", ground: groundOf("wave radio") }]);
    expect(pictureSteps({ name: "  " })[0]).toMatchObject({ letter: "?" });
  });

  it("does not show the same file twice", () => {
    expect(pictureSteps({ url: "https://a.example/i.png", icon: "https://a.example/i.png", name: "A" }).map((s) => s.kind)).toEqual(["picture", "initial"]);
  });

  it("refuses a ground that reads as points or money, and takes a pale tint from the name instead", () => {
    expect(groundOf("Strive", "#16a34a")).toMatch(/^hsl\(\d+ 12% 92%\)$/); // green: money
    expect(groundOf("Strive", "#d97706")).toMatch(/^hsl\(/); // amber: points
    expect(groundOf("Strive", "not a colour")).toMatch(/^hsl\(/);
    expect(groundOf("Strive", "#1d4ed8")).toBe("#1d4ed8"); // blue is fine inside the picture window
    expect(groundOf("Strive")).toBe(groundOf("Strive")); // steady
  });

  it("reads a campaign picture the same way", () => {
    const p = campaignPicture({ productName: "Strive", productUrl: "https://a.example/", shareImage: null, icon: "https://a.example/icon.png" });
    expect(stepsOf(p, "Strive").map((s) => s.kind)).toEqual(["icon", "initial"]);
  });

  it("drops a picture that is too small to be a picture of the app", () => {
    expect(pictureTooSmall(16, 16)).toBe(true);
    expect(pictureTooSmall(PICTURE_MIN_PX, PICTURE_MIN_PX)).toBe(false);
    expect(pictureTooSmall(1200, 0)).toBe(true);
    expect(pictureTooSmall(NaN, 100)).toBe(true);
  });
});

describe("text nobody controls", () => {
  it("draws nothing for nothing", () => {
    expect(textOrNull("")).toBeNull();
    expect(textOrNull("   ")).toBeNull();
    expect(textOrNull("undefined")).toBeNull();
    expect(textOrNull("null")).toBeNull();
    expect(textOrNull(undefined)).toBeNull();
    expect(textOrNull(" a  b ")).toBe("a b");
  });

  it("clamps at a word with one ellipsis and keeps a short text whole", () => {
    expect(clamp("short", 10)).toBe("short");
    expect(clamp("the quick brown fox jumps", 15)).toBe("the quick…");
    expect(clamp("x".repeat(90), 60)).toBe("x".repeat(59) + "…"); // one long word: cut hard
    expect(Array.from(clamp("é".repeat(100), 20)).length).toBe(20);
  });

  it("shows a bare link as its host", () => {
    expect(hostIfLink("https://www.striverun.app/x?y=1")).toBe("striverun.app");
    expect(hostIfLink("see https://striverun.app")).toBe("see https://striverun.app");
  });

  it("gives a name one line and a line two", () => {
    expect(Array.from(nameText("n".repeat(90))!).length).toBe(NAME_MAX);
    expect(Array.from(lineText("w ".repeat(200))!).length).toBeLessThanOrEqual(LINE_MAX);
    expect(nameText("")).toBeNull();
    expect(lineText("https://striverun.app/")).toBe("striverun.app");
  });
});

describe("the letter stays readable on the app's own colour", () => {
  it("is white on a dark colour, ink on a light one, and ink when the colour is refused or missing", async () => {
    const { inkOn } = await import("@/lib/content-rules");
    expect(inkOn("#5b3a8c")).toBe("white");
    expect(inkOn("#e8e8f5")).toBe("ink");
    expect(inkOn("#00c230")).toBe("ink"); // money green is refused, so the pale ground and ink
    expect(inkOn(null)).toBe("ink");
  });
});
