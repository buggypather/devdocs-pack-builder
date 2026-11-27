"""Reads a Python package's public API and docstrings, for the pack builder.

  python3 pydoc.py <package folder> <package name>

Prints JSON: one entry per public module, with its docstring and its public
functions and classes (with their methods), each with its signature and its
docstring turned into Markdown. Nothing is imported or run: the files are
only parsed, so the package's own dependencies aren't needed.

A module's public names are its __all__ when it lists them, otherwise what it
defines whose names don't start with "_", plus what a package's __init__
brings in from its own private modules (the usual way of re-exporting).
Modules and folders starting with "_", tests and test data are left out.
"""

import ast
import json
import os
import re
import sys
import textwrap

SKIP_DIRS = {"test", "tests", "testdata", "testing", "__pycache__"}
SECTION_RGX = re.compile(
    r"^(Args|Arguments|Parameters|Params|Keyword Args|Keyword Arguments|Other Parameters|Returns|Return|Yields|Yield|"
    r"Raises|Raise|Except|Exceptions|Attributes|Example|Examples|Usage|Note|Notes|Warning|Warnings|Todo|See Also|References)\s*:\s*$"
)
LIST_SECTIONS = {"Args", "Arguments", "Parameters", "Params", "Keyword Args", "Keyword Arguments", "Other Parameters", "Raises", "Raise", "Except", "Exceptions", "Attributes"}
SECTION_NAMES = {
    "Arguments": "Args", "Parameters": "Args", "Params": "Args", "Keyword Arguments": "Keyword args", "Keyword Args": "Keyword args",
    "Return": "Returns", "Yield": "Yields", "Raise": "Raises", "Except": "Raises", "Exceptions": "Raises",
    "Usage": "Example", "Warnings": "Warning",
}
ITEM_RGX = re.compile(r"^(\*{0,2}[\w.]+)\s*(\(([^)]*)\))?\s*:\s*(.*)$")


def escape(text):
    """Text for Markdown: no HTML of its own (a docstring's <cell> is text)."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def is_code(lines):
    """Whether an example is code (>>> prompts, or lines that look like Python)."""
    text = "\n".join(lines)
    if ">>>" in text:
        return True
    code_like = sum(1 for l in lines if re.match(r"^\s*(\w[\w.]*\s*=|\w[\w.]*\(|from |import |for |if |with |def |class |print\(|!|%)", l))
    return code_like * 2 >= len([l for l in lines if l.strip()])


def docstring_markdown(doc):
    """A Google-style docstring as Markdown: its Args, Returns, Raises and Example sections made readable."""
    if not doc:
        return ""
    lines = textwrap.dedent(doc).strip("\n").splitlines()
    # inspect.cleandoc: the first line has no indent of its own.
    if len(lines) > 1:
        rest = textwrap.dedent("\n".join(lines[1:])).splitlines()
        lines = [lines[0].strip()] + rest
    out = []
    plain = []

    def flush_plain():
        if plain:
            out.append(escape("\n".join(plain)).strip("\n"))
            plain.clear()

    i = 0
    while i < len(lines):
        match = SECTION_RGX.match(lines[i])
        if not match:
            plain.append(lines[i])
            i += 1
            continue
        flush_plain()
        name = SECTION_NAMES.get(match.group(1), match.group(1))
        i += 1
        body = []
        while i < len(lines) and (not lines[i].strip() or lines[i][:1] in (" ", "\t")):
            body.append(lines[i])
            i += 1
        while body and not body[-1].strip():
            body.pop()
        # "Example:" with the example under it, not indented: up to the next section.
        if not body and name in ("Example", "Examples"):
            while i < len(lines) and not SECTION_RGX.match(lines[i]):
                body.append(lines[i])
                i += 1
            while body and not body[-1].strip():
                body.pop()
        body = textwrap.dedent("\n".join(body)).splitlines()
        out.append(f"**{name}**")
        if match.group(1) in LIST_SECTIONS:
            items = []
            for line in body:
                item = ITEM_RGX.match(line) if line[:1] not in (" ", "\t") else None
                if item:
                    kind = f" ({escape(item.group(3))})" if item.group(3) else ""
                    items.append([f"`{item.group(1)}`{kind}", item.group(4).strip()])
                elif items and line.strip():
                    items[-1][1] += " " + line.strip()
                elif line.strip():
                    items.append(["", line.strip()])
            out.append("\n".join(f"- {n}{': ' if n and text else ''}{escape(text)}" for n, text in items))
        elif name in ("Example", "Examples") and body and is_code(body):
            out.append("```python\n" + "\n".join(body) + "\n```")
        else:
            out.append(escape("\n".join(body)))
    flush_plain()
    return "\n\n".join(part for part in out if part.strip())


def unparse_args(args, drop_first):
    """A function's parameters as written, without self or cls for methods."""
    text = ast.unparse(args)
    if drop_first and (args.posonlyargs or args.args):
        first = (args.posonlyargs or args.args)[0].arg
        if first in ("self", "cls"):
            text = re.sub(rf"^{first}\s*(,\s*)?", "", text)
            text = re.sub(r"^/\s*,\s*", "", text)
    return text


def returns(node):
    return f" -> {ast.unparse(node.returns)}" if getattr(node, "returns", None) else ""


def describe_function(node, method=False):
    decorators = [ast.unparse(d) for d in node.decorator_list]
    is_property = any(d in ("property", "functools.cached_property", "cached_property") for d in decorators)
    is_static = "staticmethod" in decorators
    return {
        "name": node.name,
        "kind": "property" if is_property else "function",
        "async": isinstance(node, ast.AsyncFunctionDef),
        "signature": "" if is_property else f"({unparse_args(node.args, method and not is_static)}){returns(node)}",
        "doc": docstring_markdown(ast.get_docstring(node, clean=False)),
    }


def describe_class(node):
    bases = ", ".join(t for t in (ast.unparse(b) for b in node.bases + [k for k in node.keywords]) if t != "object")
    init = next((b for b in node.body if isinstance(b, (ast.FunctionDef, ast.AsyncFunctionDef)) and b.name == "__init__"), None)
    methods = [
        describe_function(b, method=True)
        for b in node.body
        if isinstance(b, (ast.FunctionDef, ast.AsyncFunctionDef)) and not b.name.startswith("_")
    ]
    doc = docstring_markdown(ast.get_docstring(node, clean=False))
    init_doc = docstring_markdown(ast.get_docstring(init, clean=False)) if init else ""
    return {
        "name": node.name,
        "kind": "class",
        "bases": bases,
        "signature": f"({unparse_args(init.args, True)})" if init else "",
        "doc": "\n\n".join(part for part in (doc, init_doc) if part),
        "methods": methods,
    }


def literal_names(node):
    try:
        value = ast.literal_eval(node)
    except ValueError:
        return None
    return [str(v) for v in value] if isinstance(value, (list, tuple)) else None


class Package:
    def __init__(self, folder, name):
        self.folder = folder
        self.name = name
        self.trees = {}

    def module_file(self, module):
        """The file of a module of this package, or None."""
        if module != self.name and not module.startswith(self.name + "."):
            return None
        rest = module[len(self.name):].lstrip(".").split(".") if module != self.name else []
        base = os.path.join(self.folder, *rest)
        for file in (base + ".py", os.path.join(base, "__init__.py")):
            if os.path.isfile(file):
                return file
        return None

    def tree(self, file):
        if file not in self.trees:
            with open(file, encoding="utf-8") as f:
                self.trees[file] = ast.parse(f.read(), filename=file)
        return self.trees[file]

    def find(self, module, name, seen=()):
        """Where a module's name is defined: (node) following imports inside the package."""
        file = self.module_file(module)
        if not file or (module, name) in seen:
            return None
        seen = seen + ((module, name),)
        for node in self.tree(file).body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name == name:
                return node
        for node in self.tree(file).body:
            if isinstance(node, ast.ImportFrom) and node.module:
                source = self.absolute(module, file, node)
                for alias in node.names:
                    if (alias.asname or alias.name) == name:
                        return self.find(source, alias.name, seen)
        return None

    def absolute(self, module, file, node):
        """The module an `from X import y` names, relative imports included."""
        if not node.level:
            return node.module
        package = module if file.endswith("__init__.py") else module.rsplit(".", 1)[0]
        parts = package.split(".")
        if node.level > 1:
            parts = parts[: len(parts) - (node.level - 1)]
        return ".".join(parts + ([node.module] if node.module else []))

    def describe(self, module, file):
        tree = self.tree(file)
        names = None
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "__all__" for t in node.targets):
                names = literal_names(node.value)
        if names is None:
            names = []
            for node in tree.body:
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and not node.name.startswith("_"):
                    names.append(node.name)
                elif isinstance(node, ast.ImportFrom) and node.module and file.endswith("__init__.py"):
                    source = self.absolute(module, file, node)
                    # Re-exported from the package's own private modules.
                    if self.module_file(source) and any(part.startswith("_") for part in source.split(".")):
                        names += [alias.asname or alias.name for alias in node.names if not (alias.asname or alias.name).startswith("_")]
        members = []
        for name in dict.fromkeys(names):
            node = self.find(module, name)
            if isinstance(node, ast.ClassDef):
                item = describe_class(node)
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                item = describe_function(node)
            else:
                continue
            item["name"] = name
            members.append(item)
        return {
            "module": module,
            "file": os.path.relpath(file, self.folder).replace(os.sep, "/"),
            "doc": docstring_markdown(ast.get_docstring(tree, clean=False)),
            "members": members,
        }

    def modules(self):
        found = []
        for root, dirs, files in os.walk(self.folder):
            dirs[:] = sorted(d for d in dirs if not d.startswith((".", "_")) and d not in SKIP_DIRS and os.path.isfile(os.path.join(root, d, "__init__.py")))
            rel = os.path.relpath(root, self.folder)
            prefix = self.name if rel == "." else self.name + "." + rel.replace(os.sep, ".")
            for file in sorted(files):
                if not file.endswith(".py") or file.endswith("_test.py") or file.startswith("test_"):
                    continue
                if file.startswith("_") and file != "__init__.py":
                    continue
                module = prefix if file == "__init__.py" else f"{prefix}.{file[:-3]}"
                try:
                    found.append(self.describe(module, os.path.join(root, file)))
                except SyntaxError as error:
                    print(f"Skipped {file}: {error}", file=sys.stderr)
        return found


def main():
    folder, name = sys.argv[1], sys.argv[2]
    json.dump(Package(folder, name).modules(), sys.stdout)


if __name__ == "__main__":
    main()
