import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const prod = process.argv[2] === "production";

await mkdir("dist", { recursive: true });
const copyStatic = () =>
	Promise.all(["manifest.json", "styles.css"].filter(existsSync).map((f) => copyFile(f, `dist/${f}`)));

const context = await esbuild.context({
	banner: { js: "/* Bundled by esbuild. Source: see the plugin's GitHub repository. */" },
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/*",
		"@lezer/*",
		...builtinModules,
		...builtinModules.map((m) => `node:${m}`),
	],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "dist/main.js",
	minify: prod,
	plugins: [{ name: "copy-static", setup: (b) => b.onEnd(async () => { await copyStatic(); }) }],
});

if (prod) {
	await context.rebuild();
	await context.dispose();
} else {
	await context.watch();
}
