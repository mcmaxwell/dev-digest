# collect.py - defects found by the skill's own eval

## 1. `du -skL` double-counts pnpm's isolated layout  (FIXED 2026-08-27)

`mcp` is reported at ~288M. Two independent full_skill runs verified the real
figure is ~110M (`mcp/node_modules/.pnpm`): following every symlink counts the
shared store once per link.

Fix: when `layout == "isolated"`, measure `node_modules/.pnpm` once for the
package total, and keep `-L` only for per-package own size.
Do NOT change this while an eval arm is in flight - both arms must read the
same instrument.

**Fixed.** `du_kb` no longer passes `-L`; `dep_size_kb` resolves a symlink to
its real path before measuring. Verified against the figure the no_skill arm
derived independently with plain `du`:

| package | before | after | independent check |
|---|---|---|---|
| mcp | 287M | 110M | 110M |
| e2e | 83M | 36M | 37M |
| reviewer-core | 104M | 84M | 85M |
| server | 243M | 239M | 239M |
| client | 663M | 663M | 664M |

Note the eval that caught this: the arm with NO instrument was right 5/5 and
the arm with the instrument was wrong 5/5. A tool can be worse than nothing,
and only a third arm makes that visible.

## 2. Not a bug: `dependency-cruiser` in server's `dependencies`

`server/src/adapters/depgraph/index.ts:17` does `import { cruise } from
'dependency-cruiser'` at runtime, so the declaration is correct.
Recorded here because it was misread twice during development - once by
grepping only `devDependencies`, once by truncating a grep with `head -4` and
seeing only the comment mentions.

## 3. Not a bug: `@vscode/ripgrep` has no `bin/` directory

At 1.18.0 the package ships no postinstall and no `bin/`; the executable comes
from a platform optionalDependency, and `@vscode/ripgrep-darwin-arm64/bin/rg`
(4.5 MB, executable) is installed and correct.
One eval run reported the missing `bin/` as a broken postinstall; another run
checked the packaging and got it right.

Worth adding to `references/supply-chain.md`: before calling a native package
broken, check whether its binary moved to a per-platform optionalDependency.

## Recurring mistake shape (mine, three times in one session)

Each was the same error: narrow the check, then conclude from the part.

1. read `devDependencies` only, concluded a dependency was undeclared;
2. `grep ... | head -4`, saw only comments, concluded there was no import;
3. `ls bin/`, saw it missing, concluded a postinstall had failed.

Every one was caught by looking at the whole source instead of a slice. The
rule this earns: a negative claim ("X is unused / undeclared / broken") needs
the complete search, never a truncated or single-section one.
