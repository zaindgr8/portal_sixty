import { describe, expect, it } from "vitest";
import { complianceFor, daysUntil, byUrgency, WARN_DAYS } from "@/lib/proptech/compliance";
import { readPermit } from "@/lib/proptech/schema";

const today = new Date(2026, 10, 15); // 15 Nov 2026
const base = { permit_number: null, permit_expiry: null, form_a_number: "FA-1", form_a_expiry: "2027-03-01", permitAppliedAt: null } as const;
const none: never[] = [];

describe("compliance: Form A → permit → live", () => {
  it("counts days to an expiry date, valid through the day itself", () => {
    expect(daysUntil("2026-11-15", today)).toBe(0);
    expect(daysUntil("2026-11-16", today)).toBe(1);
    expect(daysUntil("2026-11-14", today)).toBe(-1);
    expect(daysUntil(null, today)).toBeNull();
  });

  it("walks through the stages", () => {
    expect(complianceFor({ ...base, form_a_number: null, form_a_expiry: null }, { hasFormA: false, portals: none, today }).stage).toBe("form_a");
    expect(complianceFor(base, { hasFormA: true, portals: none, today }).stage).toBe("apply");
    expect(complianceFor({ ...base, permitAppliedAt: "2026-11-14T09:00:00Z" }, { hasFormA: true, portals: none, today }).stage).toBe("waiting");
    const withPermit = { ...base, permit_number: "7123456789", permit_expiry: "2027-02-01" };
    expect(complianceFor(withPermit, { hasFormA: true, portals: none, today }).stage).toBe("ready");
    const live = complianceFor(withPermit, { hasFormA: true, portals: [{ portal: "bayut", status: "live" }], today });
    expect(live.stage).toBe("live");
    expect(live.level).toBe("ok");
  });

  it(`warns ${WARN_DAYS} days before a permit runs out, and it's urgent while live`, () => {
    const soon = { ...base, permit_number: "7123456789", permit_expiry: "2026-11-25" };
    const offline = complianceFor(soon, { hasFormA: true, portals: none, today });
    expect(offline.permit.state).toBe("expiring");
    expect(offline.level).toBe("warn");
    const live = complianceFor(soon, { hasFormA: true, portals: [{ portal: "propertyfinder", status: "live" }], today });
    expect(live.level).toBe("bad");
    expect(live.alerts[0].text).toMatch(/in 10 days/);
  });

  it("an expired permit on a live listing is urgent and says take it down", () => {
    const c = complianceFor({ ...base, permit_number: "7123456789", permit_expiry: "2026-11-01" }, { hasFormA: true, portals: [{ portal: "bayut", status: "live" }], today });
    expect(c.permit.state).toBe("expired");
    expect(c.level).toBe("bad");
    expect(c.alerts.map((a) => a.kind)).toContain("permit_expired_live");
    expect(c.stage).not.toBe("live");
  });

  it("nudges after waiting a few days for a permit", () => {
    const c = complianceFor({ ...base, permitAppliedAt: "2026-11-10T09:00:00Z" }, { hasFormA: true, portals: none, today });
    expect(c.permit.waitingDays).toBe(5);
    expect(c.alerts.map((a) => a.kind)).toContain("permit_waiting");
  });

  it("flags an expired Form A and a permit that outlives its Form A", () => {
    expect(complianceFor({ ...base, form_a_expiry: "2026-10-01" }, { hasFormA: true, portals: none, today }).alerts.map((a) => a.kind)).toContain("form_a_expired");
    const c = complianceFor({ ...base, form_a_expiry: "2026-12-31", permit_number: "7123456789", permit_expiry: "2027-06-30" }, { hasFormA: true, portals: none, today });
    expect(c.alerts.map((a) => a.kind)).toContain("permit_after_form_a");
  });

  it("sorts the most urgent first", () => {
    const ok = complianceFor({ ...base, permit_number: "7123456789", permit_expiry: "2027-02-01" }, { hasFormA: true, portals: none, today });
    const bad = complianceFor({ ...base, permit_number: "7123456789", permit_expiry: "2026-11-01" }, { hasFormA: true, portals: [{ portal: "bayut", status: "live" }], today });
    expect([ok, bad].sort(byUrgency)[0]).toBe(bad);
  });
});

describe("reading a Trakheesi permit document", () => {
  it("keeps a real-looking number and a day-first date", () => {
    expect(readPermit({ number: "71234 56789", expiry: "30/06/2027" })).toEqual({ number: "7123456789", expiry: "2027-06-30" });
  });
  it("ignores junk", () => {
    expect(readPermit({ number: "n/a" })).toBeNull();
    expect(readPermit(undefined)).toBeNull();
  });
});
