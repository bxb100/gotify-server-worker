export const manifest = {
	id: 2,
	token: "client-token-cleanup",
	name: "Client Token Cleanup",
	modulePath: "builtin/client-token-cleanup",
	author: "gotify-server-worker",
	website: "https://developers.cloudflare.com/workers/configuration/cron-triggers/",
	license: "MIT",
	capabilities: ["configurer", "displayer"],
	cronExpressions: ["0 * * * *"],
};

export const defaultConfig = [
	"# Delete client tokens whose name matches this regex and whose last login is older than the configured days.",
	"clientNameRegex: ^$",
	"lastLoginOlderThanDays: 2",
	"",
].join("\n");

export default {
	packageRoot: new URL(".", import.meta.url),
	manifest,
	defaultConfig,
	entrypoint: "./src/index.ts",
};
