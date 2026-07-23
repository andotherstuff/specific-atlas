import { NODES, TYPES, TYPE_ORDER, buildIndex, TIME_MIN, TIME_MAX } from "./data.js";
import { Graph } from "./graph.js";
import {
  AtlasClient,
  FOUNDATION_PK,
  JUDD_NPUB,
  APPROVAL_THRESHOLD,
  ARCHIVIST_PUBKEYS,
  NODE_KIND,
  buildDeletionEvent,
  buildModerationEvent,
  buildProposalEvent,
  createLocalIdentity,
  eventToNode,
  getExtensionIdentity,
  identityFromNsec,
  moderationFromEvent,
  neventFor,
  npubShort,
  signWithIdentity,
} from "./nostr.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
const typeDef = (type) => TYPES[type] || TYPES.concept;
const cleanYear = (value) => {
  if (!value) return undefined;
  const year = Number(value);
  return Number.isInteger(year) && year >= TIME_MIN && year <= TIME_MAX ? year : null;
};

function elem(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function dotSpan(className, color) {
  const span = elem("span", className);
  span.style.setProperty("--c", color);
  return span;
}

function setNodeState(node, state, event = node._event) {
  node._event = event;
  node._author = event?.pubkey || node._author || FOUNDATION_PK;
  node._state = state;
}

function safeNpubShort(author) {
  try {
    return npubShort(author);
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Data + provenance: baked nodes are local curated fallback data until matching
// archive-signed events are found on relays.
// ---------------------------------------------------------------------------
const index = buildIndex(NODES);
NODES.forEach((node) => {
  node._author = FOUNDATION_PK;
  node._state = "curated";
});

const mobileQuery = window.matchMedia("(max-width: 820px)");
const uiState = {
  isMobile: mobileQuery.matches,
  railOpen: false,
  panelMode: "open", // desktop: open/collapsed; mobile: closed/peek/expanded
};
let responsiveInitialized = false;

function debounce(fn, wait = 120) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------
const graph = new Graph($("#graph"), {
  nodes: NODES,
  links: index.links,
  types: TYPES,
  onSelect: (n) => {
    if (n) setPanelMode(uiState.isMobile ? "peek" : "open");
    else if (uiState.isMobile) setPanelMode("closed");
    renderPanel(n ? index.byId.get(n.id) || n : null);
  },
});
graph.setViewportMode(uiState.isMobile ? "mobile" : "desktop");
window.addEventListener("resize", debounce(() => {
  updateResponsiveState();
  graph.resize();
}));
mobileQuery.addEventListener("change", updateResponsiveState);

function updateResponsiveState() {
  const wasMobile = uiState.isMobile;
  uiState.isMobile = mobileQuery.matches;
  const changed = !responsiveInitialized || wasMobile !== uiState.isMobile;
  responsiveInitialized = true;
  document.documentElement.classList.toggle("is-mobile", uiState.isMobile);
  graph.setViewportMode(uiState.isMobile ? "mobile" : "desktop");
  if (changed) {
    setRailOpen(false);
    setPanelMode(uiState.isMobile ? (graph.selectedId ? "peek" : "closed") : "open");
  } else {
    applyUiClasses();
  }
  requestAnimationFrame(() => graph.resize());
}

function setRailOpen(open) {
  uiState.railOpen = open && uiState.isMobile;
  applyUiClasses();
}

function setPanelMode(mode) {
  if (uiState.isMobile) {
    uiState.panelMode = mode;
  } else {
    uiState.panelMode = mode === "collapsed" || mode === "closed" ? "collapsed" : "open";
  }
  applyUiClasses();
  requestAnimationFrame(() => graph.resize());
}

function applyUiClasses() {
  const app = $("#app");
  const railScrim = $("#rail-scrim");
  const mobileMenu = $("#mobile-menu");
  const panelHandle = $("#panel-handle");
  const panelClose = $("#panel-close");
  document.documentElement.classList.toggle("is-mobile", uiState.isMobile);
  app.classList.toggle("rail-open", uiState.railOpen);
  railScrim.hidden = !(uiState.isMobile && uiState.railOpen);
  app.classList.toggle("panel-collapsed", !uiState.isMobile && uiState.panelMode === "collapsed");
  app.classList.toggle("panel-closed", uiState.isMobile && uiState.panelMode === "closed");
  app.classList.toggle("panel-peek", uiState.isMobile && uiState.panelMode === "peek");
  app.classList.toggle("panel-expanded", uiState.isMobile && uiState.panelMode === "expanded");
  $("#panel-open").hidden = uiState.isMobile || uiState.panelMode !== "collapsed";
  mobileMenu.setAttribute("aria-expanded", String(uiState.railOpen));
  panelHandle.setAttribute("aria-expanded", String(uiState.panelMode === "expanded"));
  panelClose.setAttribute("aria-label", uiState.isMobile ? "Close detail sheet" : "Close detail panel");
}

$("#panel-close").addEventListener("click", () => setPanelMode(uiState.isMobile ? "closed" : "collapsed"));
$("#panel-open").addEventListener("click", () => setPanelMode("open"));
$("#panel-handle").addEventListener("click", () => {
  if (!uiState.isMobile) return;
  setPanelMode(uiState.panelMode === "expanded" ? "peek" : "expanded");
});
$("#mobile-menu").addEventListener("click", () => setRailOpen(true));
$("#rail-scrim").addEventListener("click", () => setRailOpen(false));
$("#mobile-add").addEventListener("click", () => $("#add-node").click());
updateResponsiveState();

// ---------------------------------------------------------------------------
// Lens toggle (force vs geography)
// ---------------------------------------------------------------------------
$$("#layout-toggle button").forEach((b) =>
  b.addEventListener("click", () => {
    $$("#layout-toggle button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    const mode = b.dataset.layout;
    graph.setLayout(mode);
    $("#geo-caption").hidden = mode !== "geo";
    $("#geo-list-wrap").hidden = mode !== "geo";
    if (uiState.isMobile) setRailOpen(false);
  })
);

// ---------------------------------------------------------------------------
// Concept (type) filters / legend
// ---------------------------------------------------------------------------
const active = new Set(Object.keys(TYPES));
const legend = $("#type-filters");
const legendCounts = new Map();
function refreshLegendCounts() {
  legendCounts.clear();
  for (const n of NODES) legendCounts.set(n.type, (legendCounts.get(n.type) || 0) + 1);
  $$(".legend-item", legend).forEach((li) => {
    $(".lg-count", li).textContent = legendCounts.get(li.dataset.type) || 0;
  });
}
TYPE_ORDER.forEach((t) => {
  const def = TYPES[t];
  const li = document.createElement("li");
  li.className = "legend-item on";
  li.dataset.type = t;
  li.append(dotSpan("swatch", def.color), elem("span", "lg-label", def.label), elem("span", "lg-count", "0"));
  li.addEventListener("click", () => {
    if (active.has(t)) {
      active.delete(t);
      li.classList.remove("on");
    } else {
      active.add(t);
      li.classList.add("on");
    }
    graph.setTypes(active);
  });
  legend.appendChild(li);
});
refreshLegendCounts();

// ---------------------------------------------------------------------------
// Time navigation (dual range + sweep)
// ---------------------------------------------------------------------------
const startEl = $("#time-start");
const endEl = $("#time-end");
const windowEl = $("#time-window");
const readout = $("#time-readout");
[startEl, endEl].forEach((el) => {
  el.min = TIME_MIN;
  el.max = TIME_MAX;
});
startEl.value = TIME_MIN;
endEl.value = TIME_MAX;

function applyTime() {
  let a = +startEl.value;
  let b = +endEl.value;
  if (a > b) [a, b] = [b, a];
  const span = TIME_MAX - TIME_MIN;
  windowEl.style.left = `${((a - TIME_MIN) / span) * 100}%`;
  windowEl.style.right = `${((TIME_MAX - b) / span) * 100}%`;
  readout.textContent = `${a} – ${b}`;
  const full = a === TIME_MIN && b === TIME_MAX;
  graph.setTime(full ? null : [a, b]);
}
startEl.addEventListener("input", applyTime);
endEl.addEventListener("input", applyTime);
applyTime();

let sweepTimer = null;
$("#time-play").addEventListener("click", () => {
  if (sweepTimer) return stopSweep();
  $("#time-play").textContent = "❚❚ Pause";
  startEl.value = TIME_MIN;
  let yr = TIME_MIN;
  endEl.value = yr;
  applyTime();
  sweepTimer = setInterval(() => {
    yr += 1;
    endEl.value = yr;
    applyTime();
    if (yr >= TIME_MAX) stopSweep();
  }, 90);
});
function stopSweep() {
  clearInterval(sweepTimer);
  sweepTimer = null;
  $("#time-play").textContent = "▶ Sweep the life";
}
$("#time-reset").addEventListener("click", () => {
  stopSweep();
  startEl.value = TIME_MIN;
  endEl.value = TIME_MAX;
  applyTime();
});

// ---------------------------------------------------------------------------
// Geography list
// ---------------------------------------------------------------------------
const geoList = $("#geo-list");
function renderGeoList() {
  geoList.replaceChildren();
  NODES.filter((n) => n.lat != null && n.lon != null)
    .sort((a, b) => (a.start || 0) - (b.start || 0))
    .forEach((n) => {
    const li = document.createElement("li");
    li.append(
      dotSpan("pl-dot", typeDef(n.type).color),
      elem("span", "pl-name", n.title),
      elem("span", "pl-meta", n.place || "")
    );
    li.addEventListener("click", () => {
      graph.select(n.id);
      graph.centerOn(n.id);
      if (uiState.isMobile) setRailOpen(false);
    });
    geoList.appendChild(li);
  });
}
renderGeoList();

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
const searchEl = $("#search");
const searchResults = $("#search-results");
searchEl.addEventListener("input", () => {
  const q = searchEl.value.trim().toLowerCase();
  searchResults.replaceChildren();
  if (!q) return (searchResults.style.display = "none");
  const hits = NODES.filter(
    (n) =>
      n.title.toLowerCase().includes(q) ||
      (n.content || "").toLowerCase().includes(q) ||
      (n.place || "").toLowerCase().includes(q)
  ).slice(0, 8);
  if (!hits.length) {
    searchResults.style.display = "none";
    return;
  }
  hits.forEach((n) => {
    const d = document.createElement("div");
    d.className = "sr-item";
    d.append(
      dotSpan("sr-dot", typeDef(n.type).color),
      elem("span", "sr-title", n.title),
      elem("span", "sr-type", typeDef(n.type).label)
    );
    d.addEventListener("click", () => {
      graph.select(n.id);
      graph.centerOn(n.id);
      searchEl.value = "";
      searchResults.style.display = "none";
    });
    searchResults.appendChild(d);
  });
  searchResults.style.display = "block";
});
document.addEventListener("click", (e) => {
  if (!$("#search-wrap").contains(e.target)) searchResults.style.display = "none";
});

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------
function renderPanel(n) {
  const empty = $("#panel-empty");
  const body = $("#panel-body");
  if (!n) {
    empty.hidden = false;
    body.hidden = true;
    $("#panel").classList.add("empty");
    return;
  }
  empty.hidden = true;
  body.hidden = false;
  $("#panel").classList.remove("empty");

  const def = typeDef(n.type);
  const years =
    n.start != null
      ? n.end != null && n.end !== n.start
        ? `${n.start} – ${n.end}`
        : `${n.start}`
      : "";

  // connections (out + in)
  const related = new Map();
  for (const [t, rel] of n.edges || []) {
    if (index.byId.has(t)) related.set(t, { dir: "→", rel, node: index.byId.get(t) });
  }
  for (const other of NODES) {
    for (const [t, rel] of other.edges || []) {
      if (t === n.id && !related.has(other.id))
        related.set(other.id, { dir: "←", rel, node: other });
    }
  }
  const ev = n._event;
  const nevent = ev ? neventFor(ev) : null;
  const author = n._author || (ev && ev.pubkey) || FOUNDATION_PK;
  const isArchive = author === FOUNDATION_PK;
  body.replaceChildren();

  const type = elem("div", "p-type", def.label);
  type.style.setProperty("--c", def.color);
  body.append(type, elem("h2", "p-title", n.title));

  const meta = elem("div", "p-meta");
  if (years) meta.append(elem("span", "p-year", years));
  if (n.place) meta.append(elem("span", "p-place", `⌖ ${n.place}`));
  body.append(meta);

  const content = elem("p", "p-content");
  const lines = String(n.content || "").split("\n");
  lines.forEach((line, i) => {
    if (i) content.append(document.createElement("br"));
    content.append(document.createTextNode(line));
  });
  body.append(content);

  const edgeSection = elem("div", "p-section");
  const edgeHead = elem("h4", null, "Edges ");
  edgeHead.append(elem("span", null, String(related.size)));
  const edgeList = elem("ul", "p-edges");
  for (const r of related.values()) {
    const li = document.createElement("li");
    li.dataset.id = r.node.id;
    li.append(
      elem("span", "e-dir", r.dir),
      dotSpan("e-dot", typeDef(r.node.type).color),
      elem("span", "e-rel", r.rel),
      elem("span", "e-target", r.node.title)
    );
    li.addEventListener("click", () => {
      graph.select(r.node.id);
      graph.centerOn(r.node.id);
    });
    edgeList.appendChild(li);
  }
  edgeSection.append(edgeHead, edgeList);
  body.append(edgeSection);

  const prov = elem("div", "p-section p-prov");
  prov.append(elem("h4", null, "Provenance"));
  const state = elem("div", "prov-state");
  const stateClass =
    n._state === "confirmed" || n._state === "accepted" || n._state === "curated"
      ? "prov-ok"
      : n._state === "rejected"
      ? "prov-down"
      : n._state === "proposed"
      ? "prov-live"
      : "prov-local";
  const stateText =
    n._state === "confirmed"
      ? "● Sealed base · Judd"
      : n._state === "accepted"
      ? "● Archivist-approved contribution"
      : n._state === "proposed"
      ? "● Pending archivist review"
      : n._state === "rejected"
      ? "● Not approved · visible to you & people who follow you"
      : n._state === "live"
      ? "● In the atlas"
      : "● Reference copy";
  state.append(elem("span", stateClass, stateText));
  const dl = document.createElement("dl");
  function addDef(term, value, className) {
    dl.append(elem("dt", null, term), elem("dd", className, value));
  }
  addDef("added by", `${isArchive ? "Judd Atlas" : "contributor"} · ${safeNpubShort(author)}`, "mono");
  addDef("identifier", n.id, "mono");
  if (ev) addDef("fingerprint", `${ev.id.slice(0, 16)}…`, "mono");
  prov.append(state, dl);
  if (nevent) {
    const link = elem("a", "prov-link", "inspect the signed record ↗");
    link.href = `https://njump.me/${nevent}`;
    link.target = "_blank";
    link.rel = "noopener";
    prov.append(link);
  }
  body.append(prov);
}

// ---------------------------------------------------------------------------
// Status ribbon + relay popover
// ---------------------------------------------------------------------------
const dot = $("#relay-dot");
const statusText = $("#status-text");
const relayPop = $("#relay-pop");
let lastStatus = null;

function renderStatus(s) {
  lastStatus = s;
  dot.className = "dot " + (s.connected > 0 ? "ok" : s.connected === 0 ? "warn" : "warn");
  statusText.replaceChildren(
    elem("b", null, `${s.connected}/${s.total}`),
    document.createTextNode(" connected · "),
    elem("b", null, String(s.received)),
    document.createTextNode(" nodes")
  );
  if (!relayPop.hidden) renderRelayPop(s);
}
function renderRelayPop(s) {
  relayPop.replaceChildren(elem("div", "rp-head", "Foundational key · Judd"), elem("div", "rp-npub mono", JUDD_NPUB), elem("div", "rp-head", "Network"));
  for (const [url, st] of Object.entries(s.relays)) {
    const row = elem("div", "rp-relay");
    row.append(elem("span", `dot ${st === "ok" ? "ok" : st === "connecting" ? "warn" : "down"}`), document.createTextNode(url.replace("wss://", "")));
    relayPop.append(row);
  }
}
$("#relay-detail").addEventListener("click", () => {
  relayPop.hidden = !relayPop.hidden;
  if (!relayPop.hidden && lastStatus) renderRelayPop(lastStatus);
});

// ---------------------------------------------------------------------------
// Nostr lifecycle: connect → read → seed missing → live subscribe
// ---------------------------------------------------------------------------
const client = new AtlasClient(renderStatus);
const proposals = new Map();
let currentIdentity = null;
let currentProfile = null;

function registerNode(node, state = "live") {
  if (!node?.id || index.byId.has(node.id)) return false;
  node._state = state;
  index.byId.set(node.id, node);
  graph.addNode(node);
  refreshLegendCounts();
  renderGeoList();
  client.countReceived(NODES.length);
  return true;
}

function approvalSummary(entry) {
  return `${entry.approvals.size}/${APPROVAL_THRESHOLD} approvals`;
}

function proposalStatus(entry) {
  if (entry.approvals.size >= APPROVAL_THRESHOLD) return "accepted";
  if (entry.rejections.size > 0) return "rejected";
  return "pending";
}

function upsertProposal(ev) {
  const node = eventToNode(ev);
  if (!node) return null;
  node._event = ev;
  node._author = ev.pubkey;
  node._state = "proposed";
  let entry = proposals.get(ev.id);
  if (!entry) {
    entry = { event: ev, node, approvals: new Map(), rejections: new Map() };
    proposals.set(ev.id, entry);
  } else {
    entry.event = ev;
    entry.node = node;
  }
  syncProposalNode(entry);
  applyLayers();
  renderProposalQueue();
  renderReviewList();
  return entry;
}

function applyModerationEvent(ev) {
  const vote = moderationFromEvent(ev);
  if (!vote) return;
  const entry = proposals.get(vote.proposalId);
  if (!entry) return;
  // Moderation events are not replaceable, so a single archivist's decision is
  // whichever vote is newest. Ignore anything older than what we already hold
  // for that pubkey (guards out-of-order delivery and makes undo/re-open sound).
  const prev = entry.approvals.get(vote.pubkey) || entry.rejections.get(vote.pubkey);
  if (prev && prev.event && prev.event.created_at >= ev.created_at) return;
  if (vote.action === "approve") {
    entry.rejections.delete(vote.pubkey);
    entry.approvals.set(vote.pubkey, vote);
  } else {
    entry.approvals.delete(vote.pubkey);
    entry.rejections.set(vote.pubkey, vote);
  }
  syncProposalNode(entry);
  applyLayers();
  renderProposalQueue();
  renderReviewList();
  updateArchivistUI();
}

function isArchivist() {
  return currentIdentity && ARCHIVIST_PUBKEYS.includes(currentIdentity.pubkey);
}

function renderProposalQueue() {
  const list = $("#proposal-list");
  const count = $("#proposal-count");
  if (!list || !count) return;
  list.replaceChildren();
  const entries = [...proposals.values()].sort((a, b) => b.event.created_at - a.event.created_at);
  const pending = entries.filter((entry) => proposalStatus(entry) === "pending").length;
  count.textContent = `${pending} pending`;
  if (!entries.length) {
    list.append(elem("li", "proposal-meta", "No proposals yet."));
    return;
  }
  for (const entry of entries.slice(0, 12)) {
    const status = proposalStatus(entry);
    const li = elem("li", "proposal-item");
    li.append(
      elem("span", "proposal-title", entry.node.title),
      elem(
        "span",
        "proposal-meta",
        `${status} · ${approvalSummary(entry)} · ${safeNpubShort(entry.event.pubkey)}`
      )
    );
    const actions = elem("div", "proposal-actions");
    // Archivists moderate from the dedicated review queue, not this rail list.
    // The author can withdraw their own proposal (NIP-09) — used to clean up
    // test/junk proposals. Relays only honor deletions from the signing pubkey.
    if (currentIdentity && entry.event.pubkey === currentIdentity.pubkey) {
      const withdraw = elem("button", "proposal-withdraw", "Withdraw");
      withdraw.addEventListener("click", () => withdrawProposal(entry));
      actions.append(withdraw);
    }
    if (actions.childNodes.length) li.append(actions);
    li.addEventListener("click", (e) => {
      if (e.target.tagName === "BUTTON") return;
      setPanelMode(uiState.isMobile ? "peek" : "open");
      renderPanel(entry.node);
      if (uiState.isMobile) setRailOpen(false);
    });
    list.append(li);
  }
  updateArchivistUI();
}

async function withdrawProposal(entry) {
  if (!currentIdentity || entry.event.pubkey !== currentIdentity.pubkey) return;
  const label = entry.node.title || "this proposal";
  if (!window.confirm(`Withdraw "${label}"? This publishes a deletion request to the relays.`)) return;
  try {
    const signed = await signWithIdentity(currentIdentity, buildDeletionEvent(entry.event, "Withdrawn by author."));
    await client.publish(signed);
    proposals.delete(entry.event.id);
    if (graph.selectedId === entry.node.id) graph.select(null);
    renderProposalQueue();
  } catch (err) {
    console.warn("Withdraw failed:", err);
  }
}

async function moderateProposal(entry, action, note = "") {
  if (!isArchivist()) return;
  try {
    const signed = await signWithIdentity(currentIdentity, buildModerationEvent(entry.event, action, note));
    await client.publish(signed);
    applyModerationEvent(signed);
  } catch (err) {
    console.warn("Moderation failed:", err);
  }
}

// Undo/re-open: an archivist retracts their own decision by publishing a NIP-09
// deletion of their moderation vote. Removing the only vote returns the proposal
// to pending. Relays honor deletions only from the signing (archivist) pubkey.
async function undoModeration(entry) {
  if (!isArchivist()) return;
  const pk = currentIdentity.pubkey;
  const mine = entry.approvals.get(pk) || entry.rejections.get(pk);
  if (!mine) return;
  try {
    const signed = await signWithIdentity(currentIdentity, buildDeletionEvent(mine.event, "Re-opened by archivist."));
    await client.publish(signed);
    entry.approvals.delete(pk);
    entry.rejections.delete(pk);
    syncProposalNode(entry);
    applyLayers();
    renderProposalQueue();
    renderReviewList();
    updateArchivistUI();
  } catch (err) {
    console.warn("Undo failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Archivist review queue — a dedicated screen, shown only to archivist keys.
// Gating here is convenience: proposals are public and the real authority is
// the signature on the moderation event. The queue reads every fetched proposal
// (not just graph-visible ones), so the archivist sees the whole backlog.
// ---------------------------------------------------------------------------
const reviewScrim = $("#review-scrim");
const reviewList = $("#review-list");
const profileCache = new Map(); // pubkey -> profile | null (in-flight)
let reviewFilter = "pending";

async function ensureProfile(pubkey) {
  if (profileCache.has(pubkey)) return;
  profileCache.set(pubkey, null);
  let p = null;
  try {
    p = await client.fetchProfile(pubkey);
  } catch {
    p = null;
  }
  profileCache.set(pubkey, p || { pubkey });
  if (!reviewScrim.hidden) renderReviewList();
}

function contributorName(pubkey) {
  return profileCache.get(pubkey)?.name || safeNpubShort(pubkey);
}

function statusLabel(status) {
  return status === "accepted" ? "Approved" : status === "rejected" ? "Declined" : "Pending";
}

function updateArchivistUI() {
  const btn = $("#review-open");
  if (!btn) return;
  const arch = isArchivist();
  btn.hidden = !arch;
  if (arch) {
    const pending = [...proposals.values()].filter((e) => proposalStatus(e) === "pending").length;
    btn.textContent = pending ? `Open review queue · ${pending} pending` : "Open review queue";
  } else if (reviewScrim && !reviewScrim.hidden) {
    reviewScrim.hidden = true; // lost access (signed out / switched key)
  }
}

function openReview() {
  if (!isArchivist()) return;
  reviewScrim.hidden = false;
  renderReviewList();
}

function reviewEntries() {
  const all = [...proposals.values()].sort((a, b) => b.event.created_at - a.event.created_at);
  if (reviewFilter === "all") return all;
  const want = reviewFilter === "approved" ? "accepted" : reviewFilter === "rejected" ? "rejected" : "pending";
  return all.filter((e) => proposalStatus(e) === want);
}

function renderReviewList() {
  if (!reviewList || reviewScrim.hidden) return;
  reviewList.replaceChildren();
  const entries = reviewEntries();
  if (!entries.length) {
    reviewList.append(elem("p", "review-empty", "Nothing here."));
    return;
  }
  for (const entry of entries) {
    ensureProfile(entry.event.pubkey);
    reviewList.append(reviewCard(entry));
  }
}

function reviewCard(entry) {
  const status = proposalStatus(entry);
  const card = elem("div", `review-card review-${status}`);

  const head = elem("div", "review-card-head");
  const avatar = elem("span", "account-avatar");
  renderAvatar(avatar, profileCache.get(entry.event.pubkey)?.picture, "warn");
  const meta = elem("div", "review-card-meta");
  meta.append(
    elem("div", "review-title", entry.node.title),
    elem("div", "review-by", `${TYPES[entry.node.type]?.label || entry.node.type} · proposed by ${contributorName(entry.event.pubkey)}`)
  );
  head.append(avatar, meta, elem("span", `review-badge badge-${status}`, statusLabel(status)));
  card.append(head);

  if (entry.node.content) card.append(elem("p", "review-content", entry.node.content));

  const reason = [...entry.rejections.values()].map((v) => v.note).find(Boolean);
  if (status === "rejected" && reason) {
    card.append(elem("p", "review-reason", `Reason: ${reason}`));
  }

  const actions = elem("div", "review-actions");
  if (status === "pending") {
    const approve = elem("button", "review-approve", "Approve");
    approve.addEventListener("click", () => moderateProposal(entry, "approve"));
    const decline = elem("button", "review-reject", "Decline…");
    decline.addEventListener("click", () => openRejectForm(card, entry));
    actions.append(approve, decline);
  } else {
    const undo = elem("button", null, "Undo · re-open");
    undo.addEventListener("click", () => undoModeration(entry));
    actions.append(undo);
  }
  card.append(actions);
  return card;
}

function openRejectForm(card, entry) {
  if (card.querySelector(".reject-form")) return;
  const form = elem("div", "reject-form");
  const ta = document.createElement("textarea");
  ta.rows = 2;
  ta.placeholder = "Optional reason — shown to the contributor";
  const row = elem("div", "reject-form-actions");
  const confirm = elem("button", "review-reject", "Confirm decline");
  const cancel = elem("button", null, "Cancel");
  confirm.addEventListener("click", () => moderateProposal(entry, "reject", ta.value.trim()));
  cancel.addEventListener("click", () => form.remove());
  row.append(confirm, cancel);
  form.append(ta, row);
  card.append(form);
  ta.focus();
}

$("#review-open").addEventListener("click", openReview);
$("#review-close").addEventListener("click", () => (reviewScrim.hidden = true));
reviewScrim.addEventListener("click", (e) => {
  if (e.target === reviewScrim) reviewScrim.hidden = true;
});
$$("#review-filters button").forEach((b) => {
  b.addEventListener("click", () => {
    reviewFilter = b.dataset.filter;
    $$("#review-filters button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    renderReviewList();
  });
});

// ---------------------------------------------------------------------------
// Provenance layers — what the viewer sees in the graph.
//
//   canonical  the sealed Judd base + archive-confirmed nodes (everyone)
//   approved   contributor proposals an archivist approved (everyone)
//   mine        my own pending/rejected proposals (only me)
//   following   pending/rejected proposals by people I follow (only my view)
//
// Visibility is client-side curation, not privacy: the events are public. A
// pending/rejected proposal is shown iff the viewer authored it or follows the
// author — computed from the viewer's own follow set, never by enumerating a
// proposer's followers.
// ---------------------------------------------------------------------------
const LAYERS = [
  { key: "canonical", label: "Canonical", auth: false },
  { key: "approved", label: "Approved additions", auth: false },
  { key: "mine", label: "My proposals", auth: true },
  { key: "following", label: "People I follow", auth: true },
];
const activeLayers = new Set(["canonical", "approved"]);
let currentFollows = new Set();

function layerOfNode(n) {
  return n._layer || "canonical";
}

function layerCounts() {
  const c = {};
  for (const n of NODES) {
    const k = layerOfNode(n);
    if (k === "hidden") continue;
    c[k] = (c[k] || 0) + 1;
  }
  return c;
}

// Which layer a proposal belongs to for THIS viewer, or null if not shown.
function classifyLayer(entry) {
  if (proposalStatus(entry) === "accepted") return "approved";
  const author = entry.event.pubkey;
  if (currentIdentity && author === currentIdentity.pubkey) return "mine";
  if (currentFollows.has(author)) return "following";
  return null;
}

function stateForStatus(status) {
  return status === "accepted" ? "accepted" : status === "rejected" ? "rejected" : "proposed";
}

// Reconcile one proposal with the graph: tag its layer/state, and add it to the
// graph the first time it becomes visible to this viewer. Nodes already present
// are updated in place (so approve/reject/sign-in reclassify without re-adding).
function syncProposalNode(entry) {
  const status = proposalStatus(entry);
  const layer = classifyLayer(entry);
  entry.node._state = stateForStatus(status);
  entry.node._layer = layer || "hidden";
  entry.node._fromProposal = true;
  const existing = index.byId.get(entry.node.id);
  if (existing && existing._fromProposal) {
    existing._layer = entry.node._layer;
    existing._state = entry.node._state;
    if (graph.selectedId === existing.id) renderPanel(existing);
  } else if (!existing && layer) {
    registerNode(entry.node, entry.node._state);
    if (graph.selectedId === entry.node.id) renderPanel(entry.node);
  }
}

function syncAllProposals() {
  for (const entry of proposals.values()) syncProposalNode(entry);
  applyLayers();
}

function applyLayers() {
  graph.setLayers(activeLayers);
  renderLayerToggles();
}

function renderLayerToggles() {
  const wrap = $("#layer-toggles");
  if (!wrap) return;
  wrap.replaceChildren();
  const signedIn = !!currentIdentity;
  const counts = layerCounts();
  for (const l of LAYERS) {
    const disabled = l.auth && !signedIn;
    const on = activeLayers.has(l.key) && !disabled;
    const li = elem("li", `layer-item${on ? " on" : ""}${disabled ? " disabled" : ""}`);
    li.dataset.layer = l.key;
    li.append(
      elem("span", "layer-box"),
      elem("span", "layer-label", l.label),
      elem("span", "lg-count", disabled ? "—" : String(counts[l.key] || 0))
    );
    if (disabled) {
      li.title = "Sign in to see these";
    } else {
      li.addEventListener("click", () => {
        if (activeLayers.has(l.key)) activeLayers.delete(l.key);
        else activeLayers.add(l.key);
        applyLayers();
      });
    }
    wrap.append(li);
  }
}

// On sign-in: default the personal layers on and fetch the follow set, then
// reclassify. On sign-out: drop personal layers and follows.
async function onIdentityChanged() {
  if (currentIdentity) {
    activeLayers.add("mine");
    activeLayers.add("following");
  } else {
    activeLayers.delete("mine");
    activeLayers.delete("following");
    currentFollows = new Set();
  }
  syncAllProposals();
  if (currentIdentity) {
    const who = currentIdentity.pubkey;
    const follows = await client.fetchContacts(who);
    if (currentIdentity && currentIdentity.pubkey === who) {
      currentFollows = follows;
      syncAllProposals();
    }
  }
}

renderLayerToggles();
graph.setLayers(activeLayers);

(async function boot() {
  try {
    await client.connect();
    statusText.textContent = "loading the atlas…";
    const existing = await client.fetchArchive();
    // mark confirmed nodes
    for (const ev of existing) {
      const d = ev.tags.find((t) => t[0] === "d")?.[1];
      const n = index.byId.get(d);
      if (n) {
        setNodeState(n, "confirmed", ev);
      }
    }
    if (graph.selectedId) renderPanel(index.byId.get(graph.selectedId));

    const proposalEvents = await client.fetchProposals();
    proposalEvents.forEach(upsertProposal);
    const moderationEvents = await client.fetchModeration();
    moderationEvents.forEach(applyModerationEvent);
    client.countReceived(NODES.length);
    renderStatus(client.status());

    client.subscribeLive(
      (node) => registerNode(node, "live"),
      (ev) => upsertProposal(ev),
      (ev) => applyModerationEvent(ev)
    );
  } catch (err) {
    statusText.textContent = "offline · atlas running locally";
    dot.className = "dot warn";
    console.warn("Nostr boot issue:", err);
  }
})();
renderProposalQueue();

// ---------------------------------------------------------------------------
// Add-node modal
// ---------------------------------------------------------------------------
const scrim = $("#modal-scrim");
const accountScrim = $("#account-scrim");
const mType = $("#m-type");
const mEdge = $("#m-edge");
const idStatus = $("#id-status");
const idCreated = $("#id-created");
const accountDot = $("#account-dot");
const accountLabel = $("#account-label");
const accountSub = $("#account-sub");
const accountAvatar = $("#account-avatar");
const accountModalAvatar = $("#account-modal-avatar");
const accountModalName = $("#account-modal-name");
const accountModalSub = $("#account-modal-sub");
const mobileAccount = $("#mobile-account");
const proposalAccount = $("#proposal-account");
TYPE_ORDER.forEach((t) => {
  const o = document.createElement("option");
  o.value = t;
  o.textContent = TYPES[t].label.replace(/s$/, "");
  mType.appendChild(o);
});
function refreshEdgeOptions() {
  mEdge.replaceChildren();
  const primary = document.createElement("option");
  primary.value = "donald-judd";
  primary.textContent = "Donald Judd";
  mEdge.appendChild(primary);
  NODES.filter((n) => n.id !== "donald-judd")
    .sort((a, b) => a.title.localeCompare(b.title))
    .forEach((n) => {
      const o = document.createElement("option");
      o.value = n.id;
      o.textContent = n.title;
      mEdge.appendChild(o);
    });
}
$("#add-node").addEventListener("click", () => {
  refreshEdgeOptions();
  $("#m-status").textContent = "";
  renderProposalAccount();
  scrim.hidden = false;
});
$("#m-cancel").addEventListener("click", () => (scrim.hidden = true));
scrim.addEventListener("click", (e) => {
  if (e.target === scrim) scrim.hidden = true;
});
$("#account-close").addEventListener("click", () => (accountScrim.hidden = true));
accountScrim.addEventListener("click", (e) => {
  if (e.target === accountScrim) accountScrim.hidden = true;
});

function renderIdentity() {
  if (!currentIdentity) {
    idStatus.textContent = "Not signed in.";
    renderAvatar(accountAvatar, "", "warn");
    renderAvatar(accountModalAvatar, "", "warn");
    accountLabel.textContent = "Sign in";
    accountSub.textContent = "propose & review";
    accountModalName.textContent = "Not signed in";
    accountModalSub.textContent = "Sign in to propose nodes.";
    mobileAccount.textContent = "Sign in";
    renderProposalAccount();
    renderProposalQueue();
    return;
  }
  const role = isArchivist() ? "archivist" : "contributor";
  const name = currentProfile?.name || safeNpubShort(currentIdentity.pubkey);
  const detail = `${role} · ${currentProfile?.nip05 || safeNpubShort(currentIdentity.pubkey)}`;
  idStatus.textContent = `Signed in as ${role} · ${name}`;
  renderAvatar(accountAvatar, currentProfile?.picture, isArchivist() ? "ok" : "warn");
  renderAvatar(accountModalAvatar, currentProfile?.picture, isArchivist() ? "ok" : "warn");
  accountLabel.textContent = name;
  accountSub.textContent = detail;
  mobileAccount.textContent = name;
  accountModalName.textContent = name;
  accountModalSub.textContent = detail;
  renderProposalAccount();
  renderProposalQueue();
}

function renderAvatar(target, picture, dotClass) {
  target.replaceChildren();
  if (picture) {
    const img = document.createElement("img");
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.src = picture;
    img.addEventListener("error", () => {
      target.replaceChildren(elem("span", `dot ${dotClass}`));
    });
    target.append(img);
    return;
  }
  target.append(elem("span", `dot ${dotClass}`));
}

async function refreshProfile() {
  currentProfile = null;
  renderIdentity();
  if (!currentIdentity) return;
  const profile = await client.fetchProfile(currentIdentity.pubkey);
  if (!currentIdentity || profile?.pubkey !== currentIdentity.pubkey) return;
  currentProfile = profile;
  renderIdentity();
}

function renderProposalAccount() {
  if (!proposalAccount) return;
  if (!currentIdentity) {
    proposalAccount.textContent = "Sign in from Account before submitting a proposal.";
    return;
  }
  proposalAccount.textContent = `Submitting as ${isArchivist() ? "archivist" : "contributor"} · ${currentProfile?.name || safeNpubShort(currentIdentity.pubkey)}`;
}

$("#account-state").addEventListener("click", () => {
  renderIdentity();
  accountScrim.hidden = false;
});

mobileAccount.addEventListener("click", () => {
  renderIdentity();
  accountScrim.hidden = false;
});

$("#id-ext").addEventListener("click", async () => {
  const btn = $("#id-ext");
  btn.disabled = true;
  idStatus.textContent = "Connecting…";
  try {
    currentIdentity = await getExtensionIdentity();
    currentProfile = null;
    idCreated.hidden = true;
    idCreated.textContent = "";
    await refreshProfile();
    onIdentityChanged();
  } catch (err) {
    idStatus.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$("#id-new").addEventListener("click", () => {
  currentIdentity = createLocalIdentity();
  currentProfile = null;
  idCreated.hidden = false;
  idCreated.textContent = `New account created. Save this key now; it is not stored by the app: ${currentIdentity.nsec}`;
  refreshProfile();
  onIdentityChanged();
});

$("#id-import").addEventListener("click", () => {
  try {
    currentIdentity = identityFromNsec($("#id-nsec").value);
    currentProfile = null;
    $("#id-nsec").value = "";
    idCreated.hidden = true;
    idCreated.textContent = "";
    refreshProfile();
    onIdentityChanged();
  } catch (err) {
    idStatus.textContent = err.message;
  }
});

$("#id-logout").addEventListener("click", () => {
  currentIdentity = null;
  currentProfile = null;
  $("#id-nsec").value = "";
  idCreated.hidden = true;
  idCreated.textContent = "";
  renderIdentity();
  onIdentityChanged();
});

$("#m-publish").addEventListener("click", async () => {
  if (!currentIdentity) {
    $("#m-status").textContent = "Use Account to sign in before submitting.";
    return;
  }
  const title = $("#m-title").value.trim();
  if (!title) {
    $("#m-status").textContent = "Give the node a title.";
    return;
  }
  const type = mType.value;
  const yearRaw = $("#m-year").value.trim();
  const start = cleanYear(yearRaw);
  if (start === null) {
    $("#m-status").textContent = `Use a whole year from ${TIME_MIN} to ${TIME_MAX}.`;
    return;
  }
  const target = mEdge.value;
  const content = $("#m-content").value.trim();
  const baseId = slug(title) || "node";
  const id = baseId + "-" + Math.random().toString(36).slice(2, 6);

  const node = {
    id,
    title,
    type: TYPES[type] ? type : "concept",
    start,
    content,
    edges: [[target, "linked to"]],
  };
  const template = buildProposalEvent(node);

  $("#m-status").textContent = "signing proposal…";
  try {
    const signed = await signWithIdentity(currentIdentity, template);
    $("#m-status").textContent = "submitting proposal…";
    const res = await client.publish(signed);
    upsertProposal(signed);
    $("#m-status").textContent =
      res.ok > 0 ? "proposal submitted for archivist review" : "couldn't reach the network — proposal not submitted";
    setTimeout(() => {
      scrim.hidden = true;
    }, 850);
  } catch (err) {
    $("#m-status").textContent = "Proposal failed: " + err.message;
  }
});

renderIdentity();
