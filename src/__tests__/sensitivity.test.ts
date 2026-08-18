import { describe, expect, it } from "bun:test";
import { inferKind, scoreContent } from "../lib/sensitivity.ts";

describe("sensitivity scores", () => {
  it("auto-approves a bland comment/reply", () => {
    const scored = scoreContent({
      platform: "replies",
      body: "Reply: nice writeup, the changelog example helped.",
    });
    expect(scored.kind).toBe("reply");
    expect(scored.level).toBe("low");
    expect(scored.autoApprove).toBe(true);
    expect(scored.total).toBeLessThanOrEqual(35);
  });

  it("holds original posts even when the copy is clean", () => {
    const scored = scoreContent({
      platform: "twitter",
      body: "Draft a tweet about the new onboarding flow. We made the slow path the default.",
    });
    expect(scored.kind).toBe("post");
    expect(scored.autoApprove).toBe(false);
  });

  it("holds refund or legal comments", () => {
    const scored = scoreContent({
      platform: "replies",
      body: "Reply: we can refund you today, guaranteed, no lawsuit needed.",
    });
    expect(scored.kind).toBe("reply");
    expect(scored.flags).toContain("legal-or-finance");
    expect(scored.autoApprove).toBe(false);
    expect(scored.level === "high" || scored.level === "critical").toBe(true);
  });

  it("always holds follow-back lists", () => {
    const scored = scoreContent({
      platform: "twitter",
      body: "Follow back these accounts: alice, bob",
    });
    expect(scored.kind).toBe("follow-back");
    expect(scored.autoApprove).toBe(false);
  });

  it("infers reply vs post from wording", () => {
    expect(inferKind("twitter", "comment on that thread: congrats")).toBe(
      "reply",
    );
    expect(inferKind("twitter", "launch tweet")).toBe("post");
  });
});
