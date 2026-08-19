import fs from "node:fs";
import path from "node:path";
import type { Plugin, RouteRequest, RouteResponse } from "@elizaos/core";
import {
  attachPublicUrl,
  listActivity,
  spentForProject,
} from "../lib/activity.ts";
import {
  ensureMainUser,
  login,
  logout,
  SESSION_COOKIE,
  sessionFromRequest,
  type PlatformUser,
} from "../lib/auth.ts";
import {
  getBalance,
  grantTokens,
  listLedger,
  listUsersWithBalances,
  loadBillingConfig,
  purchasePackage,
  saveBillingOverlay,
} from "../lib/billing.ts";
import {
  clearCookie,
  pathParam,
  readJsonBody,
  sendJson,
  setCookie,
} from "../lib/http.ts";
import {
  createRole,
  deleteRole,
  getRole,
  listRoles,
  type RolePlatform,
  upsertRole,
} from "../lib/roles-store.ts";
import { createAndRunJob, listJobs, stopJob } from "../lib/jobs.ts";
import { listQueue, markPublished } from "../lib/queue.ts";
import {
  assertProjectOwner,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "../lib/projects.ts";
import {
  createAccount,
  deleteAccount,
  listAccounts,
  updateAccount,
  assertOwnedAccount,
} from "../lib/accounts.ts";

function reqPath(req: RouteRequest): string {
  const raw =
    (req as { path?: string }).path ||
    (req as { url?: string }).url ||
    (req as { routePath?: string }).routePath ||
    "";
  let pathname = String(raw).split("?")[0];
  const params = ((req as { params?: Record<string, string> }).params ||
    {}) as Record<string, string>;
  for (const [key, value] of Object.entries(params)) {
    pathname = pathname.replace(`:${key}`, encodeURIComponent(String(value)));
  }
  if (pathname.includes(":") && (req as { routePath?: string }).routePath) {
    pathname = String((req as { routePath?: string }).routePath);
    for (const [key, value] of Object.entries(params)) {
      pathname = pathname.replace(`:${key}`, encodeURIComponent(String(value)));
    }
  }
  return pathname;
}

function queryOf(req: RouteRequest): Record<string, string> {
  const q = (req as { query?: Record<string, unknown> }).query || {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(q)) {
    if (typeof value === "string") out[key] = value;
  }
  const url = String((req as { url?: string }).url || "");
  const idx = url.indexOf("?");
  if (idx !== -1) {
    const params = new URLSearchParams(url.slice(idx + 1));
    for (const [key, value] of params.entries()) out[key] = value;
  }
  return out;
}

function requireUser(
  req: RouteRequest,
  res: RouteResponse,
): PlatformUser | null {
  const session = sessionFromRequest(req);
  if (!session) {
    sendJson(res, 401, { error: "Sign in required" });
    return null;
  }
  return session.user;
}

function requireAdmin(
  req: RouteRequest,
  res: RouteResponse,
): PlatformUser | null {
  const user = requireUser(req, res);
  if (!user) return null;
  if (!user.isAdmin) {
    sendJson(res, 403, { error: "Admin only" });
    return null;
  }
  return user;
}

function ownedProject(
  req: RouteRequest,
  res: RouteResponse,
  projectId: string,
) {
  const user = requireUser(req, res);
  if (!user) return null;
  try {
    return {
      user,
      project: assertProjectOwner(getProject(projectId), user.id),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, message === "Forbidden" ? 403 : 404, { error: message });
    return null;
  }
}

export async function handleAppRoute(
  req: RouteRequest,
  res: RouteResponse,
): Promise<void> {
  const method = String(
    (req as { method?: string }).method ||
      (req as { type?: string }).type ||
      "GET",
  ).toUpperCase();
  const pathname = reqPath(req);
  const body = readJsonBody(req);

  if (method === "POST" && pathname === "/app/auth/login") {
    const result = login(
      String(body.username || ""),
      String(body.password || ""),
    );
    if (!result) {
      sendJson(res, 401, { error: "Invalid username or password" });
      return;
    }
    setCookie(res, SESSION_COOKIE, result.token);
    sendJson(res, 200, { user: result.user, token: result.token });
    return;
  }

  if (method === "POST" && pathname === "/app/auth/logout") {
    const session = sessionFromRequest(req);
    logout(session?.token);
    clearCookie(res, SESSION_COOKIE);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === "GET" && pathname === "/app/auth/me") {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(res, 200, {
      user,
      balance: getBalance(user.id),
    });
    return;
  }

  if (method === "GET" && pathname === "/app/projects") {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(res, 200, { projects: listProjects(user.id) });
    return;
  }

  if (method === "POST" && pathname === "/app/projects") {
    const user = requireUser(req, res);
    if (!user) return;
    const project = createProject({
      name: String(body.name || "Untitled project"),
      ownerUserId: user.id,
      brief: String(body.brief || ""),
    });
    sendJson(res, 201, { project, roles: listRoles(project.id) });
    return;
  }

  const oneProject = pathParam(pathname, "/app/projects/:id");
  if (oneProject && method === "GET") {
    const owned = ownedProject(req, res, oneProject.id);
    if (!owned) return;
    sendJson(res, 200, {
      project: owned.project,
      roles: listRoles(owned.project.id),
      accounts: listAccounts(owned.user.id),
      balance: getBalance(owned.user.id),
      spent: spentForProject(owned.project.id),
      jobs: listJobs(owned.project.id).slice(0, 10),
    });
    return;
  }
  if (oneProject && (method === "PUT" || method === "PATCH")) {
    const owned = ownedProject(req, res, oneProject.id);
    if (!owned) return;
    const project = updateProject(owned.project.id, {
      name: body.name !== undefined ? String(body.name) : undefined,
      brief: body.brief !== undefined ? String(body.brief) : undefined,
    });
    sendJson(res, 200, { project });
    return;
  }
  if (oneProject && method === "DELETE") {
    const owned = ownedProject(req, res, oneProject.id);
    if (!owned) return;
    deleteProject(owned.project.id);
    sendJson(res, 200, { ok: true });
    return;
  }

  const rolesList = pathParam(pathname, "/app/projects/:id/roles");
  if (rolesList && method === "GET") {
    const owned = ownedProject(req, res, rolesList.id);
    if (!owned) return;
    sendJson(res, 200, { roles: listRoles(owned.project.id) });
    return;
  }
  if (rolesList && method === "POST") {
    const owned = ownedProject(req, res, rolesList.id);
    if (!owned) return;
    try {
      const platform = String(body.platform || "twitter") as RolePlatform;
      if (body.accountId) {
        assertOwnedAccount(owned.user.id, String(body.accountId), platform);
      }
      const role = createRole(owned.project.id, {
        name: String(body.name || ""),
        slug: String(body.slug || ""),
        platform,
        accountId: body.accountId ? String(body.accountId) : undefined,
      });
      sendJson(res, 201, { role });
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  const oneRole = pathParam(pathname, "/app/projects/:id/roles/:slug");
  if (oneRole && method === "GET") {
    const owned = ownedProject(req, res, oneRole.id);
    if (!owned) return;
    const role = getRole(owned.project.id, oneRole.slug);
    if (!role) {
      sendJson(res, 404, { error: "Role not found" });
      return;
    }
    sendJson(res, 200, { role });
    return;
  }
  if (oneRole && (method === "PUT" || method === "PATCH")) {
    const owned = ownedProject(req, res, oneRole.id);
    if (!owned) return;
    try {
      const patch = body as Partial<import("../lib/roles-store.ts").SocialRole>;
      if (patch.accountId) {
        const current = getRole(owned.project.id, oneRole.slug);
        assertOwnedAccount(
          owned.user.id,
          String(patch.accountId),
          current?.platform,
        );
      }
      const role = upsertRole(owned.project.id, {
        slug: oneRole.slug,
        ...patch,
      });
      sendJson(res, 200, { role });
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }
  if (oneRole && method === "DELETE") {
    const owned = ownedProject(req, res, oneRole.id);
    if (!owned) return;
    try {
      deleteRole(owned.project.id, oneRole.slug);
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  const jobsList = pathParam(pathname, "/app/projects/:id/jobs");
  if (jobsList && method === "GET") {
    const owned = ownedProject(req, res, jobsList.id);
    if (!owned) return;
    sendJson(res, 200, { jobs: listJobs(owned.project.id) });
    return;
  }
  if (jobsList && method === "POST") {
    const owned = ownedProject(req, res, jobsList.id);
    if (!owned) return;
    try {
      const job = createAndRunJob({
        projectId: owned.project.id,
        ownerUserId: owned.user.id,
        roleSlugs: Array.isArray(body.roleSlugs)
          ? body.roleSlugs.map(String)
          : undefined,
        brief: body.brief !== undefined ? String(body.brief) : undefined,
      });
      sendJson(res, 201, {
        job,
        balance: getBalance(owned.user.id),
      });
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  const stop = pathParam(pathname, "/app/projects/:id/jobs/:jobId/stop");
  if (stop && method === "POST") {
    const owned = ownedProject(req, res, stop.id);
    if (!owned) return;
    try {
      sendJson(res, 200, { job: stopJob(owned.project.id, stop.jobId) });
    } catch (error) {
      sendJson(res, 404, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  const activity = pathParam(pathname, "/app/projects/:id/activity");
  if (activity && method === "GET") {
    const owned = ownedProject(req, res, activity.id);
    if (!owned) return;
    const q = queryOf(req);
    sendJson(res, 200, {
      items: listActivity(owned.project.id, {
        role: q.role,
        platform: q.platform,
        from: q.from,
      }),
      spent: spentForProject(owned.project.id),
      balance: getBalance(owned.user.id),
    });
    return;
  }

  const queue = pathParam(pathname, "/app/projects/:id/queue");
  if (queue && method === "GET") {
    const owned = ownedProject(req, res, queue.id);
    if (!owned) return;
    const q = queryOf(req);
    sendJson(res, 200, {
      items: listQueue(
        q.status as "pending" | undefined,
        q.platform,
        owned.project.id,
      ),
    });
    return;
  }

  const published = pathParam(
    pathname,
    "/app/projects/:id/queue/:itemId/published",
  );
  if (published && method === "POST") {
    const owned = ownedProject(req, res, published.id);
    if (!owned) return;
    try {
      const url = String(body.url || body.publicUrl || "");
      const item = markPublished(published.itemId, url || undefined);
      if (url) attachPublicUrl(owned.project.id, item.id, url);
      sendJson(res, 200, { item });
    } catch (error) {
      sendJson(res, 404, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (method === "GET" && pathname === "/app/billing") {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(res, 200, {
      balance: getBalance(user.id),
      packages: loadBillingConfig().packages,
      actions: loadBillingConfig().actions,
      ledger: listLedger(user.id, 50),
    });
    return;
  }

  if (method === "POST" && pathname === "/app/billing/checkout") {
    const user = requireUser(req, res);
    if (!user) return;
    try {
      const entry = purchasePackage(user.id, String(body.packageId || ""));
      sendJson(res, 200, { entry, balance: getBalance(user.id) });
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (method === "GET" && pathname === "/app/admin/users") {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    sendJson(res, 200, { users: listUsersWithBalances() });
    return;
  }

  if (method === "GET" && pathname === "/app/admin/billing") {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    sendJson(res, 200, loadBillingConfig());
    return;
  }

  if (method === "PUT" && pathname === "/app/admin/billing") {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const current = loadBillingConfig();
    const next = saveBillingOverlay({
      actions: { ...current.actions, ...(body.actions as object) },
      packages: Array.isArray(body.packages)
        ? (body.packages as typeof current.packages)
        : current.packages,
    });
    sendJson(res, 200, next);
    return;
  }

  const grant = pathParam(pathname, "/app/admin/users/:id/credits");
  if (grant && method === "POST") {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
      const entry = grantTokens(
        grant.id,
        Number(body.tokens),
        String(body.note || "admin grant"),
      );
      sendJson(res, 200, { entry, balance: getBalance(grant.id) });
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (method === "GET" && pathname === "/app/accounts") {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(res, 200, { accounts: listAccounts(user.id) });
    return;
  }

  if (method === "POST" && pathname === "/app/accounts") {
    const user = requireUser(req, res);
    if (!user) return;
    try {
      const account = createAccount({
        ownerUserId: user.id,
        platform: String(body.platform || ""),
        handle: String(body.handle || ""),
        displayName:
          body.displayName !== undefined ? String(body.displayName) : undefined,
        profileUrl:
          body.profileUrl !== undefined ? String(body.profileUrl) : undefined,
        notes: body.notes !== undefined ? String(body.notes) : undefined,
      });
      sendJson(res, 201, { account });
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  const oneAccount = pathParam(pathname, "/app/accounts/:id");
  if (oneAccount && (method === "PUT" || method === "PATCH")) {
    const user = requireUser(req, res);
    if (!user) return;
    try {
      const account = updateAccount(user.id, oneAccount.id, {
        handle: body.handle !== undefined ? String(body.handle) : undefined,
        displayName:
          body.displayName !== undefined ? String(body.displayName) : undefined,
        profileUrl:
          body.profileUrl !== undefined ? String(body.profileUrl) : undefined,
        notes: body.notes !== undefined ? String(body.notes) : undefined,
        platform:
          body.platform !== undefined
            ? (String(body.platform) as RolePlatform)
            : undefined,
      });
      sendJson(res, 200, { account });
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }
  if (oneAccount && method === "DELETE") {
    const user = requireUser(req, res);
    if (!user) return;
    try {
      deleteAccount(user.id, oneAccount.id);
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 404, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function dashboardFile(rel: string): string | null {
  const candidates = [
    path.resolve(process.cwd(), "dist/frontend", rel),
    path.resolve(process.cwd(), "src/frontend", rel),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

async function serveDashboard(
  req: RouteRequest,
  res: RouteResponse,
): Promise<void> {
  const pathname = reqPath(req);
  const rel =
    pathname === "/dashboard" || pathname === "/dashboard/"
      ? "index.html"
      : pathname.replace(/^\/dashboard\/?/, "");
  const file = dashboardFile(rel) || dashboardFile("index.html");
  if (!file) {
    sendJson(res, 200, {
      message:
        "Operator dashboard. API is mounted at /app. Build the UI with bunx vite build.",
    });
    return;
  }
  const html = file.endsWith(".html");
  const raw = fs.readFileSync(file);
  if (typeof (res as { send?: (b: unknown) => void }).send === "function") {
    if (html) {
      (res as { type?: (t: string) => RouteResponse }).type?.("html");
    }
    (res as { send: (b: unknown) => void }).send(
      html ? raw.toString("utf8") : raw,
    );
    return;
  }
  if (html) {
    sendJson(res, 200, { html: raw.toString("utf8") });
    return;
  }
  sendJson(res, 200, { ok: true });
}

function appRoute(
  name: string,
  routePath: string,
  type: "GET" | "POST" | "PUT" | "DELETE",
) {
  return {
    name,
    path: routePath,
    type,
    handler: async (req: RouteRequest, res: RouteResponse) => {
      (req as { method?: string }).method = type;
      (req as { routePath?: string }).routePath = routePath;
      await handleAppRoute(req, res);
    },
  };
}

export const dashboardPlugin: Plugin = {
  name: "operator-dashboard",
  description:
    "Projects, roles, in-app credit tokens, billed jobs, and activity dashboard.",
  init: async () => {
    ensureMainUser();
  },
  routes: [
    appRoute("app-login", "/app/auth/login", "POST"),
    appRoute("app-logout", "/app/auth/logout", "POST"),
    appRoute("app-me", "/app/auth/me", "GET"),
    appRoute("app-accounts", "/app/accounts", "GET"),
    appRoute("app-accounts-create", "/app/accounts", "POST"),
    appRoute("app-account-update", "/app/accounts/:id", "PUT"),
    appRoute("app-account-delete", "/app/accounts/:id", "DELETE"),
    appRoute("app-projects", "/app/projects", "GET"),
    appRoute("app-projects-create", "/app/projects", "POST"),
    appRoute("app-project", "/app/projects/:id", "GET"),
    appRoute("app-project-update", "/app/projects/:id", "PUT"),
    appRoute("app-project-delete", "/app/projects/:id", "DELETE"),
    appRoute("app-roles", "/app/projects/:id/roles", "GET"),
    appRoute("app-roles-create", "/app/projects/:id/roles", "POST"),
    appRoute("app-role", "/app/projects/:id/roles/:slug", "GET"),
    appRoute("app-role-update", "/app/projects/:id/roles/:slug", "PUT"),
    appRoute("app-role-delete", "/app/projects/:id/roles/:slug", "DELETE"),
    appRoute("app-jobs", "/app/projects/:id/jobs", "GET"),
    appRoute("app-jobs-run", "/app/projects/:id/jobs", "POST"),
    appRoute("app-job-stop", "/app/projects/:id/jobs/:jobId/stop", "POST"),
    appRoute("app-activity", "/app/projects/:id/activity", "GET"),
    appRoute("app-queue", "/app/projects/:id/queue", "GET"),
    appRoute(
      "app-published",
      "/app/projects/:id/queue/:itemId/published",
      "POST",
    ),
    appRoute("app-billing", "/app/billing", "GET"),
    appRoute("app-checkout", "/app/billing/checkout", "POST"),
    appRoute("app-admin-users", "/app/admin/users", "GET"),
    appRoute("app-admin-grant", "/app/admin/users/:id/credits", "POST"),
    appRoute("app-admin-billing", "/app/admin/billing", "GET"),
    appRoute("app-admin-billing-put", "/app/admin/billing", "PUT"),
    {
      name: "dashboard",
      path: "/dashboard",
      type: "GET",
      handler: serveDashboard,
    },
  ],
};

export default dashboardPlugin;
