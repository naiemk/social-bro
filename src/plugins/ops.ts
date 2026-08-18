import type {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  Plugin,
  Provider,
  ProviderResult,
  RouteRequest,
  RouteResponse,
  State,
} from "@elizaos/core";
import { logger, Service } from "@elizaos/core";
import {
  HITL_HELP,
  extractChatId,
  isAllowlisted,
  parseHitlCommand,
} from "../lib/hitl.ts";
import {
  formatOpsStatus,
  readOpsStatus,
  snapshotFromRuntime,
  writeAgentSnapshot,
} from "../lib/ops-store.ts";
import { canDraft, getRestConfig, setPaused } from "../lib/rest.ts";

function textOf(message: Memory): string {
  return String(message.content?.text || "").trim();
}

async function reply(
  callback: HandlerCallback | undefined,
  message: Memory,
  text: string,
  action: string,
): Promise<ActionResult> {
  if (callback) {
    await callback({ text, actions: [action], source: message.content.source });
  }
  return { success: true, text };
}

const statusAction: Action = {
  name: "OPS_STATUS",
  similes: ["STATUS", "HEALTH"],
  description: "Show agent rest state, queue backup, and alerts.",
  validate: async (_runtime, message) =>
    /^\/status\b|how are the agents|ops status/i.test(textOf(message)),
  handler: async (
    _runtime,
    message,
    _state,
    _options,
    callback,
  ): Promise<ActionResult> => {
    const slug = textOf(message).split(/\s+/)[1];
    return reply(
      callback,
      message,
      formatOpsStatus(readOpsStatus(), slug),
      "OPS_STATUS",
    );
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "/status" } },
      {
        name: "{{agent}}",
        content: { text: "Ops snapshot...", actions: ["OPS_STATUS"] },
      },
    ],
  ],
};

const pauseAction: Action = {
  name: "PAUSE_AGENT",
  similes: ["REST_NOW"],
  description: "Pause an agent so it stops drafting until resumed.",
  validate: async (_runtime, message) =>
    /^\/pause\s+\S+/i.test(textOf(message)),
  handler: async (
    _runtime,
    message,
    _state,
    _options,
    callback,
  ): Promise<ActionResult> => {
    const slug = textOf(message).split(/\s+/)[1];
    setPaused(slug, true);
    return reply(
      callback,
      message,
      `Paused ${slug}. It will not draft until /resume ${slug}.`,
      "PAUSE_AGENT",
    );
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "/pause twitter-guy" } },
      {
        name: "{{agent}}",
        content: { text: "Paused twitter-guy.", actions: ["PAUSE_AGENT"] },
      },
    ],
  ],
};

const resumeAction: Action = {
  name: "RESUME_AGENT",
  similes: ["WAKE_AGENT"],
  description: "Resume a paused agent.",
  validate: async (_runtime, message) =>
    /^\/resume\s+\S+/i.test(textOf(message)),
  handler: async (
    _runtime,
    message,
    _state,
    _options,
    callback,
  ): Promise<ActionResult> => {
    const slug = textOf(message).split(/\s+/)[1];
    setPaused(slug, false);
    return reply(callback, message, `Resumed ${slug}.`, "RESUME_AGENT");
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "/resume twitter-guy" } },
      {
        name: "{{agent}}",
        content: { text: "Resumed twitter-guy.", actions: ["RESUME_AGENT"] },
      },
    ],
  ],
};

const helpAction: Action = {
  name: "HITL_HELP",
  similes: ["HELP"],
  description: "Explain human-in-the-loop commands.",
  validate: async (_runtime, message) => /^\/help\b/i.test(textOf(message)),
  handler: async (
    _runtime,
    message,
    _state,
    _options,
    callback,
  ): Promise<ActionResult> => {
    return reply(callback, message, HITL_HELP, "HITL_HELP");
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "/help" } },
      {
        name: "{{agent}}",
        content: { text: HITL_HELP, actions: ["HITL_HELP"] },
      },
    ],
  ],
};

const restProvider: Provider = {
  name: "REST_STATUS",
  description: "Whether this agent is on shift, paused, or resting.",
  get: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const decision = canDraft(runtime);
    const config = getRestConfig(runtime);
    const text = decision.allowed
      ? `${config.slug} is on shift. Quiet hours ${config.quietHours} ${config.restTz}. Cap ${config.dailyDraftCap}/day.`
      : `${config.slug} is off: ${decision.reason}. Only P0 support escalations should continue.`;
    return { text, data: { ...decision, ...config } };
  },
};

export class OpsService extends Service {
  static serviceType = "social-ops";
  capabilityDescription =
    "Writes heartbeats to ops/status.json and enforces rest windows.";
  private timer?: ReturnType<typeof setInterval>;
  private lastError: string | null = null;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime) {
    const service = new OpsService(runtime);
    await service.heartbeat();
    service.timer = setInterval(() => {
      service.heartbeat().catch((error) => {
        logger.error({ error }, "Ops heartbeat failed");
      });
    }, 60_000);
    return service;
  }

  static async stop(runtime: IAgentRuntime) {
    const service = runtime.getService(
      OpsService.serviceType,
    ) as OpsService | null;
    if (service) await service.stop();
  }

  async heartbeat() {
    const config = getRestConfig(this.runtime);
    const snapshot = snapshotFromRuntime({
      slug: config.slug,
      name: this.runtime.character.name,
      quietHours: config.quietHours,
      restTz: config.restTz,
      restDays: config.restDays,
      dailyCap: config.dailyDraftCap,
      lastError: this.lastError,
    });
    writeAgentSnapshot(snapshot);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
  }
}

export const opsPlugin: Plugin = {
  name: "ops",
  description:
    "Rest schedules, pause/resume, HITL commands, and agent monitoring.",
  services: [OpsService],
  actions: [statusAction, pauseAction, resumeAction, helpAction],
  providers: [restProvider],
  routes: [
    {
      name: "ops-status",
      path: "/ops/status",
      type: "GET",
      handler: async (_req: RouteRequest, res: RouteResponse) => {
        res.json(readOpsStatus());
      },
    },
  ],
  events: {
    MESSAGE_RECEIVED: [
      async (payload) => {
        const text = String(payload.message?.content?.text || "");
        const command = parseHitlCommand(text);
        if (!command) return;
        const chatId = extractChatId(payload.message);
        if (!isAllowlisted(chatId)) {
          logger.warn(
            { chatId },
            "Blocked HITL command from non-allowlisted chat",
          );
          return;
        }
        logger.info({ command: command.type }, "HITL command received");
      },
    ],
    RUN_ENDED: [
      async (payload) => {
        if (
          payload.status === "timeout" ||
          (payload as { error?: string }).error
        ) {
          logger.warn({ payload }, "Agent run ended with problem");
        }
      },
    ],
  },
};

export default opsPlugin;
