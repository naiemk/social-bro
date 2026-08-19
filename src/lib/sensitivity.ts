import { loadSocialOpsConfig } from "./config.ts";

export type ContentKind =
  | "reply"
  | "post"
  | "follow-back"
  | "support"
  | "blog"
  | "youtube"
  | "instagram";

export type SensitivityLevel = "low" | "medium" | "high" | "critical";

export interface SensitivityScore {
  total: number;
  level: SensitivityLevel;
  kind: ContentKind;
  flags: string[];
  autoApprove: boolean;
  reason: string;
}

const LEGAL_FINANCE =
  /\b(refund|chargeback|sue|lawsuit|legal|guaranteed? returns?|investment advice|not financial advice|crypto pump|wire me|wire transfer|ssn|social security)\b/i;
const MEDICAL = /\b(cure|diagnos(?:e|is)|prescription|fda.?approved)\b/i;
const TOXIC = /\b(idiot|stupid|kill yourself|kys|hate you|scam artist)\b/i;
const ENGAGEMENT_BAIT =
  /\b(like and retweet|follow for follow|f4f|comment (yes|yes!) for|drop a like)\b/i;
const FAKE_METRICS =
  /\b(guaranteed|#1 in the world|100% of users|never fails)\b/i;
const PII = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/;
const ANGRY_SUPPORT =
  /\b(lawsuit|attorney|better business bureau|chargeback|stolen|fraud)\b/i;

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function levelFor(total: number): SensitivityLevel {
  if (total >= 80) return "critical";
  if (total >= 50) return "high";
  if (total >= 25) return "medium";
  return "low";
}

export function inferKind(
  platform: string,
  text: string,
  explicit?: string,
): ContentKind {
  if (
    explicit &&
    [
      "reply",
      "post",
      "follow-back",
      "support",
      "blog",
      "youtube",
      "instagram",
    ].includes(explicit)
  ) {
    return explicit as ContentKind;
  }
  const blob = `${platform} ${text}`.toLowerCase();
  if (/follow-?back|follow back/.test(blob)) return "follow-back";
  if (
    platform === "replies" ||
    /\b(reply|replies|comment|comments|thread reply)\b/.test(blob)
  ) {
    return "reply";
  }
  if (platform === "support" || /\b(escalat|password|ticket)\b/.test(blob))
    return "support";
  if (platform === "blog" || /\bblog\b/.test(blob)) return "blog";
  if (platform === "youtube" || /\b(youtube|thumbnail|chapters)\b/.test(blob))
    return "youtube";
  if (platform === "instagram" || /\b(reel|caption|instagram)\b/.test(blob))
    return "instagram";
  return "post";
}

export function getAutoThresholds(): Record<ContentKind, number> {
  const cfg = loadSocialOpsConfig();
  const num = (key: string, fallback: number) => {
    const raw = process.env[key];
    if (raw === undefined || raw.trim() === "") return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    reply: num("AUTO_APPROVE_REPLY_MAX", cfg.autoApprove.replyMax),
    support: num("AUTO_APPROVE_SUPPORT_MAX", cfg.autoApprove.supportMax),
    post: num("AUTO_APPROVE_POST_MAX", cfg.autoApprove.postMax),
    instagram: num("AUTO_APPROVE_POST_MAX", cfg.autoApprove.postMax),
    youtube: num("AUTO_APPROVE_POST_MAX", cfg.autoApprove.postMax),
    blog: num("AUTO_APPROVE_POST_MAX", cfg.autoApprove.postMax),
    "follow-back": num(
      "AUTO_APPROVE_FOLLOWBACK_MAX",
      cfg.autoApprove.followbackMax,
    ),
  };
}

export function scoreContent(input: {
  body: string;
  platform?: string;
  kind?: string;
}): SensitivityScore {
  const kind = inferKind(input.platform || "twitter", input.body, input.kind);
  const flags: string[] = [];
  let total = 0;

  if (kind === "reply") total += 8;
  if (kind === "post" || kind === "instagram") total += 40;
  if (kind === "blog" || kind === "youtube") total += 45;
  if (kind === "follow-back") {
    total += 70;
    flags.push("follow-back-review");
  }
  if (kind === "support") total += 20;

  if (LEGAL_FINANCE.test(input.body)) {
    total += 45;
    flags.push("legal-or-finance");
  }
  if (MEDICAL.test(input.body)) {
    total += 40;
    flags.push("medical-claim");
  }
  if (TOXIC.test(input.body)) {
    total += 35;
    flags.push("toxic");
  }
  if (ENGAGEMENT_BAIT.test(input.body)) {
    total += 25;
    flags.push("engagement-bait");
  }
  if (FAKE_METRICS.test(input.body)) {
    total += 30;
    flags.push("unverified-claim");
  }
  if (PII.test(input.body)) {
    total += 40;
    flags.push("possible-pii");
  }
  if (kind === "support" && ANGRY_SUPPORT.test(input.body)) {
    total += 40;
    flags.push("support-escalation");
  }

  total = clamp(total);
  const level = levelFor(total);
  const max = getAutoThresholds()[kind];
  const autoApprove =
    total <= max &&
    !flags.includes("legal-or-finance") &&
    !flags.includes("support-escalation");
  const reason = autoApprove
    ? `${kind} scored ${total} (${level}) ≤ auto threshold ${max}`
    : `${kind} scored ${total} (${level}) — hold for human (threshold ${max})`;

  return { total, level, kind, flags, autoApprove, reason };
}
