// A Python package's reference, from its docstrings: one page per public
// module, with its functions and classes, and each of them searchable.
// The reading is done by pydoc.py, with Python's own parser.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PYDOC = fileURLToPath(new URL("pydoc.py", import.meta.url));

/**
 * @typedef {object} PyMember
 * @property {string} name
 * @property {"function" | "class" | "property"} kind
 * @property {boolean} [async]
 * @property {string} signature
 * @property {string} [bases]
 * @property {string} doc Markdown.
 * @property {PyMember[]} [methods]
 */

/**
 * @typedef {object} PyModule
 * @property {string} module e.g. `google.colab.drive`
 * @property {string} file Path in the package's folder, e.g. `drive.py`
 * @property {string} doc Markdown.
 * @property {PyMember[]} members
 */

/**
 * Reads a package with pydoc.py.
 *
 * @param {string} folder The package's folder on this computer.
 * @param {string} name Its import name, e.g. `google.colab`.
 * @returns {PyModule[]}
 */
export function readPythonPackage(folder, name) {
  let result;
  for (const python of ["python3", "python"]) {
    result = spawnSync(python, [PYDOC, folder, name], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (!result.error) break;
  }
  if (result.error) {
    throw new Error(`Couldn't run Python (${result.error.message}). Python 3.9 or newer is needed for "format": "python".`);
  }
  if (result.status !== 0) {
    throw new Error(`Reading the Python package ${name} failed:\n${result.stderr.trim()}`);
  }
  return JSON.parse(result.stdout);
}

/**
 * One module as a page: its Markdown body, its search entries (`drive.mount()`,
 * `widgets.Grid.output_to()`) and its sidebar group (the package it's in).
 *
 * @param {PyModule} mod
 * @param {string} packageName e.g. `google.colab`
 * @returns {{ path: string, title: string, group: string, body: string, entries: { name: string, id: string }[] }}
 */
export function modulePage(mod, packageName) {
  const relative = mod.module === packageName ? "" : mod.module.slice(packageName.length + 1);
  const path = relative ? relative.split(".").join("/") : "index";
  const group = mod.module.includes(".") ? mod.module.slice(0, mod.module.lastIndexOf(".")) : mod.module;
  const prefix = relative ? `${relative}.` : "";

  const parts = mod.doc ? [mod.doc] : [];
  /** @type {{ name: string, id: string }[]} */
  const entries = [];
  for (const member of mod.members) {
    const call = member.kind === "property" ? "" : "()";
    entries.push({ name: `${prefix}${member.name}${call}`, id: member.name });
    if (member.kind === "class") {
      parts.push(`## class ${code(member.name + member.signature)} {#${member.name}}`);
      if (member.bases) parts.push(`Bases: ${code(member.bases)}`);
    } else {
      parts.push(`## ${member.async ? "async " : ""}${code(member.name + member.signature)} {#${member.name}}`);
    }
    if (member.doc) parts.push(member.doc);
    for (const method of member.methods || []) {
      const id = `${member.name}.${method.name}`;
      const label = method.kind === "property" ? "property " : method.async ? "async " : "";
      parts.push(`### ${label}${code(id + method.signature)} {#${id}}`);
      if (method.doc) parts.push(method.doc);
      entries.push({ name: `${prefix}${id}${method.kind === "property" ? "" : "()"}`, id });
    }
  }
  if (!mod.members.length && !mod.doc) parts.push("_No public functions or classes._");
  return { path, title: mod.module, group, body: parts.join("\n\n") + "\n", entries };
}

/** Inline code that can hold backticks of its own. */
function code(text) {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const marks = "`".repeat(longest + 1);
  return longest ? `${marks} ${text} ${marks}` : `${marks}${text}${marks}`;
}
