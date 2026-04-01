import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const nodeModulesSegment = "/node_modules/";

const getPackageName = (id: string) => {
	const modulePath = id.split(nodeModulesSegment).at(-1);
	if (!modulePath) {
		return null;
	}

	const [scopeOrName, scopedName] = modulePath.split("/");
	return scopeOrName.startsWith("@") ? `${scopeOrName}/${scopedName}` : scopeOrName;
};

const matchesPackagePrefix = (pkg: string, prefixes: string[]) =>
	prefixes.some((prefix) => pkg === prefix || pkg.startsWith(`${prefix}/`));

const clientManualChunks = (id: string) => {
	if (!id.includes(nodeModulesSegment)) {
		return;
	}

	const pkg = getPackageName(id);
	if (!pkg) {
		return;
	}

	if (
		matchesPackagePrefix(pkg, [
			"react",
			"react-dom",
			"react-is",
			"react-router",
			"react-router-dom",
			"scheduler",
			"mobx",
			"mobx-react-lite",
			"mobx-utils",
		])
	) {
		return "framework";
	}

	if (matchesPackagePrefix(pkg, ["@mui", "@emotion", "tss-react", "notistack", "react-transition-group"])) {
		return "mui";
	}

	if (
		matchesPackagePrefix(pkg, [
			"react-markdown",
			"remark-gfm",
			"unified",
			"bail",
			"trough",
			"vfile",
			"vfile-message",
			"micromark",
			"mdast-util",
			"hast-util",
			"unist-util",
			"property-information",
			"space-separated-tokens",
			"comma-separated-tokens",
			"trim-lines",
			"markdown-table",
			"decode-named-character-reference",
			"character-entities",
			"zwitch",
		])
	) {
		return "markdown";
	}

	if (matchesPackagePrefix(pkg, ["@uiw", "@codemirror", "@lezer", "codemirror", "style-mod", "w3c-keyname"])) {
		return "plugin-editor";
	}
};

export default defineConfig({
	plugins: [
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
	environments: {
		client: {
			build: {
				rollupOptions: {
					output: {
						manualChunks: clientManualChunks,
					},
				},
			},
		},
	},
});
