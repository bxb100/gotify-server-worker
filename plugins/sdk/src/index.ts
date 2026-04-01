import { WorkerEntrypoint } from "cloudflare:workers";

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
	packageRoot: string | URL;
	manifest: PluginManifest;
	defaultConfig: string;
	entrypoint: string;
	entrypointName?: string;
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

export interface PluginWorkerEnv {
	HOST: GotifyHostApi;
}

export abstract class PluginEntrypoint<Props = {}> extends WorkerEntrypoint<PluginWorkerEnv, Props> {
	protected readonly host = this.env.HOST;
}

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
