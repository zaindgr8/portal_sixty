import { describe, expect, it } from "vitest";
import { resolveMethod } from "@/lib/proptech/publish";

const withFeed = { options: { propertyfinder: ["extension" as const], bayut: ["extension" as const, "feed" as const] }, defaults: { propertyfinder: "extension" as const, bayut: "feed" as const } };
const noFeed = { options: { propertyfinder: ["extension" as const], bayut: ["extension" as const] }, defaults: { propertyfinder: "extension" as const, bayut: "extension" as const } };

describe("how a portal is posted", () => {
  it("the Chrome extension is always available for PF and Bayut, even with the feed on", () => {
    expect(resolveMethod("bayut", withFeed, "extension")).toBe("extension");
    expect(resolveMethod("propertyfinder", withFeed, "extension")).toBe("extension");
  });
  it("uses the agency default when the agent doesn't choose", () => {
    expect(resolveMethod("bayut", withFeed)).toBe("feed");
    expect(resolveMethod("bayut", noFeed)).toBe("extension");
  });
  it("ignores a choice the portal doesn't offer (no feed, no API)", () => {
    expect(resolveMethod("bayut", noFeed, "feed")).toBe("extension");
    expect(resolveMethod("propertyfinder", noFeed, "api")).toBe("extension");
  });
  it("keeps a listing on the extension once it was posted that way", () => {
    expect(resolveMethod("bayut", withFeed, undefined, "ext:https://www.bayut.com/property/details-1.html")).toBe("extension");
    expect(resolveMethod("bayut", withFeed, undefined, "ext:pending")).toBe("extension");
    expect(resolveMethod("bayut", withFeed, "feed", "ext:pending")).toBe("feed"); // an explicit choice still wins
  });
});
