// Compliance autopilot: where each listing stands on the Dubai rules, and what needs doing.
//   Form A (signed listing agreement) → apply for the Trakheesi advertising permit → permit issued → live on portals.
// A listing advertised without a valid permit is removed by the portals and fined by DLD, so expiring and
// expired permits (and Form As, which a permit can't outlive) are flagged well before they lapse.
// Pure: used by the API, the daily check and the pages alike.
import { PORTAL_LABEL, type Listing, type Portal, type PortalStatus } from "./types";

/** Warn this many days before a permit or Form A runs out. */
export const WARN_DAYS = 14;
/** Applied this long ago and still no permit: nudge the agent to check Trakheesi. */
export const WAITING_DAYS = 3;

export type Stage = "form_a" | "apply" | "waiting" | "ready" | "live";
export type DocState = "missing" | "unknown" | "valid" | "expiring" | "expired";
export type PermitState = "none" | "applied" | "unknown" | "valid" | "expiring" | "expired";
export interface ComplianceAlert { level: "bad" | "warn"; kind: string; text: string }
export interface Compliance {
  stage: Stage;
  formA: { state: DocState; number: string | null; expiry: string | null; daysLeft: number | null };
  permit: { state: PermitState; number: string | null; expiry: string | null; daysLeft: number | null; appliedAt: string | null; waitingDays: number | null };
  live: Portal[];
  alerts: ComplianceAlert[];
  /** Highest alert level, for sorting and badges. */
  level: "bad" | "warn" | "ok";
}

export const STAGE_LABEL: Record<Stage, string> = {
  form_a: "Form A needed", apply: "Apply for permit", waiting: "Waiting for permit", ready: "Permit valid", live: "Live",
};

const DAY = 86_400_000;
const dayStart = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());

/** Whole days from today to a YYYY-MM-DD date (negative once it has passed; 0 = expires today). */
export function daysUntil(date: string | null | undefined, today = new Date()): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - dayStart(today)) / DAY);
}

const fmt = (date: string | null) => {
  if (!date) return "";
  const [y, m, d] = date.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};
const inDays = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);

function expiryState(expiry: string | null, today: Date): { state: "valid" | "expiring" | "expired" | "unknown"; daysLeft: number | null } {
  const daysLeft = daysUntil(expiry, today);
  if (daysLeft === null) return { state: "unknown", daysLeft };
  // A permit or Form A is valid through its expiry date.
  return { state: daysLeft < 0 ? "expired" : daysLeft <= WARN_DAYS ? "expiring" : "valid", daysLeft };
}

type L = Pick<Listing, "permit_number" | "permit_expiry" | "form_a_number" | "form_a_expiry"> & { permitAppliedAt?: string | null };

export function complianceFor(l: L, o: { hasFormA: boolean; portals: { portal: Portal; status: PortalStatus }[]; today?: Date }): Compliance {
  const today = o.today ?? new Date();
  const alerts: ComplianceAlert[] = [];
  const live = o.portals.filter((p) => p.status === "live" || p.status === "submitted").map((p) => p.portal);
  const liveNames = live.map((p) => PORTAL_LABEL[p]).join(" and ");

  // ---- Form A ----
  const fa = expiryState(l.form_a_expiry, today);
  const formAState: DocState = !o.hasFormA && !l.form_a_number ? "missing" : fa.state;
  if (formAState === "missing") alerts.push({ level: "warn", kind: "form_a_missing", text: "No Form A yet. Upload the signed Form A: Trakheesi needs it for the permit." });
  else if (formAState === "unknown") alerts.push({ level: "warn", kind: "form_a_expiry", text: "Form A expiry isn't filled in. Add it so Sixty can warn you before it runs out." });
  else if (formAState === "expired") alerts.push({ level: live.length ? "bad" : "warn", kind: "form_a_expired", text: `Form A expired on ${fmt(l.form_a_expiry)}. Get a new one signed: the permit can't be renewed without it.` });
  else if (formAState === "expiring") alerts.push({ level: "warn", kind: "form_a_expiring", text: `Form A expires ${inDays(fa.daysLeft!)} (${fmt(l.form_a_expiry)}). Arrange a renewal with the owner.` });

  // ---- Permit ----
  const pe = expiryState(l.permit_expiry, today);
  const hasPermit = Boolean(l.permit_number?.trim());
  const waitingDays = !hasPermit && l.permitAppliedAt ? Math.max(0, Math.floor((dayStart(today) - dayStart(new Date(l.permitAppliedAt))) / DAY)) : null;
  const permitState: PermitState = hasPermit ? pe.state : l.permitAppliedAt ? "applied" : "none";
  if (permitState === "expired") {
    alerts.push(live.length
      ? { level: "bad", kind: "permit_expired_live", text: `Permit expired on ${fmt(l.permit_expiry)} but the listing is still on ${liveNames}. Portals remove it and DLD fines apply: renew the permit or take it down now.` }
      : { level: "warn", kind: "permit_expired", text: `Permit expired on ${fmt(l.permit_expiry)}. Renew it on Trakheesi before publishing again.` });
  } else if (permitState === "expiring") {
    alerts.push({ level: live.length ? "bad" : "warn", kind: "permit_expiring", text: `Permit expires ${inDays(pe.daysLeft!)} (${fmt(l.permit_expiry)}). Renew it on Trakheesi${live.length ? ` so the listing stays on ${liveNames}` : ""}.` });
  } else if (permitState === "unknown") {
    alerts.push({ level: "warn", kind: "permit_expiry", text: "Permit expiry isn't filled in. Add it from the permit." });
  } else if (permitState === "applied" && (waitingDays ?? 0) >= WAITING_DAYS) {
    alerts.push({ level: "warn", kind: "permit_waiting", text: `Applied for the permit ${waitingDays} days ago and it isn't in yet. Check its status on Trakheesi.` });
  }
  // A permit can't outlive the Form A it was issued on.
  const pd = daysUntil(l.permit_expiry, today), fd = daysUntil(l.form_a_expiry, today);
  if (hasPermit && pd !== null && fd !== null && pd > fd && fd >= 0) {
    alerts.push({ level: "warn", kind: "permit_after_form_a", text: `The permit runs to ${fmt(l.permit_expiry)} but the Form A ends on ${fmt(l.form_a_expiry)}. Check both dates.` });
  }

  // ---- Stage ----
  const permitOk = hasPermit && (permitState === "valid" || permitState === "expiring");
  const formAOk = formAState === "valid" || formAState === "expiring" || formAState === "unknown";
  const stage: Stage = permitOk ? (live.length ? "live" : "ready") : !formAOk ? "form_a" : permitState === "applied" ? "waiting" : "apply";

  const level = alerts.some((a) => a.level === "bad") ? "bad" : alerts.length ? "warn" : "ok";
  return {
    stage,
    formA: { state: formAState, number: l.form_a_number ?? null, expiry: l.form_a_expiry ?? null, daysLeft: fa.daysLeft },
    permit: { state: permitState, number: l.permit_number ?? null, expiry: l.permit_expiry ?? null, daysLeft: pe.daysLeft, appliedAt: l.permitAppliedAt ?? null, waitingDays },
    live, alerts, level,
  };
}

/** Sort for the Compliance page: urgent first, then soonest expiry. */
export function byUrgency(a: Compliance, b: Compliance) {
  const rank = { bad: 0, warn: 1, ok: 2 } as const;
  const soon = (c: Compliance) => Math.min(c.permit.daysLeft ?? 9999, c.formA.daysLeft ?? 9999);
  return rank[a.level] - rank[b.level] || soon(a) - soon(b);
}
