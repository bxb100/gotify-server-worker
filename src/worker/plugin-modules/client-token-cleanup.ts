import { deleteClient, getClientsLastUsedBefore, updatePluginCleanupState } from "../db";
import type { ClientRow, EnvBindings, PluginStateRow } from "../types";
import { ApiError } from "../utils";

const CRON_EXPRESSION = "0 * * * *";
const TOKEN = "client-token-cleanup";
const DEFAULT_CONFIG = [
  "# Delete client tokens whose name matches this regex and whose last login is older than the configured days.",
  "clientNameRegex: ^$",
  "lastLoginOlderThanDays: 2",
  "",
].join("\n");

const manifest = {
  id: 2,
  token: TOKEN,
  name: "Client Token Cleanup",
  modulePath: "builtin/client-token-cleanup",
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
    `- Behavior: delete client tokens whose name matches \`${parsedConfig.clientNameRegex}\` and whose last login is older than **${parsedConfig.lastLoginOlderThanDays} days**.`,
    `- Schedule: hourly Cloudflare Cron Trigger (\`${CRON_EXPRESSION}\`, UTC).`,
    "",
    "## Config",
    "",
    `- clientNameRegex: \`${parsedConfig.clientNameRegex}\``,
    `- lastLoginOlderThanDays: ${parsedConfig.lastLoginOlderThanDays}`,
    `- Last cleanup: ${state.last_cleanup_at ?? "not run yet"}`,
    `- Last deleted count: ${state.last_deleted_count}`,
    `- Last error: ${state.last_error ? `\`${state.last_error}\`` : "none"}`,
  ];

  if (parsedConfig.clientNameRegex === "^$") {
    lines.push(
      "",
      "Current regex is a safe no-op default. Update the config before enabling if you want deletions to happen.",
    );
  }

  if (!state.enabled) {
    lines.push("", "Enable this plugin from the plugin list to start scheduled cleanup.");
  }

  return lines.join("\n");
}

export async function onEnable(env: EnvBindings, _state: PluginStateRow, config: unknown): Promise<void> {
  await runCleanup(env, parseConfig(config));
}

export async function onScheduled(
  env: EnvBindings,
  _state: PluginStateRow,
  _controller: ScheduledController,
  config: unknown,
): Promise<void> {
  await runCleanup(env, parseConfig(config));
}

export async function onConfigUpdated(env: EnvBindings, _state: PluginStateRow, config: unknown): Promise<void> {
  await runCleanup(env, parseConfig(config));
}

async function runCleanup(env: EnvBindings, config: ParsedConfig): Promise<void> {
  const ranAt = new Date().toISOString();
  const cutoff = new Date(Date.now() - config.lastLoginOlderThanDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    const candidates = await getClientsLastUsedBefore(env.DB, cutoff);
    const matched = candidates.filter((client) => config.clientNamePattern.test(client.name));

    let deletedCount = 0;
    for (const client of matched) {
      deletedCount += await deleteClientById(env, client);
    }

    await updatePluginCleanupState(env.DB, TOKEN, {
      ranAt,
      deletedCount,
      error: null,
    });
    console.log(`client token cleanup finished at ${ranAt}, deleted=${deletedCount}`);
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

async function deleteClientById(env: EnvBindings, client: ClientRow): Promise<number> {
  const result = await deleteClient(env.DB, client.id);
  return Number(result.meta.changes ?? 0);
}

type ParsedConfig = {
  clientNameRegex: string;
  clientNamePattern: RegExp;
  lastLoginOlderThanDays: number;
};

function parseConfig(config: unknown): ParsedConfig {
  const object = requireConfigObject(config);
  const clientNameRegex = object.clientNameRegex;

  if (typeof clientNameRegex !== "string" || clientNameRegex === "") {
    throw new ApiError(400, "clientNameRegex must be a non-empty string");
  }
  if (
    typeof object.lastLoginOlderThanDays !== "number" ||
    !Number.isInteger(object.lastLoginOlderThanDays) ||
    object.lastLoginOlderThanDays <= 1
  ) {
    throw new ApiError(400, "lastLoginOlderThanDays must be an integer greater than 1");
  }
  const lastLoginOlderThanDays = object.lastLoginOlderThanDays;

  let clientNamePattern: RegExp;
  try {
    clientNamePattern = new RegExp(clientNameRegex, "u");
  } catch (error) {
    throw new ApiError(
      400,
      error instanceof Error ? `invalid clientNameRegex: ${error.message}` : "invalid clientNameRegex",
    );
  }

  return {
    clientNameRegex,
    clientNamePattern,
    lastLoginOlderThanDays,
  };
}

function requireConfigObject(config: unknown): { clientNameRegex: unknown; lastLoginOlderThanDays: unknown } {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new ApiError(400, "plugin config must be a yaml object");
  }
  if (!("clientNameRegex" in config)) {
    throw new ApiError(400, "plugin config must include clientNameRegex");
  }
  if (!("lastLoginOlderThanDays" in config)) {
    throw new ApiError(400, "plugin config must include lastLoginOlderThanDays");
  }
  return config as { clientNameRegex: unknown; lastLoginOlderThanDays: unknown };
}
