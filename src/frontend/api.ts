const TOKEN_KEY = "social_bro_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };
  const res = await fetch(path, {
    ...options,
    headers,
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data.error || res.statusText);
  }
  return data as T;
}

export type User = {
  id: string;
  username: string;
  isAdmin: boolean;
  telegramId?: string;
  telegramLinkedAt?: string;
};

export type Project = {
  id: string;
  name: string;
  brief: string;
  status: string;
  updatedAt: string;
};

export type Role = {
  slug: string;
  name: string;
  platform: string;
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
  style: { all: string[]; chat: string[]; post: string[] };
  postExamples: string[];
  builtin: boolean;
  accountId?: string;
};

export type SocialAccount = {
  id: string;
  platform: string;
  handle: string;
  displayName: string;
  profileUrl: string;
  notes: string;
};

export type Job = {
  id: string;
  status: string;
  brief: string;
  produced: string[];
  tokensSpent: number;
  error?: string;
  createdAt: string;
};

export type ActivityItem = {
  ts: string;
  roleSlug: string;
  platform: string;
  action: string;
  kind?: string;
  queueItemId?: string;
  status: string;
  tokens: number;
  title: string;
  publicUrl?: string;
  note?: string;
  accountHandle?: string;
};
