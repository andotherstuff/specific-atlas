import { NODES, TYPES, TYPE_ORDER, buildIndex, TIME_MIN, TIME_MAX } from "./data.js";
import { Graph } from "./graph.js";
import {
  AtlasClient,
  ARCHIVE_PK,
  ARCHIVE_NPUB,
  APPROVAL_THRESHOLD,
  ARCHIVIST_PUBKEYS,
  NODE_KIND,
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
  node._author = event?.pubkey || node._author || ARCHIVE_PK;
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
  node._author = ARCHIVE_PK;
  node._state = "curated";
});

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------
const graph = new Graph($("#graph"), {
  nodes: NODES,
  links: index.links,
  types: TYPES,
  onSelect: (n) => {
    if (n) setPanelCollapsed(false);
    renderPanel(n ? index.byId.get(n.id) || n : null);
  },
});
window.addEventListener("resize", () => graph.resize());

function setPanelCollapsed(collapsed) {
  $("#app").classList.toggle("panel-collapsed", collapsed);
  $("#panel-open").hidden = !collapsed;
  requestAnimationFrame(() => graph.resize());
}

$("#panel-close").addEventListener("click", () => setPanelCollapsed(true));
$("#panel-open").addEventListener("click", () => setPanelCollapsed(false));

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
  const author = n._author || (ev && ev.pubkey) || ARCHIVE_PK;
  const isArchive = author === ARCHIVE_PK;
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
      : n._state === "proposed"
      ? "prov-live"
      : "prov-local";
  const stateText =
    n._state === "confirmed"
      ? "● archive-signed on relays"
      : n._state === "accepted"
      ? "● archivist-approved contribution"
      : n._state === "proposed"
      ? "● pending archivist review"
      : n._state === "live"
      ? "● received live"
      : "● curated local fallback";
  state.append(elem("span", stateClass, stateText));
  const dl = document.createElement("dl");
  function addDef(term, value, className) {
    dl.append(elem("dt", null, term), elem("dd", className, value));
  }
  addDef("kind", `${NODE_KIND} · addressable`);
  addDef("d-tag", n.id, "mono");
  addDef("author", `${isArchive ? "Judd Atlas" : "contributor"} · ${safeNpubShort(author)}`, "mono");
  if (ev) addDef("event", `${ev.id.slice(0, 16)}…`, "mono");
  prov.append(state, dl);
  if (nevent) {
    const link = elem("a", "prov-link", "inspect event on njump ↗");
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
    document.createTextNode(" relays · "),
    elem("b", null, String(s.received)),
    document.createTextNode(" nodes · "),
    elem("b", null, String(s.published)),
    document.createTextNode(" events sent")
  );
  if (!relayPop.hidden) renderRelayPop(s);
}
function renderRelayPop(s) {
  relayPop.replaceChildren(elem("div", "rp-head", "Archive identity"), elem("div", "rp-npub mono", ARCHIVE_NPUB), elem("div", "rp-head", "Relays"));
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

function applyAcceptedProposal(entry) {
  if (proposalStatus(entry) !== "accepted") return;
  entry.node._state = "accepted";
  if (registerNode(entry.node, "accepted") && graph.selectedId === entry.node.id) {
    renderPanel(entry.node);
  }
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
  applyAcceptedProposal(entry);
  renderProposalQueue();
  return entry;
}

function applyModerationEvent(ev) {
  const vote = moderationFromEvent(ev);
  if (!vote) return;
  const entry = proposals.get(vote.proposalId);
  if (!entry) return;
  if (vote.action === "approve") {
    entry.rejections.delete(vote.pubkey);
    entry.approvals.set(vote.pubkey, vote);
  } else {
    entry.approvals.delete(vote.pubkey);
    entry.rejections.set(vote.pubkey, vote);
  }
  applyAcceptedProposal(entry);
  renderProposalQueue();
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
    if (isArchivist() && status === "pending") {
      const actions = elem("div", "proposal-actions");
      const approve = elem("button", null, "Approve");
      const reject = elem("button", null, "Reject");
      approve.addEventListener("click", () => moderateProposal(entry, "approve"));
      reject.addEventListener("click", () => moderateProposal(entry, "reject"));
      actions.append(approve, reject);
      li.append(actions);
    }
    li.addEventListener("click", (e) => {
      if (e.target.tagName === "BUTTON") return;
      renderPanel(entry.node);
    });
    list.append(li);
  }
}

async function moderateProposal(entry, action) {
  if (!isArchivist()) {
    $("#id-status").textContent = "Only configured archivist identities can moderate.";
    return;
  }
  try {
    const signed = await signWithIdentity(currentIdentity, buildModerationEvent(entry.event, action));
    await client.publish(signed);
    applyModerationEvent(signed);
  } catch (err) {
    console.warn("Moderation failed:", err);
  }
}

(async function boot() {
  try {
    await client.connect();
    statusText.textContent = "reading archive from relays…";
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
    idStatus.textContent = `Not signed in. ${ARCHIVIST_PUBKEYS.length} archivist key(s), threshold ${APPROVAL_THRESHOLD}.`;
    renderAvatar(accountAvatar, "", "warn");
    renderAvatar(accountModalAvatar, "", "warn");
    accountLabel.textContent = "Not signed in";
    accountSub.textContent = "Nostr identity";
    accountModalName.textContent = "Not signed in";
    accountModalSub.textContent = "Use a Nostr identity to propose nodes.";
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

$("#id-ext").addEventListener("click", async () => {
  try {
    currentIdentity = await getExtensionIdentity();
    currentProfile = null;
    idCreated.hidden = true;
    idCreated.textContent = "";
    await refreshProfile();
  } catch (err) {
    idStatus.textContent = err.message;
  }
});

$("#id-new").addEventListener("click", () => {
  currentIdentity = createLocalIdentity();
  currentProfile = null;
  idCreated.hidden = false;
  idCreated.textContent = `New identity created. Save this private key now; it is not stored by the app: ${currentIdentity.nsec}`;
  refreshProfile();
});

$("#id-import").addEventListener("click", () => {
  try {
    currentIdentity = identityFromNsec($("#id-nsec").value);
    currentProfile = null;
    $("#id-nsec").value = "";
    idCreated.hidden = true;
    idCreated.textContent = "";
    refreshProfile();
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
    $("#m-status").textContent = "broadcasting proposal to relays…";
    const res = await client.publish(signed);
    upsertProposal(signed);
    $("#m-status").textContent =
      res.ok > 0 ? `proposal sent to ${res.ok}/${res.total} relays` : "proposal signed locally (relays unreachable)";
    setTimeout(() => {
      scrim.hidden = true;
    }, 850);
  } catch (err) {
    $("#m-status").textContent = "Proposal failed: " + err.message;
  }
});

renderIdentity();
