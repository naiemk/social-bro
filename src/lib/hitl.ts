import { linkedTelegramIds } from "./auth.ts";

export type HitlCommand =
  | { type: "pending"; platform?: string }
  | { type: "approve"; id: string }
  | { type: "reject"; id: string; reason: string }
  | { type: "edit"; id: string; notes: string }
  | { type: "published"; id: string }
  | { type: "feedback"; id: string; notes: string }
  | { type: "status"; slug?: string }
  | { type: "pause"; slug: string }
  | { type: "resume"; slug: string }
  | { type: "auto" }
  | { type: "help" };

const COMMAND_RE =
  /^\/(pending|approve|accept|reject|edit|published|feedback|status|pause|resume|auto|help)(?:\s+(.+))?$/i;

export function parseHitlCommand(text: string): HitlCommand | null {
  const trimmed = text.trim();
  const match = trimmed.match(COMMAND_RE);
  if (!match) return null;
  const name = match[1].toLowerCase();
  const rest = (match[2] || "").trim();
  const [first, ...more] = rest.split(/\s+/);
  const remainder = more.join(" ").trim();

  switch (name) {
    case "pending":
      return { type: "pending", platform: first || undefined };
    case "approve":
    case "accept":
      return first ? { type: "approve", id: first } : null;
    case "reject":
      return first
        ? { type: "reject", id: first, reason: remainder || "rejected" }
        : null;
    case "edit":
      return first ? { type: "edit", id: first, notes: remainder } : null;
    case "published":
      return first ? { type: "published", id: first } : null;
    case "feedback":
      return first ? { type: "feedback", id: first, notes: remainder } : null;
    case "status":
      return { type: "status", slug: first || undefined };
    case "pause":
      return first ? { type: "pause", slug: first } : null;
    case "resume":
      return first ? { type: "resume", slug: first } : null;
    case "auto":
      return { type: "auto" };
    case "help":
      return { type: "help" };
    default:
      return null;
  }
}

/**
 * Linked dashboard Telegram desks are always allowed.
 * HITL_CHAT_IDS is an extra operator allowlist.
 * Empty env and no linked desks = allow all (dev / existing tests).
 */
export function isAllowlisted(chatId?: string | number | null): boolean {
  const raw = process.env.HITL_CHAT_IDS?.trim();
  const linked = linkedTelegramIds();
  if (!raw && linked.length === 0) return true;
  if (chatId === undefined || chatId === null || String(chatId) === "")
    return false;
  const id = String(chatId);
  if (linked.includes(id)) return true;
  if (!raw) return false;
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(id);
}

export function extractChatId(message: {
  content?: { source?: string; url?: string; metadata?: unknown };
  metadata?: unknown;
}): string | undefined {
  const meta = {
    ...((typeof message.metadata === "object" && message.metadata) || {}),
    ...((typeof message.content?.metadata === "object" &&
      message.content.metadata) ||
      {}),
  } as Record<string, unknown>;
  const chat =
    typeof meta.chat === "object" && meta.chat
      ? (meta.chat as Record<string, unknown>)
      : null;
  const from =
    typeof meta.from === "object" && meta.from
      ? (meta.from as Record<string, unknown>)
      : null;
  const candidate =
    meta.chatId ||
    meta.chat_id ||
    meta.channelId ||
    meta.userId ||
    meta.fromId ||
    chat?.id ||
    from?.id;
  return candidate !== undefined && candidate !== null
    ? String(candidate)
    : undefined;
}

export const HITL_HELP = `Human-in-the-loop commands:
/pending [platform] — items that NEED your eyes (high sensitivity)
/auto — low-sensitivity comments that already auto-approved
/approve <id> — confirm a held draft
/accept <id> — same as /approve
/render-video <approved-plan-id> — generate approved IG/YT script with AI video provider
/edit <id> <notes> — send back to the agent
/reject <id> <reason> — kill it and store feedback
/published <id> — you already posted it
/feedback <id> <notes> — extra notes after publish
/status [agent] — health, rest, queue
/pause <agent> — rest this agent now
/resume <agent> — wake it
/help — this list

Link your Telegram id in the dashboard so this chat is your personal desk.
Comments/replies auto-go when sensitivity ≤ 35.
Original posts, follow-backs, legal/finance, and high scores stay on HOLD.`;
