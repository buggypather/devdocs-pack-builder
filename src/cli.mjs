// Builds the doc pack described by a config file.
//
//   npm run build                          pack.config.json -> pack/
//   npm run build -- other.json --out dist

import { dirname, resolve } from "node:path";
import { buildPack, readConfig } from "./build.mjs";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outDir = resolve(outIndex >= 0 ? args[outIndex + 1] : "pack");
const configFile = resolve(args.find((arg, i) => !arg.startsWith("--") && i !== outIndex + 1) || "pack.config.json");

try {
  const config = readConfig(configFile);
  const started = Date.now();
  buildPack(config, {
    outDir,
    baseDir: dirname(configFile),
    cacheDir: resolve(".cache"),
    repository: process.env.GITHUB_REPOSITORY,
    log: (message) => console.log(message),
  });
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s: ${outDir}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
