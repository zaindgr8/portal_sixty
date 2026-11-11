import { guard, handle, json, fail } from "@/lib/proptech/access";
import { loadBundle } from "@/lib/proptech/server";
import { audit, deleteListing, getListing, getListingRow, listMediaRows, updateInputs, updateListing, isListingField, readOwner, sealOwner } from "@/lib/proptech/store";
import { removeObjects } from "@/lib/proptech/storage";
import { coerceValue } from "@/lib/proptech/schema";
import { missingQuestions } from "@/lib/proptech/questions";
import { TONES, type ListingField } from "@/lib/proptech/types";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export const GET = handle(async (req: Request, { params }: P) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  const b = await loadBundle(c, (await params).id);
  return b ? json(b) : fail("Listing not found.", 404);
});

const PERMIT_FIELDS = new Set<ListingField>(["permit_number", "permit_expiry", "agency_orn", "agent_brn"]);
const TEXT_MAX: Partial<Record<ListingField, number>> = { description_en: 3000, description_ar: 3000, title_en: 120, title_ar: 120, payment_plan: 1000 };

// Edit fields. Anything the agent sets is marked source "agent" with full confidence, so the AI never overwrites it.
export const PATCH = handle(async (req: Request, { params }: P) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  const id = (await params).id;
  const l = await getListing(c.ws.id, id);
  if (!l) return fail("Listing not found.", 404);
  const b = (await req.json().catch(() => ({}))) as { fields?: Record<string, unknown>; agentNotes?: string; voiceTranscript?: string; tone?: string; agentId?: string; owner?: Record<string, string> };
  const patch: Record<string, unknown> = {};
  const conf = { ...l.fieldConfidence } as Record<string, number>;
  const src = { ...l.fieldSource } as Record<string, unknown>;
  const permitChanges: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(b.fields ?? {})) {
    if (!isListingField(k)) continue;
    let v: unknown;
    if (k === "amenities") v = Array.isArray(raw) ? raw.map((x) => String(x).trim().slice(0, 60)).filter(Boolean).slice(0, 40) : [];
    else if (raw === null || raw === "") v = null;
    else if (["agency_orn", "agent_brn", "permit_number"].includes(k)) v = String(raw).trim().slice(0, 40);
    else {
      const cv = coerceValue(k, String(raw));
      if (cv === undefined) return fail(`That value doesn't work for ${k.replace(/_/g, " ")}.`);
      v = typeof cv === "string" ? cv.slice(0, TEXT_MAX[k] ?? 300) : cv;
      if (TEXT_MAX[k]) v = String(raw).slice(0, TEXT_MAX[k]);
    }
    if (PERMIT_FIELDS.has(k) && v !== l[k]) permitChanges[k] = { from: l[k], to: v };
    patch[k] = v;
    conf[k] = 1;
    src[k] = { source: "agent" };
  }
  if (b.tone && (TONES as readonly string[]).includes(b.tone)) patch.tone = b.tone;
  if (typeof b.agentId === "string") patch.agent_id = b.agentId.slice(0, 60) || null;
  if (b.owner && c.admin) {
    const row = await getListingRow(c.ws.id, id);
    const clean = Object.fromEntries(Object.entries(b.owner).map(([k, v]) => [k, String(v ?? "").slice(0, 120)]).filter(([k]) => ["name", "idNumber", "phone", "email"].includes(k)));
    patch.owner_pii = sealOwner({ ...(readOwner(row) ?? {}), ...clean });
  }
  if (Object.keys(b.fields ?? {}).length) { patch.field_confidence = conf; patch.field_source = src; }
  const next = Object.keys(patch).length ? await updateListing(c.ws.id, id, patch) : l;
  await updateListing(c.ws.id, id, { ai_questions: missingQuestions(next) });
  if (b.agentNotes !== undefined || b.voiceTranscript !== undefined) {
    await updateInputs(c.ws.id, id, {
      ...(b.agentNotes !== undefined ? { agent_notes: String(b.agentNotes).slice(0, 4000) } : {}),
      ...(b.voiceTranscript !== undefined ? { voice_transcript: String(b.voiceTranscript).slice(0, 20000) } : {}),
    });
  }
  if (Object.keys(permitChanges).length) await audit(c.ws.id, id, c.user.username, "permit_edit", permitChanges);
  return json(await loadBundle(c, id));
});

export const DELETE = handle(async (req: Request, { params }: P) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  const id = (await params).id;
  const l = await getListing(c.ws.id, id);
  if (!l) return fail("Listing not found.", 404);
  if (l.status === "published") return fail("Unpublish this listing from every portal before deleting it.");
  if (!c.admin && l.createdBy !== c.user.username) return fail("Only the agent who created it or an admin can delete this listing.", 403);
  const media = await listMediaRows(c.ws.id, id);
  await removeObjects(c.ws.id, media.map((m) => String(m.path)));
  await deleteListing(c.ws.id, id);
  return json({ ok: true });
});
