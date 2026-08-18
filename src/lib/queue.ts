import fs from "node:fs";
import path from "node:path";
import {
  ensureDir,
  type Platform,
  type QueueState,
  resolveData,
} from "./paths.ts";

export interface QueueItem {
  id: string;
  agent: string;
  platform: Platform | string;
  status: QueueState;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  risk?: string;
  notes?: string;
  media?: string[];
  filePath: string;
}

const FRONT_MATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function queueDir(status: QueueState, platform?: string): string {
  return platform
    ? resolveData("content-queue", status, platform)
    : resolveData("content-queue", status);
}

function parseFrontMatter(raw: string): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }
  return meta;
}

function serializeItem(item: Omit<QueueItem, "filePath">): string {
  const media = (item.media || []).join(",");
  return `---
id: ${item.id}
agent: ${item.agent}
platform: ${item.platform}
status: ${item.status}
title: ${JSON.stringify(item.title)}
createdAt: ${item.createdAt}
updatedAt: ${item.updatedAt}
risk: ${JSON.stringify(item.risk || "normal")}
notes: ${JSON.stringify(item.notes || "")}
media: ${JSON.stringify(media)}
---

${item.body.trim()}\n`;
}

function parseFile(filePath: string, status: QueueState): QueueItem | null {
  if (!fs.existsSync(filePath) || !filePath.endsWith(".md")) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  const match = raw.match(FRONT_MATTER_RE);
  if (!match) return null;
  const meta = parseFrontMatter(match[1]);
  const mediaRaw = meta.media || "";
  return {
    id: meta.id,
    agent: meta.agent,
    platform: meta.platform,
    status: (meta.status as QueueState) || status,
    title: meta.title || meta.id,
    body: match[2].trim(),
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt || meta.createdAt,
    risk: meta.risk,
    notes: meta.notes,
    media: mediaRaw ? mediaRaw.split(",").filter(Boolean) : [],
    filePath,
  };
}

export function createItemId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${rand}`;
}

export function ensureQueueLayout(): void {
  const platforms = [
    "twitter",
    "instagram",
    "youtube",
    "blog",
    "replies",
    "support",
  ];
  for (const status of [
    "pending",
    "approved",
    "rejected",
    "published",
  ] as QueueState[]) {
    for (const platform of platforms) {
      ensureDir(queueDir(status, platform));
      const keep = path.join(queueDir(status, platform), ".gitkeep");
      if (!fs.existsSync(keep)) fs.writeFileSync(keep, "");
    }
  }
}

export function draftItem(input: {
  agent: string;
  platform: Platform | string;
  title: string;
  body: string;
  risk?: string;
  media?: string[];
  prefix?: string;
}): QueueItem {
  ensureQueueLayout();
  const now = new Date().toISOString();
  const id = createItemId(input.prefix || input.platform.slice(0, 2));
  const item: Omit<QueueItem, "filePath"> = {
    id,
    agent: input.agent,
    platform: input.platform,
    status: "pending",
    title: input.title,
    body: input.body,
    createdAt: now,
    updatedAt: now,
    risk: input.risk || "normal",
    notes: "",
    media: input.media || [],
  };
  const filePath = path.join(
    queueDir("pending", String(input.platform)),
    `${id}.md`,
  );
  fs.writeFileSync(filePath, serializeItem(item));
  return { ...item, filePath };
}

export function listQueue(status?: QueueState, platform?: string): QueueItem[] {
  ensureQueueLayout();
  const states: QueueState[] = status
    ? [status]
    : ["pending", "approved", "rejected", "published"];
  const items: QueueItem[] = [];
  for (const st of states) {
    const dir = platform
      ? queueDir(st, platform)
      : resolveData("content-queue", st);
    if (!fs.existsSync(dir)) continue;
    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else {
          const parsed = parseFile(full, st);
          if (parsed) items.push(parsed);
        }
      }
    };
    walk(dir);
  }
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getItem(id: string): QueueItem | null {
  return listQueue().find((item) => item.id === id) || null;
}

export function moveItem(
  id: string,
  nextStatus: QueueState,
  notes?: string,
): QueueItem {
  const item = getItem(id);
  if (!item) {
    throw new Error(`Queue item not found: ${id}`);
  }
  const updated: Omit<QueueItem, "filePath"> = {
    ...item,
    status: nextStatus,
    notes: notes ?? item.notes,
    updatedAt: new Date().toISOString(),
  };
  const dest = path.join(
    queueDir(nextStatus, String(item.platform)),
    `${item.id}.md`,
  );
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, serializeItem(updated));
  if (item.filePath !== dest && fs.existsSync(item.filePath)) {
    fs.unlinkSync(item.filePath);
  }
  return { ...updated, filePath: dest };
}

export function formatQueueList(items: QueueItem[], limit = 15): string {
  if (items.length === 0) return "Queue is empty.";
  return items
    .slice(0, limit)
    .map(
      (item) =>
        `- ${item.id} [${item.status}/${item.platform}] ${item.title} (agent: ${item.agent})`,
    )
    .join("\n");
}
