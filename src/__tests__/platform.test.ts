import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { login, sessionFromRequest, dashboardUsername, createUser, getUser } from "../lib/auth.ts";
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
import { createAccount, listAccounts } from "../lib/accounts.ts";
import {
  createRole,
  deleteRole,
  listRoles,
  upsertRole,
} from "../lib/roles-store.ts";
import { listActivity } from "../lib/activity.ts";
import { draftItem, listQueue } from "../lib/queue.ts";
import contentQueuePlugin from "../plugins/content-queue.ts";
import {
  connectTelegramDesk,
  setTelegramTransportForTests,
} from "../lib/telegram-desk.ts";

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

function seedAccounts(userId: string) {
  for (const platform of [
    "twitter",
    "instagram",
    "youtube",
    "blog",
    "support",
  ] as const) {
    createAccount({
      ownerUserId: userId,
      platform,
      handle: `acme-${platform}`,
      displayName: `Acme ${platform}`,
    });
  }
}

describe("operator platform", () => {
  let env: ReturnType<typeof withTmpData>;

  beforeEach(() => {
    env = withTmpData();
  });

  afterEach(() => {
    env.restore();
    setTelegramTransportForTests(null);
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

  it("lets each user define social accounts and bind them to roles", async () => {
    const session = login("main", "changeme")!;
    const created = await call("POST", "/app/accounts", {
      token: session.token,
      body: { platform: "twitter", handle: "@acme" },
    });
    expect(created.statusCode).toBe(201);
    const account = (
      created.body as {
        account: { id: string; handle: string; profileUrl: string };
      }
    ).account;
    expect(account.handle).toBe("acme");
    expect(account.profileUrl).toContain("x.com/acme");
    expect(listAccounts(session.user.id)).toHaveLength(1);

    const project = createProject({
      name: "Bound",
      ownerUserId: session.user.id,
    });
    const bound = await call(
      "PUT",
      `/app/projects/${project.id}/roles/twitter-guy`,
      {
        token: session.token,
        params: { id: project.id, slug: "twitter-guy" },
        body: { accountId: account.id },
      },
    );
    expect(bound.statusCode).toBe(200);
    expect(
      listRoles(project.id).find((role) => role.slug === "twitter-guy")
        ?.accountId,
    ).toBe(account.id);

    const foreign = createAccount({
      ownerUserId: "someone-else",
      platform: "twitter",
      handle: "not-yours",
    });
    const denied = await call(
      "PUT",
      `/app/projects/${project.id}/roles/twitter-guy`,
      {
        token: session.token,
        params: { id: project.id, slug: "twitter-guy" },
        body: { accountId: foreign.id },
      },
    );
    expect(denied.statusCode).toBe(400);
  });

  it("skips jobs when the user has not defined a matching account", async () => {
    const session = login("main", "changeme")!;
    const project = createProject({
      name: "No accounts",
      ownerUserId: session.user.id,
    });
    grantTokens(session.user.id, 20);
    const job = await createAndRunJob({
      projectId: project.id,
      ownerUserId: session.user.id,
      roleSlugs: ["twitter-guy"],
    });
    expect(job.status).toBe("completed");
    expect(job.produced).toHaveLength(0);
    expect(job.tokensSpent).toBe(0);
    expect(
      listActivity(project.id).some((row) =>
        String(row.note).includes("Add a twitter account"),
      ),
    ).toBe(true);
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

  it("runs a job that spends tokens and stops when credits run out", async () => {
    const session = login("main", "changeme")!;
    seedAccounts(session.user.id);
    const project = createProject({
      name: "Launch",
      ownerUserId: session.user.id,
      brief: "Announce the quiet-hours feature",
    });
    grantTokens(session.user.id, 2);
    const job = await createAndRunJob({
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
    expect(listActivity(project.id).some((row) => row.accountHandle)).toBe(
      true,
    );
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
    seedAccounts(session.user.id);
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

  it("sends a welcome from the main bot and stores the Telegram desk", async () => {
    const sent: { chatId: string; text: string }[] = [];
    setTelegramTransportForTests(async (chatId, text) => {
      sent.push({ chatId, text });
    });
    const session = login("main", "changeme")!;
    const linked = await call("POST", "/app/auth/telegram", {
      token: session.token,
      body: { telegramId: "555001" },
    });
    expect(linked.statusCode).toBe(200);
    const body = linked.body as { user: { telegramId: string }; sent: boolean };
    expect(body.sent).toBe(true);
    expect(body.user.telegramId).toBe("555001");
    expect(getUser(session.user.id)?.telegramId).toBe("555001");
    expect(sent).toHaveLength(1);
    expect(sent[0].chatId).toBe("555001");
    expect(sent[0].text).toContain("your Social Bro desk");
    expect(sent[0].text).toContain("/approve");

    const me = await call("GET", "/app/auth/me", { token: session.token });
    expect((me.body as { user: { telegramId: string } }).user.telegramId).toBe(
      "555001",
    );
  });

  it("rejects a Telegram id already linked to another user", async () => {
    const sent: string[] = [];
    setTelegramTransportForTests(async (chatId) => {
      sent.push(chatId);
    });
    const other = createUser({ username: "other", id: "user-other" });
    await connectTelegramDesk(other.id, "555002");
    const session = login("main", "changeme")!;
    const denied = await call("POST", "/app/auth/telegram", {
      token: session.token,
      body: { telegramId: "555002" },
    });
    expect(denied.statusCode).toBe(400);
    expect(String((denied.body as { error: string }).error)).toContain(
      "already linked",
    );
    expect(getUser(session.user.id)?.telegramId).toBeUndefined();
    expect(sent).toEqual(["555002"]);
  });

  it("does not save the id when Telegram cannot send", async () => {
    setTelegramTransportForTests(null);
    const previous = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    const session = login("main", "changeme")!;
    await expect(connectTelegramDesk(session.user.id, "555003")).rejects.toThrow(
      "TELEGRAM_BOT_TOKEN is not set",
    );
    expect(getUser(session.user.id)?.telegramId).toBeUndefined();
    if (previous === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previous;
  });

  it("lets a linked desk accept its own drafts and hides other users' items", async () => {
    const session = login("main", "changeme")!;
    setTelegramTransportForTests(async () => {});
    await connectTelegramDesk(session.user.id, "555001");

    const mine = createProject({
      name: "Mine",
      ownerUserId: session.user.id,
    });
    const mineItem = draftItem({
      agent: "twitter-guy",
      platform: "twitter",
      title: "My draft",
      body: "hello",
      projectId: mine.id,
    });

    const other = createUser({ username: "other", id: "user-other" });
    await connectTelegramDesk(other.id, "555002");
    const theirs = createProject({
      name: "Theirs",
      ownerUserId: other.id,
    });
    const theirItem = draftItem({
      agent: "twitter-guy",
      platform: "twitter",
      title: "Not yours",
      body: "secret",
      projectId: theirs.id,
    });

    const approve = contentQueuePlugin.actions?.find(
      (action) => action.name === "APPROVE_DRAFT",
    );
    expect(approve).toBeDefined();

    async function run(text: string, chatId: string) {
      let reply = "";
      await approve!.handler(
        {} as never,
        {
          content: { text, metadata: { chatId } },
        } as never,
        {} as never,
        {},
        async (content) => {
          reply = String(content.text || "");
        },
      );
      return reply;
    }

    const hidden = await run(`/approve ${theirItem.id}`, "555001");
    expect(hidden).toContain("not found");
    expect(listQueue("pending", undefined, theirs.id)[0]?.id).toBe(theirItem.id);

    const accepted = await run(`/accept ${mineItem.id}`, "555001");
    expect(accepted).toContain(`Approved ${mineItem.id}`);
    expect(listQueue("approved", undefined, mine.id)[0]?.id).toBe(mineItem.id);

    const list = contentQueuePlugin.actions?.find(
      (action) => action.name === "LIST_QUEUE",
    );
    let pendingText = "";
    await list!.handler(
      {} as never,
      {
        content: { text: "/pending", metadata: { chatId: "555002" } },
      } as never,
      {} as never,
      {},
      async (content) => {
        pendingText = String(content.text || "");
      },
    );
    expect(pendingText).toContain(theirItem.id);
    expect(pendingText).not.toContain(mineItem.id);
  });

  it("notifies the linked Telegram desk when a job queues a HOLD draft", async () => {
    const sent: string[] = [];
    setTelegramTransportForTests(async (_chatId, text) => {
      sent.push(text);
    });
    const session = login("main", "changeme")!;
    await connectTelegramDesk(session.user.id, "555001");
    seedAccounts(session.user.id);
    const project = createProject({
      name: "Ping",
      ownerUserId: session.user.id,
      brief: "Announce the launch",
    });
    grantTokens(session.user.id, 5);
    const job = await createAndRunJob({
      projectId: project.id,
      ownerUserId: session.user.id,
      roleSlugs: ["twitter-guy"],
    });
    expect(job.produced.length).toBe(1);
    expect(sent.some((text) => text.includes("HOLD") && text.includes(job.produced[0]))).toBe(
      true,
    );
  });
});
