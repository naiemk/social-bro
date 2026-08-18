import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isQuietHours,
  setPaused,
  isPaused,
  getUsage,
  recordDraft,
} from "../lib/rest.ts";
import { parseHitlCommand, isAllowlisted } from "../lib/hitl.ts";

describe("HITL commands", () => {
  it("parses approve/reject/edit/status", () => {
    expect(parseHitlCommand("/approve tw-abc")).toEqual({
      type: "approve",
      id: "tw-abc",
    });
    expect(parseHitlCommand("/reject tw-abc too salesy")).toEqual({
      type: "reject",
      id: "tw-abc",
      reason: "too salesy",
    });
    expect(parseHitlCommand("/edit tw-abc shorter")).toEqual({
      type: "edit",
      id: "tw-abc",
      notes: "shorter",
    });
    expect(parseHitlCommand("/status twitter-guy")).toEqual({
      type: "status",
      slug: "twitter-guy",
    });
    expect(parseHitlCommand("/auto")).toEqual({ type: "auto" });
    expect(parseHitlCommand("hello")).toBeNull();
  });

  it("allowlists chats when HITL_CHAT_IDS is set", () => {
    const previous = process.env.HITL_CHAT_IDS;
    process.env.HITL_CHAT_IDS = "111,222";
    expect(isAllowlisted("111")).toBe(true);
    expect(isAllowlisted("999")).toBe(false);
    delete process.env.HITL_CHAT_IDS;
    expect(isAllowlisted("999")).toBe(true);
    if (previous !== undefined) process.env.HITL_CHAT_IDS = previous;
  });
});

describe("rest windows", () => {
  it("detects overnight quiet hours", () => {
    expect(isQuietHours("00:00-23:59", "UTC", [])).toBe(true);
    expect(isQuietHours("23:59-23:59", "UTC", [])).toBe(false);
  });

  it("pauses agents and tracks daily usage", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "social-ops-rest-"));
    const previous = process.env.SOCIAL_OPS_DATA_DIR;
    process.env.SOCIAL_OPS_DATA_DIR = tmp;
    try {
      expect(isPaused("twitter-guy")).toBe(false);
      setPaused("twitter-guy", true);
      expect(isPaused("twitter-guy")).toBe(true);
      setPaused("twitter-guy", false);
      expect(isPaused("twitter-guy")).toBe(false);
      recordDraft("twitter-guy");
      expect(getUsage("twitter-guy").count).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.SOCIAL_OPS_DATA_DIR;
      else process.env.SOCIAL_OPS_DATA_DIR = previous;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
