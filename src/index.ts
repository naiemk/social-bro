import {
  logger,
  type IAgentRuntime,
  type Project,
  type ProjectAgent,
} from "@elizaos/core";
import starterPlugin from "./plugin.ts";
import { character } from "./character.ts";
import { twitterGuy } from "./characters/twitter-guy.ts";
import { instagramGuy } from "./characters/instagram-guy.ts";
import { tgGuy } from "./characters/tg-guy.ts";
import { youtubeGuy } from "./characters/youtube-guy.ts";
import { blogGuy } from "./characters/blog-guy.ts";
import contentQueuePlugin from "./plugins/content-queue.ts";
import opsPlugin from "./plugins/ops.ts";
import dashboardPlugin from "./plugins/dashboard.ts";
import videoClipsPlugin from "./plugins/video-clips.ts";
import whatsappPlugin from "./plugins/whatsapp.ts";

const sharedRuntimePlugins = [contentQueuePlugin, opsPlugin, dashboardPlugin];

function initNamed(name: string) {
  return async (runtime: IAgentRuntime) => {
    logger.info(
      { name, agentId: runtime.agentId },
      "Initializing social-ops agent",
    );
  };
}

export const projectAgent: ProjectAgent = {
  character,
  init: initNamed(character.name),
  plugins: [starterPlugin],
};

const twitterAgent: ProjectAgent = {
  character: twitterGuy,
  init: initNamed(twitterGuy.name),
  plugins: [...sharedRuntimePlugins],
};

const instagramAgent: ProjectAgent = {
  character: instagramGuy,
  init: initNamed(instagramGuy.name),
  plugins: [...sharedRuntimePlugins, videoClipsPlugin],
};

const tgAgent: ProjectAgent = {
  character: tgGuy,
  init: initNamed(tgGuy.name),
  plugins: [
    ...sharedRuntimePlugins,
    videoClipsPlugin,
    ...(String(process.env.WHATSAPP_ENABLED).toLowerCase() === "true"
      ? [whatsappPlugin]
      : []),
  ],
};

const youtubeAgent: ProjectAgent = {
  character: youtubeGuy,
  init: initNamed(youtubeGuy.name),
  plugins: [...sharedRuntimePlugins, videoClipsPlugin],
};

const blogAgent: ProjectAgent = {
  character: blogGuy,
  init: initNamed(blogGuy.name),
  plugins: [...sharedRuntimePlugins],
};

const project: Project = {
  agents: [twitterAgent, instagramAgent, tgAgent, youtubeAgent, blogAgent],
};

export { character } from "./character.ts";
export default project;
