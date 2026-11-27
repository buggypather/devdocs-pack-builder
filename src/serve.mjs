// Serves a built pack on this computer, so DevDocs can add it without it
// going on GitHub:
//
//   npm run serve                    pack/ at http://localhost:8765
//   npm run serve -- claude-code-pack --port 9000
//
// In DevDocs, open Preferences → Doc packs, paste the address it prints and
// click Add. DevDocs keeps the docs once you've downloaded them for offline
// reading, so this only needs to run while you add the pack or update it.

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const TYPES = { ".json": "application/json", ".html": "text/html; charset=utf-8", ".png": "image/png", ".md": "text/markdown; charset=utf-8" };

const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = Number(portIndex >= 0 ? args[portIndex + 1] : 8765);
const folder = resolve(args.find((arg, i) => !arg.startsWith("-") && i !== portIndex + 1) || "pack");

if (!existsSync(join(folder, "docs.json"))) {
  console.error(`There's no pack in ${folder} (no docs.json). Build one first: npm run build -- <config> --out ${folder}`);
  process.exit(1);
}

createServer((request, response) => {
  // DevDocs runs on another address, so it needs leave to read these files.
  response.setHeader("Access-Control-Allow-Origin", "*");
  // And Chrome asks first whether a website may read from this computer.
  response.setHeader("Access-Control-Allow-Private-Network", "true");
  if (request.method === "OPTIONS") {
    response.writeHead(204, { "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "*" }).end();
    return;
  }
  const path = normalize(decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname));
  const file = join(folder, path);
  if (!(file === folder || file.startsWith(folder + sep)) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  createReadStream(file).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Serving ${folder}`);
  console.log(`In DevDocs: Preferences → Doc packs, paste  http://localhost:${port}  and click Add.`);
  console.log("Press Ctrl+C to stop.");
});
