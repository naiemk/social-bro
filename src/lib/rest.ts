import fs from "node:fs";
import type { IAgentRuntime } from "@elizaos/core";
import { ensureDir, resolveData } from "./paths.ts";

export interface RestConfig {
  slug: string;
  quietHours: string;
  restTz: string;
  restDays: string[];
  dailyDraftCap: number;
  cooldownMinutes: number;
}

export interface RestDecision {
  allowed: boolean;
  reason?: string;
  resting: boolean;
  paused: boolean;
}

function setting(
  runtime: IAgentRuntime | null,
  key: string,
  fallback: string,
): string {
  if (runtime) {
    const value = runtime.getSetting(key);
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return String(value);
    }
  }
  const env = process.env[key];
  return env && env.trim() !== "" ? env : fallback;
}

export function agentSlug(runtime: IAgentRuntime): string {
  return setting(
    runtime,
    "AGENT_SLUG",
    runtime.character.username || runtime.character.name,
  )
    .toLowerCase()
    .replace(/\s+/g, "-");
}

export function getRestConfig(runtime: IAgentRuntime): RestConfig {
  const restDays = setting(runtime, "REST_DAYS", "")
    .split(",")
    .map((day) => day.trim())
    .filter(Boolean);
  return {
    slug: agentSlug(runtime),
    quietHours: setting(
      runtime,
      "QUIET_HOURS",
      process.env.QUIET_HOURS || "22:00-08:00",
    ),
    restTz: setting(runtime, "REST_TZ", process.env.REST_TZ || "UTC"),
    restDays,
    dailyDraftCap: Number(setting(runtime, "DAILY_DRAFT_CAP", "8")),
    cooldownMinutes: Number(setting(runtime, "COOLDOWN_MINUTES", "15")),
  };
}

function pausedPath(): string {
  return resolveData("ops", "paused.json");
}

function usagePath(): string {
  return resolveData("ops", "usage.json");
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function isPaused(slug: string): boolean {
  const paused = readJson<Record<string, boolean>>(pausedPath(), {});
  return Boolean(paused[slug]);
}

export function setPaused(slug: string, paused: boolean): void {
  ensureDir(resolveData("ops"));
  const current = readJson<Record<string, boolean>>(pausedPath(), {});
  if (paused) current[slug] = true;
  else delete current[slug];
  fs.writeFileSync(pausedPath(), JSON.stringify(current, null, 2));
}

function zonedParts(timeZone: string): {
  weekday: string;
  hours: number;
  minutes: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value || "0";
  return {
    weekday: get("weekday"),
    hours: Number(get("hour") === "24" ? "0" : get("hour")),
    minutes: Number(get("minute")),
  };
}

export function isQuietHours(
  quietHours: string,
  timeZone: string,
  restDays: string[],
): boolean {
  const now = zonedParts(timeZone);
  if (restDays.some((day) => day.toLowerCase() === now.weekday.toLowerCase())) {
    return true;
  }
  const [start, end] = quietHours.split("-");
  if (!start || !end) return false;
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const current = now.hours * 60 + now.minutes;
  const startMin = toMin(start);
  const endMin = toMin(end);
  if (startMin === endMin) return false;
  if (startMin < endMin) return current >= startMin && current < endMin;
  return current >= startMin || current < endMin;
}

export function recordDraft(slug: string): void {
  ensureDir(resolveData("ops"));
  const usage = readJson<
    Record<string, { date: string; count: number; lastAt: number }>
  >(usagePath(), {});
  const today = new Date().toISOString().slice(0, 10);
  const current = usage[slug];
  if (!current || current.date !== today) {
    usage[slug] = { date: today, count: 1, lastAt: Date.now() };
  } else {
    usage[slug] = { date: today, count: current.count + 1, lastAt: Date.now() };
  }
  fs.writeFileSync(usagePath(), JSON.stringify(usage, null, 2));
}

export function getUsage(slug: string): {
  date: string;
  count: number;
  lastAt: number;
} {
  const usage = readJson<
    Record<string, { date: string; count: number; lastAt: number }>
  >(usagePath(), {});
  const today = new Date().toISOString().slice(0, 10);
  const current = usage[slug];
  if (!current || current.date !== today)
    return { date: today, count: 0, lastAt: 0 };
  return current;
}

export function canDraft(
  runtime: IAgentRuntime,
  kind: "draft" | "p0" = "draft",
): RestDecision {
  const config = getRestConfig(runtime);
  if (isPaused(config.slug)) {
    return {
      allowed: false,
      paused: true,
      resting: false,
      reason: `${config.slug} is paused`,
    };
  }
  const resting = isQuietHours(
    config.quietHours,
    config.restTz,
    config.restDays,
  );
  if (resting && kind !== "p0") {
    return {
      allowed: false,
      paused: false,
      resting: true,
      reason: `${config.slug} is resting (quiet hours ${config.quietHours} ${config.restTz})`,
    };
  }
  const usage = getUsage(config.slug);
  if (usage.count >= config.dailyDraftCap) {
    return {
      allowed: false,
      paused: false,
      resting,
      reason: `${config.slug} hit daily cap ${config.dailyDraftCap}`,
    };
  }
  if (
    usage.lastAt &&
    Date.now() - usage.lastAt < config.cooldownMinutes * 60 * 1000
  ) {
    return {
      allowed: false,
      paused: false,
      resting,
      reason: `${config.slug} is in cooldown (${config.cooldownMinutes}m)`,
    };
  }
  return { allowed: true, paused: false, resting };
}
