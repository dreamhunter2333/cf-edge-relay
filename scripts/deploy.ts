import { writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse, type ParseError } from "jsonc-parser";

const raw = process.env.WRANGLER_CONFIG;
if (!raw?.trim()) throw new Error("WRANGLER_CONFIG is required");
if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error("CLOUDFLARE_API_TOKEN is required");
const dryRun = process.argv.slice(2).includes("--dry-run");
const errors: ParseError[] = [];
const parsed: unknown = parse(raw, errors, { allowTrailingComma: true });
if (errors.length) throw new Error("WRANGLER_CONFIG contains invalid JSONC");
const configs: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
if (!configs.length) throw new Error("At least one deployment configuration is required");
const names = new Set<string>();
for (const config of configs) {
  if (typeof config !== "object" || config === null || Array.isArray(config) ||
      !("name" in config) || typeof config.name !== "string" || !config.name ||
      !("main" in config) || typeof config.main !== "string" || !config.main) {
    throw new Error("Each configuration must include a Worker name and main entry point");
  }
  if (names.has(config.name)) throw new Error("Deployment configurations must use unique Worker names");
  names.add(config.name);
}

function mask(value: unknown): void {
  if (typeof value === "string") {
    const values = [value];
    if (/^https?:\/\//.test(value)) {
      try { values.push(new URL(value).hostname); } catch {}
    }
    for (const item of values) {
      if (!item) continue;
      const escaped = item.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
      process.stdout.write(`::add-mask::${escaped}\n`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) mask(item);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) mask(item);
  }
}

if (process.env.GITHUB_ACTIONS === "true") mask(configs);
for (const [index, config] of configs.entries()) {
  const file = resolve(`wrangler.ci-${index}.local.jsonc`);
  writeFileSync(file, JSON.stringify(config), { mode: 0o600, flag: "wx" });
  try {
    const args = ["exec", "wrangler", "deploy", "--config", file];
    if (dryRun) args.push("--dry-run");
    const result = spawnSync("pnpm", args, {
      stdio: "inherit",
      env: { ...process.env, WRANGLER_LOG: "error", CI: "true" },
    });
    if (result.error || result.status !== 0) throw new Error(`Deployment ${index + 1} failed`);
    console.log(`Deployment ${index + 1}/${configs.length} ${dryRun ? "validated" : "completed"}`);
  } finally {
    unlinkSync(file);
  }
}
