// The real Nostr layer. Canonical atlas nodes, contributor proposals, and
// archivist moderation votes are all signed Nostr events. The archive secret key
// must never be present in this browser code.
import {
  finalizeEvent,
  getPublicKey,
  generateSecretKey,
  verifyEvent,
  SimplePool,
  nip19,
} from "https://esm.sh/nostr-tools@2.10.4";

// ---------------------------------------------------------------------------
// Identity. Only public keys live here — never an nsec or other private key.
//
// Two distinct roles, deliberately NOT the same key:
//
//   JUDD (foundational key) — authors the canonical seed nodes (kind 31987).
//   Once seeding is complete this key is BURNED: the seed becomes a frozen,
//   tamper-evident base layer that no one can ever alter or extend. Because it
//   can never rotate, the burned key doubles as the permanent *namespace* for
//   the atlas — every proposal tags `proposal-for: FOUNDATION_PK` to say "this
//   belongs to the Judd atlas." That is an identifier, not a signer, so burning
//   the key does not orphan anything.
//
//   ARCHIVIST(S) — a SEPARATE authority that reviews proposals and signs
//   approve/reject moderation votes (kind 31989). Rotatable and threshold-based;
//   lives entirely in ARCHIVIST_PUBKEYS below. Approval never re-signs the node
//   (Judd is burned) — it is a vote that promotes the contributor's own event
//   into the canonical graph, PR-of-provenance style.
// ---------------------------------------------------------------------------
export const JUDD_NPUB =
  "npub1wm4ez7ludz9cfatn84gxrnmsaxjf9kz04xrysmelqyulgzv7ws4skl6f8m";
export const FOUNDATION_PK = nip19.decode(JUDD_NPUB).data;

// The archivist authority — distinct from Judd. Add rotated/additional archivist
// npubs here; approval is threshold-based and signed by these identities. Do not
// add nsecs. (Interim key; will move to keycast/NIP-46 remote signing later.)
export const ARCHIVIST_NPUBS = [
  "npub1rc25lfm5h68865u0n7wsn2tam60vnyjzu7cxxls0we9jxqq5qunqvdx7ly",
];
export const ARCHIVIST_PUBKEYS = ARCHIVIST_NPUBS.map((npub) => nip19.decode(npub).data);
export const APPROVAL_THRESHOLD = 1;

// Addressable event kind (NIP-01 parameterized replaceable range 30000–39999).
export const NODE_KIND = 31987;
export const PROPOSAL_KIND = 31988;
export const MODERATION_KIND = 31989;

// A fixed base time so re-seeding produces identical event ids (idempotent).
const SEED_BASE = 1_704_067_200; // 2024-01-01T00:00:00Z

export const RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.mom",
];

// Profile lookups (kind 0) need indexer/aggregator relays, not the content
// relays above — a user's metadata usually lives on their own relays. purplepag.es
// and nostr.band aggregate kind-0 for essentially every npub. Content relays are
// kept as a fallback in case the profile happens to be there too.
export const PROFILE_RELAYS = [
  "wss://purplepag.es",
  "wss://relay.nostr.band",
  ...RELAYS,
];

const VALID_TYPES = new Set(["person", "work", "place", "concept", "institution", "event"]);
const MAX_TEXT = 4_000;
const MAX_TAG = 160;

function cleanText(value, max = MAX_TEXT) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function cleanYear(value) {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < -5000 || n > 9999) return undefined;
  return n;
}

function cleanCoord(value, min, max) {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return n;
}

// ---------------------------------------------------------------------------
// Event <-> node translation
// ---------------------------------------------------------------------------
export function buildNodeEvent(node, index = 0) {
  const tags = [
    ["d", node.id],
    ["title", node.title],
    ["type", node.type],
    ["t", node.type],
    ["t", "donald-judd"],
  ];
  if (node.start != null) tags.push(["start", String(node.start)]);
  if (node.end != null) tags.push(["end", String(node.end)]);
  if (node.lat != null && node.lon != null) {
    tags.push(["lat", String(node.lat)], ["lon", String(node.lon)]);
  }
  if (node.place) tags.push(["place", node.place]);
  for (const [target, relation] of node.edges || []) {
    tags.push(["edge", target, relation || ""]);
  }
  tags.push(["client", "specific-objects-atlas"]);

  return {
    kind: NODE_KIND,
    created_at: SEED_BASE + index,
    tags,
    content: node.content || "",
  };
}

export function buildProposalEvent(node) {
  return {
    ...buildNodeEvent(node, Math.floor(Date.now() / 1000) - SEED_BASE),
    kind: PROPOSAL_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ...buildNodeEvent(node).tags.filter((tag) => tag[0] !== "client"),
      ["proposal-for", FOUNDATION_PK],
      ["client", "specific-objects-atlas"],
    ],
  };
}

// NIP-09 deletion request. Lets an author withdraw their own event(s) — e.g. a
// proposal they no longer want in the queue. Relays that honor NIP-09 drop the
// referenced events, but only when the deletion is signed by the same pubkey
// that authored them. Includes `k` (kind) and, for addressable events, the `a`
// coordinate, as recommended by NIP-09.
export function buildDeletionEvent(events, reason = "") {
  const list = Array.isArray(events) ? events : [events];
  const tags = [];
  for (const ev of list) {
    tags.push(["e", ev.id]);
    if (ev.kind != null) tags.push(["k", String(ev.kind)]);
    const d = ev.tags?.find((t) => t[0] === "d")?.[1];
    if (d && ev.kind >= 30000 && ev.kind < 40000) tags.push(["a", `${ev.kind}:${ev.pubkey}:${d}`]);
  }
  tags.push(["client", "specific-objects-atlas"]);
  return { kind: 5, created_at: Math.floor(Date.now() / 1000), tags, content: reason };
}

export function buildModerationEvent(proposal, action, note = "") {
  return {
    kind: MODERATION_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["e", proposal.id],
      ["p", proposal.pubkey],
      ["proposal-for", FOUNDATION_PK],
      ["action", action],
      ["client", "specific-objects-atlas"],
    ],
    content: note,
  };
}

// Turn a received Nostr event back into an atlas node.
export function eventToNode(ev) {
  const get = (k) => ev.tags.find((t) => t[0] === k)?.[1];
  const id = cleanText(get("d"), 80);
  if (!id) return null;
  const type = cleanText(get("type"), MAX_TAG);
  const edges = ev.tags
    .filter((t) => t[0] === "edge")
    .map((t) => [cleanText(t[1], 80), cleanText(t[2], MAX_TAG) || "linked to"])
    .filter(([target]) => target && target !== id)
    .slice(0, 80);
  const lat = cleanCoord(get("lat"), -90, 90);
  const lon = cleanCoord(get("lon"), -180, 180);
  return {
    id,
    title: cleanText(get("title"), 180) || id,
    type: VALID_TYPES.has(type) ? type : "concept",
    start: cleanYear(get("start")),
    end: cleanYear(get("end")),
    lat,
    lon,
    place: cleanText(get("place"), 180),
    content: cleanText(ev.content) || "",
    edges,
    _event: ev, // keep the raw event for provenance display
    _author: ev.pubkey,
  };
}

export function moderationFromEvent(ev) {
  const proposalId = ev.tags.find((t) => t[0] === "e")?.[1];
  const action = ev.tags.find((t) => t[0] === "action")?.[1];
  const forArchive = ev.tags.find((t) => t[0] === "proposal-for")?.[1];
  if (!proposalId || forArchive !== FOUNDATION_PK || !["approve", "reject"].includes(action)) return null;
  if (!ARCHIVIST_PUBKEYS.includes(ev.pubkey)) return null;
  return {
    proposalId,
    action,
    pubkey: ev.pubkey,
    note: cleanText(ev.content, MAX_TAG) || "",
    event: ev,
  };
}

export function neventFor(ev) {
  try {
    return nip19.neventEncode({
      id: ev.id,
      author: ev.pubkey,
      kind: ev.kind,
      relays: RELAYS.slice(0, 2),
    });
  } catch {
    return null;
  }
}

export function npubShort(pk) {
  const npub = nip19.npubEncode(pk);
  return npub.slice(0, 12) + "…" + npub.slice(-4);
}

export function npubFor(pk) {
  return nip19.npubEncode(pk);
}

export function profileFromEvent(ev) {
  if (!verifyEvent(ev) || ev.kind !== 0) return null;
  try {
    const profile = JSON.parse(ev.content);
    const text = (value, max = 120) =>
      typeof value === "string" && value.trim() ? value.trim().slice(0, max) : "";
    return {
      pubkey: ev.pubkey,
      name: text(profile.display_name) || text(profile.name),
      picture: text(profile.picture, 500),
      nip05: text(profile.nip05, 160),
    };
  } catch {
    return null;
  }
}

export function createLocalIdentity() {
  const secret = generateSecretKey();
  return {
    type: "local",
    pubkey: getPublicKey(secret),
    nsec: nip19.nsecEncode(secret),
    secret,
  };
}

export function identityFromNsec(nsec) {
  const decoded = nip19.decode(nsec.trim());
  if (decoded.type !== "nsec") throw new Error("Expected an nsec private key.");
  return {
    type: "local",
    pubkey: getPublicKey(decoded.data),
    nsec: nsec.trim(),
    secret: decoded.data,
  };
}

// Browser signer extensions (NIP-07) inject window.nostr asynchronously, often a
// beat after the page is interactive. Poll briefly so the first click connects
// instead of erroring and forcing the user to click again.
function waitForSigner(timeoutMs = 2000) {
  if (window.nostr) return Promise.resolve(window.nostr);
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (window.nostr) return resolve(window.nostr);
      if (Date.now() - start > timeoutMs) return resolve(null);
      setTimeout(check, 100);
    };
    check();
  });
}

export async function getExtensionIdentity() {
  const signer = await waitForSigner();
  if (!signer) {
    throw new Error("No browser signer found. Install a signer extension, or use another sign-in method.");
  }
  return { type: "extension", pubkey: await signer.getPublicKey() };
}

export async function signWithIdentity(identity, template) {
  if (!identity) throw new Error("Sign in before submitting.");
  if (identity.type === "extension") return window.nostr.signEvent(template);
  return finalizeEvent(template, identity.secret);
}

// ---------------------------------------------------------------------------
// Client: a thin wrapper over SimplePool with status reporting.
// ---------------------------------------------------------------------------
export class AtlasClient {
  constructor(onStatus) {
    this.pool = new SimplePool();
    this.onStatus = onStatus || (() => {});
    this.relayState = new Map(RELAYS.map((r) => [r, "idle"]));
    this.received = 0;
    this.published = 0;
    this.sub = null;
  }

  status() {
    const connected = [...this.relayState.values()].filter(
      (s) => s === "ok"
    ).length;
    return {
      connected,
      total: RELAYS.length,
      received: this.received,
      published: this.published,
      relays: Object.fromEntries(this.relayState),
    };
  }

  emit() {
    this.onStatus(this.status());
  }

  async connect() {
    await Promise.all(
      RELAYS.map(async (url) => {
        this.relayState.set(url, "connecting");
        this.emit();
        try {
          const relay = await this.pool.ensureRelay(url, { connectionTimeout: 6000 });
          this.relayState.set(url, relay.connected ? "ok" : "down");
        } catch {
          this.relayState.set(url, "down");
        }
        this.emit();
      })
    );
    return this.status();
  }

  // Read every canonical atlas node the archive key has published.
  async fetchArchive(timeoutMs = 4500) {
    const filter = { kinds: [NODE_KIND], authors: [FOUNDATION_PK], limit: 500 };
    let events = [];
    try {
      events = await this.pool.querySync(RELAYS, filter, { maxWait: timeoutMs });
    } catch {
      events = [];
    }
    // Deduplicate addressable events by d-tag, newest wins.
    const byD = new Map();
    for (const ev of events) {
      if (!verifyEvent(ev)) continue;
      const d = ev.tags.find((t) => t[0] === "d")?.[1];
      if (!d) continue;
      const prev = byD.get(d);
      if (!prev || ev.created_at > prev.created_at) byD.set(d, ev);
    }
    this.received = byD.size;
    this.emit();
    return [...byD.values()];
  }

  async fetchProposals(timeoutMs = 4500) {
    const filter = { kinds: [PROPOSAL_KIND], "#t": ["donald-judd"], limit: 500 };
    let events = [];
    try {
      events = await this.pool.querySync(RELAYS, filter, { maxWait: timeoutMs });
    } catch {
      events = [];
    }
    return events.filter((ev) => verifyEvent(ev) && ev.tags.some((t) => t[0] === "proposal-for" && t[1] === FOUNDATION_PK));
  }

  async fetchModeration(timeoutMs = 4500) {
    const filter = { kinds: [MODERATION_KIND], limit: 500 };
    let events = [];
    try {
      events = await this.pool.querySync(RELAYS, filter, { maxWait: timeoutMs });
    } catch {
      events = [];
    }
    return events.filter(verifyEvent);
  }

  async fetchProfile(pubkey, timeoutMs = 4500) {
    let events = [];
    try {
      // limit:1 per-relay would let one stale copy win; fetch a few and pick newest.
      events = await this.pool.querySync(PROFILE_RELAYS, { kinds: [0], authors: [pubkey] }, { maxWait: timeoutMs });
    } catch {
      events = [];
    }
    const latest = events.filter(verifyEvent).sort((a, b) => b.created_at - a.created_at)[0];
    return latest ? profileFromEvent(latest) : null;
  }

  subscribeLive(onNode, onProposal, onModeration) {
    const filter = { kinds: [NODE_KIND], "#t": ["donald-judd"] };
    const proposalFilter = { kinds: [PROPOSAL_KIND], "#t": ["donald-judd"] };
    const moderationFilter = { kinds: [MODERATION_KIND] };
    this.sub = this.pool.subscribeMany(RELAYS, [filter, proposalFilter, moderationFilter], {
      onevent: (ev) => {
        if (!verifyEvent(ev)) return;
        if (ev.kind === PROPOSAL_KIND) {
          if (ev.tags.some((t) => t[0] === "proposal-for" && t[1] === FOUNDATION_PK)) onProposal?.(ev);
          return;
        }
        if (ev.kind === MODERATION_KIND) {
          onModeration?.(ev);
          return;
        }
        if (ev.pubkey !== FOUNDATION_PK) return;
        const node = eventToNode(ev);
        if (!node) return;
        onNode(node);
      },
    });
    return this.sub;
  }

  countReceived(size) {
    this.received = size;
    this.emit();
  }

  // Publish a finished (signed) event to all relays; resolve with per-relay ok.
  async publish(signed) {
    const results = await Promise.allSettled(this.pool.publish(RELAYS, signed));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    if (ok > 0) this.published++;
    this.emit();
    return { ok, total: RELAYS.length };
  }

}
