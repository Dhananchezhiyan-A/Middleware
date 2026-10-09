import { describe, expect, it } from "vitest";
import { isInternalMiddlewareFallback, routingFallbackInfo } from "./routing-fallback";

const NO_MATCH = "no rule matched; lead kept in Middleware. [INTERNAL_MIDDLEWARE]";
const MATCHED_NO_DESTINATION =
  "Rule matched but no valid external destination was available; lead kept in Middleware. [INTERNAL_MIDDLEWARE]";
const EXTERNAL = "matched rules: DCT rule (cmx123)";

describe("isInternalMiddlewareFallback", () => {
  it("recognises the stored marker", () => {
    expect(isInternalMiddlewareFallback(NO_MATCH)).toBe(true);
    expect(isInternalMiddlewareFallback(MATCHED_NO_DESTINATION)).toBe(true);
  });

  it("never flags a normal external routing decision", () => {
    expect(isInternalMiddlewareFallback(EXTERNAL)).toBe(false);
    expect(isInternalMiddlewareFallback("")).toBe(false);
    expect(isInternalMiddlewareFallback(null)).toBe(false);
    expect(isInternalMiddlewareFallback(undefined)).toBe(false);
  });

  it("recognises the pre-marker legacy wording for the same outcome", () => {
    // Rows written before the marker existed still mean "kept in Middleware".
    expect(isInternalMiddlewareFallback("no routing rule matched")).toBe(true);
    expect(isInternalMiddlewareFallback("  no routing rule matched  ")).toBe(true);
    // ...but only that exact wording — never a delivered fallback destination.
    expect(isInternalMiddlewareFallback('no rule matched; fallback destination: middleware')).toBe(
      false,
    );
  });
});

describe("routingFallbackInfo (lead details copy)", () => {
  it("reports 'no external destination matched' for an unmatched lead", () => {
    const info = routingFallbackInfo(NO_MATCH);
    expect(info.active).toBe(true);
    expect(info.ruleMatched).toBe(false);
    expect(info.heading).toBe("Fallback: Internal Middleware");
    expect(info.title).toBe("No external destination matched.");
    expect(info.description).toBe("The lead remains in Middleware.");
  });

  it("reports 'rule matched but no valid destination' without implying delivery", () => {
    const info = routingFallbackInfo(MATCHED_NO_DESTINATION);
    expect(info.active).toBe(true);
    expect(info.ruleMatched).toBe(true);
    expect(info.heading).toBe("Fallback: Internal Middleware");
    expect(info.title).toBe(
      "Rule matched, but no valid external destination was available.",
    );
    expect(info.description).toBe("The lead remains in Middleware.");
  });

  it("stays inactive for external routing decisions", () => {
    const info = routingFallbackInfo(EXTERNAL);
    expect(info.active).toBe(false);
    expect(info.ruleMatched).toBe(false);
    expect(info.title).toBe("");
    expect(info.description).toBe("");
  });

  it("explains pre-marker legacy rows with the same copy", () => {
    const info = routingFallbackInfo("no routing rule matched");
    expect(info.active).toBe(true);
    expect(info.ruleMatched).toBe(false);
    expect(info.heading).toBe("Fallback: Internal Middleware");
    expect(info.title).toBe("No external destination matched.");
    expect(info.description).toBe("The lead remains in Middleware.");
  });

  it("is safe on missing reasons", () => {
    expect(routingFallbackInfo(null).active).toBe(false);
    expect(routingFallbackInfo(undefined).active).toBe(false);
    expect(routingFallbackInfo("").active).toBe(false);
  });
});
