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
  kind?: string;
  sensitivity?: number;
  sensitivityLevel?: string;
  flags?: string[];
  autoApproved?: boolean;
  projectId?: string;
  jobId?: string;
  tokens?: number;
  publicUrl?: string;
  accountId?: string;
  accountHandle?: string;
  filePath: string;
}

const FRONT_MATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function queueDir(
  status: QueueState,
  platform?: string,
  projectId?: string,
): string {
  const root = projectId
    ? ["projects", projectId, "content-queue"]
    : ["content-queue"];
  return platform
    ? resolveData(...root, status, platform)
    : resolveData(...root, status);
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
kind: ${item.kind || "post"}
sensitivity: ${item.sensitivity ?? ""}
sensitivityLevel: ${item.sensitivityLevel || ""}
flags: ${JSON.stringify((item.flags || []).join(","))}
autoApproved: ${item.autoApproved ? "true" : "false"}
projectId: ${item.projectId || ""}
jobId: ${item.jobId || ""}
tokens: ${item.tokens ?? ""}
publicUrl: ${JSON.stringify(item.publicUrl || "")}
accountId: ${item.accountId || ""}
accountHandle: ${JSON.stringify(item.accountHandle || "")}
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
    kind: meta.kind,
    sensitivity: meta.sensitivity ? Number(meta.sensitivity) : undefined,
    sensitivityLevel: meta.sensitivityLevel,
    flags: meta.flags ? meta.flags.split(",").filter(Boolean) : [],
    autoApproved: meta.autoApproved === "true",
    projectId: meta.projectId || undefined,
    jobId: meta.jobId || undefined,
    tokens: meta.tokens ? Number(meta.tokens) : undefined,
    publicUrl: meta.publicUrl || undefined,
    accountId: meta.accountId || undefined,
    accountHandle: meta.accountHandle || undefined,
    filePath,
  };
}

export function createItemId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${rand}`;
}

export function ensureQueueLayout(projectId?: string): void {
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
      const dir = queueDir(status, platform, projectId);
      ensureDir(dir);
      const keep = path.join(dir, ".gitkeep");
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
  kind?: string;
  sensitivity?: number;
  sensitivityLevel?: string;
  flags?: string[];
  autoApproved?: boolean;
  notes?: string;
  projectId?: string;
  jobId?: string;
  tokens?: number;
  publicUrl?: string;
  accountId?: string;
  accountHandle?: string;
}): QueueItem {
  ensureQueueLayout(input.projectId);
  const now = new Date().toISOString();
  const id = createItemId(input.prefix || input.platform.slice(0, 2));
  const status: QueueState = input.autoApproved ? "approved" : "pending";
  const item: Omit<QueueItem, "filePath"> = {
    id,
    agent: input.agent,
    platform: input.platform,
    status,
    title: input.title,
    body: input.body,
    createdAt: now,
    updatedAt: now,
    risk: input.risk || (input.autoApproved ? "auto" : "needs-human-confirm"),
    notes: input.notes || "",
    media: input.media || [],
    kind: input.kind,
    sensitivity: input.sensitivity,
    sensitivityLevel: input.sensitivityLevel,
    flags: input.flags || [],
    autoApproved: Boolean(input.autoApproved),
    projectId: input.projectId,
    jobId: input.jobId,
    tokens: input.tokens,
    publicUrl: input.publicUrl,
    accountId: input.accountId,
    accountHandle: input.accountHandle,
  };
  const filePath = path.join(
    queueDir(status, String(input.platform), input.projectId),
    `${id}.md`,
  );
  fs.writeFileSync(filePath, serializeItem(item));
  return { ...item, filePath };
}

function walkQueueDir(
  dir: string,
  status: QueueState,
  items: QueueItem[],
): void {
  if (!fs.existsSync(dir)) return;
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const parsed = parseFile(full, status);
        if (parsed) items.push(parsed);
      }
    }
  };
  walk(dir);
}

export function listQueue(
  status?: QueueState,
  platform?: string,
  projectId?: string,
): QueueItem[] {
  ensureQueueLayout(projectId);
  const states: QueueState[] = status
    ? [status]
    : ["pending", "approved", "rejected", "published"];
  const items: QueueItem[] = [];
  for (const st of states) {
    if (projectId) {
      walkQueueDir(queueDir(st, platform, projectId), st, items);
      continue;
    }
    const dir = platform
      ? queueDir(st, platform)
      : resolveData("content-queue", st);
    walkQueueDir(dir, st, items);
    const projectsRoot = resolveData("projects");
    if (fs.existsSync(projectsRoot)) {
      for (const entry of fs.readdirSync(projectsRoot, {
        withFileTypes: true,
      })) {
        if (!entry.isDirectory()) continue;
        walkQueueDir(queueDir(st, platform, entry.name), st, items);
      }
    }
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
    queueDir(nextStatus, String(item.platform), item.projectId),
    `${item.id}.md`,
  );
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, serializeItem(updated));
  if (item.filePath !== dest && fs.existsSync(item.filePath)) {
    fs.unlinkSync(item.filePath);
  }
  return { ...updated, filePath: dest };
}

export function markPublished(id: string, publicUrl?: string): QueueItem {
  const item = getItem(id);
  if (!item) throw new Error(`Queue item not found: ${id}`);
  const moved = moveItem(id, "published", item.notes);
  if (!publicUrl) return moved;
  const updated: Omit<QueueItem, "filePath"> = {
    ...moved,
    publicUrl,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(moved.filePath, serializeItem(updated));
  return { ...updated, filePath: moved.filePath };
}

export function formatQueueList(items: QueueItem[], limit = 15): string {
  if (items.length === 0) return "Queue is empty.";
  return items
    .slice(0, limit)
    .map((item) => {
      const score =
        item.sensitivity === undefined
          ? ""
          : ` score=${item.sensitivity} ${item.sensitivityLevel || ""}`;
      const gate = item.autoApproved
        ? " AUTO"
        : item.status === "pending"
          ? " HOLD"
          : "";
      return `- ${item.id} [${item.status}/${item.kind || item.platform}]${score}${gate} ${item.title}`;
    })
    .join("\n");
}
