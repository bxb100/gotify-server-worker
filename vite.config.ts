import { cloudflare } from "@cloudflare/vite-plugin";
import clientTokenCleanup from "@gotify/client-token-cleanup/plugin.config";
import messageAutoDelete from "@gotify/message-auto-delete/plugin.config";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// @ts-ignore
import gotifyPluginRegistryPlugin from "./scripts/generate-plugin-registry.mjs";

export default defineConfig({
	plugins: [
		gotifyPluginRegistryPlugin([messageAutoDelete, clientTokenCleanup]),
		react({
			babel: {
				plugins: [
					// I don't know why gotify ui don't need this
					["@babel/plugin-proposal-decorators", { version: "2023-11" }],
				],
			},
		}),
		cloudflare(),
	],
	build: {
		chunkSizeWarningLimit: 1000,
	},
});
