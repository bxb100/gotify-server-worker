export type PluginCapability = "webhooker" | "displayer" | "configurer" | "messenger" | "storager";

export interface PluginManifest {
	id: number;
	token: string;
	name: string;
	modulePath: string;
	author?: string;
	website?: string;
	license?: string;
	capabilities: readonly PluginCapability[];
	cronExpressions?: readonly string[];
}

export interface PluginDefinition {
	manifest: PluginManifest;
	defaultConfig: string;
	plugin: GotifyPluginClass;
}

export interface PluginState {
	token: string;
	enabled: boolean;
	lastCleanupAt: string | null;
	lastDeletedCount: number;
	lastError: string | null;
}

export interface PluginClient {
	id: number;
	name: string;
	lastUsed: string | null;
}

export interface PluginCleanupStateInput {
	ranAt: string;
	deletedCount: number;
	error: string | null;
}

export interface GotifyHostApi {
	deleteMessagesOlderThan(cutoffIso: string): Promise<number>;
	getClientsLastUsedBefore(cutoffIso: string): Promise<PluginClient[]>;
	deleteClientById(id: number): Promise<number>;
	updateCleanupState(input: PluginCleanupStateInput): Promise<void>;
}

export abstract class GotifyPlugin {
	public constructor(protected readonly host: GotifyHostApi) {}

	public validateConfig?(config: unknown, configText: string): void | Promise<void>;
	public getDisplay?(state: PluginState, config: unknown, configText: string): string | Promise<string>;
	public onEnable?(state: PluginState, config: unknown, configText: string): Promise<void>;
	public onDisable?(state: PluginState, config: unknown, configText: string): Promise<void>;
	public onConfigUpdated?(state: PluginState, config: unknown, configText: string): Promise<void>;
	public onScheduled?(
		state: PluginState,
		controller: ScheduledController,
		config: unknown,
		configText: string,
	): Promise<void>;
}

export type GotifyPluginClass = new (host: GotifyHostApi) => GotifyPlugin;

export function requireConfigObject<T extends Record<string, unknown>>(
	config: unknown,
	requiredKeys: readonly (keyof T)[],
): T {
	if (config === null || typeof config !== "object" || Array.isArray(config)) {
		throw new Error("plugin config must be a yaml object");
	}
	for (const key of requiredKeys) {
		if (!(key in config)) {
			throw new Error(`plugin config must include ${String(key)}`);
		}
	}
	return config as T;
}
