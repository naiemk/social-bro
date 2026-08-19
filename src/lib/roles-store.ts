import fs from "node:fs";
import YAML from "yaml";
import type { Character } from "@elizaos/core";
import { blogGuy } from "../characters/blog-guy.ts";
import { instagramGuy } from "../characters/instagram-guy.ts";
import { tgGuy } from "../characters/tg-guy.ts";
import { twitterGuy } from "../characters/twitter-guy.ts";
import { youtubeGuy } from "../characters/youtube-guy.ts";
import {
  ensureDir,
  type Platform,
  PLATFORMS,
  resolveProjectData,
  writeJsonFile,
  readJsonFile,
} from "./paths.ts";

export const BUILTIN_ROLE_SLUGS = [
  "twitter-guy",
  "instagram-guy",
  "tg-guy",
  "youtube-guy",
  "blog-guy",
] as const;

export type RolePlatform = Exclude<Platform, "replies">;

export interface RoleStyle {
  all: string[];
  chat: string[];
  post: string[];
}

export interface SocialRole {
  slug: string;
  name: string;
  platform: RolePlatform;
  enabled: boolean;
  avatar: string;
  dailyDraftCap: number;
  cooldownMinutes: number;
  quietHours: string;
  restTz: string;
  restDays: string;
  dailyReplyCap?: number;
  supportAutoFaq?: boolean;
  system: string;
  bio: string[];
  adjectives: string[];
  topics: string[];
  style: RoleStyle;
  postExamples: string[];
  builtin: boolean;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function settingsOf(character: Character): Record<string, unknown> {
  return (character.settings || {}) as Record<string, unknown>;
}

function roleFromCharacter(
  character: Character,
  platform: RolePlatform,
): SocialRole {
  const settings = settingsOf(character);
  return {
    slug: String(settings.AGENT_SLUG || character.username || "").toLowerCase(),
    name: character.name,
    platform,
    enabled: true,
    avatar: String(
      settings.avatar ||
        "https://elizaos.github.io/eliza-avatars/Eliza/portrait.png",
    ),
    dailyDraftCap: Number(settings.DAILY_DRAFT_CAP ?? 8),
    cooldownMinutes: Number(settings.COOLDOWN_MINUTES ?? 15),
    quietHours: String(settings.QUIET_HOURS || "22:00-08:00"),
    restTz: String(settings.REST_TZ || "UTC"),
    restDays: String(settings.REST_DAYS || ""),
    dailyReplyCap:
      settings.DAILY_REPLY_CAP !== undefined
        ? Number(settings.DAILY_REPLY_CAP)
        : undefined,
    supportAutoFaq:
      settings.SUPPORT_AUTO_FAQ !== undefined
        ? String(settings.SUPPORT_AUTO_FAQ).toLowerCase() === "true"
        : undefined,
    system: String(character.system || ""),
    bio: asStringArray(character.bio),
    adjectives: asStringArray(character.adjectives),
    topics: asStringArray(character.topics),
    style: {
      all: asStringArray(character.style?.all),
      chat: asStringArray(character.style?.chat),
      post: asStringArray(character.style?.post),
    },
    postExamples: asStringArray(character.postExamples),
    builtin: true,
  };
}

export function platformTemplates(): Record<RolePlatform, SocialRole> {
  return {
    twitter: roleFromCharacter(twitterGuy, "twitter"),
    instagram: roleFromCharacter(instagramGuy, "instagram"),
    youtube: roleFromCharacter(youtubeGuy, "youtube"),
    blog: roleFromCharacter(blogGuy, "blog"),
    support: roleFromCharacter(tgGuy, "support"),
  };
}

export function defaultRoles(): SocialRole[] {
  const templates = platformTemplates();
  return [
    templates.twitter,
    templates.instagram,
    templates.support,
    templates.youtube,
    templates.blog,
  ];
}

function rolesPath(projectId: string): string {
  return resolveProjectData(projectId, "roles.yaml");
}

function overlayPath(projectId: string): string {
  return resolveProjectData(projectId, "ops", "role-settings.json");
}

function parseRole(raw: unknown, fallbackBuiltin = false): SocialRole | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const slug = String(row.slug || "")
    .toLowerCase()
    .trim();
  const platform = String(row.platform || "") as RolePlatform;
  if (
    !slug ||
    !PLATFORMS.includes(platform as Platform) ||
    platform === "replies"
  ) {
    return null;
  }
  const style = (
    row.style && typeof row.style === "object"
      ? (row.style as Record<string, unknown>)
      : {}
  ) as Record<string, unknown>;
  return {
    slug,
    name: String(row.name || slug),
    platform,
    enabled: row.enabled !== false,
    avatar: String(
      row.avatar ||
        "https://elizaos.github.io/eliza-avatars/Eliza/portrait.png",
    ),
    dailyDraftCap: Number(row.dailyDraftCap ?? 8),
    cooldownMinutes: Number(row.cooldownMinutes ?? 15),
    quietHours: String(row.quietHours || "22:00-08:00"),
    restTz: String(row.restTz || "UTC"),
    restDays: String(row.restDays || ""),
    dailyReplyCap:
      row.dailyReplyCap !== undefined ? Number(row.dailyReplyCap) : undefined,
    supportAutoFaq:
      row.supportAutoFaq !== undefined
        ? Boolean(row.supportAutoFaq)
        : undefined,
    system: String(row.system || ""),
    bio: asStringArray(row.bio),
    adjectives: asStringArray(row.adjectives),
    topics: asStringArray(row.topics),
    style: {
      all: asStringArray(style.all),
      chat: asStringArray(style.chat),
      post: asStringArray(style.post),
    },
    postExamples: asStringArray(row.postExamples),
    builtin:
      typeof row.builtin === "boolean"
        ? row.builtin
        : fallbackBuiltin ||
          (BUILTIN_ROLE_SLUGS as readonly string[]).includes(slug),
  };
}

function writeRoles(projectId: string, roles: SocialRole[]): void {
  ensureDir(resolveProjectData(projectId));
  fs.writeFileSync(rolesPath(projectId), YAML.stringify({ roles }));
  const overlay: Record<
    string,
    {
      dailyDraftCap: number;
      cooldownMinutes: number;
      quietHours: string;
      restTz: string;
      restDays: string;
    }
  > = {};
  for (const role of roles) {
    overlay[role.slug] = {
      dailyDraftCap: role.dailyDraftCap,
      cooldownMinutes: role.cooldownMinutes,
      quietHours: role.quietHours,
      restTz: role.restTz,
      restDays: role.restDays,
    };
  }
  writeJsonFile(overlayPath(projectId), overlay);
}

export function seedProjectRoles(projectId: string): SocialRole[] {
  const roles = defaultRoles();
  writeRoles(projectId, roles);
  return roles;
}

export function listRoles(projectId: string): SocialRole[] {
  const file = rolesPath(projectId);
  if (!fs.existsSync(file)) return seedProjectRoles(projectId);
  const parsed = YAML.parse(fs.readFileSync(file, "utf8")) || {};
  const rows = Array.isArray(parsed.roles) ? parsed.roles : [];
  const roles = rows
    .map((row: unknown) => parseRole(row))
    .filter((role: SocialRole | null): role is SocialRole => Boolean(role));
  if (roles.length === 0) return seedProjectRoles(projectId);
  return roles;
}

export function getRole(projectId: string, slug: string): SocialRole | null {
  return listRoles(projectId).find((role) => role.slug === slug) || null;
}

export function upsertRole(
  projectId: string,
  input: Partial<SocialRole> & { slug: string; platform?: RolePlatform },
): SocialRole {
  const slug = input.slug.toLowerCase().trim();
  if (!SLUG_RE.test(slug)) {
    throw new Error("Invalid role slug");
  }
  const roles = listRoles(projectId);
  const existing = roles.find((role) => role.slug === slug);
  const templates = platformTemplates();
  const template =
    (input.platform && templates[input.platform]) ||
    (existing ? templates[existing.platform] : templates.twitter);
  const next: SocialRole = {
    ...template,
    ...existing,
    ...input,
    slug,
    platform: (input.platform ||
      existing?.platform ||
      template.platform) as RolePlatform,
    builtin:
      existing?.builtin ||
      (BUILTIN_ROLE_SLUGS as readonly string[]).includes(slug),
    enabled: input.enabled ?? existing?.enabled ?? true,
  };
  const idx = roles.findIndex((role) => role.slug === slug);
  if (idx === -1) roles.push(next);
  else roles[idx] = next;
  writeRoles(projectId, roles);
  return next;
}

export function createRole(
  projectId: string,
  input: {
    name: string;
    slug: string;
    platform: RolePlatform;
  } & Partial<SocialRole>,
): SocialRole {
  const slug = input.slug.toLowerCase().trim();
  if (!SLUG_RE.test(slug)) throw new Error("Invalid role slug");
  if (getRole(projectId, slug)) throw new Error("Role already exists");
  const templates = platformTemplates();
  const template = templates[input.platform];
  if (!template) throw new Error("Unknown platform");
  return upsertRole(projectId, {
    ...template,
    ...input,
    slug,
    name: input.name,
    platform: input.platform,
    builtin: (BUILTIN_ROLE_SLUGS as readonly string[]).includes(slug),
  });
}

export function deleteRole(projectId: string, slug: string): void {
  const role = getRole(projectId, slug);
  if (!role) throw new Error("Role not found");
  if (role.builtin) throw new Error("Built-in roles cannot be deleted");
  writeRoles(
    projectId,
    listRoles(projectId).filter((row) => row.slug !== slug),
  );
}

export function readRoleOverlay(
  projectId: string,
): Record<string, Record<string, string | number>> {
  return readJsonFile(overlayPath(projectId), {});
}
