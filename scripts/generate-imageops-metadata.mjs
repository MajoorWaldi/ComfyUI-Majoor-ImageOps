import { readFile, writeFile } from "node:fs/promises";

const sourcePath = "imageops_nodes.json";
const targetPath = "src/preview/shared/imageops-metadata.ts";

const raw = JSON.parse(await readFile(sourcePath, "utf8"));
const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
const aliases = raw.aliases && typeof raw.aliases === "object" ? raw.aliases : {};

const minimalNodes = nodes.map((entry) => {
  const out = {
    className: String(entry.className),
    ui: entry.ui === "native" ? "native" : "custom",
  };
  if (Number.isFinite(entry.minPreviewHeight)) out.minPreviewHeight = Number(entry.minPreviewHeight);
  return out;
});

const content = `export type ImageOpsUiMode = "custom" | "native";

export type ImageOpsNodeMeta = {
  className: string;
  ui: ImageOpsUiMode;
  minPreviewHeight?: number;
};

export const IMAGEOPS_NODE_METADATA: readonly ImageOpsNodeMeta[] = ${JSON.stringify(minimalNodes, null, 2)} as const;

export const IMAGEOPS_DEFAULT_PREVIEW_MIN_HEIGHT = 320;
export const IMAGEOPS_DEFAULT_NODE_WIDTH = 360;
export const IMAGEOPS_CLASS_ALIASES = new Map<string, string>(${JSON.stringify(Object.entries(aliases), null, 2)});
`;

if (process.argv.includes("--check")) {
  const current = await readFile(targetPath, "utf8").catch(() => "");
  if (current !== content) {
    console.error(`${targetPath} is stale. Run: npm run generate:metadata`);
    process.exitCode = 1;
  }
} else {
  await writeFile(targetPath, content, "utf8");
}
