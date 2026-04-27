import { describe, it, expect } from "vitest";
import { getActiveFeedbackTasks, getFeedbackTemplate } from "@/lib/feedback-tasks";

describe("getActiveFeedbackTasks", () => {
  it("returns 3 tasks by default", () => {
    const tasks = getActiveFeedbackTasks();
    expect(tasks.length).toBe(3);
  });

  it("returns requested count", () => {
    const tasks = getActiveFeedbackTasks(2);
    expect(tasks.length).toBe(2);
  });

  it("returns tasks with required fields", () => {
    const tasks = getActiveFeedbackTasks();
    for (const t of tasks) {
      expect(t.id).toBeDefined();
      expect(t.title).toBeDefined();
      expect(t.description).toBeDefined();
      expect(t.category).toBe("feedback");
      expect(t.icon).toBeDefined();
      expect(t.pointsReward).toBeGreaterThan(0);
      expect(typeof t.requiresPhoto).toBe("boolean");
    }
  });

  it("returns unique tasks", () => {
    const tasks = getActiveFeedbackTasks(6);
    const ids = tasks.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("getFeedbackTemplate", () => {
  it("returns template by id", () => {
    const t = getFeedbackTemplate("fb-try-and-tell");
    expect(t).not.toBeNull();
    expect(t!.title).toBe("Try RELAY, tell us one thing");
  });

  it("returns null for unknown id", () => {
    const t = getFeedbackTemplate("nonexistent");
    expect(t).toBeNull();
  });
});
