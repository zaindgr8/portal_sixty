import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

// Prompts live as versioned templates in /prompts/proptech/<name>.md:
//   ---\nversion: 3\nmodel: flash|pro\n---\n<template with {{vars}}>
export const PROMPT_NAMES = ["extract_form_a", "analyse_photos", "transcribe_notes", "copy_en", "copy_ar"] as const;
export type PromptName = (typeof PROMPT_NAMES)[number];

export interface Prompt { name: PromptName; version: string; model: "flash" | "pro"; template: string }

const cache = new Map<PromptName, Prompt>();

export function loadPrompt(name: PromptName): Prompt {
  const hit = process.env.NODE_ENV === "production" ? cache.get(name) : undefined;
  if (hit) return hit;
  const raw = readFileSync(path.join(process.cwd(), "prompts", "proptech", `${name}.md`), "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const meta = Object.fromEntries((m?.[1] ?? "").split("\n").map((l) => l.split(":").map((s) => s.trim())).filter((kv) => kv.length >= 2));
  const p: Prompt = { name, version: meta.version ?? "0", model: meta.model === "pro" ? "pro" : "flash", template: (m?.[2] ?? raw).trim() };
  cache.set(name, p);
  return p;
}

/** Fill {{vars}}. Unknown vars become empty, and values can't inject new {{vars}}. */
export function render(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? "").replace(/\{\{/g, "{ {"));
}
