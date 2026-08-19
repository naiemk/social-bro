import crypto from "node:crypto";
import { listProjects } from "./projects.ts";
import { unbindAccount, type RolePlatform } from "./roles-store.ts";
import { PLATFORMS, type Platform } from "./paths.ts";
import {
  ensureDir,
  readJsonFile,
  resolveData,
  writeJsonFile,
} from "./paths.ts";

export interface SocialAccount {
  id: string;
  ownerUserId: string;
  platform: RolePlatform;
  handle: string;
  displayName: string;
  profileUrl: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

function accountsPath(): string {
  return resolveData("platform", "accounts.json");
}

function readAll(): SocialAccount[] {
  ensureDir(resolveData("platform"));
  return readJsonFile<SocialAccount[]>(accountsPath(), []);
}

function writeAll(accounts: SocialAccount[]): void {
  writeJsonFile(accountsPath(), accounts);
}

export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, "");
}

export function defaultProfileUrl(
  platform: RolePlatform,
  handle: string,
): string {
  const h = normalizeHandle(handle);
  if (!h) return "";
  if (/^https?:\/\//i.test(handle)) return handle.trim();
  switch (platform) {
    case "twitter":
      return `https://x.com/${h}`;
    case "instagram":
      return `https://instagram.com/${h}`;
    case "youtube":
      return `https://youtube.com/@${h}`;
    case "blog":
      return h.includes(".") ? `https://${h}` : "";
    case "support":
      return `https://t.me/${h}`;
    default:
      return "";
  }
}

function isRolePlatform(value: string): value is RolePlatform {
  return PLATFORMS.includes(value as Platform) && value !== "replies";
}

export function listAccounts(ownerUserId: string): SocialAccount[] {
  return readAll().filter((account) => account.ownerUserId === ownerUserId);
}

export function getAccount(id: string): SocialAccount | null {
  return readAll().find((account) => account.id === id) || null;
}

export function assertOwnedAccount(
  ownerUserId: string,
  accountId: string,
  platform?: RolePlatform,
): SocialAccount {
  const account = getAccount(accountId);
  if (!account || account.ownerUserId !== ownerUserId) {
    throw new Error("Social account not found");
  }
  if (platform && account.platform !== platform) {
    throw new Error(
      `Account @${account.handle} is ${account.platform}, not ${platform}`,
    );
  }
  return account;
}

export function createAccount(input: {
  ownerUserId: string;
  platform: string;
  handle: string;
  displayName?: string;
  profileUrl?: string;
  notes?: string;
}): SocialAccount {
  const platform = String(input.platform || "").toLowerCase();
  if (!isRolePlatform(platform)) {
    throw new Error("Unknown platform");
  }
  const handle = normalizeHandle(input.handle);
  if (!handle) throw new Error("Handle is required");
  const now = new Date().toISOString();
  const account: SocialAccount = {
    id: `acc-${crypto.randomBytes(4).toString("hex")}`,
    ownerUserId: input.ownerUserId,
    platform,
    handle,
    displayName: (input.displayName || handle).trim(),
    profileUrl: input.profileUrl?.trim() || defaultProfileUrl(platform, handle),
    notes: input.notes?.trim() || "",
    createdAt: now,
    updatedAt: now,
  };
  writeAll([...readAll(), account]);
  return account;
}

export function updateAccount(
  ownerUserId: string,
  id: string,
  patch: Partial<
    Pick<
      SocialAccount,
      "handle" | "displayName" | "profileUrl" | "notes" | "platform"
    >
  >,
): SocialAccount {
  const accounts = readAll();
  const idx = accounts.findIndex(
    (account) => account.id === id && account.ownerUserId === ownerUserId,
  );
  if (idx === -1) throw new Error("Social account not found");
  const current = accounts[idx];
  const platform = patch.platform
    ? String(patch.platform).toLowerCase()
    : current.platform;
  if (!isRolePlatform(platform)) throw new Error("Unknown platform");
  const handle = patch.handle ? normalizeHandle(patch.handle) : current.handle;
  if (!handle) throw new Error("Handle is required");
  const next: SocialAccount = {
    ...current,
    platform,
    handle,
    displayName:
      patch.displayName !== undefined
        ? patch.displayName.trim() || handle
        : current.displayName,
    profileUrl:
      patch.profileUrl !== undefined
        ? patch.profileUrl.trim() || defaultProfileUrl(platform, handle)
        : current.profileUrl || defaultProfileUrl(platform, handle),
    notes: patch.notes !== undefined ? patch.notes.trim() : current.notes,
    updatedAt: new Date().toISOString(),
  };
  accounts[idx] = next;
  writeAll(accounts);
  return next;
}

export function deleteAccount(ownerUserId: string, id: string): void {
  const account = assertOwnedAccount(ownerUserId, id);
  for (const project of listProjects(ownerUserId)) {
    unbindAccount(project.id, account.id);
  }
  writeAll(readAll().filter((row) => row.id !== account.id));
}

export function resolveAccountForRole(
  ownerUserId: string,
  role: { accountId?: string; platform: RolePlatform; slug: string },
): SocialAccount | null {
  if (role.accountId) {
    const bound = getAccount(role.accountId);
    if (
      bound &&
      bound.ownerUserId === ownerUserId &&
      bound.platform === role.platform
    ) {
      return bound;
    }
  }
  const matches = listAccounts(ownerUserId).filter(
    (account) => account.platform === role.platform,
  );
  if (matches.length === 1) return matches[0];
  return null;
}

export function accountSkipReason(
  ownerUserId: string,
  role: { accountId?: string; platform: RolePlatform; slug: string },
): string | null {
  if (resolveAccountForRole(ownerUserId, role)) return null;
  const matches = listAccounts(ownerUserId).filter(
    (account) => account.platform === role.platform,
  );
  if (matches.length === 0) {
    return `Add a ${role.platform} account before running ${role.slug}`;
  }
  return `Pick which ${role.platform} account ${role.slug} should use`;
}
