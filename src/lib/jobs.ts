import crypto from "node:crypto";
import fs from "node:fs";
import { appendActivity } from "./activity.ts";
import {
  billingActionForKind,
  getBalance,
  trySpend,
  type SpendResult,
} from "./billing.ts";
import { scoreContent } from "./sensitivity.ts";
import {
  ensureDir,
  readJsonFile,
  resolveProjectData,
  writeJsonFile,
} from "./paths.ts";
import {
  accountSkipReason,
  resolveAccountForRole,
  type SocialAccount,
} from "./accounts.ts";
import { getProject, updateProject } from "./projects.ts";
import { draftItem, type QueueItem } from "./queue.ts";
import { listRoles, type SocialRole } from "./roles-store.ts";

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "stopped_no_credits"
  | "failed"
  | "stopped";

export interface Job {
  id: string;
  projectId: string;
  ownerUserId: string;
  roleSlugs: string[];
  brief: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  produced: string[];
  tokensSpent: number;
}

function jobsDir(projectId: string): string {
  return resolveProjectData(projectId, "jobs");
}

function jobPath(projectId: string, jobId: string): string {
  return resolveProjectData(projectId, "jobs", `${jobId}.json`);
}

function usagePath(projectId: string): string {
  return resolveProjectData(projectId, "ops", "usage.json");
}

function pausedPath(projectId: string): string {
  return resolveProjectData(projectId, "ops", "paused.json");
}

export function listJobs(projectId: string): Job[] {
  const dir = jobsDir(projectId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(fs.readFileSync(`${dir}/${name}`, "utf8")) as Job)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getJob(projectId: string, jobId: string): Job | null {
  const file = jobPath(projectId, jobId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as Job;
}

function saveJob(job: Job): Job {
  ensureDir(jobsDir(job.projectId));
  job.updatedAt = new Date().toISOString();
  writeJsonFile(jobPath(job.projectId, job.id), job);
  return job;
}

export function createJob(input: {
  projectId: string;
  ownerUserId: string;
  roleSlugs?: string[];
  brief?: string;
}): Job {
  const project = getProject(input.projectId);
  if (!project) throw new Error("Project not found");
  const roles = listRoles(input.projectId).filter((role) => role.enabled);
  const selected = input.roleSlugs?.length
    ? roles.filter((role) => input.roleSlugs!.includes(role.slug))
    : roles;
  if (selected.length === 0) throw new Error("No enabled roles to run");
  if (getBalance(input.ownerUserId) <= 0) {
    throw new Error(
      "No credits remaining. Grant or buy tokens before running.",
    );
  }
  const job: Job = {
    id: `job-${crypto.randomBytes(4).toString("hex")}`,
    projectId: input.projectId,
    ownerUserId: input.ownerUserId,
    roleSlugs: selected.map((role) => role.slug),
    brief: (input.brief || project.brief || "").trim(),
    status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    produced: [],
    tokensSpent: 0,
  };
  saveJob(job);
  return job;
}

export function stopJob(projectId: string, jobId: string): Job {
  const job = getJob(projectId, jobId);
  if (!job) throw new Error("Job not found");
  if (job.status === "running" || job.status === "queued") {
    job.status = "stopped";
    saveJob(job);
  }
  return job;
}

function isPaused(projectId: string, slug: string): boolean {
  const paused = readJsonFile<Record<string, boolean>>(
    pausedPath(projectId),
    {},
  );
  return Boolean(paused[slug]);
}

function recordUsage(projectId: string, slug: string): void {
  const usage = readJsonFile<
    Record<string, { date: string; count: number; lastAt: number }>
  >(usagePath(projectId), {});
  const today = new Date().toISOString().slice(0, 10);
  const current = usage[slug];
  if (!current || current.date !== today) {
    usage[slug] = { date: today, count: 1, lastAt: Date.now() };
  } else {
    usage[slug] = { date: today, count: current.count + 1, lastAt: Date.now() };
  }
  writeJsonFile(usagePath(projectId), usage);
}

function usageOf(
  projectId: string,
  slug: string,
): { date: string; count: number; lastAt: number } {
  const usage = readJsonFile<
    Record<string, { date: string; count: number; lastAt: number }>
  >(usagePath(projectId), {});
  const today = new Date().toISOString().slice(0, 10);
  const current = usage[slug];
  if (!current || current.date !== today) {
    return { date: today, count: 0, lastAt: 0 };
  }
  return current;
}

export function composeDraft(
  role: SocialRole,
  brief: string,
  account?: SocialAccount | null,
): string {
  const prompt =
    brief.trim() || `Produce this week's on-brand ${role.platform} update.`;
  const example = role.postExamples[0];
  const voice = role.adjectives.slice(0, 4).join(", ");
  const style = role.style.post.slice(0, 3).join("; ");
  const asAccount = account
    ? `Post as @${account.handle}${account.profileUrl ? ` (${account.profileUrl})` : ""}`
    : "";
  return [
    `${role.name} · ${role.platform}`,
    asAccount,
    prompt,
    voice ? `Voice: ${voice}.` : "",
    style ? `Style: ${style}.` : "",
    example ? `In the spirit of: ${example}` : "",
    role.bio[0] ? `Role: ${role.bio[0]}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function canProduce(
  projectId: string,
  role: SocialRole,
): { allowed: boolean; reason?: string } {
  if (!role.enabled)
    return { allowed: false, reason: `${role.slug} is disabled` };
  if (isPaused(projectId, role.slug)) {
    return { allowed: false, reason: `${role.slug} is paused` };
  }
  const usage = usageOf(projectId, role.slug);
  if (usage.count >= role.dailyDraftCap) {
    return {
      allowed: false,
      reason: `${role.slug} hit daily cap ${role.dailyDraftCap}`,
    };
  }
  if (
    usage.lastAt &&
    Date.now() - usage.lastAt < role.cooldownMinutes * 60 * 1000
  ) {
    return {
      allowed: false,
      reason: `${role.slug} is in cooldown (${role.cooldownMinutes}m)`,
    };
  }
  return { allowed: true };
}

function kindForRole(role: SocialRole, brief: string): string {
  const blob = `${role.platform} ${brief}`.toLowerCase();
  if (role.platform === "instagram" || role.platform === "youtube") {
    if (/\b(video|reel|short|clip|render)\b/.test(blob) || !brief.trim()) {
      return "video-plan";
    }
  }
  if (role.platform === "support") return "support";
  if (role.platform === "blog") return "blog";
  if (role.platform === "youtube") return "youtube";
  if (role.platform === "instagram") return "instagram";
  if (/\breply|comment\b/.test(blob)) return "reply";
  if (/follow-?back/.test(blob)) return "follow-back";
  return "post";
}

function produceForRole(
  job: Job,
  role: SocialRole,
): SpendResult & {
  item?: QueueItem;
  skipped?: string;
} {
  const account = resolveAccountForRole(job.ownerUserId, role);
  const missingAccount = accountSkipReason(job.ownerUserId, role);
  if (missingAccount) {
    appendActivity({
      ts: new Date().toISOString(),
      projectId: job.projectId,
      jobId: job.id,
      roleSlug: role.slug,
      platform: role.platform,
      action: "skip",
      status: "skipped",
      tokens: 0,
      title: role.name,
      note: missingAccount,
    });
    return {
      ok: true,
      cost: 0,
      balance: getBalance(job.ownerUserId),
      skipped: missingAccount,
    };
  }

  const gate = canProduce(job.projectId, role);
  if (!gate.allowed) {
    appendActivity({
      ts: new Date().toISOString(),
      projectId: job.projectId,
      jobId: job.id,
      roleSlug: role.slug,
      platform: role.platform,
      action: "skip",
      status: "skipped",
      tokens: 0,
      title: role.name,
      note: gate.reason,
    });
    return {
      ok: true,
      cost: 0,
      balance: getBalance(job.ownerUserId),
      skipped: gate.reason,
    };
  }

  const kind = kindForRole(role, job.brief);
  const action = billingActionForKind(kind, role.platform);
  const spend = trySpend(job.ownerUserId, action, {
    projectId: job.projectId,
    jobId: job.id,
    note: `${role.slug} ${kind}`,
  });
  if (!spend.ok) return spend;

  const body = composeDraft(role, job.brief, account);
  const scored = scoreContent({ body, platform: role.platform, kind });
  const item = draftItem({
    agent: role.slug,
    platform: role.platform,
    title: (job.brief || `${role.name} draft`).slice(0, 80),
    body,
    kind: kind === "video-plan" ? "video-plan" : scored.kind,
    sensitivity: scored.total,
    sensitivityLevel: scored.level,
    flags: scored.flags,
    autoApproved: kind === "video-plan" ? false : scored.autoApprove,
    notes: scored.reason,
    risk: scored.autoApprove && kind !== "video-plan" ? "auto" : scored.level,
    projectId: job.projectId,
    jobId: job.id,
    tokens: spend.cost,
    accountId: account?.id,
    accountHandle: account?.handle,
    publicUrl: account?.profileUrl,
  });
  recordUsage(job.projectId, role.slug);
  appendActivity({
    ts: new Date().toISOString(),
    projectId: job.projectId,
    jobId: job.id,
    roleSlug: role.slug,
    platform: role.platform,
    action,
    kind: item.kind,
    queueItemId: item.id,
    status: item.status,
    tokens: spend.cost,
    title: item.title,
    publicUrl: account?.profileUrl,
    accountId: account?.id,
    accountHandle: account?.handle,
  });
  return { ...spend, item };
}

export function runJob(projectId: string, jobId: string): Job {
  const job = getJob(projectId, jobId);
  if (!job) throw new Error("Job not found");
  if (job.status === "stopped") return job;
  job.status = "running";
  saveJob(job);
  updateProject(projectId, { status: "running" });

  const roles = listRoles(projectId).filter((role) =>
    job.roleSlugs.includes(role.slug),
  );
  for (const role of roles) {
    const fresh = getJob(projectId, jobId);
    if (fresh?.status === "stopped") {
      updateProject(projectId, { status: "paused" });
      return fresh;
    }
    const result = produceForRole(job, role);
    if (!result.ok) {
      job.status = "stopped_no_credits";
      job.error = result.reason;
      saveJob(job);
      updateProject(projectId, { status: "stopped_no_credits" });
      appendActivity({
        ts: new Date().toISOString(),
        projectId,
        jobId: job.id,
        roleSlug: role.slug,
        platform: role.platform,
        action: billingActionForKind(
          kindForRole(role, job.brief),
          role.platform,
        ),
        status: "stopped_no_credits",
        tokens: 0,
        title: role.name,
        note: result.reason,
      });
      return job;
    }
    if (result.item) {
      job.produced.push(result.item.id);
      job.tokensSpent += result.cost;
    }
  }

  job.status = "completed";
  saveJob(job);
  updateProject(projectId, { status: "idle" });
  return job;
}

export function createAndRunJob(input: {
  projectId: string;
  ownerUserId: string;
  roleSlugs?: string[];
  brief?: string;
}): Job {
  const job = createJob(input);
  return runJob(job.projectId, job.id);
}
