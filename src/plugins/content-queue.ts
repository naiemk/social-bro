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
import { logger } from "@elizaos/core";
import { appendFeedback, readFeedback } from "../lib/feedback.ts";
import {
  draftItem,
  ensureQueueLayout,
  formatQueueList,
  getItem,
  listQueue,
  moveItem,
} from "../lib/queue.ts";
import { agentSlug, canDraft, recordDraft } from "../lib/rest.ts";
import { scoreContent } from "../lib/sensitivity.ts";

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

const queueDraftAction: Action = {
  name: "QUEUE_DRAFT",
  similes: ["DRAFT_POST", "CREATE_DRAFT", "QUEUE_POST"],
  description:
    "Score a draft and queue it. Low-sensitivity comments/replies auto-approve; posts and high scores wait for a human.",
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const text = textOf(message).toLowerCase();
    if (text.startsWith("/")) return false;
    const decision = canDraft(runtime);
    if (!decision.allowed) return false;
    return /(draft|queue|tweet|thread|caption|script|blog|post|reply|follow-back)/i.test(
      text,
    );
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: unknown,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    const decision = canDraft(runtime);
    if (!decision.allowed) {
      return reply(
        callback,
        message,
        decision.reason || "Resting",
        "QUEUE_DRAFT",
      );
    }
    const slug = agentSlug(runtime);
    const text = textOf(message);
    const platform =
      runtime.getSetting("DEFAULT_PLATFORM")?.toString() ||
      (/(instagram|reel)/i.test(text)
        ? "instagram"
        : /(youtube|short)/i.test(text)
          ? "youtube"
          : /(blog|article)/i.test(text)
            ? "blog"
            : /(reply|thread reply)/i.test(text)
              ? "replies"
              : "twitter");
    const title = text.slice(0, 80) || "Untitled draft";
    const scored = scoreContent({ body: text, platform });
    const item = draftItem({
      agent: slug,
      platform,
      title,
      body: text,
      kind: scored.kind,
      sensitivity: scored.total,
      sensitivityLevel: scored.level,
      flags: scored.flags,
      autoApproved: scored.autoApprove,
      notes: scored.reason,
      risk: scored.autoApprove ? "auto" : scored.level,
    });
    recordDraft(slug);
    logger.info(
      {
        id: item.id,
        platform,
        kind: scored.kind,
        score: scored.total,
        auto: scored.autoApprove,
      },
      "Queued scored draft",
    );
    const next = scored.autoApprove
      ? `Auto-approved ${item.id} (${scored.kind}, score ${scored.total} ${scored.level}). ${scored.flags.length ? `Flags: ${scored.flags.join(", ")}. ` : ""}It skipped the human queue. Use /auto to review today's autos.`
      : `HOLD ${item.id} (${scored.kind}, score ${scored.total} ${scored.level}). ${scored.reason}. Review with /pending then /approve ${item.id}.`;
    return reply(callback, message, next, "QUEUE_DRAFT");
  },
  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "Draft a tweet about our product launch" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "HOLD tw-abc123 (post, score 40 medium). Review with /pending then /approve tw-abc123.",
          actions: ["QUEUE_DRAFT"],
        },
      },
    ],
  ],
};

const listQueueAction: Action = {
  name: "LIST_QUEUE",
  similes: ["PENDING", "SHOW_QUEUE"],
  description: "List content waiting for human approval.",
  validate: async (_runtime, message) =>
    /\/pending|list queue|what is pending/i.test(textOf(message)),
  handler: async (
    _runtime,
    message,
    _state,
    _options,
    callback,
  ): Promise<ActionResult> => {
    const parts = textOf(message).split(/\s+/);
    const platform =
      parts[1] && !parts[1].startsWith("/") ? parts[1] : undefined;
    const items = listQueue("pending", platform);
    return reply(callback, message, formatQueueList(items), "LIST_QUEUE");
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "/pending" } },
      {
        name: "{{agent}}",
        content: {
          text: "- tw-abc [pending/post] score=40 medium HOLD Launch note",
          actions: ["LIST_QUEUE"],
        },
      },
    ],
  ],
};

const listAutoAction: Action = {
  name: "LIST_AUTO",
  similes: ["AUTO_APPROVED", "SHOW_AUTO"],
  description: "List drafts that auto-approved on sensitivity score.",
  validate: async (_runtime, message) =>
    /^\/auto\b|auto-approved|what auto approved/i.test(textOf(message)),
  handler: async (
    _runtime,
    message,
    _state,
    _options,
    callback,
  ): Promise<ActionResult> => {
    const items = listQueue("approved").filter((item) => item.autoApproved);
    return reply(
      callback,
      message,
      items.length
        ? `Auto-approved (no human review):\n${formatQueueList(items)}`
        : "No auto-approved items.",
      "LIST_AUTO",
    );
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "/auto" } },
      {
        name: "{{agent}}",
        content: {
          text: "Auto-approved: re-abc score=12 low",
          actions: ["LIST_AUTO"],
        },
      },
    ],
  ],
};

const approveAction: Action = {
  name: "APPROVE_DRAFT",
  similes: ["APPROVE"],
  description:
    "Human confirms a pending draft. Does not post to social networks.",
  validate: async (_runtime, message) =>
    /^\/approve\s+\S+/i.test(textOf(message)),
  handler: async (
    _runtime,
    message,
    _state,
    _options,
    callback,
  ): Promise<ActionResult> => {
    const id = textOf(message).split(/\s+/)[1];
    const item = moveItem(id, "approved");
    appendFeedback(item.agent, `approved ${item.id}`);
    return reply(
      callback,
      message,
      `Approved ${item.id}. Post it yourself in the native ${item.platform} app, then /published ${item.id}.`,
      "APPROVE_DRAFT",
    );
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "/approve tw-abc123" } },
      {
        name: "{{agent}}",
        content: { text: "Approved tw-abc123.", actions: ["APPROVE_DRAFT"] },
      },
    ],
  ],
};

const rejectAction: Action = {
  name: "REJECT_DRAFT",
  similes: ["REJECT"],
  description: "Human rejects a draft and stores the reason as feedback.",
  validate: async (_runtime, message) =>
    /^\/reject\s+\S+/i.test(textOf(message)),
  handler: async (
    _runtime,
    message,
    _state,
    _options,
    callback,
  ): Promise<ActionResult> => {
    const [, id, ...reasonParts] = textOf(message).split(/\s+/);
    const reason = reasonParts.join(" ") || "rejected";
    const item = moveItem(id, "rejected", reason);
    appendFeedback(item.agent, `rejected ${item.id}: ${reason}`);
    return reply(
      callback,
      message,
      `Rejected ${item.id}. Feedback saved: ${reason}`,
      "REJECT_DRAFT",
    );
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "/reject tw-abc123 too salesy" } },
      {
        name: "{{agent}}",
        content: { text: "Rejected tw-abc123.", actions: ["REJECT_DRAFT"] },
      },
    ],
  ],
};

const editAction: Action = {
  name: "EDIT_DRAFT",
  similes: ["REVISE_DRAFT"],
  description: "Send a draft back with human notes. Keeps it pending.",
  validate: async (_runtime, message) => /^\/edit\s+\S+/i.test(textOf(message)),
  handler: async (
    _runtime,
    message,
    _state,
    _options,
    callback,
  ): Promise<ActionResult> => {
    const [, id, ...noteParts] = textOf(message).split(/\s+/);
    const notes = noteParts.join(" ");
    const existing = getItem(id);
    if (!existing) {
      return { success: false, text: `Queue item not found: ${id}` };
    }
    const item = moveItem(id, "pending", notes);
    appendFeedback(item.agent, `edit ${item.id}: ${notes}`);
    return reply(
      callback,
      message,
      `Sent ${item.id} back for revision. Notes: ${notes}`,
      "EDIT_DRAFT",
    );
  },
  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "/edit tw-abc123 shorter, no emoji" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Sent tw-abc123 back for revision.",
          actions: ["EDIT_DRAFT"],
        },
      },
    ],
  ],
};

const publishedAction: Action = {
  name: "MARK_PUBLISHED",
  similes: ["PUBLISHED"],
  description: "Mark an approved item as published after the human posted it.",
  validate: async (_runtime, message) =>
    /^\/published\s+\S+/i.test(textOf(message)),
  handler: async (
    _runtime,
    message,
    _state,
    _options,
    callback,
  ): Promise<ActionResult> => {
    const id = textOf(message).split(/\s+/)[1];
    const item = moveItem(id, "published");
    return reply(
      callback,
      message,
      `Marked ${item.id} published.`,
      "MARK_PUBLISHED",
    );
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "/published tw-abc123" } },
      {
        name: "{{agent}}",
        content: {
          text: "Marked tw-abc123 published.",
          actions: ["MARK_PUBLISHED"],
        },
      },
    ],
  ],
};

const feedbackAction: Action = {
  name: "STORE_FEEDBACK",
  similes: ["FEEDBACK"],
  description: "Store human feedback on a queue item so future drafts improve.",
  validate: async (_runtime, message) =>
    /^\/feedback\s+\S+/i.test(textOf(message)),
  handler: async (
    _runtime,
    message,
    _state,
    _options,
    callback,
  ): Promise<ActionResult> => {
    const [, id, ...noteParts] = textOf(message).split(/\s+/);
    const item = getItem(id);
    const agent = item?.agent || "shared";
    const notes = noteParts.join(" ");
    appendFeedback(agent, `feedback ${id}: ${notes}`);
    return reply(
      callback,
      message,
      `Saved feedback on ${id} for ${agent}.`,
      "STORE_FEEDBACK",
    );
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "/feedback tw-abc123 good tone" } },
      {
        name: "{{agent}}",
        content: { text: "Saved feedback.", actions: ["STORE_FEEDBACK"] },
      },
    ],
  ],
};

const queueProvider: Provider = {
  name: "CONTENT_QUEUE",
  description: "Pending approvals, rest rules, and recent human feedback.",
  get: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const slug = agentSlug(runtime);
    const pending = listQueue("pending").filter((item) => item.agent === slug);
    const decision = canDraft(runtime);
    const feedback = readFeedback(slug);
    const text = [
      `HITL: original posts, follow-backs, and high-sensitivity items wait for /approve.`,
      `Comments/replies auto-approve when score ≤ AUTO_APPROVE_REPLY_MAX (default 35).`,
      `Rest: ${decision.allowed ? "on shift" : decision.reason}`,
      `Pending HOLD for ${slug}:`,
      formatQueueList(pending),
      `Recent feedback:\n${feedback}`,
    ].join("\n");
    return {
      text,
      data: { pending: pending.length, allowed: decision.allowed },
    };
  },
};

export const contentQueuePlugin: Plugin = {
  name: "content-queue",
  description:
    "Human-in-the-loop content queue with sensitivity auto-approve for low-risk comments.",
  init: async () => {
    ensureQueueLayout();
  },
  actions: [
    queueDraftAction,
    listQueueAction,
    listAutoAction,
    approveAction,
    rejectAction,
    editAction,
    publishedAction,
    feedbackAction,
  ],
  providers: [queueProvider],
  routes: [
    {
      name: "queue-list",
      path: "/queue",
      type: "GET",
      handler: async (req: RouteRequest, res: RouteResponse) => {
        const status =
          typeof req.query?.status === "string" ? req.query.status : "pending";
        const items = listQueue(status as "pending");
        res.json({ items });
      },
    },
  ],
};

export default contentQueuePlugin;
