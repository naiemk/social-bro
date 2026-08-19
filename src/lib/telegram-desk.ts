import {
  findUserByTelegramId,
  getUser,
  linkedTelegramIds,
  updateUser,
  type PlatformUser,
} from "./auth.ts";
import { extractChatId, HITL_HELP, isAllowlisted } from "./hitl.ts";
import { getProject, listProjects } from "./projects.ts";
import {
  formatQueueList,
  getItem,
  listQueue,
  type QueueItem,
} from "./queue.ts";

export type TelegramTransport = (
  chatId: string,
  text: string,
) => Promise<void>;

let testTransport: TelegramTransport | null = null;

export function setTelegramTransportForTests(
  transport: TelegramTransport | null,
): void {
  testTransport = transport;
}

export function normalizeTelegramId(raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error("Telegram id is required");
  if (/^-?\d+$/.test(value)) return value;
  if (/^@?[A-Za-z0-9_]{5,}$/.test(value)) {
    return value.startsWith("@") ? value : `@${value}`;
  }
  throw new Error(
    "Use your numeric Telegram user id (Telegram → Settings → Advanced) or @username",
  );
}

export function deskWelcomeText(): string {
  return `This Telegram chat is now your Social Bro desk.

When agents draft posts, they land here. Accept or reject them in this chat:

/pending — items waiting for you
/approve <id> or /accept <id> — accept a draft
/reject <id> <reason> — reject it
/help — all commands

${HITL_HELP}`;
}

export function holdNotice(item: QueueItem): string {
  const account = item.accountHandle ? ` @${item.accountHandle}` : "";
  const score =
    item.sensitivity === undefined
      ? ""
      : ` score=${item.sensitivity} ${item.sensitivityLevel || ""}`;
  return `HOLD ${item.id} [${item.platform}${account}]${score}
${item.title}

/approve ${item.id}
/reject ${item.id}`;
}

async function defaultSend(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set");
  }
  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    },
  );
  const payload = (await response.json()) as {
    ok?: boolean;
    description?: string;
  };
  if (!payload.ok) {
    throw new Error(
      payload.description ||
        "Telegram could not deliver the message. Open the bot in Telegram, tap Start, then save your id again.",
    );
  }
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<void> {
  const send = testTransport || defaultSend;
  await send(chatId, text);
}

export async function connectTelegramDesk(
  userId: string,
  telegramIdRaw: string,
): Promise<{ user: PlatformUser; sent: boolean }> {
  const telegramId = normalizeTelegramId(telegramIdRaw);
  const taken = findUserByTelegramId(telegramId);
  if (taken && taken.id !== userId) {
    throw new Error("That Telegram id is already linked to another user");
  }
  await sendTelegramMessage(telegramId, deskWelcomeText());
  const user = updateUser(userId, {
    telegramId,
    telegramLinkedAt: new Date().toISOString(),
  });
  return { user, sent: true };
}

export async function notifyUserDesk(
  userId: string,
  text: string,
): Promise<boolean> {
  const user = getUser(userId);
  if (!user?.telegramId) return false;
  try {
    await sendTelegramMessage(user.telegramId, text);
    return true;
  } catch {
    return false;
  }
}

export function listOwnedQueue(
  userId: string,
  status?: QueueItem["status"],
  platform?: string,
): QueueItem[] {
  return listProjects(userId).flatMap((project) =>
    listQueue(status, platform, project.id),
  );
}

export function userOwnsItem(userId: string, item: QueueItem): boolean {
  if (!item.projectId) return false;
  const project = getProject(item.projectId);
  return project?.ownerUserId === userId;
}

export interface DeskAccess {
  ok: true;
  user: PlatformUser | null;
  chatId?: string;
  scoped: boolean;
}

export interface DeskDenied {
  ok: false;
  error: string;
}

export function resolveDesk(message: {
  content?: { source?: string; metadata?: unknown };
  metadata?: unknown;
}): DeskAccess | DeskDenied {
  const chatId = extractChatId(message);
  const linked = findUserByTelegramId(chatId);
  if (linked) return { ok: true, user: linked, chatId, scoped: true };
  if (!isAllowlisted(chatId)) {
    return {
      ok: false,
      error:
        "This Telegram chat is not linked. Add your Telegram id in the dashboard, open the bot, and tap Start.",
    };
  }
  return { ok: true, user: null, chatId, scoped: false };
}

export function itemsForDesk(
  access: DeskAccess,
  status?: QueueItem["status"],
  platform?: string,
): QueueItem[] {
  if (access.scoped && access.user) {
    return listOwnedQueue(access.user.id, status, platform);
  }
  return listQueue(status, platform);
}

export function formatDeskQueue(
  access: DeskAccess,
  status?: QueueItem["status"],
  platform?: string,
): string {
  const items = itemsForDesk(access, status, platform);
  if (items.length === 0) {
    return access.scoped ? "Nothing waiting in your desk." : formatQueueList(items);
  }
  return formatQueueList(items);
}

export function assertDeskItem(
  access: DeskAccess,
  id: string,
): QueueItem | string {
  const item = getItem(id);
  if (!item) return `Queue item not found: ${id}`;
  if (access.scoped && access.user && !userOwnsItem(access.user.id, item)) {
    return `Queue item not found: ${id}`;
  }
  return item;
}

export function hasLinkedTelegramUsers(): boolean {
  return linkedTelegramIds().length > 0;
}
