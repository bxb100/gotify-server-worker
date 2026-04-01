import { PluginEntrypoint, requireConfigObject, type PluginState } from "@gotify/sdk";

const CRON_EXPRESSION = "0 * * * *";

type RetentionConfig = {
	retentionDays: unknown;
};

export class PluginWorker extends PluginEntrypoint {
	public validateConfig(config: unknown): void {
		parseConfig(config);
	}

	public getDisplay(state: PluginState, config: unknown): string {
		const parsedConfig = parseConfig(config);
		const lines = [
			"# Message Auto Delete",
			"",
			`- Status: ${state.enabled ? "enabled" : "disabled"}`,
			`- Behavior: hard-delete messages older than **${parsedConfig.retentionDays} days**.`,
			`- Schedule: hourly Cloudflare Cron Trigger (\`${CRON_EXPRESSION}\`, UTC).`,
			"",
			"## Config",
			"",
			`- retentionDays: ${parsedConfig.retentionDays}`,
			`- Last cleanup: ${state.lastCleanupAt ?? "not run yet"}`,
			`- Last deleted count: ${state.lastDeletedCount}`,
			`- Last error: ${state.lastError ? `\`${state.lastError}\`` : "none"}`,
		];

		if (!state.enabled) {
			lines.push("", "Enable this plugin from the plugin list to start scheduled cleanup.");
		}

		return lines.join("\n");
	}

	public async onEnable(_state: PluginState, config: unknown): Promise<void> {
		await runCleanup(this.host, parseConfig(config).retentionDays);
	}

	public async onConfigUpdated(_state: PluginState, config: unknown): Promise<void> {
		await runCleanup(this.host, parseConfig(config).retentionDays);
	}

	public async onScheduled(_state: PluginState, _controller: ScheduledController, config: unknown): Promise<void> {
		await runCleanup(this.host, parseConfig(config).retentionDays);
	}
}

async function runCleanup(host: PluginWorker["host"], retentionDays: number): Promise<void> {
	const ranAt = new Date().toISOString();
	const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

	try {
		const deletedCount = await host.deleteMessagesOlderThan(cutoff);
		await host.updateCleanupState({
			ranAt,
			deletedCount,
			error: null,
		});
		console.log(`message retention cleanup finished at ${ranAt}, deleted=${deletedCount}`);
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

function parseConfig(config: unknown): { retentionDays: number } {
	const object = requireConfigObject<RetentionConfig>(config, ["retentionDays"]);
	if (typeof object.retentionDays !== "number" || !Number.isInteger(object.retentionDays) || object.retentionDays < 1) {
		throw new Error("retentionDays must be an integer greater than or equal to 1");
	}

	return { retentionDays: object.retentionDays };
}
