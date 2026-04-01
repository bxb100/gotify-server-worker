import {
	PluginEntrypoint,
	requireConfigObject,
	type GotifyHostApi,
	type PluginClient,
	type PluginState,
} from "@gotify/sdk";

const CRON_EXPRESSION = "0 * * * *";

type CleanupConfig = {
	clientNameRegex: unknown;
	lastLoginOlderThanDays: unknown;
};

type ParsedConfig = {
	clientNameRegex: string;
	clientNamePattern: RegExp;
	lastLoginOlderThanDays: number;
};

export class PluginWorker extends PluginEntrypoint {
	public validateConfig(config: unknown): void {
		parseConfig(config);
	}

	public getDisplay(state: PluginState, config: unknown): string {
		const parsedConfig = parseConfig(config);
		const lines = [
			"# Client Token Cleanup",
			"",
			`- Status: ${state.enabled ? "enabled" : "disabled"}`,
			`- Behavior: delete client tokens whose name matches \`${parsedConfig.clientNameRegex}\` and whose last login is older than **${parsedConfig.lastLoginOlderThanDays} days**.`,
			`- Schedule: hourly Cloudflare Cron Trigger (\`${CRON_EXPRESSION}\`, UTC).`,
			"",
			"## Config",
			"",
			`- clientNameRegex: \`${parsedConfig.clientNameRegex}\``,
			`- lastLoginOlderThanDays: ${parsedConfig.lastLoginOlderThanDays}`,
			`- Last cleanup: ${state.lastCleanupAt ?? "not run yet"}`,
			`- Last deleted count: ${state.lastDeletedCount}`,
			`- Last error: ${state.lastError ? `\`${state.lastError}\`` : "none"}`,
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

	public async onEnable(_state: PluginState, config: unknown): Promise<void> {
		await runCleanup(this.host, parseConfig(config));
	}

	public async onConfigUpdated(_state: PluginState, config: unknown): Promise<void> {
		await runCleanup(this.host, parseConfig(config));
	}

	public async onScheduled(_state: PluginState, _controller: ScheduledController, config: unknown): Promise<void> {
		await runCleanup(this.host, parseConfig(config));
	}
}

async function runCleanup(host: GotifyHostApi, config: ParsedConfig): Promise<void> {
	const ranAt = new Date().toISOString();
	const cutoff = new Date(Date.now() - config.lastLoginOlderThanDays * 24 * 60 * 60 * 1000).toISOString();

	try {
		const candidates = await host.getClientsLastUsedBefore(cutoff);
		const matched = candidates.filter((client) => config.clientNamePattern.test(client.name));

		let deletedCount = 0;
		for (const client of matched) {
			deletedCount += await deleteClientById(host, client);
		}

		await host.updateCleanupState({
			ranAt,
			deletedCount,
			error: null,
		});
		console.log(`client token cleanup finished at ${ranAt}, deleted=${deletedCount}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : "unknown cleanup error";
		await host.updateCleanupState({
			ranAt,
			deletedCount: 0,
			error: message,
		});
		throw error;
	}
}

async function deleteClientById(host: GotifyHostApi, client: PluginClient): Promise<number> {
	return host.deleteClientById(client.id);
}

function parseConfig(config: unknown): ParsedConfig {
	const object = requireConfigObject<CleanupConfig>(config, ["clientNameRegex", "lastLoginOlderThanDays"]);
	const { clientNameRegex } = object;

	if (typeof clientNameRegex !== "string" || clientNameRegex === "") {
		throw new Error("clientNameRegex must be a non-empty string");
	}
	if (
		typeof object.lastLoginOlderThanDays !== "number" ||
		!Number.isInteger(object.lastLoginOlderThanDays) ||
		object.lastLoginOlderThanDays <= 1
	) {
		throw new Error("lastLoginOlderThanDays must be an integer greater than 1");
	}

	let clientNamePattern: RegExp;
	try {
		clientNamePattern = new RegExp(clientNameRegex, "u");
	} catch (error) {
		throw new Error(error instanceof Error ? `invalid clientNameRegex: ${error.message}` : "invalid clientNameRegex", {
			cause: error,
		});
	}

	return {
		clientNameRegex,
		clientNamePattern,
		lastLoginOlderThanDays: object.lastLoginOlderThanDays,
	};
}
