import { NextResponse } from "next/server";
import type { Content, Part } from "@google/genai";
import { currentUser } from "@/lib/auth/current";
import { getWorkspace } from "@/lib/tenant/workspaces";
import { sameOrigin } from "@/lib/tenant/api";
import { ASSISTANT_MODEL, assistantReady, logAssistant, runTurn, type PendingCall } from "@/lib/assistant/run";
import type { ToolCtx } from "@/lib/assistant/tools";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  return NextResponse.json({ ready: assistantReady, model: ASSISTANT_MODEL });
}

// One assistant turn: { contents, message } for a new message, or { contents, confirm: { approved, pending } }
// to resume after the user answered a confirmation card.
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail("Please sign in", 401);
  if (!sameOrigin(req)) return fail("Bad origin", 403);
  if (!assistantReady) return fail("The assistant needs a Gemini API key (ASSISTANT_GEMINI_API_KEY or GEMINI_API_KEY).", 503);
  const ws = await getWorkspace(user.workspace);
  if (!ws || (ws.status !== "active" && !user.platformAdmin)) return fail("This workspace isn't active.", 403);

  const b = (await req.json().catch(() => ({}))) as { contents?: Content[]; message?: string; confirm?: { approved?: string[]; pending?: { calls: PendingCall[]; done: Part[] } } };
  const contents: Content[] = Array.isArray(b.contents) ? b.contents.filter((c) => c && (c.role === "user" || c.role === "model") && Array.isArray(c.parts)) : [];
  const message = String(b.message ?? "").trim().slice(0, 4000);
  if (!message && !b.confirm?.pending) return fail("Type a message.");
  if (message) contents.push({ role: "user", parts: [{ text: message }] });

  // Tools call the portal's own API as this user: same cookie, same origin, so every permission check applies.
  const base = new URL(req.url).origin;
  const cookie = req.headers.get("cookie") ?? "";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(base).host;
  const ctx: ToolCtx = {
    user,
    call: async (method, path, body) => {
      if (!path.startsWith("/api/") || path.startsWith("/api/assistant") || path.includes("..")) return { ok: false, status: 400, data: { error: "Not allowed." } };
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { cookie, origin: `${new URL(base).protocol}//${host}`, "x-forwarded-host": host, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(40_000),
      });
      const text = await res.text();
      let data: unknown = text;
      try { data = text ? JSON.parse(text) : null; } catch { /* plain text */ }
      return { ok: res.ok, status: res.status, data };
    },
  };

  const t = Date.now();
  try {
    const r = await runTurn({
      user, wsName: ws.name, features: ws.features ?? [], contents, ctx,
      confirm: b.confirm?.pending ? { approved: b.confirm.approved ?? [], pending: b.confirm.pending } : undefined,
    });
    await logAssistant(ws.id, user.username, r, Date.now() - t);
    return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[assistant]", msg);
    return fail(/429|RESOURCE_EXHAUSTED/.test(msg) ? "Gemini is busy right now. Try again in a minute." : /API key|PERMISSION|401|403/i.test(msg) ? "Gemini rejected the API key." : `The assistant hit an error: ${msg.slice(0, 200)}`, 502);
  }
}
