import { deleteMessagesOlderThan, updatePluginCleanupState } from "../db";
import type { EnvBindings, PluginStateRow } from "../types";
import { ApiError } from "../utils";

const CRON_EXPRESSION = "0 * * * *";
const TOKEN = "message-auto-delete-token";
const DEFAULT_RETENTION_DAYS = 15;
const DEFAULT_CONFIG = [
  "# Delete messages older than this many days.",
  `retentionDays: ${DEFAULT_RETENTION_DAYS}`,
  "",
].join("\n");

const manifest = {
  id: 1,
  token: TOKEN,
  name: "Message Auto Delete",
  modulePath: "builtin/message-auto-delete",
  author: "gotify-server-worker",
  website: "https://developers.cloudflare.com/workers/configuration/cron-triggers/",
  license: "MIT",
  capabilities: ["configurer", "displayer"],
  cronExpressions: [CRON_EXPRESSION],
} as const;

export { manifest };
export const defaultConfig = DEFAULT_CONFIG;

export function validateConfig(config: unknown): void {
  parseConfig(config);
}

export function getDisplay(state: PluginStateRow, config: unknown): string {
  const parsedConfig = parseConfig(config);
  const lines = [
    `# ${manifest.name}`,
    "",
    `- Status: ${state.enabled ? "enabled" : "disabled"}`,
    `- Behavior: hard-delete messages older than **${parsedConfig.retentionDays} days**.`,
    `- Schedule: hourly Cloudflare Cron Trigger (\`${CRON_EXPRESSION}\`, UTC).`,
    "",
    "## Config",
    "",
    `- retentionDays: ${parsedConfig.retentionDays}`,
    `- Last cleanup: ${state.last_cleanup_at ?? "not run yet"}`,
    `- Last deleted count: ${state.last_deleted_count}`,
    `- Last error: ${state.last_error ? `\`${state.last_error}\`` : "none"}`,
  ];

  if (!state.enabled) {
    lines.push("", "Enable this plugin from the plugin list to start scheduled cleanup.");
  }

  return lines.join("\n");
}

export async function onEnable(env: EnvBindings, _state: PluginStateRow, config: unknown): Promise<void> {
  await runCleanup(env, parseConfig(config).retentionDays);
}

export async function onScheduled(
  env: EnvBindings,
  _state: PluginStateRow,
  _controller: ScheduledController,
  config: unknown,
): Promise<void> {
  await runCleanup(env, parseConfig(config).retentionDays);
}

export async function onConfigUpdated(env: EnvBindings, _state: PluginStateRow, config: unknown): Promise<void> {
  await runCleanup(env, parseConfig(config).retentionDays);
}

async function runCleanup(env: EnvBindings, retentionDays: number): Promise<void> {
  const ranAt = new Date().toISOString();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    const deletedCount = await deleteMessagesOlderThan(env.DB, cutoff);
    await updatePluginCleanupState(env.DB, TOKEN, {
      ranAt,
      deletedCount,
      error: null,
    });
    console.log(`message retention cleanup finished at ${ranAt}, deleted=${deletedCount}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown cleanup error";
    await updatePluginCleanupState(env.DB, TOKEN, {
      ranAt,
      deletedCount: 0,
      error: message,
    });
    throw error;
  }
}

function parseConfig(config: unknown): { retentionDays: number } {
  const object = requireConfigObject(config);
  if (typeof object.retentionDays !== "number" || !Number.isInteger(object.retentionDays) || object.retentionDays < 1) {
    throw new ApiError(400, "retentionDays must be an integer greater than or equal to 1");
  }
  const retentionDays = object.retentionDays;

  return { retentionDays };
}

function requireConfigObject(config: unknown): { retentionDays: unknown } {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new ApiError(400, "plugin config must be a yaml object");
  }
  if (!("retentionDays" in config)) {
    throw new ApiError(400, "plugin config must include retentionDays");
  }
  return config as { retentionDays: unknown };
}
