import { guard, handle, json, fail } from "@/lib/proptech/access";
import { enqueue, pendingJob } from "@/lib/proptech/jobs";
import { geminiReady } from "@/lib/proptech/gemini";
import { getListing, listMediaRows, updateInputs, updateListing } from "@/lib/proptech/store";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

// Start (or re-run) the AI step. Form A is required.
export const POST = handle(async (req: Request, { params }: P) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  const id = (await params).id;
  const l = await getListing(c.ws.id, id);
  if (!l) return fail("Listing not found.", 404);
  if (!geminiReady) return fail("GEMINI_API_KEY isn't set on the server.", 503);
  const b = (await req.json().catch(() => ({}))) as { agentNotes?: string };
  if (b.agentNotes !== undefined) await updateInputs(c.ws.id, id, { agent_notes: String(b.agentNotes).slice(0, 4000) });
  const media = (await listMediaRows(c.ws.id, id)).filter((m) => !m.removed);
  if (!media.some((m) => m.kind === "form_a")) return fail("Upload Form A (or the listing form) first.");
  if (await pendingJob(c.ws.id, id, "process_listing")) return json({ ok: true, already: true });
  await updateListing(c.ws.id, id, { status: "processing", progress: { step: "queued", label: "Starting…", done: [], startedAt: new Date().toISOString() } });
  await enqueue(c.ws.id, "process_listing", { listingId: id, maxAttempts: 2 });
  return json({ ok: true });
});
