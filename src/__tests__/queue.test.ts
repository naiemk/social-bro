import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { draftItem, getItem, listQueue, moveItem } from "../lib/queue.ts";

describe("content queue", () => {
  let tmp: string;
  let previous: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "social-ops-"));
    previous = process.env.SOCIAL_OPS_DATA_DIR;
    process.env.SOCIAL_OPS_DATA_DIR = tmp;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.SOCIAL_OPS_DATA_DIR;
    else process.env.SOCIAL_OPS_DATA_DIR = previous;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("creates pending drafts and moves them through HITL states", () => {
    const item = draftItem({
      agent: "twitter-guy",
      platform: "twitter",
      title: "Launch note",
      body: "We shipped a small fix.",
    });
    expect(item.status).toBe("pending");
    expect(listQueue("pending")).toHaveLength(1);

    const approved = moveItem(item.id, "approved");
    expect(approved.status).toBe("approved");
    expect(getItem(item.id)?.status).toBe("approved");
    expect(listQueue("pending")).toHaveLength(0);

    moveItem(item.id, "published");
    expect(getItem(item.id)?.status).toBe("published");
  });

  it("auto-approved drafts land in approved, not pending", () => {
    const item = draftItem({
      agent: "twitter-guy",
      platform: "replies",
      title: "Nice thread",
      body: "Congrats on the ship.",
      autoApproved: true,
      sensitivity: 12,
      sensitivityLevel: "low",
      kind: "reply",
    });
    expect(item.status).toBe("approved");
    expect(item.autoApproved).toBe(true);
    expect(listQueue("pending")).toHaveLength(0);
    expect(listQueue("approved")).toHaveLength(1);
  });

  it("stores reject reasons", () => {
    const item = draftItem({
      agent: "blog-guy",
      platform: "blog",
      title: "Post",
      body: "Too salesy draft",
    });
    const rejected = moveItem(item.id, "rejected", "too salesy");
    expect(rejected.notes).toBe("too salesy");
  });
});
