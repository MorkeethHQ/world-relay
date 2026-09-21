import { describe, it, expect } from "vitest";
import { authorLabel } from "@/lib/authorship";
import { AGENT_REGISTRY } from "@/lib/agents";

// HONEST AUTHORSHIP (2026-09-21): a persona FAVOUR itself posts under must never
// read as an independent outside agent asking.
describe("who asked is said honestly", () => {
  it("FAVOUR's own persona (agent:<id>) is labelled a FAVOUR agent, never 'asked'", () => {
    const l = authorLabel({ poster: "agent:openclaw", agent: { name: "OpenClaw" } as any });
    expect(l).toBe("OpenClaw · FAVOUR agent");
    expect(l).not.toMatch(/asked/);
  });
  it("an outside agent through the agent door (agent_...) really did ask", () => {
    expect(authorLabel({ poster: "agent_acme", agent: { name: "Acme Bot" } as any })).toBe("Acme Bot asked");
  });
  it("a human poster gets no agent label", () => {
    expect(authorLabel({ poster: "0x1111111111111111111111111111111111111111", agent: null })).toBeNull();
  });
});

describe("persona descriptions claim no outside company or customers", () => {
  it("every persona says it is a FAVOUR agent and that nobody pays it", () => {
    const list = Object.values(AGENT_REGISTRY);
    expect(list.length).toBeGreaterThan(0);
    for (const a of list as any[]) {
      expect(a.personality, a.id).toMatch(/^A FAVOUR agent/);
      expect(a.personality, a.id).toMatch(/nobody pays it/);
      expect(a.personality, a.id).not.toMatch(/Brands pay|platforms need|at scale|intelligence/i);
    }
  });
});
