import "server-only";
import { GoogleGenAI, ThinkingLevel, createPartFromUri, type Part } from "@google/genai";
import type { z } from "zod";
import { sb } from "../supabase";
import { loadPrompt, render, type PromptName } from "./prompts";

// The one place PropTech talks to Gemini: timeouts, retries with backoff, schema validation,
// and a row in ai_usage (tokens + cost) for every call, tied to the listing.
//
// Use a PAID-TIER key: on the free tier Google may use prompts (Form A has owner personal data) to improve its models.

const KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
export const geminiReady = Boolean(KEY);
export const MODEL_FLASH = process.env.GEMINI_MODEL || "gemini-3.8-flash";
export const MODEL_PRO = process.env.GEMINI_MODEL_PRO || "gemini-3.1-pro-preview";

// USD per 1M tokens (output includes thinking). Source: ai.google.dev/gemini-api/docs/pricing.
// Override with GEMINI_PRICES='{"model-id":{"in":1.5,"out":7.5}}' when Google changes them.
const PRICES: Record<string, { in: number; out: number }> = {
  "gemini-3.8-flash": Date.now() < Date.UTC(2027, 0, 1) ? { in: 0.75, out: 3.75 } : { in: 1.5, out: 7.5 },
  "gemini-3.1-pro-preview": { in: 2, out: 12 },
  ...(() => { try { return JSON.parse(process.env.GEMINI_PRICES || "{}"); } catch { return {}; } })(),
};
export function costUsd(model: string, inTok: number, outTok: number) {
  const p = PRICES[model] ?? PRICES[MODEL_FLASH] ?? { in: 1, out: 5 };
  return (inTok * p.in + outTok * p.out) / 1_000_000;
}

let client: GoogleGenAI | null = null;
// v1beta: preview models (e.g. the Pro model for Arabic) are only served there.
const ai = () => (client ??= new GoogleGenAI({ apiKey: KEY, apiVersion: "v1beta" }));

export class AiError extends Error {
  constructor(message: string, readonly retryable = false) { super(message); }
}

/** A file to send to Gemini: small ones inline, big ones through the Files API. */
export interface AiFile { data: Buffer; mimeType: string; name?: string }
const INLINE_LIMIT = 14 * 1024 * 1024; // the whole request must stay under ~20 MB

async function toParts(files: AiFile[]): Promise<Part[]> {
  const total = files.reduce((t, f) => t + f.data.length, 0);
  if (total <= INLINE_LIMIT) return files.map((f) => ({ inlineData: { mimeType: f.mimeType, data: f.data.toString("base64") } }));
  return Promise.all(files.map(async (f) => {
    if (f.data.length < 512 * 1024) return { inlineData: { mimeType: f.mimeType, data: f.data.toString("base64") } };
    let up = await ai().files.upload({ file: new Blob([new Uint8Array(f.data)], { type: f.mimeType }), config: { mimeType: f.mimeType, displayName: f.name } });
    for (let i = 0; up.state === "PROCESSING" && i < 30; i++) {
      await sleep(1000);
      up = await ai().files.get({ name: up.name! });
    }
    if (up.state === "FAILED" || !up.uri) throw new AiError("Gemini couldn't process an uploaded file.");
    return createPartFromUri(up.uri, f.mimeType);
  }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface AiCall<T> {
  task: string;
  prompt: PromptName;
  vars?: Record<string, string | number>;
  files?: AiFile[];
  /** Text parts added after the files (e.g. "Page 1 is…"). */
  extraText?: string;
  responseSchema: object;
  schema: z.ZodType<T>;
  /** Override the template's model. */
  model?: "flash" | "pro";
  workspaceId: string;
  listingId?: string;
  timeoutMs?: number;
  temperature?: number;
}

export type AiResult<T> = { ok: true; data: T; model: string; costUsd: number; tokens: number } | { ok: false; error: string; model: string; costUsd: number; tokens: number };

/**
 * Structured call. Network/rate-limit errors are retried with backoff (3 tries); an answer that fails our
 * schema is retried once. Never throws: callers mark fields as missing on { ok: false }.
 */
export async function aiJson<T>(c: AiCall<T>): Promise<AiResult<T>> {
  const p = loadPrompt(c.prompt);
  const model = (c.model ?? p.model) === "pro" ? MODEL_PRO : MODEL_FLASH;
  let costTotal = 0;
  let tokTotal = 0;
  if (!geminiReady) return { ok: false, error: "GEMINI_API_KEY is not set.", model, costUsd: 0, tokens: 0 };

  let parts: Part[];
  try {
    parts = c.files?.length ? await toParts(c.files) : [];
  } catch (err) {
    return { ok: false, error: errText(err), model, costUsd: 0, tokens: 0 };
  }
  const text = render(p.template, c.vars ?? {});
  let invalidRetries = 0;
  let lastError = "";

  for (let attempt = 0; attempt < 4; attempt++) {
    const started = Date.now();
    let inTok = 0, outTok = 0;
    try {
      const res = await ai().models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text }, ...parts, ...(c.extraText ? [{ text: c.extraText }] : [])] }],
        config: {
          temperature: c.temperature ?? 0.2,
          responseMimeType: "application/json",
          responseSchema: c.responseSchema,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          abortSignal: AbortSignal.timeout(c.timeoutMs ?? 50_000),
        },
      });
      inTok = res.usageMetadata?.promptTokenCount ?? 0;
      outTok = (res.usageMetadata?.candidatesTokenCount ?? 0) + (res.usageMetadata?.thoughtsTokenCount ?? 0);
      const cost = costUsd(model, inTok, outTok);
      costTotal += cost; tokTotal += inTok + outTok;
      const raw = res.text ?? "";
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { throw new AiError("Gemini returned text that isn't JSON.", false); }
      const v = c.schema.safeParse(parsed);
      if (!v.success) throw new AiError(`Answer didn't match the schema: ${v.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`, false);
      await logUsage(c, p.version, model, inTok, outTok, cost, true, null, Date.now() - started);
      return { ok: true, data: v.data, model, costUsd: costTotal, tokens: tokTotal };
    } catch (err) {
      lastError = errText(err);
      const cost = costUsd(model, inTok, outTok);
      await logUsage(c, p.version, model, inTok, outTok, inTok ? cost : 0, false, lastError, Date.now() - started);
      const transient = isTransient(err);
      if (!transient) {
        if (invalidRetries++ >= 1) break; // bad answer: one retry, then give up
      } else if (attempt >= 2) break;
      await sleep(transient ? 1000 * 2 ** attempt + Math.random() * 400 : 300);
    }
  }
  console.error(`[proptech:ai] ${c.task} failed: ${lastError}`);
  return { ok: false, error: lastError, model, costUsd: costTotal, tokens: tokTotal };
}

function errText(err: unknown) {
  const m = err instanceof Error ? err.message : String(err);
  return m.length > 400 ? `${m.slice(0, 400)}…` : m;
}
function isTransient(err: unknown) {
  if (err instanceof AiError) return err.retryable;
  const m = errText(err);
  return /timeout|timed out|abort|ECONN|fetch failed|429|RESOURCE_EXHAUSTED|500|502|503|504|UNAVAILABLE|INTERNAL|overloaded/i.test(m);
}

async function logUsage(c: AiCall<unknown>, version: string, model: string, inTok: number, outTok: number, cost: number, ok: boolean, error: string | null, ms: number) {
  console.log(`[proptech:ai] ${c.task} ${model} ok=${ok} in=${inTok} out=${outTok} $${cost.toFixed(5)} ${ms}ms`);
  try {
    await sb("ai_usage", {
      method: "POST",
      body: {
        workspace_id: c.workspaceId, listing_id: c.listingId ?? null, task: c.task, prompt_version: `${c.prompt}@${version}`, model,
        input_tokens: inTok, output_tokens: outTok, cost_usd: cost, ok, error, duration_ms: ms,
      },
    });
  } catch (e) {
    console.error("[proptech:ai] couldn't log usage:", errText(e));
  }
}
