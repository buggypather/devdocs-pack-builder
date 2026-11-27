import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildPack } from "../src/build.mjs";
import { cleanPage, prepareSources, readIndex } from "../src/llms.mjs";

const INDEX = `# Some Docs

> What these are.

## Getting started

### Overview

#### Getting started

- [Overview](https://docs.example.com/docs/en/overview.md): Start here.
- [Quickstart](https://docs.example.com/docs/en/quickstart.md): Install it.

#### Core concepts

- [How it works](https://docs.example.com/docs/en/how-it-works.md): The loop.

## Plugins

### Plugins

#### Mods

- [Mods](https://docs.example.com/docs/en/plugins/mods/overview.md): Mods.
- [Gone](https://docs.example.com/docs/en/gone.md): Not there any more.
- [French](https://docs.example.com/docs/fr/overview.md): Not English.
- [Elsewhere](https://other.example.com/x.md): Another site.

## Indexes

- [French (4 pages)](https://docs.example.com/docs/_llms/fr.txt): An index.
`;

const PAGES = {
  "https://docs.example.com/docs/en/overview.md": `> ## Documentation Index
> Fetch the complete documentation index at: https://docs.example.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Overview

> What it is.

See the [quickstart](https://docs.example.com/docs/en/quickstart.md) and [mods](https://docs.example.com/docs/en/plugins/mods/overview.md#start).

> [!TIP]
> A tip.

## First steps

Go.
`,
  "https://docs.example.com/docs/en/quickstart.md": "# Quickstart\n\nBack to the [overview](https://docs.example.com/docs/en/overview).\n",
  "https://docs.example.com/docs/en/how-it-works.md": "# How it works\n\nIt loops.\n",
  "https://docs.example.com/docs/en/plugins/mods/overview.md": "# Mods\n\n## Start {#start}\n\nSee [how it works](https://docs.example.com/docs/en/how-it-works.md).\n",
};

const fakeFetch = async (url) => {
  if (url === "https://docs.example.com/docs/llms.txt") return new Response(INDEX);
  if (PAGES[url]) return new Response(PAGES[url]);
  return new Response("Not found", { status: 404 });
};

test("an llms.txt: its Markdown pages under the address given, grouped by its sections", () => {
  const { pages, toc } = readIndex(INDEX, "https://docs.example.com/docs/en/");
  assert.deepEqual(
    pages.map((page) => page.file),
    ["overview.md", "quickstart.md", "how-it-works.md", "plugins/mods/overview.md", "gone.md"],
  );
  assert.deepEqual(
    toc.map((group) => [group.title, group.section.length]),
    [["Getting started", 2], ["Getting started: Core concepts", 1], ["Plugins: Mods", 2]],
  );
});

test("a downloaded page loses the note for AI agents, and its links to the docs become paths", () => {
  const page = cleanPage(PAGES["https://docs.example.com/docs/en/overview.md"], "https://docs.example.com/docs/en/");
  assert.match(page, /^# Overview/);
  assert.ok(page.includes("[quickstart](/quickstart.md)"), page);
  assert.ok(page.includes("[mods](/plugins/mods/overview.md#start)"), page);
});

test("docs listed by an llms.txt are downloaded, then built like any other", async (t) => {
  const cache = mkdtempSync(join(tmpdir(), "cache-"));
  const out = mkdtempSync(join(tmpdir(), "pack-"));
  t.after(() => {
    rmSync(cache, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });
  const config = {
    name: "Example",
    docs: [
      {
        name: "Example",
        slug: "example",
        source: { llms: "https://docs.example.com/docs/llms.txt", only: "https://docs.example.com/docs/en/" },
        site: "https://docs.example.com/docs/en",
        attribution: "&copy; Example",
      },
    ],
  };
  const said = [];
  await prepareSources(config, { cacheDir: cache, log: (line) => said.push(line), fetch: fakeFetch });
  assert.ok(said.some((line) => /1 of 5 pages couldn't be downloaded: gone\.md/.test(line)), said.join("\n"));

  buildPack(config, { outDir: out, baseDir: cache, cacheDir: cache });
  const pages = JSON.parse(readFileSync(join(out, "example/db.json"), "utf8"));
  assert.deepEqual(Object.keys(pages).sort(), ["how-it-works", "index", "overview", "plugins/mods/overview", "quickstart"]);
  const overview = pages.overview;
  assert.ok(!overview.includes("Documentation Index"), overview);
  assert.ok(overview.includes('<a href="quickstart">quickstart</a>'), overview);
  assert.ok(overview.includes('<a href="plugins/mods/overview#start">mods</a>'), overview);
  assert.ok(pages["plugins/mods/overview"].includes('<a href="../../how-it-works">how it works</a>'), pages["plugins/mods/overview"]);
  assert.ok(pages.quickstart.includes('<a href="overview">overview</a>'), "a link without .md");
  assert.ok(overview.includes('href="https://docs.example.com/docs/en/overview"'), "the original page");

  const index = JSON.parse(readFileSync(join(out, "example/index.json"), "utf8"));
  assert.deepEqual(
    index.types.map((type) => type.name),
    ["Getting started", "Getting started: Core concepts", "Plugins: Mods"],
  );
  assert.ok(index.entries.some((entry) => entry.name === "Overview: First steps"), JSON.stringify(index.entries));
});
