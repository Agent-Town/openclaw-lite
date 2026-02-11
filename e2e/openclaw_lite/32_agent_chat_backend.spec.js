const { test, expect } = require("@playwright/test");

const { resetServer } = require("./helpers/backend_modularity");

test.describe("M32: agent chat backend", () => {
  test.beforeEach(async ({ request }) => {
    await resetServer(request);
  });

  test("accepts allowlisted action and returns deterministic test reply", async ({ request }) => {
    const res = await request.post("/api/agent/chat", {
      data: {
        action: "chat.guide",
        message: "How do I recover my house?",
      },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body?.ok).toBe(true);
    expect(body?.action).toBe("chat.guide");
    expect(body?.backend).toBe("openclaw-agent-test");
    expect(String(body?.reply || "")).toContain("How do I recover my house?");
  });

  test("rejects non-allowlisted action", async ({ request }) => {
    const res = await request.post("/api/agent/chat", {
      data: {
        action: "tool.exec",
        message: "run this",
      },
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body?.ok).toBe(false);
    expect(body?.error).toBe("ACTION_NOT_ALLOWED");
    expect(Array.isArray(body?.allowedActions)).toBeTruthy();
    expect(body.allowedActions).toContain("chat.guide");
  });

  test("rejects missing/empty message", async ({ request }) => {
    const res = await request.post("/api/agent/chat", {
      data: {
        action: "chat.guide",
        message: "   ",
      },
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body?.ok).toBe(false);
    expect(body?.error).toBe("MISSING_MESSAGE");
  });
});
