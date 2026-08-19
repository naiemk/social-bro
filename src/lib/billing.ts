import fs from "node:fs";
import YAML from "yaml";
import { listUsers } from "./auth.ts";
import {
  type BillingActionKey,
  type BillingConfig,
  type BillingPackage,
  loadSocialOpsConfig,
} from "./config.ts";
import {
  ensureDir,
  readJsonFile,
  resolveData,
  writeJsonFile,
} from "./paths.ts";

export interface LedgerEntry {
  ts: string;
  userId: string;
  type: "grant" | "purchase" | "spend" | "refund";
  action?: BillingActionKey;
  projectId?: string;
  jobId?: string;
  itemId?: string;
  tokens: number;
  balanceAfter: number;
  note?: string;
}

export interface SpendResult {
  ok: boolean;
  cost: number;
  balance: number;
  reason?: string;
}

function overlayPath(): string {
  return resolveData("platform", "billing.yaml");
}

function balancesPath(): string {
  return resolveData("platform", "balances.json");
}

function ledgerPath(): string {
  return resolveData("platform", "credits.jsonl");
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function loadBillingConfig(): BillingConfig {
  const base = loadSocialOpsConfig().billing;
  const file = overlayPath();
  if (!fs.existsSync(file)) return base;
  const parsed = YAML.parse(fs.readFileSync(file, "utf8")) || {};
  const root = asObject(parsed);
  const actions = asObject(root.actions);
  const packagesRaw = Array.isArray(root.packages) ? root.packages : [];
  const mergedActions = { ...base.actions };
  for (const key of Object.keys(mergedActions) as BillingActionKey[]) {
    const value = Number(actions[key]);
    if (Number.isFinite(value) && value >= 0) mergedActions[key] = value;
  }
  const packages: BillingPackage[] =
    packagesRaw.length > 0
      ? packagesRaw
          .map((pkg) => {
            const row = asObject(pkg);
            return {
              id: String(row.id || ""),
              tokens: Number(row.tokens || 0),
              label: String(row.label || row.id || "Package"),
            };
          })
          .filter((pkg) => pkg.id && pkg.tokens > 0)
      : base.packages;
  return { actions: mergedActions, packages };
}

export function saveBillingOverlay(config: BillingConfig): BillingConfig {
  ensureDir(resolveData("platform"));
  fs.writeFileSync(overlayPath(), YAML.stringify(config));
  return loadBillingConfig();
}

export function actionCost(action: BillingActionKey): number {
  return loadBillingConfig().actions[action] ?? 0;
}

export function getBalance(userId: string): number {
  const balances = readJsonFile<Record<string, number>>(balancesPath(), {});
  return Number(balances[userId] || 0);
}

export function listUsersWithBalances() {
  return listUsers().map((user) => ({
    ...user,
    balance: getBalance(user.id),
  }));
}

function setBalance(userId: string, balance: number): void {
  const balances = readJsonFile<Record<string, number>>(balancesPath(), {});
  balances[userId] = Math.max(0, balance);
  writeJsonFile(balancesPath(), balances);
}

function appendLedger(entry: LedgerEntry): void {
  ensureDir(resolveData("platform"));
  fs.appendFileSync(ledgerPath(), `${JSON.stringify(entry)}\n`);
}

export function listLedger(userId?: string, limit = 100): LedgerEntry[] {
  const file = ledgerPath();
  if (!fs.existsSync(file)) return [];
  const rows = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as LedgerEntry;
      } catch {
        return null;
      }
    })
    .filter((row): row is LedgerEntry => Boolean(row));
  const filtered = userId ? rows.filter((row) => row.userId === userId) : rows;
  return filtered.slice(-limit).reverse();
}

function credit(
  userId: string,
  tokens: number,
  type: "grant" | "purchase" | "refund",
  note?: string,
): LedgerEntry {
  const next = getBalance(userId) + tokens;
  setBalance(userId, next);
  const entry: LedgerEntry = {
    ts: new Date().toISOString(),
    userId,
    type,
    tokens,
    balanceAfter: next,
    note,
  };
  appendLedger(entry);
  return entry;
}

export function grantTokens(
  userId: string,
  tokens: number,
  note = "admin grant",
): LedgerEntry {
  if (!Number.isFinite(tokens) || tokens === 0) {
    throw new Error("Token amount must be a non-zero number");
  }
  return credit(userId, tokens, "grant", note);
}

export function purchasePackage(
  userId: string,
  packageId: string,
): LedgerEntry {
  const pkg = loadBillingConfig().packages.find((row) => row.id === packageId);
  if (!pkg) throw new Error("Unknown credit package");
  return credit(userId, pkg.tokens, "purchase", `In-app package ${pkg.label}`);
}

export function trySpend(
  userId: string,
  action: BillingActionKey,
  meta: {
    projectId?: string;
    jobId?: string;
    itemId?: string;
    note?: string;
  } = {},
): SpendResult {
  const cost = actionCost(action);
  const balance = getBalance(userId);
  if (cost <= 0) {
    return { ok: true, cost: 0, balance };
  }
  if (balance < cost) {
    return {
      ok: false,
      cost,
      balance,
      reason: `Insufficient credits: need ${cost}, have ${balance}`,
    };
  }
  const next = balance - cost;
  setBalance(userId, next);
  appendLedger({
    ts: new Date().toISOString(),
    userId,
    type: "spend",
    action,
    projectId: meta.projectId,
    jobId: meta.jobId,
    itemId: meta.itemId,
    tokens: -cost,
    balanceAfter: next,
    note: meta.note,
  });
  return { ok: true, cost, balance: next };
}

export function billingActionForKind(
  kind: string,
  platform?: string,
): BillingActionKey {
  if (kind === "video-plan" || kind === "video.plan") return "video.plan";
  if (kind === "video-render" || kind === "video.render") return "video.render";
  if (kind === "reply") return "draft.reply";
  if (kind === "support") return "draft.support";
  if (kind === "blog") return "draft.blog";
  if (kind === "youtube") return "draft.youtube";
  if (kind === "instagram") return "draft.instagram";
  if (kind === "follow-back") return "draft.follow-back";
  if (platform === "instagram") return "draft.instagram";
  if (platform === "youtube") return "draft.youtube";
  if (platform === "blog") return "draft.blog";
  if (platform === "support") return "draft.support";
  return "draft.post";
}
