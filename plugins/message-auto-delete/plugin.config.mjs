export const manifest = {
	id: 1,
	token: "message-auto-delete-token",
	name: "Message Auto Delete",
	modulePath: "builtin/message-auto-delete",
	author: "gotify-server-worker",
	website: "https://developers.cloudflare.com/workers/configuration/cron-triggers/",
	license: "MIT",
	capabilities: ["configurer", "displayer"],
	cronExpressions: ["0 * * * *"],
};

export const defaultConfig = ["# Delete messages older than this many days.", "retentionDays: 15", ""].join("\n");

export default {
	packageRoot: new URL(".", import.meta.url),
	manifest,
	defaultConfig,
	entrypoint: "./src/index.ts",
};
