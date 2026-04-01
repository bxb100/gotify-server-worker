import type { PluginCapability } from "@gotify/sdk";

export interface EnvBindings {
	DB: D1Database;
	STREAM_HUB: DurableObjectNamespace;
	PLUGIN_LOADER: WorkerLoader;
	APP_IMAGES?: R2Bucket;
	GOTIFY_REGISTRATION?: string;
	GOTIFY_DEFAULT_USER?: string;
	GOTIFY_DEFAULT_PASS?: string;
	GOTIFY_PASSWORD_ROUNDS?: string;
	GOTIFY_VERSION?: string;
	GOTIFY_COMMIT?: string;
	GOTIFY_BUILD_DATE?: string;
	CORS_ALLOW_ORIGIN?: string;
}

export interface UserRow {
	id: number;
	name: string;
	pass: string;
	admin: number;
}

export interface ClientRow {
	id: number;
	token: string;
	user_id: number;
	name: string;
	last_used: string | null;
}

export interface ApplicationRow {
	id: number;
	token: string;
	user_id: number;
	name: string;
	description: string;
	internal: number;
	image: string;
	default_priority: number;
	last_used: string | null;
	sort_key: string;
}

export interface MessageRow {
	id: number;
	application_id: number;
	message: string;
	title: string;
	priority: number;
	extras: string | null;
	date: string;
}

export interface PluginStateRow {
	token: string;
	enabled: number;
	last_cleanup_at: string | null;
	last_deleted_count: number;
	last_error: string | null;
}

export interface PluginConfigRow {
	token: string;
	config: string;
}

export interface UserExternal {
	id: number;
	name: string;
	admin: boolean;
}

export interface ClientExternal {
	id: number;
	token: string;
	name: string;
	lastUsed: string | null;
}

export interface ApplicationExternal {
	id: number;
	token: string;
	name: string;
	description: string;
	internal: boolean;
	image: string;
	defaultPriority: number;
	lastUsed: string | null;
	sortKey: string;
}

export interface MessageExternal {
	id: number;
	appid: number;
	message: string;
	title: string;
	priority: number;
	extras?: Record<string, unknown>;
	date: string;
}

export interface PluginExternal {
	id: number;
	token: string;
	name: string;
	modulePath: string;
	enabled: boolean;
	author?: string;
	website?: string;
	license?: string;
	capabilities: PluginCapability[];
}

export interface PagedMessages {
	paging: {
		next?: string;
		size: number;
		since: number;
		limit: number;
	};
	messages: MessageExternal[];
}

export interface AuthState {
	kind: "basic" | "client" | "application" | "optional";
	userId: number;
	token: string;
	user?: UserRow;
}
