import crypto from "node:crypto";
import fs from "node:fs";
import YAML from "yaml";
import { ensureDir, resolveData, resolveProjectData } from "./paths.ts";
import { seedProjectRoles } from "./roles-store.ts";

export type ProjectStatus =
  "idle" | "running" | "paused" | "stopped_no_credits";

export interface Project {
  id: string;
  name: string;
  ownerUserId: string;
  brief: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

function indexPath(): string {
  return resolveData("platform", "projects.yaml");
}

function projectFile(id: string): string {
  return resolveProjectData(id, "project.yaml");
}

function readIndex(): Project[] {
  const file = indexPath();
  if (!fs.existsSync(file)) return [];
  const parsed = YAML.parse(fs.readFileSync(file, "utf8")) || {};
  return Array.isArray(parsed.projects) ? parsed.projects : [];
}

function writeIndex(projects: Project[]): void {
  ensureDir(resolveData("platform"));
  fs.writeFileSync(indexPath(), YAML.stringify({ projects }));
}

export function listProjects(ownerUserId?: string): Project[] {
  const all = readIndex();
  if (!ownerUserId) return all;
  return all.filter((project) => project.ownerUserId === ownerUserId);
}

export function getProject(id: string): Project | null {
  const fromIndex = readIndex().find((project) => project.id === id);
  if (fromIndex) return fromIndex;
  const file = projectFile(id);
  if (!fs.existsSync(file)) return null;
  const parsed = YAML.parse(fs.readFileSync(file, "utf8"));
  return parsed || null;
}

export function createProject(input: {
  name: string;
  ownerUserId: string;
  brief?: string;
}): Project {
  const now = new Date().toISOString();
  const project: Project = {
    id: `prj-${crypto.randomBytes(4).toString("hex")}`,
    name: input.name.trim() || "Untitled project",
    ownerUserId: input.ownerUserId,
    brief: input.brief?.trim() || "",
    status: "idle",
    createdAt: now,
    updatedAt: now,
  };
  ensureDir(resolveProjectData(project.id));
  fs.writeFileSync(projectFile(project.id), YAML.stringify(project));
  writeIndex([...readIndex(), project]);
  seedProjectRoles(project.id);
  return project;
}

export function updateProject(
  id: string,
  patch: Partial<Pick<Project, "name" | "brief" | "status">>,
): Project {
  const project = getProject(id);
  if (!project) throw new Error("Project not found");
  const next: Project = {
    ...project,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(projectFile(id), YAML.stringify(next));
  writeIndex(readIndex().map((row) => (row.id === id ? next : row)));
  return next;
}

export function deleteProject(id: string): void {
  const project = getProject(id);
  if (!project) throw new Error("Project not found");
  writeIndex(readIndex().filter((row) => row.id !== id));
  fs.rmSync(resolveProjectData(id), { recursive: true, force: true });
}

export function assertProjectOwner(
  project: Project | null,
  userId: string,
): Project {
  if (!project) throw new Error("Project not found");
  if (project.ownerUserId !== userId) throw new Error("Forbidden");
  return project;
}
