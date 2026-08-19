import fs from "node:fs";
import { ensureDir, resolveProjectData } from "./paths.ts";
import type { BillingActionKey } from "./config.ts";

export interface ActivityEvent {
  ts: string;
  projectId: string;
  jobId?: string;
  roleSlug: string;
  platform: string;
  action: BillingActionKey | "published" | "skip";
  kind?: string;
  queueItemId?: string;
  status: string;
  tokens: number;
  title: string;
  publicUrl?: string;
  note?: string;
  accountId?: string;
  accountHandle?: string;
}

function activityPath(projectId: string): string {
  return resolveProjectData(projectId, "activity.jsonl");
}

export function appendActivity(event: ActivityEvent): ActivityEvent {
  ensureDir(resolveProjectData(event.projectId));
  fs.appendFileSync(
    activityPath(event.projectId),
    `${JSON.stringify(event)}\n`,
  );
  return event;
}

export function listActivity(
  projectId: string,
  filters: { role?: string; platform?: string; from?: string } = {},
): ActivityEvent[] {
  const file = activityPath(projectId);
  if (!fs.existsSync(file)) return [];
  const rows = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as ActivityEvent;
      } catch {
        return null;
      }
    })
    .filter((row): row is ActivityEvent => Boolean(row));
  return rows
    .filter((row) => (filters.role ? row.roleSlug === filters.role : true))
    .filter((row) =>
      filters.platform ? row.platform === filters.platform : true,
    )
    .filter((row) => (filters.from ? row.ts >= filters.from : true))
    .reverse();
}

export function attachPublicUrl(
  projectId: string,
  queueItemId: string,
  publicUrl: string,
): void {
  const events = listActivity(projectId).reverse();
  const match = [...events]
    .reverse()
    .find((event) => event.queueItemId === queueItemId);
  if (!match) {
    appendActivity({
      ts: new Date().toISOString(),
      projectId,
      roleSlug: "unknown",
      platform: "twitter",
      action: "published",
      queueItemId,
      status: "published",
      tokens: 0,
      title: queueItemId,
      publicUrl,
    });
    return;
  }
  appendActivity({
    ...match,
    ts: new Date().toISOString(),
    action: "published",
    status: "published",
    tokens: 0,
    publicUrl,
    note: "Marked published",
  });
}

export function spentForProject(projectId: string): number {
  return listActivity(projectId).reduce(
    (sum, event) => sum + Math.max(0, event.tokens),
    0,
  );
}
