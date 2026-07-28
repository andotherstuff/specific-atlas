# Agent instructions: Specific Atlas

## Write like a person

Never use em dashes. Do not use any language that reads as LLM-generated.
Examples include stock openings and conclusions, inflated claims, fake
quotations, excessive headings, repeated summaries, and formulaic contrast
patterns. Be direct, specific, and natural.

This applies to every piece of agent-written prose: responses, documentation,
issues, plans, PRs, reviews, comments, commit messages, release notes, product
copy, source comments, string literals, fixtures, and user-facing messages.
Agent-written prose inside source files is not exempt.

The only general exemptions are text reproduced verbatim from an existing
source, plus code syntax, commands, and identifiers that must remain exact.

Adopted from `divinevideo/divine-context` PR #58, "docs: require natural human
writing".

### Repo-specific carve-outs

These were agreed deliberately. Do not "fix" them.

- **The product name.** `SPECIFIC ATLAS—An Atlas of Donald Judd` in the page
  title keeps its em dash. It is the name of the thing, not prose.
- **Node titles.** `First Objects—Green Gallery` is an archival record label.
  Changing a displayed title changes data, not writing style.
- **Numeric and date ranges.** `1928 – 1994`, `Complete Writings 1959–1975`, and
  the Nostr kind range `30000–39999` keep their en dashes. A range dash is
  ordinary typography, not a sign of machine writing. `Complete Writings
  1959–1975` is also the real title of Judd's book.
- **Judd node descriptions in `src/data.js`.** The `content` field of each node
  is authored editorial prose about a real artist, in a deliberate voice, and
  most of it predates the rule. Leave it alone. Comments in that file are
  ordinary source comments and are covered by the rule.
- **The empty-value glyph.** `styles`/`app.js` render `"—"` in the layer counts
  when a count is unavailable. That is a typographic stand-in for "no value",
  not prose.

Everything else in this repo has been cleaned. If you add prose, follow the
rule.

## Before you write code

- No build step. `index.html` loads `styles.css` and `src/app.js` directly, and
  `app.js` imports `data.js`, `graph.js`, and `nostr.js` as ES modules by URL.
- Run `./bump-cache.sh` once per release after changing any local asset, then
  commit. It rewrites the `?v=N` query on every local URL so browsers do not
  serve stale code.
- Never commit an nsec or any other private key. `src/nostr.js` holds public
  keys only.
- `docs/` is excluded from the repo via `.git/info/exclude` and is intentionally
  local-only. Do not force-add it.
