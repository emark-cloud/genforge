#!/usr/bin/env python3
"""Generate src/lib/sdk-reference.ts from the pinned py-genlayer SDK.

Walks a curated set of modules under
``~/.cache/gltest-direct/extracted/<ver>/py-lib-genlayer-std/<sub>/genlayer/``,
parses each with ``ast``, and emits a compact Markdown reference embedded
in a TypeScript module. The intent is to give the LLM system prompt a
positive enumeration of the SDK's public surface — anything not listed
does not exist.

Invocation::

    python3 scripts/gen_sdk_reference.py > src/lib/sdk-reference.ts

Exits non-zero (2) if the pinned hash directory is missing — we refuse
to ship a stale or partial reference.
"""

from __future__ import annotations

import ast
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# ── Path resolution ─────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent
VERSION_TS = REPO_ROOT / "src" / "lib" / "genlayer-version.ts"


def read_pinned_hash() -> str:
    text = VERSION_TS.read_text(encoding="utf-8")
    m = re.search(r'GENLAYER_DEPENDS_HASH\s*=\s*"([a-z0-9]+)"', text)
    if m is None:
        die("could not parse GENLAYER_DEPENDS_HASH from src/lib/genlayer-version.ts")
        raise SystemExit(2)  # for type-checkers; die() already exited.
    return m.group(1)


def resolve_sdk_root() -> tuple[Path, str]:
    cache = Path(os.environ.get("GLTEST_CACHE", Path.home() / ".cache/gltest-direct/extracted"))
    if not cache.is_dir():
        die(f"SDK cache root not found at {cache} (set GLTEST_CACHE to override)")
    versions = sorted(
        (p for p in cache.iterdir() if re.fullmatch(r"v\d+\.\d+\.\d+", p.name)),
        reverse=True,
    )
    if not versions:
        die(f"no versioned subdirs (vN.N.N) under {cache}")
    ver_dir = versions[0]
    std_parent = ver_dir / "py-lib-genlayer-std"
    children = list(std_parent.iterdir()) if std_parent.is_dir() else []
    if len(children) != 1:
        die(f"expected exactly one py-lib-genlayer-std/<hash> dir, found {len(children)} at {std_parent}")
    sdk = children[0] / "genlayer"
    if not sdk.is_dir():
        die(f"resolved SDK root does not exist: {sdk}")
    return sdk, ver_dir.name


def assert_pin_present(version_dir_name: str, pin: str) -> None:
    cache = Path(os.environ.get("GLTEST_CACHE", Path.home() / ".cache/gltest-direct/extracted"))
    pin_dir = cache / version_dir_name / "py-genlayer" / pin
    if not pin_dir.is_dir():
        die(
            f"pinned py-genlayer hash dir missing: {pin_dir}\n"
            f"Run `gltest-direct fetch` (or set GLTEST_CACHE) before regenerating the reference."
        )


def die(msg: str) -> None:
    sys.stderr.write(f"gen_sdk_reference: {msg}\n")
    sys.exit(2)


# ── AST helpers ─────────────────────────────────────────────────────────


def parse(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def first_line(s: str | None) -> str:
    """Best human-readable one-line summary from a Python docstring.

    Skips doctest examples (``>>> ...`` and continuation lines) and Sphinx
    ``.. directive::`` blocks; prefers ``:returns: text`` when present so
    property docstrings produce useful descriptions instead of an opening
    ``>>>`` example.
    """
    if not s:
        return ""
    lines = [ln.rstrip() for ln in s.strip().splitlines()]
    # `:returns:` (or `:return:`) wins if present.
    for ln in lines:
        ls = ln.lstrip()
        if ls.startswith((":returns:", ":return:")):
            after = ls.split(":", 2)[2].strip()
            if after:
                return after.rstrip(":")
    # Otherwise: first content line that isn't a doctest example or RST directive.
    for ln in lines:
        ls = ln.lstrip()
        if not ls:
            continue
        if ls.startswith((">>>", "...", ".. ", "::")):
            continue
        return ls.rstrip(":")
    return ""


def get_all_tuple(mod: ast.Module) -> list[str]:
    """Extract the literal `__all__` tuple, ignoring inline comments."""
    for node in mod.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "__all__" for t in node.targets
        ):
            val = node.value
            # Tuple or list of string literals.
            if isinstance(val, (ast.Tuple, ast.List)):
                out: list[str] = []
                for el in val.elts:
                    if isinstance(el, ast.Constant) and isinstance(el.value, str):
                        out.append(el.value)
                return out
    return []


def unparse_annot(annot: ast.expr | None) -> str:
    if annot is None:
        return ""
    try:
        return ast.unparse(annot)
    except Exception:
        return "?"


def func_sig(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> str:
    """Render `name(args) -> return` for a top-level or method function."""
    args = fn.args
    parts: list[str] = []

    # positional-only
    if args.posonlyargs:
        for a in args.posonlyargs:
            parts.append(_arg(a))
        parts.append("/")

    # regular positional + defaults
    pos = list(args.args)
    defaults = list(args.defaults)
    n_pos = len(pos)
    n_def = len(defaults)
    for i, a in enumerate(pos):
        d_idx = i - (n_pos - n_def)
        default = defaults[d_idx] if d_idx >= 0 else None
        parts.append(_arg(a, default=default))

    # *args
    if args.vararg:
        parts.append("*" + _arg(args.vararg))
    elif args.kwonlyargs:
        parts.append("*")

    # keyword-only
    for a, default in zip(args.kwonlyargs, args.kw_defaults):
        parts.append(_arg(a, default=default))

    # **kwargs
    if args.kwarg:
        parts.append("**" + _arg(args.kwarg))

    ret = ""
    if fn.returns is not None:
        ret = f" -> {unparse_annot(fn.returns)}"
    return f"{fn.name}({', '.join(parts)}){ret}"


def _arg(a: ast.arg, default: ast.expr | None = None) -> str:
    out = a.arg
    if a.annotation is not None:
        out += f": {unparse_annot(a.annotation)}"
    if default is not None:
        try:
            out += f" = {ast.unparse(default)}"
        except Exception:
            out += " = ..."
    return out


def public_methods(cls: ast.ClassDef) -> list[ast.FunctionDef | ast.AsyncFunctionDef]:
    """Functions whose name doesn't start with '_' AND not @typing.overload stubs."""
    out: list[ast.FunctionDef | ast.AsyncFunctionDef] = []
    seen: dict[str, ast.FunctionDef | ast.AsyncFunctionDef] = {}
    for n in cls.body:
        if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if n.name.startswith("_"):
            continue
        # Skip @typing.overload stubs (their body is just `...`); keep the
        # final concrete def, which appears last by Python convention.
        if any(_is_overload(d) for d in n.decorator_list):
            continue
        if n.name in seen:
            continue
        seen[n.name] = n
        out.append(n)
    return out


def _is_overload(dec: ast.expr) -> bool:
    if isinstance(dec, ast.Name) and dec.id == "overload":
        return True
    if isinstance(dec, ast.Attribute) and dec.attr == "overload":
        return True
    return False


def is_property(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    for d in fn.decorator_list:
        if isinstance(d, ast.Name) and d.id == "property":
            return True
        if isinstance(d, ast.Attribute) and d.attr == "property":
            return True
    return False


def field_pairs(cls: ast.ClassDef) -> list[tuple[str, str, str]]:
    """Return [(name, type, docstring_first_line), ...] from class body
    AnnAssign nodes, pairing each with its adjacent string Expr (if any)."""
    out: list[tuple[str, str, str]] = []
    body = cls.body
    for i, n in enumerate(body):
        if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name):
            name = n.target.id
            if name.startswith("_"):
                continue
            anno = unparse_annot(n.annotation)
            doc = ""
            # Adjacent string literal as docstring.
            nxt = body[i + 1] if i + 1 < len(body) else None
            if (
                isinstance(nxt, ast.Expr)
                and isinstance(nxt.value, ast.Constant)
                and isinstance(nxt.value.value, str)
            ):
                doc = first_line(nxt.value.value)
            out.append((name, anno, doc))
    return out


# ── Renderers ───────────────────────────────────────────────────────────


def render_message_type(gl_init_module: ast.Module, msg_module: ast.Module) -> str:
    """Render gl.message (NamedTuple, attribute access) and gl.message_raw
    (TypedDict, item access).

    These are two different objects: `gl.message` is the convenience
    NamedTuple bound at runtime in `gl/__init__.py` with only the
    most-used fields; `gl.message_raw` is the full underlying TypedDict
    from `_internal/msg.py` with every transaction-context field. The
    SDK does NOT bridge raw fields onto `gl.message` — e.g.
    `gl.message.datetime` is `AttributeError` at runtime."""
    # MessageType NamedTuple — the attribute-access object.
    msg_lines = ["### gl.message  (NamedTuple — attribute access)"]
    msg_lines.append(
        "`gl.message` is a NamedTuple with **only** these fields. "
        "Anything else (datetime, is_init, stack, entry_kind, …) lives on "
        "`gl.message_raw` and must be read with dict syntax — see below."
    )
    msg_lines.append("")
    found_msg_type = False
    for n in gl_init_module.body:
        if isinstance(n, ast.ClassDef) and n.name == "MessageType":
            found_msg_type = True
            for name, anno, doc in field_pairs(n):
                msg_lines.append(_bullet(name, anno, doc))
            break
    if not found_msg_type:
        msg_lines.append("(parse failed — MessageType not found in gl/__init__.py)")

    # MessageRawType TypedDict — the dict-access object (gl.message_raw).
    raw_lines = ["", "### gl.message_raw  (TypedDict — dict access, `gl.message_raw['field']`)"]
    raw_lines.append(
        "Full transaction context as a TypedDict. **Use bracket notation, "
        "not attribute access**: `gl.message_raw['datetime']`, not "
        "`gl.message_raw.datetime`."
    )
    raw_lines.append("")
    for n in msg_module.body:
        if isinstance(n, ast.ClassDef) and n.name == "MessageRawType":
            for name, anno, doc in field_pairs(n):
                raw_lines.append(_bullet(name, anno, doc))
            break

    return "\n".join(msg_lines + raw_lines)


def render_vm(mod: ast.Module) -> str:
    lines = ["### gl.vm  (VM utilities)"]
    lines.append("Errors, sandboxing, and the nondet primitives.")
    lines.append("")
    # Dataclasses first.
    for n in mod.body:
        if isinstance(n, ast.ClassDef) and not n.name.startswith("_") and _has_dataclass(n.decorator_list):
            doc = first_line(ast.get_docstring(n))
            lines.append(_class_line(n, doc))
            for fname, anno, fdoc in field_pairs(n):
                lines.append(f"    - {fname}: {anno}" + (f"    # {fdoc}" if fdoc else ""))
    # Module-level functions.
    for n in mod.body:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and not n.name.startswith("_"):
            if any(_is_overload(d) for d in n.decorator_list):
                continue
            doc = first_line(ast.get_docstring(n))
            lines.append(f"- `{func_sig(n)}`" + (f"    # {doc}" if doc else ""))
    # Result alias.
    for n in mod.body:
        if isinstance(n, ast.TypeAlias) and isinstance(n.name, ast.Name) and n.name.id == "Result":
            lines.append(f"- `type Result[T] = Return[T] | VMError | UserError`    # union of VM outcomes")
            break
    return "\n".join(lines)


def render_eq_principle(mod: ast.Module) -> str:
    lines = ["### gl.eq_principle  (consensus wrappers)"]
    lines.append("Wrap every `gl.nondet.*` call (including hash and web) in one of these.")
    lines.append("")
    for n in mod.body:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and not n.name.startswith("_"):
            if any(_is_overload(d) for d in n.decorator_list):
                continue
            doc = first_line(ast.get_docstring(n))
            lines.append(f"- `{func_sig(n)}`" + (f"    # {doc}" if doc else ""))
    return "\n".join(lines)


def render_nondet(mod: ast.Module, web_mod: ast.Module) -> str:
    lines = ["### gl.nondet  (non-deterministic primitives — ALWAYS wrap in eq_principle)"]
    lines.append("")
    for n in mod.body:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and not n.name.startswith("_"):
            if any(_is_overload(d) for d in n.decorator_list):
                continue
            doc = first_line(ast.get_docstring(n))
            lines.append(f"- `gl.nondet.{func_sig(n)}`" + (f"    # {doc}" if doc else ""))
    # gl.nondet.web
    lines.append("")
    lines.append("**gl.nondet.web** (HTTP requests + headless render):")
    for n in web_mod.body:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and not n.name.startswith("_"):
            if any(_is_overload(d) for d in n.decorator_list):
                continue
            doc = first_line(ast.get_docstring(n))
            lines.append(f"- `gl.nondet.web.{func_sig(n)}`" + (f"    # {doc}" if doc else ""))
    lines.append("")
    lines.append("**gl.nondet.hash**: `keccak256(data: bytes) -> bytes` (and similar). All hash calls live in `gl.nondet.hash` and need `eq_principle.strict_eq` wrapping.")
    return "\n".join(lines)


def render_address(mod: ast.Module) -> str:
    lines = ["### Address  (also available as `gl.Address`)"]
    for n in mod.body:
        if isinstance(n, ast.ClassDef) and n.name == "Address":
            ctor = ""
            for m in n.body:
                if isinstance(m, ast.FunctionDef) and m.name == "__init__":
                    ctor = func_sig(m)
                    break
            if ctor:
                lines.append(f"- `{ctor}`")
            # Properties
            for m in n.body:
                if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)) and is_property(m):
                    name = m.name
                    if name.startswith("_"):
                        continue
                    ret = unparse_annot(m.returns) if m.returns is not None else "?"
                    doc = first_line(ast.get_docstring(m))
                    lines.append(f"    - `.{name}: {ret}`" + (f"    # {doc}" if doc else ""))
            break
    lines.append("- **No** `Address.zero()`, `Address.null()`, `Address.empty()` etc. exist. For an all-zero sentinel use `Address(\"0x\" + \"00\" * 20)`.")
    return "\n".join(lines)


def render_integer_types() -> str:
    return (
        "### Integer types  (from `genlayer.py.types`, also under `gl.*`)\n"
        "- Unsigned: `u8, u16, u24, u32, u40, u48, u56, u64, u72, u80, u88, u96, u104, u112, u120, u128, u136, u144, u152, u160, u168, u176, u184, u192, u200, u208, u216, u224, u232, u240, u248, u256`\n"
        "- Signed:   `i8, i16, i24, i32, i40, i48, i56, i64, i72, i80, i88, i96, i104, i112, i120, i128, i136, i144, i152, i160, i168, i176, i184, i192, i200, i208, i216, i224, i232, i240, i248, i256`\n"
        "- Unbounded: `bigint`\n"
        "- **No floats anywhere in the SDK** — there is no `float` storage descriptor and no float type alias.\n"
        "- Construct as `u256(123)`, `i64(-1)`, `bigint(10**40)`."
    )


def render_storage(storage_init: ast.Module, tree_map: ast.Module, vec: ast.Module) -> str:
    lines = ["### Storage primitives (`from genlayer import *` or `gl.storage`)"]
    lines.append("")
    lines.append("**Eligible storage types** (the SDK rejects anything else):")
    lines.append("- `Address`, `str`, `bytes`, `bool`, `None`")
    lines.append("- Every integer width above (`u8…u256`, `i8…i256`, `bigint`)")
    lines.append("- `TreeMap[K, V]`, `DynArray[T]`, `Array[T, N]`")
    lines.append("- `@allow_storage`-decorated dataclasses or plain classes")
    lines.append("- **`Enum` subclasses are NOT eligible.** Store the underlying integer (`u256(MyEnum.X.value)`) and round-trip via the Enum class inside methods.")
    lines.append("- **Union types are NOT eligible.** `Address | None`, `Optional[T]`, `Union[A, B]` all fail at deploy (`E104: incorrect number of generic arguments for <class 'types.UnionType'>`). To express \"unset,\" use a sentinel (`Address(\"0x\" + \"00\" * 20)`, `u256(0)`, empty `str`/`bytes`) or a parallel `has_winner: bool` field — never a `Optional` annotation.")
    lines.append("")
    # storage __init__ exports as module-level functions.
    for n in storage_init.body:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and not n.name.startswith("_"):
            doc = first_line(ast.get_docstring(n))
            lines.append(f"- `gl.storage.{func_sig(n)}`" + (f"    # {doc}" if doc else ""))
    lines.append("- `@allow_storage` decorator — apply to dataclasses / plain classes used as storage field types or inside generic containers.")
    lines.append("")
    # TreeMap public surface
    lines.append("**TreeMap[K, V]** — ordered map; keys must be `Comparable`. Methods:")
    for fn in public_methods(_find_class(tree_map, "TreeMap") or _empty_class()):
        doc = first_line(ast.get_docstring(fn))
        lines.append(f"- `tree.{func_sig(fn)}`" + (f"    # {doc}" if doc else ""))
    lines.append("- Plus the usual mapping interface: `m[k]`, `m[k] = v`, `del m[k]`, `k in m`, `iter(m)`, `len(m)`.")
    lines.append("")
    lines.append("**DynArray[T]** — growable list:")
    for fn in public_methods(_find_class(vec, "DynArray") or _empty_class()):
        doc = first_line(ast.get_docstring(fn))
        lines.append(f"- `arr.{func_sig(fn)}`" + (f"    # {doc}" if doc else ""))
    lines.append("- Plus the usual sequence interface: `arr[i]`, `arr[i] = v`, `iter(arr)`, `len(arr)`.")
    lines.append("")
    lines.append("**Array[T, N]** — fixed-size array. Indexing only; no append/pop. `N` is a literal integer type-parameter.")
    return "\n".join(lines)


def render_pointer_namespaces() -> str:
    return (
        "### Pointer-only namespaces\n"
        "These exist but their surface isn't enumerated inline. If you need them, refer to the SDK source on disk.\n"
        "- `gl.evm.*` — Ethereum bridge primitives (see `genlayer/gl/evm/`).\n"
        "- `gl.events.*` — `Event` class and emission helpers (`genlayer/gl/events.py`).\n"
        "- `gl.advanced.*` — escape hatches; rarely needed.\n"
        "- `gl.calldata` — calldata encode/decode helpers.\n"
        "- `gl.contract_interface`, `gl.get_contract_at(addr)`, `gl.deploy_contract(...)` — contract-to-contract calls.\n"
        "- `gl.Lazy[T]` — used as return type of eq_principle / nondet wrappers; resolve with `.get()` if needed."
    )


# ── Helpers ─────────────────────────────────────────────────────────────


def _bullet(name: str, anno: str, doc: str) -> str:
    body = f"- `{name}: {anno}`"
    return body + (f"    # {doc}" if doc else "")


def _class_line(cls: ast.ClassDef, doc: str) -> str:
    return f"- `class {cls.name}` (dataclass)" + (f"    # {doc}" if doc else "")


def _has_dataclass(decs: list[ast.expr]) -> bool:
    for d in decs:
        if isinstance(d, ast.Attribute) and d.attr == "dataclass":
            return True
        if isinstance(d, ast.Name) and d.id == "dataclass":
            return True
    return False


def _find_class(mod: ast.Module, name: str) -> ast.ClassDef | None:
    for n in mod.body:
        if isinstance(n, ast.ClassDef) and n.name == name:
            return n
    return None


def _empty_class() -> ast.ClassDef:
    return ast.ClassDef(
        name="_empty", bases=[], keywords=[], body=[], decorator_list=[], type_params=[]
    )


# ── Top-level composition ───────────────────────────────────────────────


PREAMBLE_TEMPLATE = """## SDK reference (py-genlayer {version}, pin {pin_short}…)

The following is the curated public surface for the pinned py-genlayer release. **Any identifier not listed here does not exist.** Use this as the authoritative API surface. The hard rules and common bugs above teach idiom and gotchas; this section is the truth about what exists.

`gl` is a proxy to `genlayer.gl`. `gl.message`, `gl.vm`, `gl.eq_principle`, `gl.nondet`, `gl.storage` are the namespaces you'll touch most often. `gl.Address`, `gl.TreeMap`, integer widths, etc. are the same objects as the top-level imports from `from genlayer import *`.

### Things that do NOT exist (common hallucinations)
- `gl.vm.timestamp()`, `gl.block.timestamp`, `gl.now()` — there is no time API. The only time signal is `gl.message_raw['datetime']` (ISO-8601 string; parse with `datetime.fromisoformat`). **`gl.message.datetime` does NOT exist** — `gl.message` is a NamedTuple with only `contract_address`, `sender_address`, `origin_address`, `value`, `chain_id`.
- `Address.zero()`, `Address.null()`, `Address.empty()` — only `Address(val: str | bytes)`.
- `@allow_storage` on `Enum` — Enums aren't storage-eligible; store the `.value` as `u256`.
- `float` anywhere in storage or types — there is no float in the SDK type system.
- **Union types in storage**: `Address | None`, `Optional[T]`, `Union[A, B]`, `T | U` are NOT storage-eligible (SDK raises `E104: incorrect number of generic arguments for <class 'types.UnionType'>` at deploy). Encode optionality as a sentinel value (e.g., `Address("0x" + "00" * 20)`, `u256(0)`, empty `str`) or a parallel `bool` flag.

"""


def render_all() -> str:
    sdk_root, ver = resolve_sdk_root()
    pin = read_pinned_hash()
    assert_pin_present(ver, pin)

    msg_mod = parse(sdk_root / "_internal" / "msg.py")
    gl_init_mod = parse(sdk_root / "gl" / "__init__.py")
    vm_mod = parse(sdk_root / "gl" / "vm.py")
    eq_mod = parse(sdk_root / "gl" / "eq_principle.py")
    nondet_init = parse(sdk_root / "gl" / "nondet" / "__init__.py")
    nondet_web = parse(sdk_root / "gl" / "nondet" / "web.py")
    types_mod = parse(sdk_root / "py" / "types.py")
    storage_init = parse(sdk_root / "py" / "storage" / "__init__.py")
    tree_map = parse(sdk_root / "py" / "storage" / "tree_map.py")
    vec_mod = parse(sdk_root / "py" / "storage" / "vec.py")

    preamble = PREAMBLE_TEMPLATE.format(version=ver, pin_short=pin[:8])

    sections = [
        preamble.rstrip(),
        render_message_type(gl_init_mod, msg_mod),
        render_vm(vm_mod),
        render_eq_principle(eq_mod),
        render_nondet(nondet_init, nondet_web),
        render_address(types_mod),
        render_integer_types(),
        render_storage(storage_init, tree_map, vec_mod),
        render_pointer_namespaces(),
    ]
    return "\n\n".join(sections).rstrip() + "\n"


# ── TS emission ─────────────────────────────────────────────────────────


def escape_for_ts_template(s: str) -> str:
    # Order matters: escape backslash first, then backtick and `${`.
    return s.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")


def emit_ts(markdown: str, pin: str, version: str) -> str:
    ts_now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    escaped = escape_for_ts_template(markdown)
    return (
        f"// AUTO-GENERATED by scripts/gen_sdk_reference.py — do not edit by hand.\n"
        f"// Source: py-genlayer {version}, pin {pin}\n"
        f"// Generated: {ts_now}\n"
        f"// To regenerate: pnpm gen:sdk-reference\n"
        f"\n"
        f"export const SDK_REFERENCE_HASH = \"{pin}\";\n"
        f"export const SDK_REFERENCE_VERSION = \"{version}\";\n"
        f"\n"
        f"export const SDK_REFERENCE: string = `{escaped}`;\n"
    )


def main() -> None:
    pin = read_pinned_hash()
    _, ver = resolve_sdk_root()
    markdown = render_all()
    sys.stdout.write(emit_ts(markdown, pin, ver))


if __name__ == "__main__":
    main()
