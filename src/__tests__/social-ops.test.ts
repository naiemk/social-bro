import { describe, expect, it } from "bun:test";
import contentQueuePlugin from "../plugins/content-queue.ts";
import opsPlugin from "../plugins/ops.ts";
import { twitterGuy } from "../characters/twitter-guy.ts";
import { tgGuy } from "../characters/tg-guy.ts";

describe("social-ops plugins", () => {
  it("registers queue and HITL actions", () => {
    const names =
      contentQueuePlugin.actions?.map((action) => action.name) || [];
    expect(names).toContain("QUEUE_DRAFT");
    expect(names).toContain("APPROVE_DRAFT");
    expect(names).toContain("REJECT_DRAFT");
    expect(names).toContain("LIST_AUTO");
  });

  it("registers ops actions and heartbeat service", () => {
    const names = opsPlugin.actions?.map((action) => action.name) || [];
    expect(names).toContain("OPS_STATUS");
    expect(names).toContain("PAUSE_AGENT");
    expect(opsPlugin.services?.length).toBeGreaterThan(0);
  });
});

describe("specialized characters", () => {
  it("keeps twitter guy off the official twitter plugin", () => {
    expect(twitterGuy.plugins).not.toContain("@elizaos/plugin-twitter");
    expect(twitterGuy.settings?.DRY_RUN).toBe(true);
  });

  it("makes tg guy the HITL desk", () => {
    expect(tgGuy.system).toContain("/approve");
    expect(tgGuy.plugins?.[0]).toBe("@elizaos/plugin-sql");
  });
});
