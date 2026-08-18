import fs from "node:fs";
import { ensureDir, resolveData } from "./paths.ts";
import { listQueue } from "./queue.ts";
import { getUsage, isPaused, isQuietHours } from "./rest.ts";

export interface AgentSnapshot {
  slug: string;
  name: string;
  state: "running" | "stopped" | "resting" | "paused" | "error";
  lastActionAt: string | null;
  lastError: string | null;
  pending: number;
  approved: number;
  rejected: number;
  draftsToday: number;
  dailyCap: number;
  quietHours: string;
  updatedAt: string;
}

export interface OpsStatus {
  updatedAt: string;
  agents: Record<string, AgentSnapshot>;
  alerts: string[];
}

function statusPath(): string {
  return resolveData("ops", "status.json");
}

export function readOpsStatus(): OpsStatus {
  try {
    if (!fs.existsSync(statusPath())) {
      return { updatedAt: new Date().toISOString(), agents: {}, alerts: [] };
    }
    return JSON.parse(fs.readFileSync(statusPath(), "utf8")) as OpsStatus;
  } catch {
    return { updatedAt: new Date().toISOString(), agents: {}, alerts: [] };
  }
}

export function writeAgentSnapshot(snapshot: AgentSnapshot): OpsStatus {
  ensureDir(resolveData("ops"));
  const status = readOpsStatus();
  status.agents[snapshot.slug] = snapshot;
  status.updatedAt = new Date().toISOString();
  status.alerts = buildAlerts(status.agents);
  fs.writeFileSync(statusPath(), JSON.stringify(status, null, 2));
  return status;
}

function buildAlerts(agents: Record<string, AgentSnapshot>): string[] {
  const alerts: string[] = [];
  const staleMs =
    Number(process.env.STALE_PENDING_HOURS || "6") * 60 * 60 * 1000;
  const pending = listQueue("pending");
  for (const item of pending) {
    const age = Date.now() - new Date(item.createdAt).getTime();
    if (age > staleMs) {
      alerts.push(`Stale pending ${item.id} (${item.platform})`);
    }
  }
  for (const snapshot of Object.values(agents)) {
    if (snapshot.state === "error" && snapshot.lastError) {
      alerts.push(`${snapshot.slug}: ${snapshot.lastError}`);
    }
    if (snapshot.draftsToday >= snapshot.dailyCap) {
      alerts.push(`${snapshot.slug} hit daily cap`);
    }
  }
  return [...new Set(alerts)].slice(0, 20);
}

export function formatOpsStatus(status: OpsStatus, slug?: string): string {
  const agents = slug
    ? Object.values(status.agents).filter((agent) => agent.slug === slug)
    : Object.values(status.agents);
  if (agents.length === 0) {
    return slug
      ? `No monitor data for ${slug} yet.`
      : "No agents have reported status yet.";
  }
  const lines = agents.map((agent) => {
    return [
      `${agent.name} (${agent.slug}): ${agent.state}`,
      `  queue pending=${agent.pending} approved=${agent.approved} rejected=${agent.rejected}`,
      `  drafts today ${agent.draftsToday}/${agent.dailyCap} quiet=${agent.quietHours}`,
      `  last action ${agent.lastActionAt || "n/a"}`,
      agent.lastError ? `  last error ${agent.lastError}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });
  const alerts = status.alerts.length
    ? `\nAlerts:\n- ${status.alerts.join("\n- ")}`
    : "\nNo alerts.";
  return `Ops ${status.updatedAt}\n\n${lines.join("\n\n")}${alerts}`;
}

export function snapshotFromRuntime(input: {
  slug: string;
  name: string;
  quietHours: string;
  restTz: string;
  restDays: string[];
  dailyCap: number;
  lastError?: string | null;
}): AgentSnapshot {
  const usage = getUsage(input.slug);
  const paused = isPaused(input.slug);
  const resting = isQuietHours(input.quietHours, input.restTz, input.restDays);
  let state: AgentSnapshot["state"] = "running";
  if (input.lastError) state = "error";
  else if (paused) state = "paused";
  else if (resting) state = "resting";
  const pending = listQueue("pending").filter(
    (item) => item.agent === input.slug,
  ).length;
  const approved = listQueue("approved").filter(
    (item) => item.agent === input.slug,
  ).length;
  const rejected = listQueue("rejected").filter(
    (item) => item.agent === input.slug,
  ).length;
  return {
    slug: input.slug,
    name: input.name,
    state,
    lastActionAt: usage.lastAt ? new Date(usage.lastAt).toISOString() : null,
    lastError: input.lastError || null,
    pending,
    approved,
    rejected,
    draftsToday: usage.count,
    dailyCap: input.dailyCap,
    quietHours: input.quietHours,
    updatedAt: new Date().toISOString(),
  };
}
