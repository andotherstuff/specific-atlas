// Force-directed + geographic graph renderer (d3 v7, loaded globally).
const d3 = window.d3;

export class Graph {
  // `salience` and `edgeActiveAt` are injected rather than imported: this file
  // has no imports by design, and bump-cache.sh only rewrites the ?v= pins in
  // index.html and app.js, so an import here would go stale on release.
  constructor(svgEl, { nodes, links, types, onSelect, onVisibility, salience, edgeActiveAt, timeMin, timeMax, juddBorn, juddDied }) {
    this.timeMin = timeMin ?? 1900;
    this.timeMax = timeMax ?? 2025;
    this.juddBorn = juddBorn ?? 1928;
    this.juddDied = juddDied ?? 1994;
    this.salience = salience || null;
    this.edgeActiveAt = edgeActiveAt || (() => true);
    this.now = null;
    this.svg = d3.select(svgEl);
    this.types = types;
    this.onSelect = onSelect || (() => {});
    // Fires whenever the visible set changes, for readouts that would otherwise
    // drift out of step with the filters they don't know about.
    this.onVisibility = onVisibility || (() => {});
    this.layout = "force";
    this.viewportMode = "desktop";
    this.timeRange = null; // [start,end] or null
    this.activeTypes = new Set(Object.keys(types));
    this.activeLayers = null; // Set of provenance layers, or null = show all
    this.selectedId = null;
    this.k = 1; // current zoom scale (semantic zoom: elements counter-scale by 1/k)
    this.transform = window.d3.zoomIdentity; // current pan/zoom, for label placement
    this._labelW = new Map(); // cached measured label widths (screen px)

    this.nodes = nodes;
    this.links = links.map((l) => ({ ...l }));
    this.maxHops = null; // degrees-of-separation limit; null = show everything

    const box = svgEl.getBoundingClientRect();
    this.W = box.width || 900;
    this.H = box.height || 700;

    this._recompute();
    this._build();
    this._sim();
    this._applyVisibility();
    window.setTimeout(() => this.fitToView({ duration: 0, force: false }), 900);
  }

  _settings() {
    return this.viewportMode === "mobile"
      ? {
          baseRadius: 5,
          degreeRadius: 2.4,
          hubRadius: 16,
          hitRadius: 22,
          charge: -145,
          linkDistance: 48,
          hubLinkDistance: 66,
          collisionPadding: 13,
          geoPad: 34,
        }
      : {
          baseRadius: 6,
          degreeRadius: 3.2,
          hubRadius: 22,
          hitRadius: 16,
          charge: -260,
          linkDistance: 70,
          hubLinkDistance: 90,
          collisionPadding: 10,
          geoPad: 90,
        };
  }

  _build() {
    const svg = this.svg;
    svg.selectAll("*").remove();

    const defs = svg.append("defs");
    const glow = defs.append("filter").attr("id", "glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
    glow.append("feGaussianBlur").attr("stdDeviation", "3.2").attr("result", "b");
    const m = glow.append("feMerge");
    m.append("feMergeNode").attr("in", "b");
    m.append("feMergeNode").attr("in", "SourceGraphic");

    this.root = svg.append("g").attr("class", "root");
    this.gMap = this.root.append("g").attr("class", "map-layer");
    this.gLink = this.root.append("g").attr("class", "links");
    this.gNode = this.root.append("g").attr("class", "nodes");
    this.gCluster = this.root.append("g").attr("class", "clusters");

    this.zoom = d3
      .zoom()
      .scaleExtent([0.4, 6])
      .on("zoom", (e) => {
        // Semantic zoom: the root scales so node *positions* fan apart, but the
        // per-node counter-scale (see _tick) and non-scaling strokes keep dots,
        // rings, labels, and edges a constant, readable size. Zooming in opens
        // up crowded regions instead of magnifying the overlap.
        this.k = e.transform.k;
        this.transform = e.transform;
        this.root.attr("transform", e.transform);
        this._hideClusterPop();
        this._tick();
        this._applyZoomDetail();
      })
      .on("end", () => {
        // Re-cluster once the gesture settles: markers merge/split with the zoom.
        if (this.layout === "geo") this._recomputeGeoClusters();
      });
    svg.call(this.zoom);
    svg.on("dblclick.zoom", null);
    svg.on("click", (e) => {
      if (e.target === svg.node()) {
        this.select(null);
        this._hideClusterPop();
      }
    });

    // Popover for expanding a geographic cluster into its member nodes.
    const stage = svg.node().parentNode;
    this.clusterPop = document.createElement("div");
    this.clusterPop.className = "geo-cluster-pop";
    this.clusterPop.hidden = true;
    stage.appendChild(this.clusterPop);

    this._world = null; // basemap land (FeatureCollection), loaded async
    this._clusters = [];
    this._borders = null; // internal country borders (mesh)
    this._loadBasemap();

    this._render();
  }

  // Fetch a low-res world basemap so the geography view sits over real land that
  // aligns with each place's coordinates. Degrades gracefully (points still show)
  // if the CDN or topojson-client is unavailable.
  async _loadBasemap() {
    if (!window.topojson) return;
    try {
      const res = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
      const topo = await res.json();
      this._world = window.topojson.feature(topo, topo.objects.countries);
      this._borders = window.topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b);
      if (this.layout === "geo") this._geoLayout();
    } catch {
      /* no basemap, but the projected points still render */
    }
  }

  _id(value) {
    return typeof value === "object" && value ? value.id : value;
  }

  _typeDef(type) {
    return this.types[type] || this.types.concept;
  }

  _linkKey(d) {
    return `${this._id(d.source)}->${this._id(d.target)}`;
  }

  _recompute() {
    this.adj = new Map(this.nodes.map((n) => [n.id, new Set()]));
    const deg = new Map(this.nodes.map((n) => [n.id, 0]));
    const known = new Set(this.nodes.map((n) => n.id));
    this.links = this.links.filter((l) => known.has(this._id(l.source)) && known.has(this._id(l.target)));
    for (const l of this.links) {
      const source = this._id(l.source);
      const target = this._id(l.target);
      this.adj.get(source)?.add(target);
      this.adj.get(target)?.add(source);
      deg.set(source, (deg.get(source) || 0) + 1);
      deg.set(target, (deg.get(target) || 0) + 1);
    }
    for (const n of this.nodes) {
      n.deg = deg.get(n.id) || 0;
      const settings = this._settings();
      n.r = n.id === "donald-judd" ? settings.hubRadius : settings.baseRadius + Math.sqrt(n.deg) * settings.degreeRadius;
      n.type = this.types[n.type] ? n.type : "concept";
      if (n.x == null) n.x = this.W / 2;
      if (n.y == null) n.y = this.H / 2;
    }
    this._computeDepth();
  }

  // Degrees of separation from the centre, over the *whole* graph rather than
  // the currently visible one, so hiding a type doesn't silently push the
  // nodes behind it further away. Recomputed with the adjacency because
  // proposals can add nodes and edges after load.
  _computeDepth(rootId = "donald-judd") {
    for (const n of this.nodes) n._depth = Infinity;
    const byId = new Map(this.nodes.map((n) => [n.id, n]));
    const root = byId.get(rootId);
    if (!root) return;
    root._depth = 0;
    let ring = [rootId];
    let depth = 0;
    while (ring.length) {
      depth++;
      const next = [];
      for (const id of ring) {
        for (const neighbour of this.adj.get(id) || []) {
          const node = byId.get(neighbour);
          if (!node || node._depth !== Infinity) continue;
          node._depth = depth;
          next.push(neighbour);
        }
      }
      ring = next;
    }
    this.maxDepth = Math.max(0, ...this.nodes.map((n) => (n._depth === Infinity ? 0 : n._depth)));
  }

  _render() {
    this.linkSel = this.gLink
      .selectAll("line")
      .data(this.links, (d) => this._linkKey(d))
      .join(
        (enter) => enter.append("line").attr("class", "link"),
        (update) => update,
        (exit) => exit.remove()
      );

    const drag = d3
      .drag()
      .on("start", (e, d) => {
        if (!e.active) this.simulation?.alphaTarget(0.25).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (e, d) => {
        d.fx = e.x;
        d.fy = e.y;
      })
      .on("end", (e, d) => {
        if (!e.active) this.simulation?.alphaTarget(0);
        if (this.layout === "force") {
          d.fx = null;
          d.fy = null;
        }
      });

    this.nodeSel = this.gNode
      .selectAll("g.node")
      .data(this.nodes, (d) => d.id)
      .join(
        (enter) => {
          const g = enter.append("g").attr("class", "node").style("cursor", "pointer");
          g.append("circle").attr("class", "node-hit");
          g.append("circle").attr("class", "node-dot");
          g.append("circle").attr("class", "node-ring").attr("fill", "none");
          g.append("circle").attr("class", "note-pip");
          g.append("text").attr("class", "node-label").text((d) => d.title);
          return g;
        },
        (update) => update,
        (exit) => exit.remove()
      );

    this.nodeSel
      .on("click", (e, d) => {
        e.stopPropagation();
        this.select(d.id);
      })
      .on("mouseenter", (e, d) => this._hover(d.id))
      .on("mouseleave", () => this._hover(null))
      .call(drag);

    this.nodeSel.classed("hub", (d) => d.id === "donald-judd");
    // Machine-surfaced candidates read as outlines, not filled records, so an
    // unverified node is never mistaken for archive at a glance.
    this.nodeSel
      .classed("detected", (d) => d._layer === "detected")
      .style("--c", (d) => this._typeDef(d.type).color); // lets CSS stroke in the type colour
    this.nodeSel.select(".node-hit").attr("r", (d) => Math.max(this._settings().hitRadius, d.r + 8));
    this.nodeSel.select(".node-dot").attr("r", (d) => d.r).attr("fill", (d) => this._typeDef(d.type).color);
    this.nodeSel.select(".node-ring").attr("r", (d) => d.r + 4);
    // Small pip at the upper right of the dot, outside the focus ring.
    this.nodeSel
      .select(".note-pip")
      .attr("r", 3)
      .attr("cx", (d) => d.r * 0.78)
      .attr("cy", (d) => -d.r * 0.78);
    this.nodeSel.classed("noted", (d) => (this.notedIds || new Set()).has(d.id));
    const labels = this.nodeSel
      .select(".node-label")
      .attr("dy", (d) => -d.r - 6)
      .text((d) => d.title);

    // Cache each label's rendered width (screen px) for collision placement.
    this._labelW = new Map();
    labels.each((d, i, nodes) => {
      let w;
      try { w = nodes[i].getComputedTextLength(); } catch (_) { w = (d.title || "").length * 5.6; }
      this._labelW.set(d.id, w || (d.title || "").length * 5.6);
    });

    this._applyZoomDetail();
  }

  _sim() {
    const settings = this._settings();
    this.simulation = d3
      .forceSimulation(this.nodes)
      .force(
        "link",
        d3
          .forceLink(this.links)
          .id((d) => d.id)
          .distance((l) => (this._id(l.source) === "donald-judd" || this._id(l.target) === "donald-judd" ? settings.hubLinkDistance : settings.linkDistance))
          .strength(0.25)
      )
      .force("charge", d3.forceManyBody().strength(settings.charge))
      .force("collide", d3.forceCollide().radius((d) => d.r + settings.collisionPadding))
      .force("center", d3.forceCenter(this.W / 2, this.H / 2))
      .force("x", d3.forceX(this.W / 2).strength(0.03))
      .force("y", d3.forceY(this.H / 2).strength(0.03))
      .on("tick", () => this._tick());
  }

  _tick() {
    this.linkSel
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);
    // Counter-scale each node by 1/k so its dot/ring/label render at a constant
    // screen size while its position (in the root, scaled by k) fans apart.
    const inv = 1 / (this.k || 1);
    this.nodeSel.attr("transform", (d) => `translate(${d.x},${d.y}) scale(${inv})`);
    if (this._clusters && this._clusters.length) {
      this.gCluster.selectAll("g.geo-cluster").attr("transform", (c) => `translate(${c.x},${c.y}) scale(${inv})`);
    }
    this._maybeRelabel();
  }

  // Progressive disclosure via greedy label placement. Walking nodes from most
  // to least important, a label is shown only if its box has room in screen
  // space; the rest are dimmed. Because zoom spreads node *positions* apart
  // (while label size is constant), zooming in frees space and more labels fade
  // in. The disclosure is driven by the zoom itself.
  _labelPriority(d) {
    return d.id === "donald-judd" ? Infinity : d.deg;
  }

  _applyZoomDetail() {
    if (!this.nodeSel) return;
    const t = this.transform || window.d3.zoomIdentity;
    const H = 14;          // label box height incl. leading (screen px)
    const padX = 4, padY = 3;
    const placed = [];
    const show = new Set();
    const ordered = this.nodes
      .filter((d) => this._visible(d) && Number.isFinite(d.x) && Number.isFinite(d.y))
      .sort((a, b) => this._labelPriority(b) - this._labelPriority(a));

    for (const d of ordered) {
      const sx = t.applyX(d.x);
      const sy = t.applyY(d.y);
      const w = (this._labelW.get(d.id) || 40) + padX * 2;
      const y1 = sy - d.r - 6;      // label baseline sits d.r+6 px above center
      const box = { x0: sx - w / 2, y0: y1 - H, x1: sx + w / 2, y1 };
      let ok = true;
      for (const p of placed) {
        if (box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0) { ok = false; break; }
      }
      if (ok) { show.add(d.id); placed.push(box); }
    }
    this.nodeSel.classed("dim-label", (d) => !show.has(d.id));
  }

  // Re-run label placement as the layout settles, throttled so it doesn't churn.
  _maybeRelabel() {
    const now = (window.performance && performance.now) ? performance.now() : 0;
    if (now - (this._lastRelabel || 0) < 140) return;
    this._lastRelabel = now;
    this._applyZoomDetail();
  }

  // ---- interaction state ------------------------------------------------
  _hover(id) {
    if (this.selectedId) return; // selection takes precedence
    this._applyHighlight(id);
  }

  _applyHighlight(focusId) {
    const near = focusId ? this.adj.get(focusId) : null;
    this.nodeSel.classed("focus", (d) => d.id === focusId);
    this.nodeSel.classed("near", (d) => near && near.has(d.id));
    this.nodeSel.classed("faded", (d) =>
      focusId ? d.id !== focusId && !(near && near.has(d.id)) : false
    );
    this.linkSel.classed("active", (d) =>
      focusId ? this._id(d.source) === focusId || this._id(d.target) === focusId : false
    );
    this.linkSel.classed("faded", (d) =>
      focusId ? !(this._id(d.source) === focusId || this._id(d.target) === focusId) : false
    );
  }

  select(id) {
    this.selectedId = id;
    this._applyHighlight(id);
    if (id) {
      const n = this.nodes.find((x) => x.id === id);
      this.onSelect(n);
    } else {
      this.onSelect(null);
    }
  }

  centerOn(id) {
    const n = this.nodes.find((x) => x.id === id);
    if (!n) return;
    const t = d3.zoomIdentity
      .translate(this.W / 2, this.H / 2)
      .scale(1.4)
      .translate(-n.x, -n.y);
    this.svg.transition().duration(700).call(this.zoom.transform, t);
  }

  resetZoom() {
    this.svg.transition().duration(600).call(this.zoom.transform, d3.zoomIdentity);
  }

  fitToView({ duration = 450, force = true } = {}) {
    if (!this.nodes.length || this.selectedId) return;
    if (!force && this.viewportMode !== "mobile") return;
    const visible = this.nodes.filter((n) => this._visible(n));
    const fitNodes = visible.length ? visible : this.nodes;
    const ready = fitNodes.filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y));
    if (!ready.length) return;
    const minX = d3.min(ready, (n) => n.x - n.r);
    const maxX = d3.max(ready, (n) => n.x + n.r);
    const minY = d3.min(ready, (n) => n.y - n.r);
    const maxY = d3.max(ready, (n) => n.y + n.r);
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    const pad = this.viewportMode === "mobile" ? 44 : 80;
    const scale = Math.max(0.25, Math.min(2.2, Math.min((this.W - pad * 2) / w, (this.H - pad * 2) / h)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const t = d3.zoomIdentity.translate(this.W / 2, this.H / 2).scale(scale).translate(-cx, -cy);
    const target = duration ? this.svg.transition().duration(duration) : this.svg;
    target.call(this.zoom.transform, t);
  }

  // ---- filters ----------------------------------------------------------
  setTypes(activeSet) {
    this.activeTypes = new Set(activeSet);
    this._applyVisibility();
  }

  setTime(range) {
    this.timeRange = range;
    this._applyVisibility();
  }

  // The moment salience is read at. The sweep advances the window's end, so the
  // end doubles as a playhead and no second control is needed.
  setNow(year) {
    this.now = year;
    this._applySalience();
  }

  // Emphasis, not existence. A node still in the graph can be dim because the
  // dated record around it is thin at this moment: the Foundation's point that
  // colour and anti-illusionism both persist while one comes to the fore.
  _applySalience() {
    if (!this.nodeSel || !this.salience || this.now == null) return;
    const weight = (d) => this.salience.at(d.id, this.now);
    this.nodeSel.style("--salience", (d) => weight(d).toFixed(3));
    this.nodeSel.classed("ascendant", (d) => weight(d) > 0.85);
    this.linkSel.style("--salience", (d) =>
      Math.min(weight(this._endpoint(d.source)), weight(this._endpoint(d.target))).toFixed(3)
    );
  }

  _endpoint(value) {
    return typeof value === "object" && value ? value : { id: value };
  }

  // Provenance layers: canonical / approved / mine / following (see app.js).
  // A node's layer lives on d._layer; null activeLayers means no layer filtering.
  setLayers(activeSet) {
    this.activeLayers = activeSet ? new Set(activeSet) : null;
    this._applyVisibility();
  }

  _inLayers(d) {
    if (!this.activeLayers) return true;
    const layer = d._layer || "canonical";
    return this.activeLayers.has(layer);
  }

  // Which nodes carry a private note. Kept as a class rather than baked into
  // the node data so notes stay entirely a view concern, invisible to anything
  // that publishes.
  markNotes(idSet) {
    this.notedIds = idSet || new Set();
    if (this.nodeSel) this.nodeSel.classed("noted", (d) => this.notedIds.has(d.id));
    if (this.notesOnly) this._applyVisibility(); // the filtered set just changed
  }

  // Narrow the graph to nodes the viewer has annotated. Orthogonal to the
  // provenance layers: a note does not change who authored a record.
  setNotesOnly(on) {
    this.notesOnly = !!on;
    this._applyVisibility();
  }

  // Show only what sits within `hops` of the centre. null means no limit.
  setDepth(hops) {
    this.maxHops = hops;
    this._applyVisibility();
  }

  _inDepth(d) {
    if (this.maxHops == null) return true;
    // Unreachable nodes have no path to the centre at all, so they belong to
    // no ring and stay out whenever a limit is set.
    return d._depth <= this.maxHops;
  }

  _inTime(d) {
    if (!this.timeRange) return true;
    const [a, b] = this.timeRange;
    const s = d.start != null ? d.start : d.end;
    const e = d.end != null ? d.end : d.start;
    if (s == null) return true; // undated nodes always present
    return s <= b && e >= a;
  }

  _visible(d) {
    // The geography lens only shows things with a real location; abstract nodes
    // (most people/ideas, and works without coordinates) can't sit on a map.
    // Nodes folded into a cluster marker are hidden until the cluster is opened.
    if (this.layout === "geo" && (d.lat == null || d.lon == null || d._clustered)) return false;
    // Same rule for time: a node with no date has no position on this axis.
    if (this.layout === "time" && this._startYear(d) == null) return false;
    // "Only annotated" is a mode, not another filter in the stack. Someone
    // asking to see their own notes means all of them: composing this with the
    // layer, type and time filters hides notes the person just wrote, which
    // reads as data loss rather than as filtering.
    if (this.notesOnly) return (this.notedIds || new Set()).has(d.id);
    return (
      this.activeTypes.has(d.type) &&
      this._inTime(d) &&
      this._inLayers(d) &&
      this._inDepth(d)
    );
  }

  _applyVisibility() {
    this.nodeSel.classed("hidden", (d) => !this._visible(d));
    const vis = new Set(this.nodes.filter((d) => this._visible(d)).map((d) => d.id));
    // A relationship can be absent while both its ends are present: Judd and
    // architecture both exist in 1940, the relationship between them does not.
    this.linkSel.classed(
      "hidden",
      (d) =>
        !(vis.has(this._id(d.source)) && vis.has(this._id(d.target))) || !this._edgeInTime(d)
    );
    this._applyZoomDetail();
    this._applySalience();
    this.onVisibility(vis.size, this.nodes.length);
  }

  // An edge with no recorded time is timeless and always present, so the 125
  // un-annotated edges keep working exactly as before.
  _edgeInTime(d) {
    if (!this.timeRange || !d.when) return true;
    return this.edgeActiveAt(d.when, this.timeRange[1]);
  }

  // ---- layouts ----------------------------------------------------------
  setLayout(mode) {
    if (mode === this.layout) return;
    this.layout = mode;
    if (mode === "geo") this._geoLayout();
    else if (mode === "time") this._timeLayout();
    else this._forceLayout();
  }

  _startYear(n) {
    return n.start != null ? n.start : n.end != null ? n.end : null;
  }

  // Node radius is tuned for the constellation, where there is room to spread.
  // Pinned to a date inside a lane, the same dots overlap into a smear, so the
  // timeline draws them smaller.
  _radiusFor(d) {
    return this.layout === "time" ? Math.max(3.5, d.r * 0.5) : d.r;
  }

  // Re-apply the sizes that depend on the current lens.
  _applyRadii() {
    if (!this.nodeSel) return;
    const r = (d) => this._radiusFor(d);
    this.nodeSel.select(".node-hit").attr("r", (d) => Math.max(this._settings().hitRadius, r(d) + 8));
    this.nodeSel.select(".node-dot").attr("r", r);
    this.nodeSel.select(".node-ring").attr("r", (d) => r(d) + 4);
    this.nodeSel.select(".note-pip").attr("cx", (d) => r(d) * 0.78).attr("cy", (d) => -r(d) * 0.78);
    this.nodeSel.select(".node-label").attr("dy", (d) => -r(d) - 6);
  }

  // The third projection. Constellation means position is relationship,
  // Geography means position is place, Timeline means position is when.
  //
  // Time runs DOWN and categories run ACROSS, which is the shape of the
  // Foundation's own timeline spreadsheets: rows are periods, columns are
  // categories. Only y is pinned, because the year is exact; the horizontal is
  // free so collision can spread a crowded decade sideways inside its column
  // rather than stacking nodes on top of each other.
  _timeLayout() {
    this.k = 1;
    this.transform = d3.zoomIdentity;
    this.svg.node().__zoom = d3.zoomIdentity;
    this.root.attr("transform", d3.zoomIdentity);
    this.gCluster.selectAll("*").remove();
    this._clusters = [];
    this._hideClusterPop();
    for (const n of this.nodes) n._clustered = false;

    // A reserved gutter for the lane names, so labels never sit under the data.
    const padL = 116;
    const padR = 26;
    const padT = 30;
    const padB = 34; // decade numbers along the foot

    // Fit the axis to the years actually plotted rather than to the full atlas
    // span. Nothing in the data sits after 1996, so scaling to 2025 spent a
    // quarter of the canvas on empty afterlife. The bounds still run to 2025
    // for the scrubber and for salience; this is only how the axis is drawn.
    const plotted = this.nodes.map((n) => this._startYear(n)).filter((y) => y != null);
    const lo = plotted.length ? Math.min(...plotted) : this.timeMin;
    const hi = plotted.length ? Math.max(...plotted) : this.timeMax;
    const domainLo = Math.floor((lo - 4) / 10) * 10;
    const domainHi = Math.ceil((hi + 4) / 10) * 10;
    const span = domainHi - domainLo || 1;
    const plotW = this.W - padL - padR;
    const x = (year) => padL + ((year - domainLo) / span) * plotW;
    this._timeX = x;
    this._timeDomain = [domainLo, domainHi];

    const order = Object.keys(this.types);
    const laneH = (this.H - padT - padB) / order.length;
    const laneY = (type) => padT + order.indexOf(type) * laneH + laneH / 2;

    const seen = {};
    for (const n of this.nodes) {
      const year = this._startYear(n);
      if (year == null) {
        n.fx = null;
        n.fy = null;
        continue; // undated nodes are not plotted; the rail reports how many
      }
      n.fx = x(year);
      n.fy = null;
      n._laneY = laneY(n.type);
      // Snap into the lane rather than drifting toward it. The vertical force
      // only resolves over ticks, so a node entering this lens keeps whatever y
      // the constellation left it with, and if alpha decays before it arrives it
      // settles in the wrong band entirely. The small offset gives collision
      // something to push against; identical positions deadlock it.
      seen[n.type] = (seen[n.type] || 0) + 1;
      n.y = n._laneY + ((seen[n.type] % 5) - 2) * 1.5;
    }

    this._drawTimeGuides({ x, laneY, laneH, order, padL, padR, padT, padB });

    this.simulation.force("geoX", null);
    this.simulation.force("geoY", null);
    this.simulation.force("colX", null);
    this.simulation.force("charge").strength(-8);
    this.simulation.force("link").strength(0);
    this.simulation.force("collide").radius((d) => this._radiusFor(d) + 2.5);
    // Hold each node in its lane but let it ride up and down inside it, so a
    // crowded decade grows vertically instead of overlapping.
    this.simulation.force("laneY", d3.forceY((d) => d._laneY ?? this.H / 2).strength(0.34));
    this._applyRadii();
    this.simulation.alpha(0.8).restart();
    this._applyVisibility();
  }

  // The chart furniture: lane bands, decade rules, and the life.
  //
  // Drawn as rules and intervals rather than boxes and fills. Equal lane heights
  // and an even decade interval do the organising, which is the same logic the
  // work runs on: one thing after another, at a fixed interval, with nothing
  // emphasised over anything else. The only filled shape is the life, and it is
  // barely there.
  _drawTimeGuides({ x, laneY, laneH, order, padL, padR, padT, padB }) {
    const g = this.gMap;
    g.selectAll("*").remove();

    const [domainLo, domainHi] = this._timeDomain;
    const clamp = (year) => Math.min(domainHi, Math.max(domainLo, year));
    const right = this.W - padR;
    const foot = this.H - padB;
    const bornX = x(clamp(this.juddBorn));
    const diedX = x(clamp(this.juddDied));

    // 1. The life, behind everything.
    g.append("rect")
      .attr("class", "time-life")
      .attr("x", bornX)
      .attr("y", padT)
      .attr("width", Math.max(0, diedX - bornX))
      .attr("height", foot - padT);
    for (const edge of [bornX, diedX]) {
      g.append("line")
        .attr("class", "time-life-edge")
        .attr("x1", edge).attr("x2", edge)
        .attr("y1", padT - 8).attr("y2", foot);
    }

    // 2. Decade rules, hairline, full height of the field.
    const step = 10;
    for (let year = Math.ceil(domainLo / step) * step; year <= domainHi; year += step) {
      g.append("line")
        .attr("class", "time-rule")
        .attr("x1", x(year)).attr("x2", x(year))
        .attr("y1", padT).attr("y2", foot);
      g.append("text")
        .attr("class", "time-tick")
        .attr("x", x(year)).attr("y", foot + 18)
        .attr("text-anchor", "middle")
        .text(year);
    }

    // 3. Lane separators. Equal intervals, hairline, edge to edge.
    for (let i = 0; i <= order.length; i++) {
      const y = padT + i * laneH;
      g.append("line")
        .attr("class", i === 0 || i === order.length ? "time-lane-edge" : "time-lane-rule")
        .attr("x1", padL - 16).attr("x2", right)
        .attr("y1", y).attr("y2", y);
    }

    // 4. Lane names in the gutter, each with its own colour, left aligned so
    //    they read as a list rather than as labels chasing the data.
    for (const type of order) {
      const cy = laneY(type);
      g.append("rect")
        .attr("class", "time-lane-swatch")
        .attr("x", 14).attr("y", cy - 5)
        .attr("width", 9).attr("height", 9)
        .attr("fill", this._typeDef(type).color);
      g.append("text")
        .attr("class", "time-lane-label")
        .attr("x", 31).attr("y", cy + 3)
        .text(this._typeDef(type).label);
    }

    // 5. The two dates that bound the life, set above the field.
    for (const mark of [
      { at: bornX, text: String(this.juddBorn), anchor: "start" },
      { at: diedX, text: String(this.juddDied), anchor: "end" },
    ]) {
      g.append("text")
        .attr("class", "time-life-label")
        .attr("x", mark.at + (mark.anchor === "start" ? 5 : -5))
        .attr("y", padT - 13)
        .attr("text-anchor", mark.anchor)
        .text(mark.text);
    }
  }

  _forceLayout() {
    const settings = this._settings();
    this.simulation.force("laneY", null);
    this.simulation.force("colX", null);
    this.gMap.selectAll("*").remove();
    this.gCluster.selectAll("*").remove();
    this._clusters = [];
    this._hideClusterPop();
    for (const n of this.nodes) n._clustered = false;
    this.simulation.force("geoX", null);
    this.simulation.force("geoY", null);
    for (const n of this.nodes) {
      n.fx = null;
      n.fy = null;
    }
    this.simulation
      .force("link")
      .distance((l) => (this._id(l.source) === "donald-judd" || this._id(l.target) === "donald-judd" ? settings.hubLinkDistance : settings.linkDistance))
      .strength(0.25);
    this.simulation.force("charge").strength(settings.charge);
    this.simulation.force("collide").radius((d) => d.r + settings.collisionPadding);
    this._applyRadii();
    this.simulation.alpha(0.9).restart();
    this._applyVisibility();
  }

  _geoLayout() {
    this.simulation.force("laneY", null);
    this.simulation.force("colX", null);
    // Reset any leftover zoom so the projection fit is correct and clusters are
    // computed at k=1. (Set d3-zoom's stored transform directly to avoid firing
    // the zoom handler.)
    this.k = 1;
    this.transform = d3.zoomIdentity;
    this.svg.node().__zoom = d3.zoomIdentity;
    this.root.attr("transform", d3.zoomIdentity);

    // Fit the WHOLE extent of located places so nothing (e.g. Korea) is left off
    // screen; density is handled by zoom-aware clustering below.
    const geoNodes = this.nodes.filter((n) => n.lat != null && n.lon != null);
    const fc = {
      type: "FeatureCollection",
      features: geoNodes.map((n) => ({ type: "Feature", geometry: { type: "Point", coordinates: [n.lon, n.lat] } })),
    };
    const pad = this._settings().geoPad;
    const projection = d3.geoMercator().fitExtent([[pad, pad], [this.W - pad, this.H - pad]], fc);
    this.projection = projection;

    this._drawBasemap(projection);

    // Pin located nodes at their real coordinates (kept in _px/_py so clusters can
    // be recomputed at any zoom); un-located nodes are hidden in geo mode.
    for (const n of this.nodes) {
      n._clustered = false;
      if (n.lat != null && n.lon != null) {
        const [x, y] = projection([n.lon, n.lat]);
        n._px = x; n._py = y; n.fx = x; n.fy = y; n.x = x; n.y = y;
      } else {
        n._px = null; n._py = null; n.fx = null; n.fy = null;
      }
    }

    this.simulation.force("geoX", null);
    this.simulation.force("geoY", null);
    this.simulation.force("charge").strength(-30);
    this.simulation.force("link").strength(0.05).distance(30);
    this.simulation.force("collide").radius((d) => d.r + this._settings().collisionPadding);
    this._applyRadii();
    this.simulation.alpha(0.3).restart();
    this._recomputeGeoClusters();
    this._hideClusterPop();
  }

  // Cluster located nodes by screen-space proximity at the current zoom: tight
  // groups (all of Marfa, all of NYC, or the whole US when zoomed out on a
  // phone) collapse into one counted marker and split apart as you zoom in.
  _recomputeGeoClusters() {
    if (this.layout !== "geo") {
      this._clusters = [];
      this.gCluster.selectAll("*").remove();
      return;
    }
    const located = this.nodes.filter(
      (n) => n._px != null && this.activeTypes.has(n.type) && this._inTime(n) && this._inLayers(n)
    );
    for (const n of located) n._clustered = false;
    const R = 46 / (this.k || 1); // ~46px on screen → base-projection space
    const clusters = [];
    for (const n of located) {
      let c = clusters.find((k) => Math.hypot(k.sx - n._px, k.sy - n._py) <= R);
      if (!c) {
        c = { sx: n._px, sy: n._py, members: [] };
        clusters.push(c);
      }
      c.members.push(n);
    }
    for (const c of clusters) {
      c.x = c.members.reduce((s, m) => s + m._px, 0) / c.members.length;
      c.y = c.members.reduce((s, m) => s + m._py, 0) / c.members.length;
      if (c.members.length > 1) for (const m of c.members) m._clustered = true;
    }
    this._clusters = clusters.filter((c) => c.members.length > 1);
    this._renderClusters();
    this._applyVisibility();
  }

  _renderClusters() {
    const sel = this.gCluster.selectAll("g.geo-cluster").data(this._clusters, (c, i) => i);
    sel.exit().remove();
    const enter = sel.enter().append("g").attr("class", "geo-cluster").style("cursor", "pointer");
    enter.append("circle").attr("class", "geo-cluster-hit");
    enter.append("circle").attr("class", "geo-cluster-dot");
    enter.append("text").attr("class", "geo-cluster-count").attr("dy", "0.34em");
    const merged = enter.merge(sel);
    merged.select(".geo-cluster-hit").attr("r", (c) => 13 + Math.min(7, c.members.length) + 12); // ≥ 44px touch target
    merged.select(".geo-cluster-dot").attr("r", (c) => 13 + Math.min(7, c.members.length));
    merged.select(".geo-cluster-count").text((c) => c.members.length);
    merged.on("click", (e, c) => {
      e.stopPropagation();
      this._showClusterPop(c);
    });
    const inv = 1 / (this.k || 1);
    merged.attr("transform", (c) => `translate(${c.x},${c.y}) scale(${inv})`);
  }

  _showClusterPop(cluster) {
    const pop = this.clusterPop;
    if (!pop) return;
    pop.replaceChildren();
    const head = document.createElement("div");
    head.className = "gcp-head";
    const places = new Set(cluster.members.map((m) => m.place).filter(Boolean));
    head.textContent = places.size === 1 ? [...places][0] : `${cluster.members.length} in this area`;
    pop.appendChild(head);
    for (const m of cluster.members) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "gcp-item";
      const sw = document.createElement("span");
      sw.className = "gcp-swatch";
      sw.style.background = this._typeDef(m.type).color;
      const label = document.createElement("span");
      label.className = "gcp-title";
      label.textContent = m.title;
      item.append(sw, label);
      item.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.select(m.id);
        this._hideClusterPop();
      });
      pop.appendChild(item);
    }
    const t = this.transform && this.transform.apply ? this.transform : { apply: (p) => p };
    const [sx, sy] = t.apply([cluster.x, cluster.y]);
    const stage = this.svg.node().parentNode;
    const W = stage.clientWidth, H = stage.clientHeight;
    pop.hidden = false;
    const pw = pop.offsetWidth || 210, ph = pop.offsetHeight || 200;
    let left = sx + 18;
    let top = sy - 12;
    if (left + pw > W - 8) left = sx - pw - 18;
    if (top + ph > H - 8) top = Math.max(8, H - ph - 8);
    pop.style.left = Math.max(8, left) + "px";
    pop.style.top = Math.max(8, top) + "px";
  }

  _hideClusterPop() {
    if (this.clusterPop) this.clusterPop.hidden = true;
  }

  // Draw the country basemap under the projected place nodes, using the same
  // projection so land aligns with each place's real coordinates.
  _drawBasemap(projection) {
    const g = this.gMap;
    g.selectAll("*").remove();
    if (!this._world || !window.d3) return;
    const path = d3.geoPath(projection);
    g.append("path").datum(this._world).attr("class", "geo-land").attr("d", path);
    if (this._borders) {
      g.append("path").datum(this._borders).attr("class", "geo-borders").attr("d", path);
    }
  }

  resize() {
    const box = this.svg.node().getBoundingClientRect();
    this.W = box.width;
    this.H = box.height;
    this.simulation.force("center", d3.forceCenter(this.W / 2, this.H / 2));
    // Both projected layouts pin positions from the canvas size, so a resize
    // has to reproject. Without this the timeline keeps the width it was built
    // with and crams the whole life into the left third when the detail panel
    // collapses.
    if (this.layout === "geo") this._geoLayout();
    else if (this.layout === "time") this._timeLayout();
    else this.simulation.alpha(0.3).restart();
    window.setTimeout(() => this.fitToView({ duration: 250, force: false }), 250);
  }

  setViewportMode(mode) {
    const next = mode === "mobile" ? "mobile" : "desktop";
    if (next === this.viewportMode) return;
    this.viewportMode = next;
    this._recompute();
    this._render();
    if (!this.simulation) return;
    this.simulation.force("collide").radius((d) => d.r + this._settings().collisionPadding);
    this.simulation.nodes(this.nodes);
    this.simulation.force("link").links(this.links);
    if (this.layout === "geo") this._geoLayout();
    else if (this.layout === "time") this._timeLayout();
    else this._forceLayout();
    this._applyVisibility();
    this._applyHighlight(this.selectedId);
    window.setTimeout(() => this.fitToView({ duration: 350, force: false }), 500);
  }

  // add a node that arrived live (or was just published)
  addNode(node) {
    if (this.nodes.some((n) => n.id === node.id)) return false;
    node.x = this.W / 2;
    node.y = this.H / 2;
    this.nodes.push(node);
    return this.refresh();
  }

  refresh() {
    const existing = new Set(this.links.map((l) => this._linkKey(l)));
    const known = new Set(this.nodes.map((n) => n.id));
    for (const node of this.nodes) {
      for (const [target, relation] of node.edges || []) {
        if (!known.has(target)) continue;
        const key = `${node.id}->${target}`;
        if (existing.has(key)) continue;
        this.links.push({ source: node.id, target, relation });
        existing.add(key);
      }
    }
    this._recompute();
    this._render();
    this.simulation.nodes(this.nodes);
    this.simulation.force("link").links(this.links);
    if (this.layout === "geo") this._geoLayout();
    this._applyVisibility();
    this._applyHighlight(this.selectedId);
    this.simulation.alpha(0.6).restart();
    return true;
  }
}
