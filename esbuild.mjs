import { build, context } from "esbuild";
import { glob } from "node:fs/promises";

const entryPoints = [];
for await (const f of glob("src/**/*.ts")) {
  if (!f.endsWith(".d.ts") && !f.endsWith("types.ts")) entryPoints.push(f);
}

const opts = {
  entryPoints,
  outdir: "js",
  outbase: "src",
  format: "esm",
  platform: "browser",
  target: "es2020",
  bundle: false,
  sourcemap: false,
};

if (process.argv.includes("--watch")) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log("[esbuild] watching...");
} else {
  await build(opts);
  console.log(`[esbuild] built ${entryPoints.length} files → js/`);
}
