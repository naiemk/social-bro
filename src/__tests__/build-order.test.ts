import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { $ } from "bun";

describe("Build Order Integration Test", () => {
  const rootDir = path.resolve(__dirname, "../..");
  const distDir = path.join(rootDir, "dist");
  const bunBuildMarker = path.join(distDir, "index.js");

  it("should produce a bun bundle under dist/", async () => {
    await $`cd ${rootDir} && bun run build`;

    expect(fs.existsSync(distDir)).toBe(true);
    expect(fs.existsSync(bunBuildMarker)).toBe(true);

    const distFiles = fs.readdirSync(distDir);
    expect(distFiles.length).toBeGreaterThan(0);
  }, 30000);
});
