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
    this.selectedId = null;

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

    this.zoom = d3
      .zoom()
      .scaleExtent([0.25, 6])
      .on("zoom", (e) => this.root.attr("transform", e.transform));
    svg.call(this.zoom);
    svg.on("dblclick.zoom", null);
    svg.on("click", (e) => {
      if (e.target === svg.node()) this.select(null);
    });

    this._render();
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
    this.nodeSel
      .select(".node-label")
      .attr("dy", (d) => -d.r - 6)
      .text((d) => d.title);
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
    this.nodeSel.attr("transform", (d) => `translate(${d.x},${d.y})`);
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

  _inTime(d) {
    if (!this.timeRange) return true;
    const [a, b] = this.timeRange;
    const s = d.start != null ? d.start : d.end;
    const e = d.end != null ? d.end : d.start;
    if (s == null) return true; // undated nodes always present
    return s <= b && e >= a;
  }

  _visible(d) {
    return this.activeTypes.has(d.type) && this._inTime(d);
  }

  _applyVisibility() {
    this.nodeSel.classed("hidden", (d) => !this._visible(d));
    const vis = new Set(this.nodes.filter((d) => this._visible(d)).map((d) => d.id));
    this.linkSel.classed("hidden", (d) => !(vis.has(this._id(d.source)) && vis.has(this._id(d.target))));
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

    // faint graticule-ish frame: draw the projected place markers' ghost grid
    this.gMap.selectAll("*").remove();
    this._drawMapHints(projection, geoNodes);

    for (const n of this.nodes) {
      if (n.lat != null && n.lon != null) {
        const [x, y] = projection([n.lon, n.lat]);
        n.fx = x;
        n.fy = y;
        n.x = x;
        n.y = y;
      } else {
        n.fx = null;
        n.fy = null;
      }
    }
    // weaken global forces so undated/un-placed nodes hover near their anchors
    this.simulation.force("charge").strength(-120);
    this.simulation.force("link").strength(0.5).distance(46);
    this.simulation.alpha(0.7).restart();
  }

  _drawMapHints(projection, geoNodes) {
    // light lat/long crosshairs at each place + a soft label
    const g = this.gMap;
    g.append("rect")
      .attr("x", 0).attr("y", 0).attr("width", this.W).attr("height", this.H)
      .attr("class", "geo-bg");
    const grp = g
      .selectAll("g.place-hint")
      .data(geoNodes, (d) => d.id)
      .join("g")
      .attr("class", "place-hint")
      .attr("transform", (d) => {
        const [x, y] = projection([d.lon, d.lat]);
        return `translate(${x},${y})`;
      });
    grp.append("line").attr("class", "cross").attr("x1", -9).attr("x2", 9);
    grp.append("line").attr("class", "cross").attr("y1", -9).attr("y2", 9);
    grp.append("text")
      .attr("class", "place-coord")
      .attr("dy", 18)
      .text((d) => `${d.lat.toFixed(2)}, ${d.lon.toFixed(2)}`);
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
