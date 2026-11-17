import "server-only";
import { countConversations } from "./store";
import { importHistory, twilioConfigured } from "./twilio";
import { inWorkspace, workspaceId } from "../tenant/context";
import { listWorkspaces } from "../tenant/workspaces";
import { refreshAllTokens } from "../instagram/connect";

// Messages your n8n workflow sends go straight through Twilio, so the dashboard
// checks Twilio regularly to show them (and their delivery status) in the chats.
// Each workspace is checked with its own Twilio account.
const INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS ?? 15_000);
const LOOKBACK_MS = 30 * 60_000;

const g = globalThis as typeof globalThis & { __waPollerWs?: NodeJS.Timeout; __waPollingWs?: Set<string>; __waLastSyncWs?: Map<string, number> };
const polling = (g.__waPollingWs ??= new Set());
const lastSync = (g.__waLastSyncWs ??= new Map());

/** Pull the current workspace's recent messages from Twilio, at most once per interval per server instance. */
export async function syncFromTwilio() {
  if (INTERVAL_MS <= 0) return;
  const id = await workspaceId();
  if (polling.has(id) || Date.now() - (lastSync.get(id) ?? 0) < INTERVAL_MS) return;
  if (!(await twilioConfigured())) return;
  polling.add(id);
  lastSync.set(id, Date.now());
  try {
    // First run on an empty dashboard: bring in the full history.
    if (!(await countConversations())) await importHistory(1000);
    else await importHistory(100, new Date(Date.now() - LOOKBACK_MS));
  } catch (err) {
    console.error(`[sync:${id}]`, err instanceof Error ? err.message : err);
  } finally {
    polling.delete(id);
  }
}

/** Every active workspace, one after another. */
export async function syncAllWorkspaces() {
  let list;
  try {
    list = (await listWorkspaces()).filter((w) => w.status === "active");
  } catch (err) {
    console.error("[sync]", err instanceof Error ? err.message : err);
    return;
  }
  for (const w of list) await inWorkspace(w.id, syncFromTwilio);
}

// Long-running servers (local / `next start`) check on a timer. On Vercel, timers DO
// survive between requests (Fluid compute keeps instances warm), so a running interval
// keeps a function instance provisioned around the clock — in Nov 2026 this poller
// burned 371 GB-Hrs of Fluid Provisioned Memory and paused the whole team. On Vercel
// the timer stays off; the dashboard's own refreshes call syncFromTwilio() instead.
export function startPoller() {
  if (process.env.VERCEL) return;
  if (INTERVAL_MS <= 0 || g.__waPollerWs) return;
  g.__waPollerWs = setInterval(() => void syncAllWorkspaces(), INTERVAL_MS);
  void syncAllWorkspaces();
  // Instagram tokens last ~60 days; renew them well before they run out.
  setInterval(() => void refreshAllTokens(), 6 * 3_600_000);
  void refreshAllTokens();
  console.log(`[sync] Checking Twilio for new WhatsApp messages every ${INTERVAL_MS / 1000}s`);
}
