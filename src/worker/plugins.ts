import { load } from "js-yaml";

import { getPluginConfigByToken, getPluginStateByToken, setPluginConfig, setPluginEnabled } from "./db";
import type { EnvBindings, PluginCapability, PluginExternal, PluginStateRow } from "./types";
import { ApiError } from "./utils";

type PluginManifest = {
	id: number;
	token: string;
	name: string;
	modulePath: string;
	author: string;
	website: string;
	license: string;
	capabilities: readonly PluginCapability[];
	cronExpressions?: readonly string[];
};

type PluginModule = {
	manifest: PluginManifest;
	defaultConfig: string;
	validateConfig?(config: unknown, configText: string): void | Promise<void>;
	getDisplay?(state: PluginStateRow, config: unknown, configText: string): string | Promise<string>;
	onEnable?(env: EnvBindings, state: PluginStateRow, config: unknown, configText: string): Promise<void>;
	onDisable?(env: EnvBindings, state: PluginStateRow, config: unknown, configText: string): Promise<void>;
	onConfigUpdated?(env: EnvBindings, state: PluginStateRow, config: unknown, configText: string): Promise<void>;
	onScheduled?(
		env: EnvBindings,
		state: PluginStateRow,
		controller: ScheduledController,
		config: unknown,
		configText: string,
	): Promise<void>;
};

type PluginLoader = {
	id: number;
	load: () => Promise<PluginModule>;
};

const pluginLoaders: PluginLoader[] = [
	{
		id: 1,
		load: () => import("./plugin-modules/message-auto-delete"),
	},
	{
		id: 2,
		load: () => import("./plugin-modules/client-token-cleanup"),
	},
];

let pluginBootstrapPromise: Promise<void> | null = null;
let pluginModuleCache: Promise<PluginModule[]> | null = null;

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

	const modules = await loadAllPluginModules();
	await Promise.all(
		modules.map((plugin) =>
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
		modules.map((plugin) =>
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
	const modules = await loadAllPluginModules();
	return Promise.all(
		modules.map(async (plugin) =>
			toPluginExternal(plugin.manifest, await requirePluginState(db, plugin.manifest.token)),
		),
	);
}

export async function getPluginDisplay(db: D1Database, id: number): Promise<string> {
	const plugin = await getPluginModuleById(id);
	if (!plugin.getDisplay) {
		throw new ApiError(404, "plugin does not support display");
	}
	const [state, configText] = await Promise.all([
		requirePluginState(db, plugin.manifest.token),
		requirePluginConfig(db, plugin),
	]);
	return plugin.getDisplay(state, parseYamlConfig(configText), configText);
}

export async function getPluginConfig(db: D1Database, id: number): Promise<string> {
	const plugin = await getPluginModuleById(id);
	if (!plugin.manifest.capabilities.includes("configurer")) {
		throw new ApiError(404, "plugin does not support configuration");
	}
	return requirePluginConfig(db, plugin);
}

export async function setPluginConfigById(env: EnvBindings, id: number, configText: string): Promise<void> {
	const plugin = await getPluginModuleById(id);
	if (!plugin.manifest.capabilities.includes("configurer")) {
		throw new ApiError(404, "plugin does not support configuration");
	}

	const normalizedConfig = normalizeConfigText(configText, plugin.defaultConfig);
	const parsedConfig = parseYamlConfig(normalizedConfig);
	await plugin.validateConfig?.(parsedConfig, normalizedConfig);
	await setPluginConfig(env.DB, plugin.manifest.token, normalizedConfig);

	const state = await requirePluginState(env.DB, plugin.manifest.token);
	if (state.enabled) {
		await plugin.onConfigUpdated?.(env, state, parsedConfig, normalizedConfig);
	}
}

export async function setPluginEnabledById(env: EnvBindings, id: number, enabled: boolean): Promise<void> {
	const plugin = await getPluginModuleById(id);
	await setPluginEnabled(env.DB, plugin.manifest.token, enabled);
	const [state, configText] = await Promise.all([
		requirePluginState(env.DB, plugin.manifest.token),
		requirePluginConfig(env.DB, plugin),
	]);
	const parsedConfig = parseYamlConfig(configText);

	if (enabled) {
		await plugin.onEnable?.(env, state, parsedConfig, configText);
		return;
	}

	await plugin.onDisable?.(env, state, parsedConfig, configText);
}

export async function runScheduledPlugins(env: EnvBindings, controller: ScheduledController): Promise<void> {
	const modules = await loadAllPluginModules();
	for (const plugin of modules) {
		if (!plugin.onScheduled || !plugin.manifest.cronExpressions?.includes(controller.cron)) {
			continue;
		}

		const [state, configText] = await Promise.all([
			requirePluginState(env.DB, plugin.manifest.token),
			requirePluginConfig(env.DB, plugin),
		]);
		const parsedConfig = parseYamlConfig(configText);
		if (!state.enabled) {
			continue;
		}

		await plugin.onScheduled(env, state, controller, parsedConfig, configText);
	}
}

async function getPluginModuleById(id: number): Promise<PluginModule> {
	const plugin = (await loadAllPluginModules()).find((item) => item.manifest.id === id);
	if (!plugin) {
		throw new ApiError(404, "plugin does not exist");
	}
	return plugin;
}

async function loadAllPluginModules(): Promise<PluginModule[]> {
	pluginModuleCache ??= Promise.all(pluginLoaders.map((loader) => loader.load()));
	return pluginModuleCache;
}

async function requirePluginState(db: D1Database, token: string): Promise<PluginStateRow> {
	const state = await getPluginStateByToken(db, token);
	if (!state) {
		throw new ApiError(500, `plugin state missing for token '${token}'`);
	}
	return state;
}

async function requirePluginConfig(db: D1Database, plugin: PluginModule): Promise<string> {
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
