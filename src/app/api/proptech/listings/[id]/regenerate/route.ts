import { guard, handle, json, fail } from "@/lib/proptech/access";
import { enqueue, pendingJob } from "@/lib/proptech/jobs";
import { getListing, updateListing } from "@/lib/proptech/store";
import { TONES, type Tone } from "@/lib/proptech/types";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export const POST = handle(async (req: Request, { params }: P) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  const id = (await params).id;
  const l = await getListing(c.ws.id, id);
  if (!l) return fail("Listing not found.", 404);
  const b = (await req.json().catch(() => ({}))) as { tone?: string };
  const tone = (TONES as readonly string[]).includes(b.tone ?? "") ? (b.tone as Tone) : l.tone;
  if (await pendingJob(c.ws.id, id, "regenerate_copy")) return json({ ok: true, already: true });
  await updateListing(c.ws.id, id, { tone, progress: { ...l.progress, step: "writing", label: "Rewriting description…" } });
  await enqueue(c.ws.id, "regenerate_copy", { listingId: id, payload: { tone }, maxAttempts: 2 });
  return json({ ok: true });
});
