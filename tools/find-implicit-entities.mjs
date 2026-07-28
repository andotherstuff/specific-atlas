#!/usr/bin/env node
//
// Find entities the atlas talks about but never models.
//
// The Judd Foundation archivist described a specific failure in their own
// systems: some important things exist only as metadata, tags, or recurring
// references, never as formal records. Casa Perez and the US Army were the
// examples given. This script tests that claim against the atlas's own prose.
// it reads every node's description and `place` field, pulls out proper nouns,
// and reports the ones that have no node of their own.
//
// It is a research aid for archival review, NOT an ingestion step. Everything
// it emits is a candidate for a human to accept or reject: the alias report at
// the bottom exists precisely because deciding that "Chinati" and "Chinati
// Foundation" are one thing is a curatorial judgement, not a parsing one.
//
//   node tools/find-implicit-entities.mjs
//
import { NODES } from "../src/data.js";

// Words that may sit *inside* a proper noun without breaking it, so that
// "Army Corps of Engineers" survives whole. Deliberately excludes "and": in
// this corpus it joins two separate names far more often than it belongs to
// one ("Meyer Schapiro and Rudolf Wittkower" is two people, not an institute).
const CONNECTORS = new Set(["of", "the", "de", "du", "von", "van", "des", "la"]);

// Capitalised but not entities: demonyms, movements-as-adjectives, months, and
// the function words that start a sentence and so arrive capitalised.
const NOT_ENTITIES = new Set([
  "american", "americans", "mexican", "european", "midwestern", "german", "italian", "swiss",
  "minimalist", "minimalists", "modernist", "expressionist", "expressionists",
  "abstract expressionist", "abstract expressionists",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "she", "her", "hers", "they", "them", "their", "this", "that", "these", "those",
  "when", "what", "where", "over", "after", "before", "yet", "but", "and", "his", "its",
  "the", "u.s.", "us", "without", "unlike", "though", "although", "because", "during",
  "across", "between", "beyond", "within", "under", "above", "later", "each", "both",
]);

// Sentence splitting must not fire inside "Fort D.A. Russell", so initialism
// dots are swapped for a sentinel up front and restored at the end. Written as
// an escape, never a literal. An invisible character in source is a trap.
const DOT = "\uE000";
const protect = (s) => s.replace(/\b([A-Z])\.(?=[A-Z]\.|\s*[A-Z])/g, `$1${DOT}`);
const restore = (s) => s.replaceAll(DOT, ".");

const POSSESSIVE = /'s$/;
// Run-ending punctuation, tested against a token with only *leading* punctuation
// removed. Stripping the tail first would eat the very comma that proves
// "Marfa, Texas" is two names rather than one.
const BREAKS = /[,;:.!?"'”’)\]]$/;

const lead = (w) => w.replace(/^[^A-Za-z0-9“"']+/, "");
const strip = (w) => lead(w).replace(/[^A-Za-z0-9&'.\uE000]+$/, "");
const bare = (w) => strip(w).replace(/\.$/, "").replace(POSSESSIVE, "");
const isCap = (w) => /^[A-Z]/.test(bare(w)) && bare(w).length > 0;
// A possessive ends the name it marks: in "Judd's Marfa ambitions" the two
// capitals are separate entities, not one compound.
const hasPossessive = (w) => POSSESSIVE.test(lead(w));
const breaksRun = (w) => BREAKS.test(lead(w).replace(POSSESSIVE, "")) || hasPossessive(w);

function properNouns(text) {
  if (!text) return [];
  // Em/en dashes join words without spaces ("Plexiglas—treating"): make them breaks.
  const normalised = protect(text).replace(/[—–]/g, " ");
  const out = [];
  for (const sentence of normalised.split(/(?<=[.!?])\s+/)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < words.length) {
      if (!isCap(words[i])) { i++; continue; }
      const parts = [bare(words[i])];
      const initial = i === 0; // a sentence-initial capital may just be grammar
      let ended = breaksRun(words[i]);
      let j = i + 1;
      while (!ended && j < words.length) {
        const lower = bare(words[j]).toLowerCase();
        if (isCap(words[j])) {
          parts.push(bare(words[j]));
          ended = breaksRun(words[j]);
          j++;
        } else if (
          CONNECTORS.has(lower) && !breaksRun(words[j]) &&
          j + 1 < words.length && isCap(words[j + 1])
        ) {
          parts.push(bare(words[j])); // bridge "of" in "Corps of Engineers"
          j++;
        } else break;
      }
      // Drop leading function words ("Without Bernstein Brothers", "When Dia").
      while (parts.length && NOT_ENTITIES.has(parts[0].toLowerCase())) parts.shift();
      if (parts.length) out.push({ phrase: restore(parts.join(" ")), initial });
      i = Math.max(j, i + 1);
    }
  }
  return out;
}

// Node titles carry typographic quotes and commas the prose does not, so
// compare on a flattened form.
const flatten = (s) =>
  s.toLowerCase().replace(/[“”‘’"']/g, "").replace(/\s+/g, " ").trim();
const TITLES = NODES.map((n) => ({ title: n.title, flat: flatten(n.title) }));

// Resolve a partial name to the node it refers to: exact title first, then the
// SHORTEST title containing it. Shortest matters, because "Chinati" must land on
// Chinati Foundation, not The Block (La Mansana de Chinati), and "Judd" on
// Donald Judd rather than Judd Foundation. Genuine ambiguity is reported
// rather than hidden, because choosing between candidates is the archivist's
// call, not the parser's.
function resolveNode(phrase) {
  const f = flatten(phrase);
  const exact = TITLES.find((t) => t.flat === f);
  if (exact) return { match: exact.title, candidates: [exact.title] };
  const containing = TITLES.filter((t) => t.flat.includes(f) || f.includes(t.flat))
    .sort((a, b) => a.flat.length - b.flat.length);
  if (!containing.length) return { match: null, candidates: [] };
  return { match: containing[0].title, candidates: containing.map((t) => t.title) };
}

// ---------------------------------------------------------------------------
const mentions = new Map();
const seenMidSentence = new Set();

for (const n of NODES) {
  for (const text of [n.content, n.place]) {
    for (const { phrase, initial } of properNouns(text)) {
      if (!initial) seenMidSentence.add(phrase.toLowerCase());
      if (!mentions.has(phrase)) mentions.set(phrase, { nodes: new Set(), initial: true });
      const rec = mentions.get(phrase);
      rec.nodes.add(n.id);
      if (!initial) rec.initial = false;
    }
  }
}

const unmodelled = [];
const aliases = [];
for (const [phrase, rec] of mentions) {
  const lower = phrase.toLowerCase();
  if (flatten(phrase).length < 4 || NOT_ENTITIES.has(lower)) continue;
  // A single word seen only at sentence start is probably grammar, not a name.
  if (rec.initial && !phrase.includes(" ") && !seenMidSentence.has(lower)) continue;
  const { match, candidates } = resolveNode(phrase);
  const row = { phrase, count: rec.nodes.size, nodes: [...rec.nodes], match, candidates };
  (match ? aliases : unmodelled).push(row);
}

const byCount = (a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase);
unmodelled.sort(byCount);
aliases.sort(byCount);

console.log(`\nUNMODELLED ENTITIES: named in ${NODES.length} nodes, no node of their own\n`);
for (const r of unmodelled) {
  console.log(`  ${String(r.count).padStart(2)} node(s)  ${r.phrase}`);
  console.log(`             via: ${r.nodes.join(", ")}`);
}

const realAliases = aliases.filter((r) => flatten(r.phrase) !== flatten(r.match));
console.log(`\n\nALIAS FORMS: partial names for nodes that DO exist`);
console.log(`(each is a controlled-vocabulary decision, not a parser bug)\n`);
for (const r of realAliases) {
  const ambiguous = r.candidates.length > 1 ? `   [ambiguous: also ${r.candidates.slice(1).join("; ")}]` : "";
  console.log(`  ${String(r.count).padStart(2)} node(s)  "${r.phrase}" -> ${r.match}${ambiguous}`);
}

console.log(`\n${unmodelled.length} unmodelled, ${realAliases.length} alias forms.\n`);
