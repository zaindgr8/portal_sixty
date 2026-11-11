import "server-only";
import { GoogleGenAI, ThinkingLevel, type Content, type FunctionCall, type Part } from "@google/genai";
import { sb } from "../supabase";
import type { SessionUser } from "../auth/modules";
import { toolsFor, type Tool, type ToolCtx } from "./tools";

// The portal assistant: a Gemini function-calling loop over the tools in tools.ts.
// The browser keeps the conversation (Gemini "contents", including thought signatures) and sends it back
// each turn; tools always run with the signed-in user's own permissions, so a tampered history can't
// grant anything the user couldn't do in the UI anyway.

const KEY = process.env.ASSISTANT_GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
export const assistantReady = Boolean(KEY);
export const ASSISTANT_MODEL = process.env.ASSISTANT_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-3.8-flash";
const MAX_STEPS = 8;
const MAX_RESULT_CHARS = 14_000;
const MAX_HISTORY = 60;

let client: GoogleGenAI | null = null;
// v1beta: preview models (e.g. the Pro model for Arabic) are only served there.
const ai = () => (client ??= new GoogleGenAI({ apiKey: KEY, apiVersion: "v1beta" }));

export interface PendingCall { id: string; name: string; summary: string; args: Record<string, unknown> }
export interface StepLog { tool: string; ok: boolean; kind: Tool["kind"]; error?: string }
export interface TurnResult {
  contents: Content[];
  reply?: string;
  /** Write actions waiting for the user's OK. */
  pending?: { calls: PendingCall[]; done: Part[] };
  /** Things the browser should do (open a page). */
  actions: { navigate?: string }[];
  steps: StepLog[];
  tokens: { input: number; output: number };
}

function system(user: SessionUser, wsName: string) {
  const now = new Date();
  return [
    `You are the Sixty assistant inside the Sixty portal by DevMate (CRM for WhatsApp/Instagram leads, AI voice calls and, for real-estate agencies, PropTech Auto Listing).`,
    `You're talking to ${user.name} (@${user.username}), ${user.role} of the workspace "${wsName}". Today is ${now.toISOString().slice(0, 10)} (Dubai time is UTC+4).`,
    "",
    "How to work:",
    "- Get facts with the tools. Never guess numbers, names, statuses or ids; if a tool doesn't give it, say you couldn't find it.",
    "- Chain tools when needed (e.g. list_conversations to find a chat, then get_conversation to read it).",
    "- To change something or contact a customer, call the write tool directly. The portal shows the user a confirmation card before it runs, so don't ask \"shall I?\" in text first. Only ask when you genuinely lack details (who, which chat, what text).",
    "- Never send a customer message the user didn't ask for. When drafting a message, show the draft and use send_message only if they asked you to send it.",
    "- When a page would help, call open_page (e.g. the chat or listing you're talking about).",
    "- Answer briefly and concretely in the user's language. Use short lists or small markdown tables for several rows. Mention names rather than internal ids unless the id is needed.",
    "- Owner personal data (Emirates ID, owner phone) is for agency admins only; the API already masks it, don't try to get around that.",
  ].join("\n");
}

const clip = (v: unknown) => {
  const s = JSON.stringify(v ?? null);
  return s.length > MAX_RESULT_CHARS ? { truncated: true, data: s.slice(0, MAX_RESULT_CHARS) } : (JSON.parse(s) as unknown);
};

async function runTool(t: Tool | undefined, call: FunctionCall, ctx: ToolCtx, steps: StepLog[], actions: TurnResult["actions"]): Promise<Part> {
  const name = call.name ?? "unknown";
  const args = (call.args ?? {}) as Record<string, unknown>;
  let response: Record<string, unknown>;
  if (!t) {
    response = { error: `Unknown tool ${name}` };
    steps.push({ tool: name, ok: false, kind: "read", error: "unknown tool" });
  } else {
    try {
      const out = await t.run(args, ctx);
      if (t.kind === "client" && out && typeof out === "object" && "navigate" in out) actions.push(out as { navigate: string });
      response = { result: clip(out) };
      steps.push({ tool: name, ok: true, kind: t.kind });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      response = { error: msg };
      steps.push({ tool: name, ok: false, kind: t.kind, error: msg });
    }
  }
  return { functionResponse: { id: call.id, name, response } };
}

/**
 * Run the assistant until it answers or needs a confirmation.
 * `confirm` resumes a paused turn: approved write calls run, declined ones tell the model "the user said no".
 */
export async function runTurn(opts: {
  user: SessionUser; wsName: string; features: string[]; contents: Content[]; ctx: ToolCtx;
  confirm?: { approved: string[]; pending: { calls: PendingCall[]; done: Part[] } };
}): Promise<TurnResult> {
  const tools = toolsFor(opts.user, opts.features);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const contents = opts.contents.slice(-MAX_HISTORY);
  const steps: StepLog[] = [];
  const actions: TurnResult["actions"] = [];
  const tokens = { input: 0, output: 0 };

  if (opts.confirm) {
    // Only calls the model actually made in its last turn can be confirmed.
    const last = [...contents].reverse().find((c) => c.role === "model");
    const made = new Map((last?.parts ?? []).filter((p) => p.functionCall).map((p) => [p.functionCall!.id ?? p.functionCall!.name, p.functionCall!]));
    const parts: Part[] = [...opts.confirm.pending.done];
    for (const pc of opts.confirm.pending.calls) {
      const call = made.get(pc.id);
      if (!call) continue;
      if (opts.confirm.approved.includes(pc.id)) parts.push(await runTool(byName.get(pc.name), call, opts.ctx, steps, actions));
      else {
        parts.push({ functionResponse: { id: call.id, name: pc.name, response: { error: "The user declined this action. Don't retry it unless they ask." } } });
        steps.push({ tool: pc.name, ok: false, kind: "write", error: "declined" });
      }
    }
    contents.push({ role: "user", parts });
  }

  const declarations = tools.map((t) => ({ name: t.name, description: t.description + (t.kind === "write" ? " (asks the user to confirm)" : ""), parameters: t.params }));
  for (let i = 0; i < MAX_STEPS; i++) {
    const res = await ai().models.generateContent({
      model: ASSISTANT_MODEL,
      contents,
      config: {
        systemInstruction: system(opts.user, opts.wsName),
        tools: [{ functionDeclarations: declarations as never }],
        temperature: 0.3,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        abortSignal: AbortSignal.timeout(45_000),
      },
    });
    tokens.input += res.usageMetadata?.promptTokenCount ?? 0;
    tokens.output += (res.usageMetadata?.candidatesTokenCount ?? 0) + (res.usageMetadata?.thoughtsTokenCount ?? 0);
    const content = res.candidates?.[0]?.content;
    if (!content?.parts?.length) {
      const reason = res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason ?? "no answer";
      return { contents, reply: `Sorry, I couldn't answer that (${reason}).`, actions, steps, tokens };
    }
    // Give every call an id so confirmations can point at it.
    content.parts.forEach((p, n) => { if (p.functionCall && !p.functionCall.id) p.functionCall.id = `call_${Date.now().toString(36)}_${i}_${n}`; });
    contents.push({ role: "model", parts: content.parts });
    const calls = content.parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
    if (!calls.length) {
      const reply = content.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
      return { contents, reply: reply || "Done.", actions, steps, tokens };
    }
    const done: Part[] = [];
    const waiting: PendingCall[] = [];
    for (const call of calls) {
      const t = byName.get(call.name ?? "");
      if (t?.kind === "write") {
        const args = (call.args ?? {}) as Record<string, unknown>;
        waiting.push({ id: call.id!, name: t.name, args, summary: t.summary?.(args) ?? `${t.name} ${JSON.stringify(args).slice(0, 200)}` });
      } else done.push(await runTool(t, call, opts.ctx, steps, actions));
    }
    if (waiting.length) return { contents, pending: { calls: waiting, done }, actions, steps, tokens };
    contents.push({ role: "user", parts: done });
  }
  return { contents, reply: "That took more steps than I'm allowed in one go. Tell me to continue, or narrow the request.", actions, steps, tokens };
}

/** Log usage per workspace (same table as the WhatsApp agent). */
export async function logAssistant(ws: string, user: string, r: Pick<TurnResult, "steps" | "tokens">, ms: number) {
  try {
    await sb("agent_events", {
      method: "POST",
      body: {
        workspace_id: ws, conversation_id: `assistant:${user}`, type: "assistant",
        detail: r.steps.map((s) => `${s.tool}${s.ok ? "" : "✗"}`).join(", ").slice(0, 500) || "chat",
        model: ASSISTANT_MODEL, latency_ms: ms, input_tokens: r.tokens.input, output_tokens: r.tokens.output,
      },
    });
  } catch (err) {
    console.error("[assistant] couldn't log usage", err instanceof Error ? err.message : err);
  }
}
