import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { login, sessionFromRequest, dashboardUsername } from "../lib/auth.ts";
import {
  grantTokens,
  getBalance,
  purchasePackage,
  trySpend,
} from "../lib/billing.ts";
import {
  loadSocialOpsConfig,
  resetConfigCacheForTests,
} from "../lib/config.ts";
import { createAndRunJob } from "../lib/jobs.ts";
import { handleAppRoute } from "../plugins/dashboard.ts";
import { createProject, listProjects } from "../lib/projects.ts";
import {
  createRole,
  deleteRole,
  listRoles,
  upsertRole,
} from "../lib/roles-store.ts";
import { listActivity } from "../lib/activity.ts";
import { listQueue } from "../lib/queue.ts";

function withTmpData() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "social-bro-app-"));
  const prevData = process.env.SOCIAL_OPS_DATA_DIR;
  const prevConfig = process.env.SOCIAL_OPS_CONFIG;
  process.env.SOCIAL_OPS_DATA_DIR = tmp;
  process.env.SOCIAL_OPS_CONFIG = path.join(tmp, "config.yaml");
  process.env.DASHBOARD_USER = "main";
  process.env.DASHBOARD_PASSWORD = "changeme";
  resetConfigCacheForTests();
  return {
    tmp,
    restore() {
      if (prevData === undefined) delete process.env.SOCIAL_OPS_DATA_DIR;
      else process.env.SOCIAL_OPS_DATA_DIR = prevData;
      if (prevConfig === undefined) delete process.env.SOCIAL_OPS_CONFIG;
      else process.env.SOCIAL_OPS_CONFIG = prevConfig;
      resetConfigCacheForTests();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
    },
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
  };
  return res;
}

async function call(
  method: string,
  urlPath: string,
  opts: {
    body?: unknown;
    token?: string;
    params?: Record<string, string>;
  } = {},
) {
  const req = {
    method,
    path: urlPath,
    url: urlPath,
    body: opts.body || {},
    params: opts.params || {},
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
  };
  const res = mockRes();
  await handleAppRoute(req as never, res as never);
  return res;
}

describe("operator platform", () => {
  let env: ReturnType<typeof withTmpData>;

  beforeEach(() => {
    env = withTmpData();
  });

  afterEach(() => {
    env.restore();
  });

  it("rejects bad passwords and issues a session for the hardcoded user", async () => {
    const bad = await call("POST", "/app/auth/login", {
      body: { username: "main", password: "nope" },
    });
    expect(bad.statusCode).toBe(401);

    const ok = await call("POST", "/app/auth/login", {
      body: { username: dashboardUsername(), password: "changeme" },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.body as { token: string; user: { username: string } };
    expect(body.user.username).toBe("main");
    expect(
      sessionFromRequest({ headers: { authorization: `Bearer ${body.token}` } })
        ?.user.username,
    ).toBe("main");
  });

  it("gates projects behind sign-in", async () => {
    const res = await call("GET", "/app/projects");
    expect(res.statusCode).toBe(401);
  });

  it("creates a project with seeded roles and allows free config", async () => {
    const session = login("main", "changeme")!;
    const created = await call("POST", "/app/projects", {
      token: session.token,
      body: { name: "Acme", brief: "Ship the changelog" },
    });
    expect(created.statusCode).toBe(201);
    const project = (created.body as { project: { id: string } }).project;
    expect(listProjects(session.user.id)).toHaveLength(1);
    expect(listRoles(project.id).map((role) => role.slug)).toContain(
      "twitter-guy",
    );

    const updated = await call("PUT", `/app/projects/${project.id}`, {
      token: session.token,
      params: { id: project.id },
      body: { brief: "New brief" },
    });
    expect(updated.statusCode).toBe(200);
    expect(getBalance(session.user.id)).toBe(0);
  });

  it("cannot delete built-in roles and can add a custom clone", () => {
    const project = createProject({ name: "P", ownerUserId: "user-main" });
    expect(() => deleteRole(project.id, "twitter-guy")).toThrow();
    const custom = createRole(project.id, {
      name: "Launch Voice",
      slug: "launch-voice",
      platform: "twitter",
    });
    expect(custom.builtin).toBe(false);
    upsertRole(project.id, { slug: "launch-voice", dailyDraftCap: 2 });
    expect(
      listRoles(project.id).find((role) => role.slug === "launch-voice")
        ?.dailyDraftCap,
    ).toBe(2);
    deleteRole(project.id, "launch-voice");
    expect(
      listRoles(project.id).find((role) => role.slug === "launch-voice"),
    ).toBeUndefined();
  });

  it("uses in-app tokens: grant, buy pack, spend, halt at zero", () => {
    const userId = "user-main";
    grantTokens(userId, 5, "test");
    expect(getBalance(userId)).toBe(5);
    purchasePackage(userId, "starter");
    expect(getBalance(userId)).toBe(105);
    const spend = trySpend(userId, "draft.post", { note: "tweet" });
    expect(spend.ok).toBe(true);
    expect(getBalance(userId)).toBe(104);
    while (trySpend(userId, "draft.post").ok) {
      /* drain wallet */
    }
    expect(getBalance(userId)).toBe(0);
    const fail = trySpend(userId, "draft.post");
    expect(fail.ok).toBe(false);
    expect(fail.reason).toContain("Insufficient credits");
  });

  it("runs a job that spends tokens and stops when credits run out", () => {
    const session = login("main", "changeme")!;
    const project = createProject({
      name: "Launch",
      ownerUserId: session.user.id,
      brief: "Announce the quiet-hours feature",
    });
    grantTokens(session.user.id, 2);
    const job = createAndRunJob({
      projectId: project.id,
      ownerUserId: session.user.id,
    });
    expect(job.status).toBe("stopped_no_credits");
    expect(job.produced.length).toBeGreaterThan(0);
    expect(job.produced.length).toBeLessThan(5);
    expect(listQueue(undefined, undefined, project.id).length).toBe(
      job.produced.length,
    );
    expect(listActivity(project.id).some((row) => row.tokens > 0)).toBe(true);
    expect(getBalance(session.user.id)).toBeLessThan(2);
  });

  it("lets admin grant tokens over HTTP and then run", async () => {
    const session = login("main", "changeme")!;
    const grant = await call("POST", "/app/admin/users/user-main/credits", {
      token: session.token,
      params: { id: "user-main" },
      body: { tokens: 50, note: "seed" },
    });
    expect(grant.statusCode).toBe(200);
    expect(getBalance("user-main")).toBe(50);

    const created = await call("POST", "/app/projects", {
      token: session.token,
      body: { name: "Ops" },
    });
    const projectId = (created.body as { project: { id: string } }).project.id;
    const run = await call("POST", `/app/projects/${projectId}/jobs`, {
      token: session.token,
      params: { id: projectId },
      body: { brief: "Weekly update", roleSlugs: ["twitter-guy", "blog-guy"] },
    });
    expect(run.statusCode).toBe(201);
    const job = (run.body as { job: { status: string; tokensSpent: number } })
      .job;
    expect(job.status).toBe("completed");
    expect(job.tokensSpent).toBeGreaterThan(0);
    expect(getBalance("user-main")).toBe(50 - job.tokensSpent);
  });

  it("loads billing defaults from config.yaml", () => {
    const cfg = loadSocialOpsConfig();
    expect(cfg.billing.actions["draft.post"]).toBe(1);
    expect(cfg.billing.packages[0].id).toBe("starter");
  });
});
