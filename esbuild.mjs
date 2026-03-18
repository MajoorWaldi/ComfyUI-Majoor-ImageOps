import { build, context } from "esbuild";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

async function findTS(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...await findTS(full));
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts") && e.name !== "types.ts") {
      files.push(full);
    }
  }
  return files;
}

const entryPoints = await findTS("src");

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
