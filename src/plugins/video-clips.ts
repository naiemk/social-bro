import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  Plugin,
} from "@elizaos/core";
import { logger, ModelType } from "@elizaos/core";
import { loadSocialOpsConfig } from "../lib/config.ts";
import { ensureDir, resolveData } from "../lib/paths.ts";
import { draftItem, getItem } from "../lib/queue.ts";
import { agentSlug, canDraft, recordDraft } from "../lib/rest.ts";

function run(
  cmd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) =>
      resolve({ code: code ?? 1, stdout, stderr }),
    );
    child.on("error", (error) =>
      resolve({ code: 1, stdout, stderr: error.message }),
    );
  });
}

async function ffmpegAvailable(): Promise<boolean> {
  const result = await run("ffmpeg", ["-version"]);
  return result.code === 0;
}

interface ClipProbe {
  durationSeconds: number;
  width: number;
  height: number;
}

async function ffprobeClip(filePath: string): Promise<ClipProbe | null> {
  const result = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=width,height:format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  if (result.code !== 0) return null;
  const lines = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 3) return null;
  return {
    width: Number(lines[0]),
    height: Number(lines[1]),
    durationSeconds: Number(lines[2]),
  };
}

async function generateScenarioScript(
  runtime: IAgentRuntime,
  request: string,
  platform: "instagram" | "youtube",
): Promise<string> {
  const cfg = loadSocialOpsConfig();
  const prompt = `You are a short-form video writer for ${platform}.
Return only markdown with sections:
- Hook
- Scenario
- Script
- Shot list
- CTA

Request: ${request}
Target duration: ${cfg.video.profile.durationSeconds}s
Format: ${cfg.video.profile.width}x${cfg.video.profile.height} ${cfg.video.profile.fps}fps`;

  try {
    const text = await (runtime as any).useModel(ModelType.TEXT_LARGE, {
      prompt,
      temperature: 0.5,
    });
    if (typeof text === "string" && text.trim()) return text.trim();
  } catch (error) {
    logger.warn({ error }, "Model generation failed, using fallback template");
  }

  return `## Hook
One sharp sentence that names the problem.

## Scenario
Creator explains the problem, then demonstrates a fast win.

## Script
1) Problem in 2 seconds.
2) Proof in 4 seconds.
3) Result + CTA in 2 seconds.

## Shot list
- Shot 1: tight talking-head opener
- Shot 2: product close-up with action
- Shot 3: before/after visual

## CTA
Save this and try it today.`;
}

async function pollReplicate(getUrl: string): Promise<any> {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(getUrl, {
      headers: {
        Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN || ""}`,
      },
    });
    if (!res.ok) {
      throw new Error(`Replicate polling failed: ${res.status}`);
    }
    const json = await res.json();
    if (json.status === "succeeded") return json;
    if (json.status === "failed" || json.status === "canceled") {
      throw new Error(`Replicate status ${json.status}: ${json.error || ""}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Replicate generation timed out");
}

async function generateViaReplicate(
  prompt: string,
  platform: "instagram" | "youtube",
): Promise<{ outputUrl: string; model: string }> {
  const cfg = loadSocialOpsConfig();
  if (!process.env.REPLICATE_API_TOKEN?.trim()) {
    throw new Error("REPLICATE_API_TOKEN is missing");
  }
  const aspectRatio = platform === "youtube" ? "9:16" : "9:16";
  const create = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
    },
    body: JSON.stringify({
      model: cfg.video.replicate.model,
      input: {
        prompt,
        duration: cfg.video.profile.durationSeconds,
        aspect_ratio: aspectRatio,
      },
    }),
  });
  if (!create.ok) {
    const text = await create.text();
    throw new Error(`Replicate create failed: ${create.status} ${text}`);
  }
  const created = await create.json();
  const done = await pollReplicate(created.urls.get);
  const output = Array.isArray(done.output) ? done.output[0] : done.output;
  if (!output || typeof output !== "string") {
    throw new Error("Replicate returned no output URL");
  }
  return { outputUrl: output, model: cfg.video.replicate.model };
}

async function downloadToFile(url: string, filePath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, bytes);
}

const planVideoAction: Action = {
  name: "PLAN_AI_VIDEO",
  similes: ["VIDEO_SCENARIO", "VIDEO_SCRIPT", "PLAN_CLIP"],
  description:
    "Generate AI clip scenario + script, then queue it for human review.",
  validate: async (runtime, message) => {
    if (!canDraft(runtime).allowed) return false;
    return /(scenario|script|short video|reel idea|video idea|plan clip)/i.test(
      String(message.content?.text || ""),
    );
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state,
    _options,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    const decision = canDraft(runtime);
    if (!decision.allowed) {
      return { success: false, text: decision.reason };
    }
    const platform = /youtube/i.test(String(message.content?.text || ""))
      ? "youtube"
      : "instagram";
    const plan = await generateScenarioScript(
      runtime,
      String(message.content?.text || ""),
      platform,
    );
    const slug = agentSlug(runtime);
    const item = draftItem({
      agent: slug,
      platform,
      title: `AI video plan: ${String(message.content?.text || "").slice(0, 60)}`,
      body: `${plan}\n\n---\nRender command after approval:\n/render-video ${"replace-with-approved-id"}`,
      prefix: "vplan",
      kind: "video-plan",
    });
    recordDraft(slug);
    const text = `Queued video plan ${item.id} (${platform}). Review/edit, then /approve ${item.id}. After approval, run /render-video ${item.id}.`;
    if (callback) await callback({ text, actions: ["PLAN_AI_VIDEO"] });
    return { success: true, text, data: { id: item.id } };
  },
  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "Create an instagram reel scenario and script for our new feature" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Queued video plan and script for approval.",
          actions: ["PLAN_AI_VIDEO"],
        },
      },
    ],
  ],
};

const renderVideoAction: Action = {
  name: "RENDER_AI_VIDEO",
  similes: ["GENERATE_VIDEO", "RENDER_VIDEO"],
  description:
    "Generate approved video scripts through Replicate and run quality checks.",
  validate: async (_runtime, message) =>
    /^\/render-video\s+\S+/i.test(String(message.content?.text || "").trim()),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state,
    _options,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    const parts = String(message.content?.text || "").trim().split(/\s+/);
    const sourceId = parts[1];
    const existing = getItem(sourceId);
    if (!existing) return { success: false, text: `Queue item not found: ${sourceId}` };
    if (existing.status !== "approved") {
      return {
        success: false,
        text: `${sourceId} must be approved first. Use /approve ${sourceId}.`,
      };
    }
    if (existing.kind !== "video-plan") {
      return {
        success: false,
        text: `${sourceId} is not a video plan (kind=${existing.kind || "unknown"}).`,
      };
    }

    ensureDir(resolveData("media", "clips"));
    if (!(await ffmpegAvailable())) {
      return {
        success: false,
        text: "ffmpeg/ffprobe are required for quality checks.",
      };
    }

    const platform =
      String(existing.platform).toLowerCase() === "youtube"
        ? "youtube"
        : "instagram";
    const rendered = await generateViaReplicate(existing.body, platform);
    const outName = `ai-${Date.now()}-${sourceId}.mp4`;
    const dest = resolveData("media", "clips", outName);
    await downloadToFile(rendered.outputUrl, dest);
    const probe = await ffprobeClip(dest);
    if (!probe) {
      return { success: false, text: "Generated video, but quality probe failed." };
    }
    const cfg = loadSocialOpsConfig();
    const qualityPass =
      probe.durationSeconds >= cfg.video.quality.minDurationSeconds &&
      probe.durationSeconds <= cfg.video.quality.maxDurationSeconds &&
      probe.width >= cfg.video.quality.minWidth &&
      probe.height >= cfg.video.quality.minHeight;
    const qualitySummary = `duration=${probe.durationSeconds.toFixed(2)}s, resolution=${probe.width}x${probe.height}, threshold=${cfg.video.quality.minWidth}x${cfg.video.quality.minHeight}, duration range=${cfg.video.quality.minDurationSeconds}-${cfg.video.quality.maxDurationSeconds}s`;

    const slug = agentSlug(runtime);
    const item = draftItem({
      agent: slug,
      platform,
      title: `Rendered AI video from ${sourceId}`,
      body: `Source plan: ${sourceId}\nModel: ${rendered.model}\nQuality: ${qualityPass ? "PASS" : "REVIEW"} (${qualitySummary})\n\nDownload URL used:\n${rendered.outputUrl}`,
      media: [`media/clips/${outName}`],
      prefix: "clip",
      kind: "video-render",
      notes: qualitySummary,
      autoApproved: false,
    });
    recordDraft(slug);
    const text = `Rendered ${item.id} from ${sourceId}. Quality ${qualityPass ? "PASS" : "NEEDS REVIEW"} (${qualitySummary}). Review with /pending and approve when ready.`;
    if (callback) await callback({ text, actions: ["RENDER_AI_VIDEO"] });
    return { success: true, text, data: { id: item.id, file: dest, qualityPass } };
  },
};

export const videoClipsPlugin: Plugin = {
  name: "video-clips",
  description:
    "AI video planning + Replicate rendering with ffmpeg quality checks.",
  actions: [planVideoAction, renderVideoAction],
};

export default videoClipsPlugin;
