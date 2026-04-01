import type { GotifyHostApi, PluginManifest, PluginState } from "@gotify/sdk";
import { load } from "js-yaml";

import { getPluginConfigByToken, getPluginStateByToken, setPluginConfig, setPluginEnabled } from "./db";
import { configuredPlugins } from "./generated/plugin-registry";
import type { EnvBindings, PluginExternal, PluginStateRow } from "./types";
import { ApiError } from "./utils";

type PluginRuntimeContext = {
	env: EnvBindings;
	ctx: ExecutionContext;
};

type PluginWorker = {
	validateConfig?(config: unknown, configText: string): void | Promise<void>;
	getDisplay?(state: PluginState, config: unknown, configText: string): string | Promise<string>;
	onEnable?(state: PluginState, config: unknown, configText: string): Promise<void>;
	onDisable?(state: PluginState, config: unknown, configText: string): Promise<void>;
	onConfigUpdated?(state: PluginState, config: unknown, configText: string): Promise<void>;
	onScheduled?(state: PluginState, controller: ScheduledController, config: unknown, configText: string): Promise<void>;
};

type ConfiguredPluginDefinition = {
	manifest: PluginManifest;
	defaultConfig: string;
	entrypointName: string;
	workerCode: WorkerLoaderWorkerCode;
};

const pluginDefinitions = configuredPlugins as unknown as readonly ConfiguredPluginDefinition[];

let pluginBootstrapPromise: Promise<void> | null = null;

export function ensurePluginBootstrap(db: D1Database): Promise<void> {
	pluginBootstrapPromise ??= initializePluginBootstrap(db);
	return pluginBootstrapPromise;
}

async function initializePluginBootstrap(db: D1Database): Promise<void> {
	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS plugin_states (
      token TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      last_cleanup_at TEXT,
      last_deleted_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    )`,
		)
		.run();
	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS plugin_configs (
      token TEXT PRIMARY KEY,
      config TEXT NOT NULL
    )`,
		)
		.run();

	await Promise.all(
		pluginDefinitions.map((plugin) =>
			db
				.prepare(
					`INSERT INTO plugin_states (token, enabled, last_cleanup_at, last_deleted_count, last_error)
         VALUES (?, 0, NULL, 0, NULL)
         ON CONFLICT(token) DO NOTHING`,
				)
				.bind(plugin.manifest.token)
				.run(),
		),
	);
	await Promise.all(
		pluginDefinitions.map((plugin) =>
			db
				.prepare(
					`INSERT INTO plugin_configs (token, config)
         VALUES (?, ?)
         ON CONFLICT(token) DO NOTHING`,
				)
				.bind(plugin.manifest.token, plugin.defaultConfig)
				.run(),
		),
	);
}

export async function listPlugins(db: D1Database): Promise<PluginExternal[]> {
	return Promise.all(
		pluginDefinitions.map(async (plugin) =>
			toPluginExternal(plugin.manifest, await requirePluginState(db, plugin.manifest.token)),
		),
	);
}

export async function getPluginDisplay(runtime: PluginRuntimeContext, id: number): Promise<string> {
	const plugin = getPluginDefinitionById(id);
	if (!plugin.manifest.capabilities.includes("displayer")) {
		throw new ApiError(404, "plugin does not support display");
	}

	const worker = await getPluginWorker(plugin, runtime);
	if (!worker.getDisplay) {
		throw new ApiError(404, "plugin does not support display");
	}

	const [state, configText] = await Promise.all([
		requirePluginState(runtime.env.DB, plugin.manifest.token),
		requirePluginConfig(runtime.env.DB, plugin),
	]);
	return worker.getDisplay(toPluginState(state), parseYamlConfig(configText), configText);
}

export async function getPluginConfig(db: D1Database, id: number): Promise<string> {
	const plugin = getPluginDefinitionById(id);
	if (!plugin.manifest.capabilities.includes("configurer")) {
		throw new ApiError(404, "plugin does not support configuration");
	}
	return requirePluginConfig(db, plugin);
}

export async function setPluginConfigById(
	runtime: PluginRuntimeContext,
	id: number,
	configText: string,
): Promise<void> {
	const plugin = getPluginDefinitionById(id);
	if (!plugin.manifest.capabilities.includes("configurer")) {
		throw new ApiError(404, "plugin does not support configuration");
	}

	const worker = await getPluginWorker(plugin, runtime);
	const normalizedConfig = normalizeConfigText(configText, plugin.defaultConfig);
	const parsedConfig = parseYamlConfig(normalizedConfig);
	try {
		await worker.validateConfig?.(parsedConfig, normalizedConfig);
	} catch (error) {
		throw toApiError(error, 400);
	}

	await setPluginConfig(runtime.env.DB, plugin.manifest.token, normalizedConfig);

	const state = await requirePluginState(runtime.env.DB, plugin.manifest.token);
	if (state.enabled) {
		await worker.onConfigUpdated?.(toPluginState(state), parsedConfig, normalizedConfig);
	}
}

export async function setPluginEnabledById(runtime: PluginRuntimeContext, id: number, enabled: boolean): Promise<void> {
	const plugin = getPluginDefinitionById(id);
	const worker = await getPluginWorker(plugin, runtime);

	await setPluginEnabled(runtime.env.DB, plugin.manifest.token, enabled);

	const [state, configText] = await Promise.all([
		requirePluginState(runtime.env.DB, plugin.manifest.token),
		requirePluginConfig(runtime.env.DB, plugin),
	]);
	const parsedConfig = parseYamlConfig(configText);
	const pluginState = toPluginState(state);

	if (enabled) {
		await worker.onEnable?.(pluginState, parsedConfig, configText);
		return;
	}

	await worker.onDisable?.(pluginState, parsedConfig, configText);
}

export async function runScheduledPlugins(
	runtime: PluginRuntimeContext,
	controller: ScheduledController,
): Promise<void> {
	for (const plugin of pluginDefinitions) {
		if (!plugin.manifest.cronExpressions?.includes(controller.cron)) {
			continue;
		}

		const [state, configText] = await Promise.all([
			requirePluginState(runtime.env.DB, plugin.manifest.token),
			requirePluginConfig(runtime.env.DB, plugin),
		]);
		if (!state.enabled) {
			continue;
		}

		const worker = await getPluginWorker(plugin, runtime);
		if (!worker.onScheduled) {
			continue;
		}

		await worker.onScheduled(toPluginState(state), controller, parseYamlConfig(configText), configText);
	}
}

function getPluginDefinitionById(id: number): ConfiguredPluginDefinition {
	const plugin = pluginDefinitions.find((item) => item.manifest.id === id);
	if (!plugin) {
		throw new ApiError(404, "plugin does not exist");
	}
	return plugin;
}

async function getPluginWorker(
	plugin: ConfiguredPluginDefinition,
	runtime: PluginRuntimeContext,
): Promise<PluginWorker> {
	return createPluginWorker(plugin, runtime);
}

function createPluginWorker(plugin: ConfiguredPluginDefinition, runtime: PluginRuntimeContext): PluginWorker {
	const exportsMap = runtime.ctx.exports as Record<string, unknown>;
	const hostFactory = exportsMap.GotifyHost as
		| ((options: { props: { pluginToken: string } }) => GotifyHostApi)
		| undefined;
	if (!hostFactory) {
		throw new ApiError(500, "GotifyHost export is unavailable");
	}

	const stub = runtime.env.PLUGIN_LOADER.get(plugin.manifest.token, () => ({
		...plugin.workerCode,
		env: {
			...plugin.workerCode.env,
			HOST: hostFactory({ props: { pluginToken: plugin.manifest.token } }),
		},
	}));

	return stub.getEntrypoint(plugin.entrypointName) as unknown as PluginWorker;
}

async function requirePluginState(db: D1Database, token: string): Promise<PluginStateRow> {
	const state = await getPluginStateByToken(db, token);
	if (!state) {
		throw new ApiError(500, `plugin state missing for token '${token}'`);
	}
	return state;
}

async function requirePluginConfig(db: D1Database, plugin: ConfiguredPluginDefinition): Promise<string> {
	const config = await getPluginConfigByToken(db, plugin.manifest.token);
	return config?.config ?? plugin.defaultConfig;
}

function normalizeConfigText(configText: string, fallback: string): string {
	const trimmed = configText.trim();
	return trimmed ? `${trimmed}\n` : fallback;
}

function parseYamlConfig(configText: string): unknown {
	try {
		return load(configText);
	} catch (error) {
		throw new ApiError(400, error instanceof Error ? `invalid plugin yaml: ${error.message}` : "invalid plugin yaml");
	}
}

function toPluginExternal(manifest: PluginManifest, state: PluginStateRow): PluginExternal {
	return {
		id: manifest.id,
		token: manifest.token,
		name: manifest.name,
		modulePath: manifest.modulePath,
		enabled: Boolean(state.enabled),
		author: manifest.author,
		website: manifest.website,
		license: manifest.license,
		capabilities: [...manifest.capabilities],
	};
}

function toPluginState(state: PluginStateRow): PluginState {
	return {
		token: state.token,
		enabled: Boolean(state.enabled),
		lastCleanupAt: state.last_cleanup_at,
		lastDeletedCount: state.last_deleted_count,
		lastError: state.last_error,
	};
}

function toApiError(error: unknown, fallbackStatus: number): ApiError {
	if (error instanceof ApiError) {
		return error;
	}
	return new ApiError(fallbackStatus, error instanceof Error ? error.message : "plugin call failed");
}
