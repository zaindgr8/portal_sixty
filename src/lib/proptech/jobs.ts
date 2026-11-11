import "server-only";
import { q, sb } from "../supabase";
import { inWorkspace } from "../tenant/context";

// A small Postgres-backed job queue. Jobs are claimed with FOR UPDATE SKIP LOCKED (proptech_claim_jobs), so
// several server instances can run the worker safely, and a job whose server died is picked up again when its
// lease runs out. Failed jobs retry with exponential backoff up to max_attempts.

export type JobKind = "process_listing" | "regenerate_copy" | "portal_publish" | "portal_update" | "portal_unpublish" | "portal_status";
export interface Job { id: number; workspace_id: string; listing_id: string | null; kind: JobKind; payload: Record<string, unknown>; attempts: number; max_attempts: number }
type Handler = (job: Job) => Promise<void | { retryInMs?: number }>;

const g = globalThis as typeof globalThis & { __ptHandlers?: Map<JobKind, Handler>; __ptTimer?: NodeJS.Timeout; __ptRunning?: number };
const handlers = (g.__ptHandlers ??= new Map());
const CONCURRENCY = Number(process.env.PROPTECH_JOB_CONCURRENCY ?? 3);
const TICK_MS = 2000;

export function registerJob(kind: JobKind, fn: Handler) {
  handlers.set(kind, fn);
}

export async function enqueue(ws: string, kind: JobKind, o: { listingId?: string; payload?: Record<string, unknown>; delayMs?: number; maxAttempts?: number } = {}) {
  const rows = await sb<{ id: number }[]>("proptech_jobs", {
    method: "POST", prefer: "return=representation",
    body: {
      workspace_id: ws, listing_id: o.listingId ?? null, kind, payload: o.payload ?? {}, max_attempts: o.maxAttempts ?? 3,
      run_at: new Date(Date.now() + (o.delayMs ?? 0)).toISOString(),
    },
  });
  if (!o.delayMs) setTimeout(() => void tick(), 50); // start now rather than on the next tick
  return rows[0]?.id;
}

/** Is there an unfinished job of this kind for the listing? */
export async function pendingJob(ws: string, listingId: string, kind: JobKind) {
  const rows = await sb<{ id: number }[]>(`proptech_jobs?workspace_id=eq.${q(ws)}&listing_id=eq.${q(listingId)}&kind=eq.${kind}&status=in.(queued,running)&select=id&limit=1`);
  return rows.length > 0;
}

async function finish(job: Job, patch: Record<string, unknown>) {
  await sb(`proptech_jobs?id=eq.${job.id}`, { method: "PATCH", body: { ...patch, updated_at: new Date().toISOString() } });
}

async function run(job: Job) {
  const fn = handlers.get(job.kind);
  if (!fn) return finish(job, { status: "failed", last_error: `No handler for ${job.kind}` });
  try {
    const r = await inWorkspace(job.workspace_id, () => fn(job));
    if (r && r.retryInMs) {
      // The handler asked to look again later (e.g. polling a portal's status), without counting as a failure.
      await finish(job, { status: "queued", attempts: Math.max(0, job.attempts - 1), run_at: new Date(Date.now() + r.retryInMs).toISOString(), locked_until: null });
    } else {
      await finish(job, { status: "done", last_error: null, locked_until: null });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[proptech:job] ${job.kind} #${job.id} attempt ${job.attempts}: ${msg}`);
    const last = job.attempts >= job.max_attempts;
    await finish(job, {
      status: last ? "failed" : "queued", last_error: msg.slice(0, 1000), locked_until: null,
      run_at: new Date(Date.now() + 2000 * 3 ** job.attempts).toISOString(),
    });
    if (last) await onFinalFailure(job, msg).catch(() => {});
  }
}

const g2 = globalThis as typeof globalThis & { __ptOnFail?: (job: Job, msg: string) => Promise<void> };
export function onJobFailure(fn: (job: Job, msg: string) => Promise<void>) { g2.__ptOnFail = fn; }
const onFinalFailure = (job: Job, msg: string) => g2.__ptOnFail?.(job, msg) ?? Promise.resolve();

export async function tick() {
  const running = g.__ptRunning ?? 0;
  const free = CONCURRENCY - running;
  if (free <= 0) return;
  let jobs: Job[];
  try {
    jobs = await sb<Job[]>("rpc/proptech_claim_jobs", { method: "POST", body: { n: free, lease_seconds: 180 } });
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    if (!/proptech_claim_jobs|PGRST202/.test(m)) console.error("[proptech:job] claim failed:", m.slice(0, 200));
    return;
  }
  for (const job of jobs) {
    g.__ptRunning = (g.__ptRunning ?? 0) + 1;
    void run(job).finally(() => { g.__ptRunning = (g.__ptRunning ?? 1) - 1; });
  }
}

/** Start the worker once per server process (from instrumentation.ts). */
export function startJobWorker() {
  if (g.__ptTimer || process.env.PROPTECH_WORKER === "off") return;
  g.__ptTimer = setInterval(() => void tick(), TICK_MS);
  g.__ptTimer.unref?.();
  console.log("[proptech:job] worker started");
}
