import fs from "node:fs";
import path from "node:path";

export function getDataRoot(): string {
  return process.env.SOCIAL_OPS_DATA_DIR || process.cwd();
}

export function resolveData(...segments: string[]): string {
  return path.join(getDataRoot(), ...segments);
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export const QUEUE_STATES = [
  "pending",
  "approved",
  "rejected",
  "published",
] as const;
export type QueueState = (typeof QUEUE_STATES)[number];

export const PLATFORMS = [
  "twitter",
  "instagram",
  "youtube",
  "blog",
  "replies",
  "support",
] as const;
export type Platform = (typeof PLATFORMS)[number];
