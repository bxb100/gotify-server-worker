declare module "@gotify/*/plugin.config" {
	import type { PluginDefinition, PluginManifest } from "@gotify/sdk";

	export const manifest: PluginManifest;
	export const defaultConfig: string;

	const pluginDefinition: PluginDefinition;
	export default pluginDefinition;
}
