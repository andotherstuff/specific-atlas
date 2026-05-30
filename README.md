# SPECIFIC ATLAS — A Nostr Atlas of Donald Judd

An interactive atlas of the American artist **Donald Judd** (1928–1994) — his life,
work, geographies, and ideas — built as a **real Nostr application**. Every node in
the graph (a person, work, place, idea, institution, or moment) is a signed,
addressable Nostr event broadcast to public relays. The app writes art history to a
decentralized network and reads it back over the same protocol.

> *"A work needs only to be interesting."* — Donald Judd

## What it does

- **Linked-graph navigation.** A force-directed constellation of ~40 nodes centered on
  Judd. Click any node to read it and follow its edges; the graph is the spine.
- **Navigate three dimensions:**
  - **Time** — a dual-handle range and a *“Sweep the life”* animation that reveals the
    biography chronologically (1928 → present).
  - **Geography** — a *Geography* lens re-anchors every geolocated node to its real
    latitude/longitude (Excelsior Springs → New York → Marfa → Korea), so the edges
    literally cross real distance. A projected map layout via `d3.geoMercator`.
  - **Concepts** — toggle node kinds (People, Works, Places, Ideas, Institutions,
    Moments) on and off; search across titles, places, and text.
- **Detail panel** with each node's text, dates, place, its inbound/outbound edges, and
  full **Nostr provenance**: kind, `d`-tag, author npub, event id, and a link to inspect
  the live event on [njump.me](https://njump.me).
- **Propose a node** — contributors sign proposals with their own Nostr identity.
  Archivist keys approve or reject those proposals before they join the atlas.

## The Nostr design

- **Kind `31987`** — an *addressable* event (NIP-01 parameterized-replaceable range
  30000–39999). Each node is identified by its `d`-tag (the node id), so re-seeding is
  idempotent: the same node always replaces itself rather than duplicating.
- **Edges** live on the source node as `["edge", targetId, relation]` tags. Time, place,
  and coordinates are tags too (`start`, `end`, `lat`, `lon`, `place`, `t`).
- **Archive identity** — the app contains only the archive public key. The archive
  private key is never shipped to browsers and should be rotated if it was ever exposed.
  - npub: `npub1wm4ez7ludz9cfatn84gxrnmsaxjf9kz04xrysmelqyulgzv7ws4skl6f8m`
- **Proposal workflow** — contributor-signed kind `31988` events are queued for review.
  Archivist-signed kind `31989` approval/rejection events form a configurable threshold
  gate. Accepted proposals remain attributed to the contributor. Configure archivist
  public keys as npubs in `ARCHIVIST_NPUBS`; do not use a key whose secret has ever been exposed.
- **Lifecycle on load:** connect to relays → read existing archive events → read
  proposals and moderation votes → subscribe live.
  If relays are unreachable, the atlas still runs fully from local data.
- **Relays:** `relay.damus.io`, `nos.lol`, `relay.nostr.band`, `relay.primal.net`,
  `nostr.mom`.

## Run it

It's a static site (no build step). Any static server works:

```bash
npm start              # python3 -m http.server 8011
# then open http://localhost:8011
```

Dependencies load from CDNs at runtime: [`d3`](https://d3js.org) v7 (graph + projection)
and [`nostr-tools`](https://github.com/nbd-wtf/nostr-tools) v2 (keys, signing, relays).
An internet connection is needed for the Nostr layer and the CDNs.

## Key safety

Do not commit an `nsec`, hex secret key, `.env` with secrets, or any private-key material.
Archivist and archive keys are configured by npubs only in `src/nostr.js`. Generate or
choose archivist identities outside this repo, keep their private keys offline or in a trusted
Nostr signer, and commit only their npubs.
Generated in-browser identities are shown once and kept in memory for the session; they
are not persisted by the app.

## Files

```
index.html      shell + layout
styles.css      industrial / editorial theme
src/data.js     the curated atlas (nodes + edges) — the content
src/nostr.js    keys, addressable event build/sign, relay pool (SimplePool)
src/graph.js    d3 force + geographic renderer, selection/filter/zoom
src/app.js      orchestration: facets, search, panel, Nostr lifecycle, add-node
```

## A note on the history

Facts were checked against the Judd Foundation and Chinati chronologies and other public
sources. A few specifics worth flagging: Judd first leased buildings in **Marfa in 1971**
and moved there permanently in **1977**; his daughter **Rainer Judd** (b. 1970) is named
for the dancer **Yvonne Rainer**, his son **Flavin** (b. 1968) for **Dan Flavin**. The
*Chinati Foundation* was founded in **1986** on the former Fort D.A. Russell. The atlas is
curated and interpretive — corrections are welcome; propose a node.
