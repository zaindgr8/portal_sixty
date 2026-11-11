import "server-only";
import sharp from "sharp";
import { aiJson, type AiFile } from "./gemini";
import { copyResponseSchema, copySchema, extractResponseSchema, extractionSchema, photoAnalysisSchema, photoResponseSchema, voiceResponseSchema, voiceSchema, type ExtractedField } from "./schema";
import { mergeFields } from "./merge";
import { assembleCopy, copyFacts } from "./copy";
import { missingQuestions } from "./questions";
import { getObject } from "./storage";
import { addCost, getInputs, getListing, getListingRow, listMediaRows, readOwner, sealOwner, toMedia, updateInputs, updateListing, updateMedia } from "./store";
import { loadPrompt } from "./prompts";
import type { Listing, ListingField, Progress, Tone } from "./types";

// The AI step of a new listing. Runs as a background job; the review screen polls `progress`.
//   1. In parallel: read Form A + documents, analyse photos, transcribe the voice note.
//   2. Merge (documents win legal fields, notes/voice win marketing fields).
//   3. Write English copy, then Arabic copy natively.
// Any step can fail without stopping the rest: its fields just stay empty and show as missing.

type Row = Record<string, unknown>;

async function setProgress(ws: string, id: string, p: Progress) {
  await updateListing(ws, id, { progress: p }).catch(() => {});
}

/** Downscale for Gemini (faster, cheaper); HEIC and anything sharp can't read goes as-is. */
async function forAi(buf: Buffer, mime: string, max = 1024): Promise<AiFile> {
  if (!mime.startsWith("image/") || /heic|heif/.test(mime)) return { data: buf, mimeType: mime };
  try {
    return { data: await sharp(buf).rotate().resize({ width: max, height: max, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer(), mimeType: "image/jpeg" };
  } catch {
    return { data: buf, mimeType: mime };
  }
}

export async function processListing(ws: string, listingId: string) {
  const listing = await getListing(ws, listingId);
  if (!listing) return;
  const started = new Date().toISOString();
  const done: string[] = [];
  await updateListing(ws, listingId, { status: "processing", progress: { step: "reading", label: "Reading Form A…", done, startedAt: started } });

  const media = (await listMediaRows(ws, listingId)).map((r) => ({ row: r, m: toMedia(r) })).filter((x) => !x.m.removed);
  const inputs = await getInputs(ws, listingId);
  const notes = String(inputs.agent_notes ?? "").slice(0, 4000);
  const docs = media.filter((x) => x.m.kind === "form_a" || x.m.kind === "document" || x.m.kind === "floorplan");
  const photos = media.filter((x) => x.m.kind === "photo").sort((a, b) => a.m.order - b.m.order);
  const audio = media.find((x) => x.m.kind === "audio");
  const versions: Record<string, string> = {};
  let cost = 0, tokens = 0;
  const track = (r: { costUsd: number; tokens: number }) => { cost += r.costUsd; tokens += r.tokens; };

  // ---- 1. extraction / photos / voice in parallel ----
  const extractP = (async () => {
    if (!docs.length && !notes) return null;
    const files: AiFile[] = [];
    const labels: string[] = [];
    for (const [i, d] of docs.entries()) {
      const buf = await getObject(ws, d.row.path as string);
      files.push(d.m.mimeType === "application/pdf" ? { data: buf, mimeType: "application/pdf", name: d.m.fileName } : await forAi(buf, d.m.mimeType, 2000));
      labels.push(`Document ${i + 1}: ${d.m.kind === "form_a" ? "Form A / listing form" : d.m.docType ?? d.m.kind} (${d.m.fileName})`);
    }
    versions.extract_form_a = loadPrompt("extract_form_a").version;
    const r = await aiJson({
      task: "extract_form_a", prompt: "extract_form_a", vars: { agent_notes: notes || "(none)" }, files,
      extraText: labels.length ? `The documents above, in order:\n${labels.join("\n")}` : undefined,
      responseSchema: extractResponseSchema, schema: extractionSchema, workspaceId: ws, listingId, timeoutMs: 55_000,
    });
    track(r);
    if (!r.ok) return null;
    done.push("form_a");
    await setProgress(ws, listingId, { step: "photos", label: "Analysing photos…", done, startedAt: started });
    return r.data;
  })();

  const photosP = (async () => {
    if (!photos.length) return null;
    const files = await Promise.all(photos.map(async (p) => forAi(await getObject(ws, p.row.path as string), p.m.mimeType, 768)));
    versions.analyse_photos = loadPrompt("analyse_photos").version;
    const r = await aiJson({
      task: "analyse_photos", prompt: "analyse_photos", vars: { count: photos.length, last_index: photos.length - 1 }, files,
      responseSchema: photoResponseSchema, schema: photoAnalysisSchema, workspaceId: ws, listingId, timeoutMs: 55_000,
    });
    track(r);
    if (!r.ok) return null;
    done.push("photos");
    return r.data;
  })();

  const voiceP = (async () => {
    if (!audio) return null;
    const buf = await getObject(ws, audio.row.path as string);
    versions.transcribe_notes = loadPrompt("transcribe_notes").version;
    const r = await aiJson({
      task: "transcribe_notes", prompt: "transcribe_notes", files: [{ data: buf, mimeType: audio.m.mimeType || "audio/webm" }],
      responseSchema: voiceResponseSchema, schema: voiceSchema, workspaceId: ws, listingId, timeoutMs: 55_000,
    });
    track(r);
    if (!r.ok) return null;
    done.push("voice");
    return r.data;
  })();

  const [extraction, photoAnalysis, voice] = await Promise.all([
    extractP.catch((e) => (console.error("[proptech] extraction", e), null)),
    photosP.catch((e) => (console.error("[proptech] photos", e), null)),
    voiceP.catch((e) => (console.error("[proptech] voice", e), null)),
  ]);

  // ---- 2. photos: room types, order, cover, flags ----
  if (photoAnalysis) {
    const byIndex = new Map(photoAnalysis.photos.map((p) => [p.index, p]));
    const order = [...new Set([...photoAnalysis.suggested_order.filter((i) => i < photos.length), ...photos.map((_, i) => i)])];
    const coverOk = (i: number) => { const p = byIndex.get(i); return p && !p.watermark && !p.phone_visible && !p.people_visible; };
    const cover = coverOk(photoAnalysis.cover_index) ? photoAnalysis.cover_index : order.find(coverOk) ?? order[0];
    await Promise.all(photos.map((p, i) => {
      const a = byIndex.get(i);
      const short = p.m.width && p.m.height ? Math.min(p.m.width, p.m.height) : null;
      return updateMedia(ws, listingId, p.m.id, {
        room_type: a?.room_type ?? null, sort_order: order.indexOf(i), is_cover: i === cover,
        flags: {
          ...(p.m.flags ?? {}), blurry: a?.blurry ?? false, dark: a?.dark ?? false, duplicate: (a?.duplicate_of ?? -1) >= 0, watermark: a?.watermark ?? false,
          phone_visible: a?.phone_visible ?? false, people_visible: a?.people_visible ?? false, low_res: short != null && short < 800, quality: a?.quality,
          amenity_suggestions: a?.amenities ?? [],
        },
      });
    }));
  }

  // ---- 3. merge ----
  await setProgress(ws, listingId, { step: "merging", label: "Checking the details…", done, startedAt: started });
  const formA = docs.find((d) => d.m.kind === "form_a")?.m.id;
  const deed = docs.find((d) => d.m.kind === "document")?.m.id;
  const candidates: ExtractedField[] = [...((extraction?.fields ?? []) as ExtractedField[]), ...((voice?.facts ?? []).map((f) => ({ ...f, source: "voice" })) as ExtractedField[])];
  const merged = mergeFields(candidates, [extraction?.amenities ?? [], voice?.amenities ?? []], { form_a: formA, title_deed: deed });

  const row = await getListingRow(ws, listingId);
  const current = row ? (await getListing(ws, listingId))! : listing;
  const patch: Row = {};
  const conf: Record<string, number> = { ...current.fieldConfidence };
  const src: Record<string, unknown> = { ...current.fieldSource };
  for (const [f, v] of Object.entries(merged.values) as [ListingField, string | number][]) {
    // Don't overwrite anything the agent has already edited by hand.
    if ((current.fieldSource[f] as { source?: string } | undefined)?.source === "agent") continue;
    patch[f] = v;
    conf[f] = merged.confidence[f] ?? 0.5;
    src[f] = merged.source[f];
  }
  if (merged.amenities.length && !current.amenities.length) {
    patch.amenities = merged.amenities;
    conf.amenities = 0.8;
    src.amenities = { source: "notes" };
  }
  const owner = { ...(readOwner(row) ?? {}), ...Object.fromEntries(Object.entries(extraction?.owner ?? {}).filter(([, v]) => v)) };
  patch.owner_pii = sealOwner(owner);
  patch.field_confidence = conf;
  patch.field_source = src;
  const afterMerge = await updateListing(ws, listingId, patch);
  await updateInputs(ws, listingId, {
    extraction_raw: extraction ? { ...extraction, owner: undefined, conflicts: merged.conflicts } : null,
    photo_analysis: photoAnalysis, voice_transcript: voice?.transcript ?? inputs.voice_transcript ?? "",
    voice_facts: voice ? { facts: voice.facts, language: voice.language } : {}, prompt_versions: versions,
  });

  // ---- 4. copy ----
  await setProgress(ws, listingId, { step: "writing", label: "Writing description…", done, startedAt: started });
  const copyCost = await writeCopy(ws, afterMerge, voice?.transcript ?? String(inputs.voice_transcript ?? ""), notes);
  cost += copyCost.cost; tokens += copyCost.tokens;
  done.push(...copyCost.done);

  // ---- 5. questions + ready for review ----
  const final = (await getListing(ws, listingId))!;
  const failed = [!extraction && docs.length ? "Form A" : null, !photoAnalysis && photos.length ? "photos" : null, !voice && audio ? "voice note" : null].filter(Boolean);
  await updateListing(ws, listingId, {
    status: "review", ai_questions: missingQuestions(final),
    progress: {
      step: "done", label: failed.length ? `Ready to review. The AI couldn't read the ${failed.join(", ")}, so fill those fields in by hand.` : "Ready to review",
      done, startedAt: started, finishedAt: new Date().toISOString(), ...(failed.length ? { error: `Couldn't read: ${failed.join(", ")}` } : {}),
    },
  });
  await addCost(ws, listingId, cost, tokens);
}

/** English first, then Arabic written natively (the Pro model). Returns the cost so callers can add it up. */
export async function writeCopy(ws: string, l: Listing, transcript: string, notes: string, tone?: Tone) {
  const t = tone ?? l.tone;
  const facts = JSON.stringify(copyFacts(l), null, 1);
  const marketing = [notes, transcript && `Voice note: ${transcript}`].filter(Boolean).join("\n\n").slice(0, 5000) || "(none)";
  let cost = 0, tokens = 0;
  const done: string[] = [];
  const en = await aiJson({ task: "copy_en", prompt: "copy_en", vars: { tone: t, facts, notes: marketing }, responseSchema: copyResponseSchema, schema: copySchema, workspaceId: ws, listingId: l.id, temperature: 0.6 });
  cost += en.costUsd; tokens += en.tokens;
  if (!en.ok) return { cost, tokens, done };
  const enCopy = assembleCopy(en.data);
  const conf = { ...l.fieldConfidence, title_en: 0.9, description_en: 0.9 };
  const src = { ...l.fieldSource, title_en: { source: "inferred" as const }, description_en: { source: "inferred" as const } };
  await updateListing(ws, l.id, { title_en: enCopy.title, description_en: enCopy.description, tone: t, field_confidence: conf, field_source: src });
  done.push("copy_en");

  const ar = await aiJson({
    task: "copy_ar", prompt: "copy_ar", vars: { tone: t, facts, notes: marketing, english: `${enCopy.title}\n\n${enCopy.description}` },
    responseSchema: copyResponseSchema, schema: copySchema, workspaceId: ws, listingId: l.id, temperature: 0.6, timeoutMs: 60_000,
  });
  cost += ar.costUsd; tokens += ar.tokens;
  if (ar.ok) {
    const arCopy = assembleCopy(ar.data);
    await updateListing(ws, l.id, {
      title_ar: arCopy.title, description_ar: arCopy.description,
      field_confidence: { ...conf, title_ar: 0.85, description_ar: 0.85 }, field_source: { ...src, title_ar: { source: "inferred" }, description_ar: { source: "inferred" } },
    });
    done.push("copy_ar");
  }
  return { cost, tokens, done };
}

export async function regenerateCopy(ws: string, listingId: string, tone?: Tone) {
  const l = await getListing(ws, listingId);
  if (!l) return;
  const inputs = await getInputs(ws, listingId);
  await updateListing(ws, listingId, { progress: { ...l.progress, step: "writing", label: "Rewriting description…" } });
  const r = await writeCopy(ws, l, String(inputs.voice_transcript ?? ""), String(inputs.agent_notes ?? ""), tone);
  await updateListing(ws, listingId, { progress: { ...l.progress, step: "done", label: r.done.length ? "Description rewritten" : "Couldn't rewrite the description. Try again." } });
  await addCost(ws, listingId, r.cost, r.tokens);
}
