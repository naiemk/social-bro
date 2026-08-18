import fs from "node:fs";
import { ensureDir, resolveData } from "./paths.ts";

export function appendFeedback(agent: string, line: string): void {
  ensureDir(resolveData("knowledge", "feedback"));
  const file = resolveData("knowledge", "feedback", `${agent}.md`);
  const stamp = new Date().toISOString();
  fs.appendFileSync(file, `- ${stamp} ${line.trim()}\n`);
}

export function readFeedback(agent: string, limit = 10): string {
  const file = resolveData("knowledge", "feedback", `${agent}.md`);
  if (!fs.existsSync(file)) return "No feedback yet.";
  const lines = fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
  return lines.slice(-limit).join("\n");
}
