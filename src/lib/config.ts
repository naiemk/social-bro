import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export interface VideoProfileConfig {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
}

export interface VideoQualityConfig {
  minDurationSeconds: number;
  maxDurationSeconds: number;
  minWidth: number;
  minHeight: number;
}

export interface ReplicateConfig {
  enabled: boolean;
  model: string;
}

export type BillingActionKey =
  | "draft.post"
  | "draft.reply"
  | "draft.support"
  | "draft.blog"
  | "draft.youtube"
  | "draft.instagram"
  | "draft.follow-back"
  | "video.plan"
  | "video.render";

export interface BillingPackage {
  id: string;
  tokens: number;
  label: string;
}

export interface BillingConfig {
  actions: Record<BillingActionKey, number>;
  packages: BillingPackage[];
}

export interface SocialOpsConfig {
  dataDir: string;
  autoApprove: {
    replyMax: number;
    supportMax: number;
    postMax: number;
    followbackMax: number;
  };
  video: {
    provider: "replicate" | "runway";
    defaultPlatform: "instagram" | "youtube";
    profile: VideoProfileConfig;
    quality: VideoQualityConfig;
    replicate: ReplicateConfig;
  };
  deploy: {
    appPort: number;
  };
  billing: BillingConfig;
}

const defaults: SocialOpsConfig = {
  dataDir: process.cwd(),
  autoApprove: {
    replyMax: 35,
    supportMax: 25,
    postMax: 0,
    followbackMax: 0,
  },
  video: {
    provider: "replicate",
    defaultPlatform: "instagram",
    profile: {
      durationSeconds: 8,
      width: 720,
      height: 1280,
      fps: 24,
    },
    quality: {
      minDurationSeconds: 6,
      maxDurationSeconds: 12,
      minWidth: 540,
      minHeight: 960,
    },
    replicate: {
      enabled: true,
      model: "kwaivgi/kling-v2.1",
    },
  },
  deploy: {
    appPort: 3000,
  },
  billing: {
    actions: {
      "draft.post": 1,
      "draft.reply": 1,
      "draft.support": 1,
      "draft.blog": 3,
      "draft.youtube": 3,
      "draft.instagram": 2,
      "draft.follow-back": 1,
      "video.plan": 5,
      "video.render": 20,
    },
    packages: [
      { id: "starter", tokens: 100, label: "Starter 100" },
      { id: "growth", tokens: 500, label: "Growth 500" },
      { id: "studio", tokens: 2000, label: "Studio 2000" },
    ],
  },
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

let cached: SocialOpsConfig | null = null;

export function getConfigPath(): string {
  const explicit = process.env.SOCIAL_OPS_CONFIG?.trim();
  if (explicit) return path.resolve(explicit);
  return path.resolve(process.cwd(), "config.yaml");
}

export function loadSocialOpsConfig(): SocialOpsConfig {
  if (cached) return cached;
  const filePath = getConfigPath();
  if (!fs.existsSync(filePath)) {
    cached = defaults;
    return cached;
  }

  const parsed = YAML.parse(fs.readFileSync(filePath, "utf8")) || {};
  const root = asObject(parsed);
  const autoApprove = asObject(root.autoApprove);
  const video = asObject(root.video);
  const profile = asObject(video.profile);
  const quality = asObject(video.quality);
  const replicate = asObject(video.replicate);
  const deploy = asObject(root.deploy);
  const billing = asObject(root.billing);
  const billingActions = asObject(billing.actions);
  const packagesRaw = Array.isArray(billing.packages) ? billing.packages : [];

  cached = {
    dataDir: str(root.dataDir, defaults.dataDir),
    autoApprove: {
      replyMax: num(autoApprove.replyMax, defaults.autoApprove.replyMax),
      supportMax: num(autoApprove.supportMax, defaults.autoApprove.supportMax),
      postMax: num(autoApprove.postMax, defaults.autoApprove.postMax),
      followbackMax: num(
        autoApprove.followbackMax,
        defaults.autoApprove.followbackMax,
      ),
    },
    video: {
      provider:
        str(video.provider, defaults.video.provider) === "runway"
          ? "runway"
          : "replicate",
      defaultPlatform:
        str(video.defaultPlatform, defaults.video.defaultPlatform) === "youtube"
          ? "youtube"
          : "instagram",
      profile: {
        durationSeconds: num(
          profile.durationSeconds,
          defaults.video.profile.durationSeconds,
        ),
        width: num(profile.width, defaults.video.profile.width),
        height: num(profile.height, defaults.video.profile.height),
        fps: num(profile.fps, defaults.video.profile.fps),
      },
      quality: {
        minDurationSeconds: num(
          quality.minDurationSeconds,
          defaults.video.quality.minDurationSeconds,
        ),
        maxDurationSeconds: num(
          quality.maxDurationSeconds,
          defaults.video.quality.maxDurationSeconds,
        ),
        minWidth: num(quality.minWidth, defaults.video.quality.minWidth),
        minHeight: num(quality.minHeight, defaults.video.quality.minHeight),
      },
      replicate: {
        enabled: bool(replicate.enabled, defaults.video.replicate.enabled),
        model: str(replicate.model, defaults.video.replicate.model),
      },
    },
    deploy: {
      appPort: num(deploy.appPort, defaults.deploy.appPort),
    },
    billing: {
      actions: {
        "draft.post": num(
          billingActions["draft.post"],
          defaults.billing.actions["draft.post"],
        ),
        "draft.reply": num(
          billingActions["draft.reply"],
          defaults.billing.actions["draft.reply"],
        ),
        "draft.support": num(
          billingActions["draft.support"],
          defaults.billing.actions["draft.support"],
        ),
        "draft.blog": num(
          billingActions["draft.blog"],
          defaults.billing.actions["draft.blog"],
        ),
        "draft.youtube": num(
          billingActions["draft.youtube"],
          defaults.billing.actions["draft.youtube"],
        ),
        "draft.instagram": num(
          billingActions["draft.instagram"],
          defaults.billing.actions["draft.instagram"],
        ),
        "draft.follow-back": num(
          billingActions["draft.follow-back"],
          defaults.billing.actions["draft.follow-back"],
        ),
        "video.plan": num(
          billingActions["video.plan"],
          defaults.billing.actions["video.plan"],
        ),
        "video.render": num(
          billingActions["video.render"],
          defaults.billing.actions["video.render"],
        ),
      },
      packages:
        packagesRaw.length > 0
          ? packagesRaw
              .map((pkg) => {
                const row = asObject(pkg);
                return {
                  id: str(row.id, ""),
                  tokens: num(row.tokens, 0),
                  label: str(row.label, str(row.id, "Package")),
                };
              })
              .filter((pkg) => pkg.id && pkg.tokens > 0)
          : defaults.billing.packages,
    },
  };

  return cached;
}

export function resetConfigCacheForTests(): void {
  cached = null;
}
