import crypto from "node:crypto";
import { bearerToken, readCookie } from "./http.ts";
import {
  ensureDir,
  readJsonFile,
  resolveData,
  writeJsonFile,
} from "./paths.ts";

export const SESSION_COOKIE = "social_bro_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface PlatformUser {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
}

export interface Session {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

function usersPath(): string {
  return resolveData("platform", "users.json");
}

function sessionsPath(): string {
  return resolveData("platform", "sessions.json");
}

export function dashboardUsername(): string {
  return process.env.DASHBOARD_USER?.trim() || "main";
}

export function dashboardPassword(): string {
  return process.env.DASHBOARD_PASSWORD?.trim() || "changeme";
}

export function ensureMainUser(): PlatformUser {
  ensureDir(resolveData("platform"));
  const users = readJsonFile<PlatformUser[]>(usersPath(), []);
  const username = dashboardUsername();
  let user = users.find((row) => row.username === username);
  if (!user) {
    user = {
      id: "user-main",
      username,
      isAdmin: true,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    writeJsonFile(usersPath(), users);
  }
  return user;
}

export function listUsers(): PlatformUser[] {
  ensureMainUser();
  return readJsonFile<PlatformUser[]>(usersPath(), []);
}

export function getUser(id: string): PlatformUser | null {
  return listUsers().find((user) => user.id === id) || null;
}

export function login(
  username: string,
  password: string,
): {
  user: PlatformUser;
  token: string;
} | null {
  if (username !== dashboardUsername() || password !== dashboardPassword()) {
    return null;
  }
  const user = ensureMainUser();
  const token = crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  const sessions = readJsonFile<Session[]>(sessionsPath(), []).filter(
    (session) => new Date(session.expiresAt).getTime() > now,
  );
  const session: Session = {
    token,
    userId: user.id,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  };
  sessions.push(session);
  writeJsonFile(sessionsPath(), sessions);
  return { user, token };
}

export function logout(token?: string): void {
  if (!token) return;
  const sessions = readJsonFile<Session[]>(sessionsPath(), []).filter(
    (session) => session.token !== token,
  );
  writeJsonFile(sessionsPath(), sessions);
}

export function sessionFromRequest(req: {
  headers?: Record<string, unknown>;
}): { user: PlatformUser; token: string } | null {
  const token =
    bearerToken(req) || readCookie(req, SESSION_COOKIE) || undefined;
  if (!token) return null;
  return userFromToken(token);
}

export function userFromToken(token: string): {
  user: PlatformUser;
  token: string;
} | null {
  const now = Date.now();
  const sessions = readJsonFile<Session[]>(sessionsPath(), []);
  const session = sessions.find(
    (row) => row.token === token && new Date(row.expiresAt).getTime() > now,
  );
  if (!session) return null;
  const user = getUser(session.userId);
  if (!user) return null;
  return { user, token };
}
