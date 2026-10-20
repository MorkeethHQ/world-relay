import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/redis", () => ({ getRedis: () => null }));
vi.mock("@/lib/public-id", () => ({ publicIdOrSame: () => "p_public" }));

import { createPlatformPost, likePlatformPost, listPlatformPosts, parsePlatformPost, resetPlatformPostsForTest } from "@/lib/platform-posts";

describe("platform posts and likes", () => {
  beforeEach(() => resetPlatformPostsForTest());

  it("stores a build post without exposing its wallet", async () => {
    const post = parsePlatformPost({
      kind: "build",
      title: "A useful agent",
      body: "It checks every source before it answers.",
      projectUrl: "https://example.com",
    }, "0x1111111111111111111111111111111111111111");
    expect(post).not.toBeNull();
    await createPlatformPost(post!);
    const [shown] = await listPlatformPosts(null);
    expect(shown.author).toBe("p_public");
    expect(JSON.stringify(shown)).not.toContain("0x1111");
    expect(shown.likes).toBe(0);
  });

  it("counts one like per person", async () => {
    const post = parsePlatformPost({
      kind: "agent_problem",
      title: "It rewrites the brief",
      body: "The agent keeps replacing the requested goal.",
    }, "0x1111111111111111111111111111111111111111");
    await createPlatformPost(post!);
    expect(await likePlatformPost(post!.id, "0x2222222222222222222222222222222222222222")).toEqual({ likes: 1, added: true });
    expect(await likePlatformPost(post!.id, "0x2222222222222222222222222222222222222222")).toEqual({ likes: 1, added: false });
  });

  it("rejects unsafe content and non-https links", () => {
    expect(parsePlatformPost({ kind: "build", title: "Key", body: "private key: abc", projectUrl: "https://example.com" }, "0x1")).toBeNull();
    expect(parsePlatformPost({ kind: "build", title: "Site", body: "Try it", projectUrl: "http://example.com" }, "0x1")).toBeNull();
  });
});
