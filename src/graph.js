// Force-directed + geographic graph renderer (d3 v7, loaded globally).
const d3 = window.d3;

export class Graph {
  constructor(svgEl, { nodes, links, types, onSelect }) {
    this.svg = d3.select(svgEl);
    this.types = types;
    this.onSelect = onSelect || (() => {});
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
      /* no basemap — the projected points still render */
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
    this.nodeSel.select(".node-hit").attr("r", (d) => Math.max(this._settings().hitRadius, d.r + 8));
    this.nodeSel.select(".node-dot").attr("r", (d) => d.r).attr("fill", (d) => this._typeDef(d.type).color);
    this.nodeSel.select(".node-ring").attr("r", (d) => d.r + 4);
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
  // in — the disclosure is driven by the zoom itself.
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
    return this.activeTypes.has(d.type) && this._inTime(d) && this._inLayers(d);
  }

  _applyVisibility() {
    this.nodeSel.classed("hidden", (d) => !this._visible(d));
    const vis = new Set(this.nodes.filter((d) => this._visible(d)).map((d) => d.id));
    this.linkSel.classed("hidden", (d) => !(vis.has(this._id(d.source)) && vis.has(this._id(d.target))));
    this._applyZoomDetail();
  }

  // ---- layouts ----------------------------------------------------------
  setLayout(mode) {
    if (mode === this.layout) return;
    this.layout = mode;
    if (mode === "geo") this._geoLayout();
    else this._forceLayout();
  }

  _forceLayout() {
    const settings = this._settings();
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
    this.simulation.alpha(0.9).restart();
    this._applyVisibility();
  }

  _geoLayout() {
    const geoNodes = this.nodes.filter((n) => n.lat != null && n.lon != null);
    const fc = {
      type: "FeatureCollection",
      features: geoNodes.map((n) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [n.lon, n.lat] },
      })),
    };
    const pad = this._settings().geoPad;
    const projection = d3
      .geoMercator()
      .fitExtent([[pad, pad], [this.W - pad, this.H - pad]], fc);
    this.projection = projection;

    this._drawBasemap(projection);

    // Fix located nodes at their real coordinates; only these are shown in geo
    // mode (see _visible).
    for (const n of this.nodes) {
      n._clustered = false;
      if (n.lat != null && n.lon != null) {
        const [x, y] = projection([n.lon, n.lat]);
        n.fx = x; n.fy = y; n.x = x; n.y = y;
      } else {
        n.fx = null; n.fy = null;
      }
    }

    // Group located nodes that land on the same spot (everything in Marfa,
    // everything in NYC…) into one counted cluster marker; a click expands it.
    const located = this.nodes.filter(
      (n) => n.lat != null && n.lon != null && this.activeTypes.has(n.type) && this._inTime(n) && this._inLayers(n)
    );
    const R = 30; // px in base-projection space
    const clusters = [];
    for (const n of located) {
      let c = clusters.find((k) => Math.hypot(k.sx - n.x, k.sy - n.y) <= R);
      if (!c) {
        c = { sx: n.x, sy: n.y, members: [] };
        clusters.push(c);
      }
      c.members.push(n);
    }
    for (const c of clusters) {
      c.x = c.members.reduce((s, m) => s + m.x, 0) / c.members.length;
      c.y = c.members.reduce((s, m) => s + m.y, 0) / c.members.length;
      if (c.members.length > 1) {
        for (const m of c.members) {
          m._clustered = true;
          m.fx = c.x; m.fy = c.y; m.x = c.x; m.y = c.y;
        }
      }
    }
    this._clusters = clusters.filter((c) => c.members.length > 1);

    this.simulation.force("geoX", null);
    this.simulation.force("geoY", null);
    this.simulation.force("charge").strength(-30);
    this.simulation.force("link").strength(0.05).distance(30);
    this.simulation.force("collide").radius((d) => d.r + this._settings().collisionPadding);
    this.simulation.alpha(0.4).restart();
    this._renderClusters();
    this._applyVisibility();
    this._hideClusterPop();
  }

  _renderClusters() {
    const sel = this.gCluster.selectAll("g.geo-cluster").data(this._clusters, (c, i) => i);
    sel.exit().remove();
    const enter = sel.enter().append("g").attr("class", "geo-cluster").style("cursor", "pointer");
    enter.append("circle").attr("class", "geo-cluster-dot");
    enter.append("text").attr("class", "geo-cluster-count").attr("dy", "0.34em");
    const merged = enter.merge(sel);
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
    head.textContent = cluster.members[0].place || `${cluster.members.length} here`;
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
    if (this.layout === "geo") this._geoLayout();
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
