const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const AGENT_CHAT_ACTIONS = new Set(["chat.guide"]);
const AGENT_CHAT_DEFAULT_ACTION = "chat.guide";
const AGENT_CHAT_MAX_MESSAGE_CHARS = 4000;
const AGENT_CHAT_TIMEOUT_SECONDS = 45;

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

function buildOpenClawSessionId(sessionId) {
  const safe = String(sessionId || "anon")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
  return `openclaw-lite-agent-${safe}`;
}

function buildPrompt({ userMessage, houseId }) {
  return [
    "You are the OpenClaw Lite in-app assistant.",
    "Hard constraints:",
    "- Chat-only guidance. Do not execute tools/actions.",
    "- Do not claim to have performed external side effects.",
    "- If asked to perform actions, provide safe step-by-step guidance instead.",
    "- Keep responses concise and practical.",
    `Context: houseId=${houseId || "none"}`,
    "",
    "User message:",
    userMessage,
  ].join("\n");
}

function extractJsonObjectFromOutput(stdout) {
  const text = String(stdout || "").trim();
  if (!text) throw new Error("EMPTY_OUTPUT");

  try {
    return JSON.parse(text);
  } catch {
    // Continue to tolerant parsing.
  }

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trim().startsWith("{")) continue;
    const candidate = lines.slice(i).join("\n");
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }

  throw new Error("INVALID_JSON_OUTPUT");
}

function extractAgentReply(json) {
  const payloads = json?.result?.payloads;
  if (Array.isArray(payloads)) {
    for (const payload of payloads) {
      if (payload && typeof payload.text === "string" && payload.text.trim()) return payload.text.trim();
    }
  }
  return "";
}

async function runOpenClawAgent({ sessionId, prompt }) {
  const openclawBin = process.env.OPENCLAW_LITE_AGENT_CLI || "openclaw";
  const timeoutSeconds = Math.max(5, Number(process.env.OPENCLAW_LITE_AGENT_TIMEOUT_SECONDS || AGENT_CHAT_TIMEOUT_SECONDS));

  const args = [
    "agent",
    "--session-id",
    sessionId,
    "--message",
    prompt,
    "--timeout",
    String(timeoutSeconds),
    "--json",
  ];

  const { stdout } = await execFileAsync(openclawBin, args, {
    timeout: timeoutSeconds * 1000 + 2000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env },
  });

  const parsed = extractJsonObjectFromOutput(stdout);
  const reply = extractAgentReply(parsed);
  if (!reply) throw new Error("EMPTY_AGENT_REPLY");
  return reply;
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

    const session = ensureSession(req, res);
    const sessionId = buildOpenClawSessionId(session?.sessionId);
    const prompt = buildPrompt({ userMessage: message, houseId: session?.houseId || null });

    if (process.env.NODE_ENV === "test") {
      const reply = `test-agent: ${message}`;
      return res.json({ ok: true, backend: "openclaw-agent-test", action, reply });
    }

    try {
      const reply = await runOpenClawAgent({ sessionId, prompt });
      return res.json({ ok: true, backend: "openclaw-agent", action, reply });
    } catch (error) {
      const code = error?.code === "ENOENT" ? "OPENCLAW_CLI_NOT_FOUND" : "AGENT_BACKEND_FAILED";
      return res.status(502).json({ ok: false, error: code });
    }
  });
}

module.exports = {
  registerAgentChatRoutes,
};
