import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadSocialOpsConfig,
  resetConfigCacheForTests,
} from "../lib/config.ts";

describe("config.yaml loader", () => {
  let tmpDir: string;
  const prevConfig = process.env.SOCIAL_OPS_CONFIG;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "social-bro-config-"));
    process.env.SOCIAL_OPS_CONFIG = path.join(tmpDir, "config.yaml");
    resetConfigCacheForTests();
  });

  afterEach(() => {
    if (prevConfig === undefined) delete process.env.SOCIAL_OPS_CONFIG;
    else process.env.SOCIAL_OPS_CONFIG = prevConfig;
    resetConfigCacheForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uses defaults when config.yaml is absent", () => {
    const cfg = loadSocialOpsConfig();
    expect(cfg.autoApprove.replyMax).toBe(35);
    expect(cfg.video.provider).toBe("replicate");
  });

  it("reads explicit yaml settings", () => {
    fs.writeFileSync(
      process.env.SOCIAL_OPS_CONFIG!,
      `autoApprove:\n  replyMax: 12\nvideo:\n  replicate:\n    model: test/model\n`,
    );
    resetConfigCacheForTests();
    const cfg = loadSocialOpsConfig();
    expect(cfg.autoApprove.replyMax).toBe(12);
    expect(cfg.video.replicate.model).toBe("test/model");
  });
});
