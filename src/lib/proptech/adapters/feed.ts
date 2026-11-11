// Bayut / dubizzle XML feed: pure generation from listings + mapping (no I/O), so it can be tested.
import { validateListing, type PortalRules } from "../validate";
import type { Listing, ListingMedia, PortalDefaults } from "../types";

export interface FeedMapping {
  verified?: boolean;
  root: string;
  item: string;
  fields: Record<string, string>;
  lists?: Record<string, { item: string; from: "amenities" | "images" }>;
  values?: Record<string, Record<string, string>>;
  rules?: PortalRules;
}

export interface FeedListing { listing: Listing; media: ListingMedia[] }
export interface FeedContext {
  mapping: FeedMapping;
  defaults: PortalDefaults;
  imageUrl: (m: ListingMedia) => string;
  agentNames?: Record<string, { name?: string; email?: string }>;
  today?: Date;
}

export const xmlEscape = (s: string) =>
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
const safeName = (n: string) => (/^[A-Za-z_][\w.-]*$/.test(n) ? n : null);

/** Which listings may go in the feed, and why the others were left out. */
export function feedEligible(items: FeedListing[], ctx: FeedContext) {
  const ok: FeedListing[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const it of items) {
    const v = validateListing({ listing: it.listing, media: it.media, portals: ["bayut"], rules: { bayut: ctx.mapping.rules ?? {} }, today: ctx.today });
    const errors = v.issues.filter((i) => i.level === "error");
    if (errors.length) skipped.push({ id: it.listing.id, reason: errors.map((e) => e.message).join(" ") });
    else ok.push(it);
  }
  return { ok, skipped };
}

function valueFor(source: string, l: Listing, media: ListingMedia[], ctx: FeedContext): string | null {
  if (source.startsWith("const:")) return source.slice(6);
  const map = ctx.mapping.values ?? {};
  const agent = (l.agentId && ctx.defaults.agents?.[l.agentId]) || {};
  const names = (l.agentId && ctx.agentNames?.[l.agentId]) || {};
  switch (source) {
    case "ref": return l.id;
    case "status": return "live";
    case "purpose": return l.offering_type ? map.purpose?.[l.offering_type] ?? l.offering_type : null;
    case "rent_frequency": return l.offering_type === "rent" && l.price_type ? map.rent_frequency?.[l.price_type] ?? l.price_type : null;
    case "off_plan": return l.completion_status === "off_plan" ? "Yes" : "No";
    case "agent_name": return agent.name ?? names.name ?? l.agentId;
    case "agent_email": return agent.email ?? names.email ?? null;
    case "agent_phone": return agent.phone ?? null;
    case "agent_brn": return l.agent_brn ?? agent.brn ?? null;
    case "agency_orn": return l.agency_orn ?? ctx.defaults.orn ?? null;
    case "updated_at": return l.updatedAt;
    default: {
      const v = (l as unknown as Record<string, unknown>)[source];
      if (v === null || v === undefined || v === "") return null;
      const mapped = map[source]?.[String(v)];
      return mapped ?? (Array.isArray(v) ? v.join(", ") : String(v));
    }
  }
  void media;
}

/** Build the whole feed. Never includes owner data (there is no mapping for it, by design). */
export function buildFeedXml(items: FeedListing[], ctx: FeedContext) {
  const { root, item, fields, lists = {} } = ctx.mapping;
  if (!safeName(root) || !safeName(item)) throw new Error("Bayut mapping has an invalid root or item element name.");
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', `<${root} generated="${xmlEscape(new Date().toISOString())}" count="${items.length}">`];
  for (const { listing: l, media } of items) {
    out.push(`  <${item}>`);
    for (const [el, src] of Object.entries(fields)) {
      const name = safeName(el);
      if (!name) throw new Error(`Bayut mapping has an invalid element name: ${el}`);
      const v = valueFor(src, l, media, ctx);
      if (v === null) continue;
      const long = /description|title/i.test(src);
      out.push(`    <${name}>${long ? cdata(v) : xmlEscape(v)}</${name}>`);
    }
    for (const [el, spec] of Object.entries(lists)) {
      const name = safeName(el), child = safeName(spec.item);
      if (!name || !child) throw new Error(`Bayut mapping has an invalid list element: ${el}`);
      const values = spec.from === "amenities"
        ? l.amenities
        : media.filter((m) => m.kind === "photo" && !m.removed).sort((a, b) => Number(b.isCover) - Number(a.isCover) || a.order - b.order).map(ctx.imageUrl);
      if (!values.length) continue;
      out.push(`    <${name}>`);
      for (const v of values) out.push(`      <${child}>${xmlEscape(v)}</${child}>`);
      out.push(`    </${name}>`);
    }
    out.push(`  </${item}>`);
  }
  out.push(`</${root}>`);
  return out.join("\n");
}

/** Minimal well-formedness check (balanced tags, one root) so a broken feed is never served. */
export function checkXml(xml: string): string | null {
  const body = xml.replace(/<\?xml[^>]*\?>/, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const stack: string[] = [];
  const re = /<(\/?)([A-Za-z_][\w.-]*)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  let roots = 0;
  while ((m = re.exec(body))) {
    const [, close, name, , self] = m;
    if (self) { if (!stack.length) roots++; continue; }
    if (close) {
      if (stack.pop() !== name) return `Mismatched closing tag </${name}>`;
    } else {
      if (!stack.length) roots++;
      stack.push(name);
    }
  }
  if (stack.length) return `Unclosed tag <${stack[stack.length - 1]}>`;
  if (roots !== 1) return "The feed must have exactly one root element.";
  if (/<(?![A-Za-z_/!?])/.test(body)) return "Unescaped '<' in the feed.";
  return null;
}
