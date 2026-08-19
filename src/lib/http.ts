export type JsonRecord = Record<string, unknown>;

export function headerOf(
  req: { headers?: Record<string, unknown> },
  name: string,
): string {
  const headers = req.headers || {};
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      if (Array.isArray(value)) return String(value[0] || "");
      return String(value || "");
    }
  }
  return "";
}

export function readJsonBody(req: {
  body?: unknown;
  json?: () => unknown;
}): JsonRecord {
  const body = req.body;
  if (!body) return {};
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === "object" ? (parsed as JsonRecord) : {};
    } catch {
      return {};
    }
  }
  if (typeof body === "object") return body as JsonRecord;
  return {};
}

export function readCookie(
  req: { headers?: Record<string, unknown> },
  name: string,
): string | undefined {
  const raw = headerOf(req, "cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

export function bearerToken(req: {
  headers?: Record<string, unknown>;
}): string | undefined {
  const auth = headerOf(req, "authorization");
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

export function sendJson(
  res: {
    status?: (code: number) => { json: (body: unknown) => void };
    statusCode?: number;
    json?: (body: unknown) => void;
    end?: (body?: string) => void;
  },
  status: number,
  body: unknown,
): void {
  if (typeof res.status === "function") {
    res.status(status).json(body);
    return;
  }
  res.statusCode = status;
  if (typeof res.json === "function") {
    res.json(body);
    return;
  }
  if (typeof res.end === "function") {
    res.end(JSON.stringify(body));
  }
}

export function setCookie(
  res: {
    setHeader?: (name: string, value: string) => void;
    cookie?: (name: string, value: string, opts?: object) => void;
  },
  name: string,
  value: string,
  maxAgeSeconds = 60 * 60 * 24 * 7,
): void {
  const cookie = `${name}=${encodeURIComponent(value)}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
  if (typeof res.setHeader === "function") {
    res.setHeader("Set-Cookie", cookie);
  }
  if (typeof res.cookie === "function") {
    res.cookie(name, value, {
      httpOnly: true,
      path: "/",
      maxAge: maxAgeSeconds,
      sameSite: "lax",
    });
  }
}

export function clearCookie(
  res: {
    setHeader?: (name: string, value: string) => void;
  },
  name: string,
): void {
  if (typeof res.setHeader === "function") {
    res.setHeader(
      "Set-Cookie",
      `${name}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`,
    );
  }
}

export function pathParam(
  reqPath: string,
  pattern: string,
): Record<string, string> | null {
  const reqParts = reqPath.split("?")[0].split("/").filter(Boolean);
  const patParts = pattern.split("/").filter(Boolean);
  if (reqParts.length !== patParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i].startsWith(":")) {
      params[patParts[i].slice(1)] = decodeURIComponent(reqParts[i]);
    } else if (patParts[i] !== reqParts[i]) {
      return null;
    }
  }
  return params;
}
