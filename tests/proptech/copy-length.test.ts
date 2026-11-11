import { describe, expect, it } from "vitest";
import { withLength } from "@/lib/proptech/copy";
import { DESC_MAX, DESC_MIN } from "@/lib/proptech/validate";

// A fake model answer whose assembled description is about `n` characters long.
const answer = (n: number) => ({
  ok: true as const, model: "test", costUsd: 0.001, tokens: 100,
  data: { title: "2BR Apartment | Marina View | Dubai Marina", hook: "A bright home with a view.", highlights: ["Two bedrooms", "Three bathrooms"], body: "x".repeat(Math.max(0, n - 70)) },
});

describe("description length correction", () => {
  it("keeps a first answer that is already in range, with one call", async () => {
    const asks: (string | undefined)[] = [];
    const r = await withLength(async (extra) => { asks.push(extra); return answer(1000); });
    expect(asks).toEqual([undefined]);
    expect(r.ok && r.copy.description.length).toBeGreaterThanOrEqual(DESC_MIN);
  });

  it("asks again with the real length when too short, and uses the fixed answer", async () => {
    const asks: (string | undefined)[] = [];
    const r = await withLength(async (extra) => { asks.push(extra); return answer(extra ? 1100 : 650); });
    expect(asks).toHaveLength(2);
    expect(asks[1]).toMatch(/was \d+ characters/);
    expect(r.ok && r.copy.description.length).toBeGreaterThanOrEqual(DESC_MIN);
    expect(r.costUsd).toBeCloseTo(0.002);
  });

  it("asks to shorten when too long", async () => {
    const asks: (string | undefined)[] = [];
    const r = await withLength(async (extra) => { asks.push(extra); return answer(extra ? 1200 : 1800); });
    expect(asks[1]).toMatch(/tighter/);
    expect(r.ok && r.copy.description.length).toBeLessThanOrEqual(DESC_MAX);
  });

  it("keeps the closer answer if the second try is worse, and stops after two calls", async () => {
    let calls = 0;
    const r = await withLength(async () => answer(++calls === 1 ? 700 : 400));
    expect(calls).toBe(2);
    expect(r.ok && r.copy.description.length).toBeGreaterThan(600); // the 700 one, not the 400 one
  });

  it("passes a failed call through", async () => {
    const r = await withLength(async () => ({ ok: false as const, error: "boom", model: "t", costUsd: 0, tokens: 0 }));
    expect(r.ok).toBe(false);
  });
});
