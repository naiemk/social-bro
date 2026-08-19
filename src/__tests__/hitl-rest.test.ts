import { describe, expect, it } from "bun:test";
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
import { login, updateUser } from "../lib/auth.ts";
import {
  resetConfigCacheForTests,
} from "../lib/config.ts";

describe("HITL commands", () => {
  it("parses approve/reject/edit/status", () => {
    expect(parseHitlCommand("/approve tw-abc")).toEqual({
      type: "approve",
      id: "tw-abc",
    });
    expect(parseHitlCommand("/accept tw-abc")).toEqual({
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
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "social-ops-hitl-"));
    const previousData = process.env.SOCIAL_OPS_DATA_DIR;
    const previousIds = process.env.HITL_CHAT_IDS;
    process.env.SOCIAL_OPS_DATA_DIR = tmp;
    resetConfigCacheForTests();
    try {
      process.env.HITL_CHAT_IDS = "111,222";
      expect(isAllowlisted("111")).toBe(true);
      expect(isAllowlisted("999")).toBe(false);
      delete process.env.HITL_CHAT_IDS;
      expect(isAllowlisted("999")).toBe(true);
    } finally {
      if (previousIds === undefined) delete process.env.HITL_CHAT_IDS;
      else process.env.HITL_CHAT_IDS = previousIds;
      if (previousData === undefined) delete process.env.SOCIAL_OPS_DATA_DIR;
      else process.env.SOCIAL_OPS_DATA_DIR = previousData;
      resetConfigCacheForTests();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("allows linked dashboard Telegram ids even when HITL_CHAT_IDS is set", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "social-ops-hitl-"));
    const previousData = process.env.SOCIAL_OPS_DATA_DIR;
    const previousIds = process.env.HITL_CHAT_IDS;
    process.env.SOCIAL_OPS_DATA_DIR = tmp;
    process.env.HITL_CHAT_IDS = "111";
    process.env.DASHBOARD_USER = "main";
    process.env.DASHBOARD_PASSWORD = "changeme";
    resetConfigCacheForTests();
    try {
      login("main", "changeme");
      updateUser("user-main", { telegramId: "555001", telegramLinkedAt: new Date().toISOString() });
      expect(isAllowlisted("111")).toBe(true);
      expect(isAllowlisted("555001")).toBe(true);
      expect(isAllowlisted("999")).toBe(false);
    } finally {
      if (previousIds === undefined) delete process.env.HITL_CHAT_IDS;
      else process.env.HITL_CHAT_IDS = previousIds;
      if (previousData === undefined) delete process.env.SOCIAL_OPS_DATA_DIR;
      else process.env.SOCIAL_OPS_DATA_DIR = previousData;
      resetConfigCacheForTests();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
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
