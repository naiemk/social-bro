import type { Character } from "@elizaos/core";

export const HITL_RULES = [
  "Never publish, post, like, follow, or send outbound social content yourself.",
  "Always put drafts in the pending queue and wait for a human /approve.",
  "If you are paused or in quiet hours, say you are resting unless the issue is a P0 support escalation.",
  "Read recent human feedback before drafting.",
  "Do not invent discounts, refunds, legal promises, or fake engagement.",
  "No mass follow-backs, no reply spam, no scraping private data.",
];

export function sharedPlugins(extra: string[] = []): string[] {
  const hasRemoteLlm = Boolean(
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.ANTHROPIC_API_KEY?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    process.env.ELIZAOS_API_KEY?.trim(),
  );

  return [
    "@elizaos/plugin-sql",
    ...(process.env.ANTHROPIC_API_KEY?.trim()
      ? ["@elizaos/plugin-anthropic"]
      : []),
    ...(process.env.ELIZAOS_API_KEY?.trim()
      ? ["@elizaos/plugin-elizacloud"]
      : []),
    ...(process.env.OPENROUTER_API_KEY?.trim()
      ? ["@elizaos/plugin-openrouter"]
      : []),
    ...(process.env.OPENAI_API_KEY?.trim() ? ["@elizaos/plugin-openai"] : []),
    ...(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()
      ? ["@elizaos/plugin-google-genai"]
      : []),
    ...(!hasRemoteLlm || process.env.OLLAMA_API_ENDPOINT?.trim()
      ? ["@elizaos/plugin-ollama"]
      : []),
    ...extra,
    ...(!process.env.IGNORE_BOOTSTRAP ? ["@elizaos/plugin-bootstrap"] : []),
  ];
}

export const sharedKnowledge: Character["knowledge"] = [
  { path: "knowledge/brand.md", shared: true },
  { directory: "knowledge/feedback", shared: true },
];

export function baseSettings(
  slug: string,
  extra: Record<string, string | number | boolean> = {},
) {
  return {
    secrets: {},
    AGENT_SLUG: slug,
    DRY_RUN: true,
    QUIET_HOURS: process.env.QUIET_HOURS || "22:00-08:00",
    REST_TZ: process.env.REST_TZ || "UTC",
    REST_DAYS: process.env.REST_DAYS || "",
    DAILY_DRAFT_CAP: extra.DAILY_DRAFT_CAP ?? 8,
    COOLDOWN_MINUTES: extra.COOLDOWN_MINUTES ?? 15,
    ...extra,
  };
}
