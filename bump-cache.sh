#!/usr/bin/env bash
#
# Bump the cache-busting version on every locally-served asset.
#
# The atlas is a static, no-build app: index.html loads styles.css and app.js by
# URL, and app.js imports data.js / graph.js / nostr.js as ES modules by URL. A
# browser will happily serve any of these from cache after a deploy, stranding
# users on stale code. Appending "?v=N" makes each release a distinct URL, so a
# bump forces a fresh fetch. (d3 and nostr-tools are already version-pinned in
# their CDN URLs, so they don't need this.)
#
# Run this once per release, then commit. Requires perl (present on macOS/Linux).
set -euo pipefail
cd "$(dirname "$0")"

cur=$(grep -oE 'styles\.css\?v=[0-9]+' index.html | grep -oE '[0-9]+' | head -1)
if [ -z "${cur:-}" ]; then
  echo "Could not find a current ?v= version in index.html" >&2
  exit 1
fi
next=$((cur + 1))

perl -0pi -e "s/(styles\.css\?v=)\d+/\${1}$next/; s/(src\/app\.js\?v=)\d+/\${1}$next/" index.html
perl -0pi -e "s/(\.\/(?:data|graph|nostr)\.js\?v=)\d+/\${1}$next/g" src/app.js

echo "Cache version bumped: $cur -> $next"
echo "Now commit index.html and src/app.js."
