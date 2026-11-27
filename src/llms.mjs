// Documentation published as Markdown with an llms.txt index (as Mintlify
// sites do: code.claude.com/docs/llms.txt, for one): downloads the pages it
// lists into a folder, with a table of contents made from the index's
// sections, so the pack is built from that folder like any other.
//
// Such docs are often not openly licensed: build them for yourself (see
// "Docs that aren't on GitHub" in the README), not into a public pack.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stringify } from "yaml";

const LINK_RGX = /^\s*[-*]\s+\[([^\]]+)\]\((\S+?)\)/;
const HEADING_RGX = /^(#{2,6})\s+(.+?)\s*$/;
const TIMEOUT_MS = 30_000;
const AT_ONCE = 8;

/**
 * Downloads the pages of each doc whose source is an llms.txt index, and
 * points the doc at them (`source.dir` and `source.toc`).
 *
 * @param {{ docs: any[] }} config As readConfig gives it; changed in place.
 * @param {{ cacheDir: string, log?: (m: string) => void, debug?: (m: string) => void, fetch?: typeof fetch }} options
 */
export async function prepareSources(config, { cacheDir, log = () => {}, debug = () => {}, fetch: get = fetch }) {
  for (const doc of config.docs) {
    if (!doc.source?.llms) continue;
    log(`${doc.name}: getting the pages listed in ${doc.source.llms}…`);
    const { dir, pages, failed } = await downloadLlms(doc.source, { cacheDir, debug, get });
    if (!pages) throw new Error(`${doc.name}: ${doc.source.llms} lists no Markdown pages.`);
    if (failed.length) log(`${doc.name}: ${failed.length} of ${pages + failed.length} pages couldn't be downloaded: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? "…" : ""}`);
    doc.source = { ...doc.source, dir, toc: "_toc.yaml", path: "" };
  }
}

/**
 * @param {{ llms: string, only?: string }} source `only`: the address the
 *   pages to take start with (e.g. `https://code.claude.com/docs/en/`, for
 *   the English ones); the folder of llms.txt otherwise.
 */
async function downloadLlms(source, { cacheDir, debug, get }) {
  const index = await getText(get, source.llms);
  const base = source.only || source.llms.replace(/[^/]*$/, "");
  const { pages, toc } = readIndex(index, base);
  debug(`${pages.length} pages listed under ${base}`);

  const dir = join(cacheDir, "llms", source.llms.replace(/^https?:\/\//, "").replace(/[^\w.-]+/g, "_"));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  /** @type {string[]} */
  const failed = [];
  let done = 0;
  const queue = [...pages];
  const worker = async () => {
    for (let page = queue.shift(); page; page = queue.shift()) {
      try {
        const text = await getText(get, page.url);
        const file = join(dir, page.file);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, cleanPage(text, base));
        done++;
        debug(`${page.url} -> ${page.file}`);
      } catch (error) {
        failed.push(page.file);
        debug(`${page.url}: ${error.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, worker));

  writeFileSync(join(dir, "_toc.yaml"), stringify({ toc }));
  return { dir, pages: done, failed };
}

/**
 * The pages an llms.txt lists (Markdown ones under `base`), in order, and a
 * table of contents grouping them by its sections: `## Plugins` with
 * `#### Mods` under it is "Plugins: Mods".
 *
 * @param {string} index
 * @param {string} base
 */
export function readIndex(index, base) {
  /** @type {{ url: string, file: string }[]} */
  const pages = [];
  /** @type {{ title: string, section: { path: string }[] }[]} */
  const toc = [];
  const seen = new Set();
  /** @type {string[]} */
  const headings = [];
  for (const line of index.split(/\r?\n/)) {
    const heading = line.match(HEADING_RGX);
    if (heading) {
      const level = heading[1].length;
      headings.length = level - 2;
      headings[level - 2] = heading[2].replace(/[*_`]/g, "");
      continue;
    }
    const link = line.match(LINK_RGX);
    if (!link) continue;
    const url = link[2].replace(/[?#].*$/, "");
    if (!url.startsWith(base) || !/\.mdx?$/i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const file = decodeURIComponent(url.slice(base.length));
    if (!file || file.split("/").some((part) => part === ".." || part === "." || !part)) continue;
    pages.push({ url, file });
    const title = groupName(headings);
    let group = toc[toc.length - 1];
    if (!group || group.title !== title) toc.push((group = { title, section: [] }));
    group.section.push({ path: file });
  }
  return { pages, toc };
}

/** "Plugins" › "Plugins" › "Mods" is "Plugins: Mods", and "Plugins" › "Plugins" › "Plugins" just "Plugins". */
function groupName(headings) {
  const [top, ...rest] = headings.filter(Boolean);
  const last = rest[rest.length - 1];
  return top ? (last && last !== top ? `${top}: ${last}` : top) : "Docs";
}

/**
 * A downloaded page, ready to build: without the "Documentation index" note
 * at its top, and with links to other pages of the docs written as paths
 * (`/hooks-guide.md`), so they stay in DevDocs.
 *
 * @param {string} text
 * @param {string} base
 */
export function cleanPage(text, base) {
  let page = text.replace(/\r\n?/g, "\n");
  // A note for AI agents, as a quote at the very top: "> ## Documentation Index ...".
  page = page.replace(/^(?:>[^\n]*\n)*?>\s*#*\s*Documentation Index[^\n]*\n(?:>[^\n]*\n)*\n*/i, "");
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.replace(new RegExp(`\\]\\(${escaped}`, "g"), "](/").replace(new RegExp(`(href=["'])${escaped}`, "g"), "$1/");
}

/** @param {typeof fetch} get @param {string} url */
async function getText(get, url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await get(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "text/markdown, text/plain, */*" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (/HTTP 4\d\d/.test(error.message) && !/HTTP 429/.test(error.message)) break;
      await new Promise((done) => setTimeout(done, 500 * (attempt + 1)));
    }
  }
  throw new Error(`Couldn't get ${url}: ${lastError.message}`);
}
