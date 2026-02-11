const AGENT_CHAT_ACTIONS = new Set(["chat.guide"]);
const AGENT_CHAT_DEFAULT_ACTION = "chat.guide";
const AGENT_CHAT_MAX_MESSAGE_CHARS = 4000;

function normalizeMessage(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.length > AGENT_CHAT_MAX_MESSAGE_CHARS ? trimmed.slice(0, AGENT_CHAT_MAX_MESSAGE_CHARS) : trimmed;
}

function normalizeAction(value) {
  if (typeof value !== "string") return AGENT_CHAT_DEFAULT_ACTION;
  const action = value.trim();
  return action || AGENT_CHAT_DEFAULT_ACTION;
}

function isLocalRequest(req) {
  const ip = req.ip || req.connection?.remoteAddress || "";
  return ip === "127.0.0.1" || ip === "::1" || ip.endsWith("::1") || ip.endsWith("127.0.0.1");
}

function registerAgentChatRoutes(app, { ensureSession }) {
  if (!ensureSession || typeof ensureSession !== "function") {
    throw new Error("registerAgentChatRoutes requires ensureSession");
  }

  app.post("/api/agent/chat", async (req, res) => {
    const action = normalizeAction(req.body?.action);
    if (!AGENT_CHAT_ACTIONS.has(action)) {
      return res.status(400).json({
        ok: false,
        error: "ACTION_NOT_ALLOWED",
        allowedActions: Array.from(AGENT_CHAT_ACTIONS),
      });
    }

    const message = normalizeMessage(req.body?.message);
    if (!message) {
      return res.status(400).json({ ok: false, error: "MISSING_MESSAGE" });
    }

    if (process.env.OPENCLAW_LITE_AGENT_CHAT_ALLOW_REMOTE !== "1" && !isLocalRequest(req)) {
      return res.status(403).json({ ok: false, error: "LOCALHOST_ONLY" });
    }

    // Keep parity with cookie/session semantics even though the runtime agent lives in-browser.
    ensureSession(req, res);

    if (process.env.NODE_ENV === "test") {
      const reply = `test-agent: ${message}`;
      return res.json({ ok: true, backend: "openclaw-lite-browser-agent-test", action, reply });
    }

    return res.status(409).json({
      ok: false,
      error: "BROWSER_AGENT_ONLY",
      message: "OpenClaw Lite agent runs in the browser worker. Use the in-browser runtime chat path.",
    });
  });
}

module.exports = {
  registerAgentChatRoutes,
};
