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
import { logger } from "@elizaos/core";
import { ensureDir, resolveData } from "../lib/paths.ts";
import { draftItem } from "../lib/queue.ts";
import { agentSlug, canDraft, recordDraft } from "../lib/rest.ts";

function run(
  cmd: string,
  args: string[],
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
    child.on("error", (error) => resolve({ code: 1, stderr: error.message }));
  });
}

async function ffmpegAvailable(): Promise<boolean> {
  const result = await run("ffmpeg", ["-version"]);
  return result.code === 0;
}

const clipAction: Action = {
  name: "CLIP_VIDEO",
  similes: ["MAKE_CLIP", "CUT_SHORT", "VERTICAL_CLIP"],
  description:
    "Cut a vertical short from media/source using ffmpeg and queue caption package for human approval.",
  validate: async (runtime, message) => {
    if (!canDraft(runtime).allowed) return false;
    return /(clip|short|reel|cut video|ffmpeg)/i.test(
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
    if (!(await ffmpegAvailable())) {
      const text =
        "ffmpeg is not installed. Install ffmpeg, drop source files in media/source/, then ask again.";
      if (callback) await callback({ text, actions: ["CLIP_VIDEO"] });
      return { success: false, text };
    }

    const sourceDir = resolveData("media", "source");
    ensureDir(sourceDir);
    ensureDir(resolveData("media", "clips"));
    const files = fs
      .readdirSync(sourceDir)
      .filter((name) => /\.(mp4|mov|mkv|webm)$/i.test(name));
    if (files.length === 0) {
      const text =
        "No source videos in media/source/. Drop a long-form file there first.";
      if (callback) await callback({ text, actions: ["CLIP_VIDEO"] });
      return { success: false, text };
    }

    const source = path.join(sourceDir, files[0]);
    const outName = `clip-${Date.now()}.mp4`;
    const dest = resolveData("media", "clips", outName);
    const args = [
      "-y",
      "-i",
      source,
      "-t",
      "15",
      "-vf",
      "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      dest,
    ];
    logger.info({ source, dest }, "Rendering vertical clip");
    const result = await run("ffmpeg", args);
    if (result.code !== 0) {
      return {
        success: false,
        text: `ffmpeg failed: ${result.stderr.slice(0, 400)}`,
      };
    }

    const slug = agentSlug(runtime);
    const item = draftItem({
      agent: slug,
      platform:
        runtime.getSetting("DEFAULT_PLATFORM")?.toString() || "instagram",
      title: `Clip from ${files[0]}`,
      body: `Vertical clip ready at media/clips/${outName}\n\nCaption draft:\n${String(message.content?.text || "")}\n\nStatus: pending human confirm. Do not upload until /approve ${"will-assign"}.`,
      media: [`media/clips/${outName}`],
      prefix: "clip",
    });
    recordDraft(slug);
    const text = `Clip rendered to media/clips/${outName}. Queued ${item.id} as pending. Approve before posting.`;
    if (callback) await callback({ text, actions: ["CLIP_VIDEO"] });
    return { success: true, text, data: { id: item.id, dest } };
  },
  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "Cut a 15s reel from the latest source video" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Clip rendered and queued as pending.",
          actions: ["CLIP_VIDEO"],
        },
      },
    ],
  ],
};

export const videoClipsPlugin: Plugin = {
  name: "video-clips",
  description:
    "ffmpeg helper for Instagram/YouTube shorts from local source footage.",
  actions: [clipAction],
};

export default videoClipsPlugin;
