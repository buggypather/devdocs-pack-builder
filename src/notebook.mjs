// Jupyter notebooks (.ipynb) as Markdown pages: text cells as they are, code
// cells as code, and what the code printed (text, tables as text, small
// pictures and errors). HTML and widget output is left out: it needs the
// notebook's own scripts.

/** Lines of output shown per output; the rest is cut. */
const MAX_OUTPUT_LINES = 40;
/** Pictures bigger than this (in base64 characters) are left out, to keep db.json small. */
const MAX_IMAGE_CHARS = 150_000;

/**
 * @param {string} text The .ipynb file.
 * @param {string} [fileName] Its name, for a title when it has none.
 * @returns {{ title: string, body: string }} Its title, taken out of the
 *   body: a `#` heading on the first line of its first text cell, or a bold
 *   first line there, or else its file name; and the rest as Markdown.
 */
export function notebookMarkdown(text, fileName = "") {
  let notebook;
  try {
    notebook = JSON.parse(text);
  } catch {
    return { title: "", body: "" };
  }
  const cells = Array.isArray(notebook?.cells) ? notebook.cells : [];
  const meta = notebook?.metadata || {};
  const language = String(meta.language_info?.name || meta.kernelspec?.language || "python").toLowerCase();

  let title = "";
  let first = true;
  const parts = [];
  for (const cell of cells) {
    const source = joinSource(cell?.source).replace(/\r\n?/g, "\n");
    if (cell?.cell_type === "markdown") {
      // Colab shows "#Heading" as a heading, without the space Markdown wants.
      let markdown = source.replace(/^(#{1,6})(?=[^\s#])/gm, (marks, _, at) => (insideFence(source, at) ? marks : `${marks} `));
      if (first) {
        first = false;
        const top = markdown.match(/^\s*(?:#[ \t]+(.+?)[ \t#]*|<b>(.+?)<\/b>|\*\*(.+?)\*\*)[ \t]*(?:\n|$)/);
        if (top) {
          title = (top[1] ?? top[2] ?? top[3]).replace(/[*_`]/g, "").trim();
          markdown = markdown.slice(top[0].length);
        }
      }
      if (markdown.trim()) parts.push(markdown.trim());
    } else if (cell?.cell_type === "code") {
      if (source.trim()) parts.push(fence(source.replace(/\n+$/, ""), language));
      for (const output of Array.isArray(cell.outputs) ? cell.outputs : []) {
        const shown = outputMarkdown(output);
        if (shown) parts.push(shown);
      }
    }
  }
  // Its top sections as ## (under the page's title), whether it wrote them as # or ###.
  const markdownParts = parts.map((part) => !/^`{3,}/.test(part));
  const levels = parts.flatMap((part, i) =>
    markdownParts[i] ? [...part.matchAll(/^(#{1,6})[ \t]/gm)].filter((m) => !insideFence(part, m.index)).map((m) => m[1].length) : [],
  );
  const shift = levels.length ? 2 - Math.min(...levels) : 0;
  if (shift) {
    for (const [i, part] of parts.entries()) {
      if (!markdownParts[i]) continue;
      parts[i] = part.replace(/^(#{1,6})(?=[ \t])/gm, (marks, _, at) =>
        insideFence(part, at) ? marks : "#".repeat(Math.min(6, Math.max(1, marks.length + shift))),
      );
    }
  }
  if (!title) {
    // "Getting_started_with_colab.ipynb" is "Getting started with colab".
    const name = fileName.replace(/^.*[\\/]/, "").replace(/\.ipynb$/i, "").replace(/[_-]+/g, " ").trim();
    title = name ? name[0].toUpperCase() + name.slice(1) : "Notebook";
  }
  return { title, body: parts.join("\n\n") + "\n" };
}

/** @param {any} output */
function outputMarkdown(output) {
  if (!output || typeof output !== "object") return "";
  if (output.output_type === "stream") return textBlock(joinSource(output.text));
  if (output.output_type === "error") {
    return textBlock(`${output.ename || "Error"}: ${output.evalue || ""}`);
  }
  const data = output.data || {};
  for (const type of ["image/png", "image/jpeg", "image/gif"]) {
    const picture = joinSource(data[type]).replace(/\s+/g, "");
    if (picture && picture.length <= MAX_IMAGE_CHARS) return `![](data:${type};base64,${picture})`;
  }
  if (data["text/markdown"]) return joinSource(data["text/markdown"]).trim();
  if (data["text/plain"]) return textBlock(joinSource(data["text/plain"]));
  return "";
}

/** @param {string} text */
function textBlock(text) {
  // Terminal colours and progress bars' carriage returns aren't text.
  let lines = text
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .split("\n")
    .map((line) => line.slice(line.lastIndexOf("\r") + 1))
    .filter((line, i, all) => line.trim() || (i > 0 && i < all.length - 1));
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return "";
  if (lines.length > MAX_OUTPUT_LINES) lines = [...lines.slice(0, MAX_OUTPUT_LINES), `… (${lines.length - MAX_OUTPUT_LINES} more lines)`];
  return fence(lines.join("\n"), "");
}

/** A fenced code block, with a fence longer than any run of backticks in the code. */
function fence(code, language) {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  const marks = "`".repeat(longest + 1);
  return `${marks}${language}\n${code}\n${marks}`;
}

/** @param {unknown} source A notebook's text: a string, or a list of lines. */
function joinSource(source) {
  if (Array.isArray(source)) return source.map(String).join("");
  return typeof source === "string" ? source : "";
}

/** Whether a place in some Markdown is inside a fenced code block. */
function insideFence(markdown, at) {
  const before = markdown.slice(0, at).match(/^(`{3,}|~{3,})/gm) || [];
  return before.length % 2 === 1;
}
