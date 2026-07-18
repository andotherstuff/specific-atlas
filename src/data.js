// The atlas. Each entry becomes one signed, addressable Nostr event (NIP-01
// addressable kind, identified by its `d` tag = id). Edges live on the source
// node as ["edge", targetId, relation] tags. Facts checked against Judd
// Foundation / Chinati / Wikipedia chronologies (see project notes).

// Restrained, desaturated "Marfa desert" palette—muted enough to stay
// editorial on the white ground, distinct enough that type stays scannable.
// Works is the Judd Foundation cyan itself; People carry a muted gold so the
// central Judd hub reads warm; Institutions take an adobe clay-tan (the Marfa
// association) rather than a redder terracotta.
export const TYPES = {
  person:      { label: "People",       color: "#d8b24b", glyph: "person" },  // lighter, yellower gold—pulls away from the adobe clay
  work:        { label: "Works",        color: "#7acbd7", glyph: "work" },
  place:       { label: "Places",       color: "#8a9065", glyph: "place" },  // Pantone 5773 C—desert sage (Marfa / Chihuahuan Desert)
  concept:     { label: "Ideas",        color: "#6b4a6e", glyph: "concept" },
  institution: { label: "Institutions", color: "#b08560", glyph: "institution" },
  event:       { label: "Moments",      color: "#b2ac9e", glyph: "event" },  // light warm greige—neutral, separates from the sage green
};

// type order for legend / z-stacking
export const TYPE_ORDER = ["person", "work", "place", "concept", "institution", "event"];

export const NODES = [
  // ---- THE CENTER -------------------------------------------------------
  {
    id: "donald-judd", type: "person", title: "Donald Judd", start: 1928, end: 1994,
    lat: 30.3094, lon: -104.0207, place: "Marfa, Texas",
    content:
      "Donald Clarence Judd (1928–1994). Painter turned critic turned maker of what he called specific objects—real things in real space, not pictures of anything. He rejected illusion, composition, and the word 'Minimalism' that the world insisted on using for him. Over three decades he moved art off the wall, out of the gallery, and finally into permanent installation across two cities he reshaped to his standard: a cast-iron building in SoHo and a former army fort in the West Texas desert.",
    edges: [
      ["specific-objects", "wrote the founding text of"],
      ["minimalism", "was labeled with—and refused"],
      ["stacks", "made"],
      ["progressions", "made"],
      ["101-spring", "bought and inhabited"],
      ["marfa", "remade"],
      ["chinati", "founded"],
      ["julie-finch", "married"],
      ["flavin-judd", "father of"],
      ["rainer-judd", "father of"],
      ["marianne-stockebrand", "companion of"],
      ["dan-flavin", "close friend of"],
      ["frank-stella", "ally of"],
      ["john-chamberlain", "collaborator with"],
      ["barnett-newman", "admired"],
      ["leo-castelli", "represented by"],
      ["green-gallery", "broke through at"],
      ["arts-magazine", "wrote criticism for"],
      ["judd-furniture", "designed"],
      ["color", "spent late career on"],
    ],
  },

  // ---- PEOPLE -----------------------------------------------------------
  {
    id: "julie-finch", type: "person", title: "Julie Finch", start: 1939,
    content:
      "Dancer; married Judd in 1964. The two raised Flavin and Rainer between 101 Spring Street and Marfa before divorcing in 1978. An activist and performer, she shared the early SoHo years when the family lived inside what became one of Judd's first permanent installations.",
    edges: [["donald-judd", "married"], ["101-spring", "lived in"], ["flavin-judd", "mother of"], ["rainer-judd", "mother of"]],
  },
  {
    id: "flavin-judd", type: "person", title: "Flavin Judd", start: 1968,
    content:
      "Judd's son, born 1968 and named for Dan Flavin. Now artistic director of Judd Foundation, he has overseen the restoration of 101 Spring Street and the Marfa properties—the steward who keeps the installations exactly as his father fixed them.",
    edges: [["donald-judd", "son of"], ["rainer-judd", "brother of"], ["dan-flavin", "namesake of"], ["judd-foundation", "leads"]],
  },
  {
    id: "rainer-judd", type: "person", title: "Rainer Judd", start: 1970,
    content:
      "Judd's daughter, born 1970 and named for the dancer Yvonne Rainer. A filmmaker, she is president of Judd Foundation. Her childhood ran between a SoHo loft and the Texas desert, both arranged with her father's exacting sense of order.",
    edges: [["donald-judd", "daughter of"], ["flavin-judd", "sister of"], ["yvonne-rainer", "namesake of"], ["judd-foundation", "presides over"]],
  },
  {
    id: "yvonne-rainer", type: "person", title: "Yvonne Rainer", start: 1934,
    content:
      "Dancer, choreographer, and later filmmaker; a founder of the Judson Dance Theater (1962) and author of the 1965 \"No Manifesto,\" which stripped dance of spectacle and virtuosity much as Judd stripped art of illusion. A friend of Julie Finch in the downtown dance world, she is the dancer for whom Judd and Finch named their daughter, Rainer.",
    edges: [["donald-judd", "friend of"], ["julie-finch", "friend of"]],
  },
  {
    id: "marianne-stockebrand", type: "person", title: "Marianne Stockebrand", start: 1955,
    content:
      "German curator and Judd's companion in his last four years. After his death in 1994 she became director of the Chinati Foundation, leading it for nearly two decades and writing 'Chinati: The Vision of Donald Judd.' She translated his intentions into the institution that now guards them.",
    edges: [["donald-judd", "companion of"], ["chinati", "directed"]],
  },
  {
    id: "dan-flavin", type: "person", title: "Dan Flavin", start: 1933, end: 1996,
    content:
      "Artist of fluorescent light and one of Judd's closest friends; Judd named his son for him. Flavin's light works are permanently installed at Chinati, in six former barracks buildings—a friendship made architectural.",
    edges: [["donald-judd", "close friend of"], ["chinati", "permanently installed at"], ["minimalism", "linked to"]],
  },
  {
    id: "frank-stella", type: "person", title: "Frank Stella", start: 1936, end: 2024,
    content:
      "Painter whose black paintings—'what you see is what you see'—gave Judd's generation a creed against illusion. A friend and intellectual ally from the early 1960s New York scene.",
    edges: [["donald-judd", "ally of"], ["specific-objects", "anticipated"]],
  },
  {
    id: "john-chamberlain", type: "person", title: "John Chamberlain", start: 1927, end: 2011,
    content:
      "Sculptor of crushed automobile metal and a long-time friend. Judd championed his work and installed a building of his crushed-metal sculptures at Chinati, in a former wool warehouse in downtown Marfa.",
    edges: [["donald-judd", "collaborator with"], ["chinati", "permanently installed at"]],
  },
  {
    id: "carl-andre", type: "person", title: "Carl Andre", start: 1935, end: 2024,
    content:
      "Sculptor of floor-bound metal plates and bricks, grouped with Judd under the Minimalist banner. A peer in the 1960s redefinition of sculpture as real material in real space.",
    edges: [["donald-judd", "peer of"], ["minimalism", "linked to"]],
  },
  {
    id: "barnett-newman", type: "person", title: "Barnett Newman", start: 1905, end: 1970,
    content:
      "Abstract Expressionist of the great color fields and 'zips.' Judd admired him above nearly all painters—for wholeness, for scale, for refusing relational composition. A bridge from the generation before to Judd's specific objects.",
    edges: [["donald-judd", "admired by"], ["wholeness", "embodied"]],
  },
  {
    id: "leo-castelli", type: "person", title: "Leo Castelli", start: 1907, end: 1999,
    content:
      "The dealer who defined postwar American art. Castelli represented Judd from 1966, giving the new work its market and its institutional reach after the Green Gallery years.",
    edges: [["donald-judd", "represented"], ["green-gallery", "succeeded"]],
  },

  // ---- WORKS & WRITING --------------------------------------------------
  {
    id: "specific-objects", type: "concept", title: "“Specific Objects”", start: 1965,
    content:
      "Judd's manifesto, published in Arts Yearbook 8 (1965). It argued that the best new work was neither painting nor sculpture but a third thing—specific objects—that existed as actual volume in actual space. No illusion, no relational composition, no hierarchy of parts. The essay became the intellectual ground of an entire movement, even as Judd resisted the label that movement acquired.",
    edges: [["minimalism", "founded the language of"], ["donald-judd", "written by"], ["wholeness", "argues for"], ["anti-illusion", "argues for"]],
  },
  {
    id: "stacks", type: "work", title: "The Stacks", start: 1965, end: 1994,
    content:
      "Identical boxes projecting from the wall at equal intervals, climbing floor to ceiling—galvanized iron, anodized aluminum, copper, colored Plexiglas. The interval of empty wall is as much the work as the metal. Begun in 1965 and made for the rest of his life, the Stacks are Judd's clearest statement that order need not mean composition.",
    edges: [["donald-judd", "made by"], ["seriality", "exemplifies"], ["industrial-fabrication", "made through"], ["bernstein-brothers", "fabricated by"]],
  },
  {
    id: "progressions", type: "work", title: "The Progressions", start: 1964, end: 1994,
    content:
      "Horizontal wall works whose solids and voids follow mathematical sequences—arithmetic, Fibonacci, inverse-natural. Judd let a number, not his taste, decide the spacing, removing the artist's hand from composition while keeping the result exact and physical.",
    edges: [["donald-judd", "made by"], ["seriality", "exemplifies"], ["anti-illusion", "embodies"]],
  },
  {
    id: "untitled-aluminum", type: "work", title: "100 untitled works in mill aluminum", start: 1982, end: 1986,
    lat: 30.293, lon: -104.030, place: "Chinati, Marfa",
    content:
      "One hundred aluminum boxes, each 41 × 51 × 72 inches on the outside, every interior different. They fill two converted artillery sheds at Chinati, walls reglazed in continuous windows. Light moves across them through the day until the metal seems to dissolve into the desert behind the glass. Judd's supreme demonstration that sameness of container makes difference visible.",
    edges: [["chinati", "installed at"], ["donald-judd", "made by"], ["seriality", "culminates"], ["permanent-installation", "defines"]],
  },
  {
    id: "untitled-concrete", type: "work", title: "15 untitled works in concrete", start: 1980, end: 1984,
    lat: 30.298, lon: -104.024, place: "Chinati, Marfa",
    content:
      "Fifteen groups of concrete boxes marching a kilometer across the Chinati grassland, parallel to the road. Each unit is 2.5 metres cubed; the groupings shift, but the desert and sky never let you forget the scale. Land art's openness meets Judd's exactitude.",
    edges: [["chinati", "installed at"], ["donald-judd", "made by"], ["permanent-installation", "defines"], ["marfa", "sited in"]],
  },
  {
    id: "judd-furniture", type: "work", title: "Furniture & Design", start: 1973, end: 1994,
    content:
      "Chairs, tables, beds, desks—designed first for his own family and houses, later produced in editions. Judd insisted furniture was not art and art was not furniture: a chair answers to the body, an object answers only to itself. Yet both share his materials and his refusal of the superfluous.",
    edges: [["donald-judd", "designed by"], ["the-block", "furnished"], ["industrial-fabrication", "made through"]],
  },
  {
    id: "complete-writings", type: "work", title: "Complete Writings 1959–1975", start: 1975,
    content:
      "The collected criticism and essays—terse, exacting, often combative. Judd reviewed hundreds of shows for Arts Magazine and ARTnews, building in prose the same standards he built in metal. The book remains a primary text for understanding postwar American art from the inside.",
    edges: [["donald-judd", "written by"], ["arts-magazine", "drawn from"], ["specific-objects", "includes"]],
  },

  // ---- PLACES -----------------------------------------------------------
  {
    id: "excelsior-springs", type: "place", title: "Excelsior Springs, Missouri", start: 1928,
    lat: 39.3392, lon: -94.2261, place: "Missouri",
    content:
      "Judd's birthplace, a Missouri spa town. The family moved often through his Midwestern childhood—Nebraska, then New Jersey—before the army and New York. The flat, plain geometry of the American interior never quite left his work.",
    edges: [["donald-judd", "birthplace of"]],
  },
  {
    id: "korea", type: "place", title: "Korea", start: 1946, end: 1947,
    lat: 37.55, lon: 126.99, place: "Korea",
    content:
      "Judd served in the U.S. Army Corps of Engineers in occupied Korea, 1946–47, before the war. The engineering discipline—drawings, tolerances, things built to spec by other hands—prefigured how he would one day make art: by specification, fabricated industrially.",
    edges: [["donald-judd", "shaped"], ["industrial-fabrication", "foreshadowed"]],
  },
  {
    id: "columbia", type: "institution", title: "Columbia University", start: 1948, end: 1962,
    lat: 40.8075, lon: -73.9626, place: "New York",
    content:
      "Judd took a philosophy degree (1953) and studied art history at Columbia under Meyer Schapiro and Rudolf Wittkower, while learning to paint at the Art Students League. Philosophy gave him the habit of first principles; art history gave him enemies to argue with.",
    edges: [["donald-judd", "educated"], ["nyc", "in"]],
  },
  {
    id: "nyc", type: "place", title: "New York City", start: 1948,
    lat: 40.7223, lon: -74.0006, place: "SoHo, New York",
    content:
      "Judd's base from the late 1940s: Columbia, the Art Students League, the critics' desks, the downtown galleries, and finally SoHo, where he bought a building and reinvented how art is kept. New York is where Judd the painter became Judd the maker of objects.",
    edges: [["101-spring", "contains"], ["columbia", "home to"], ["green-gallery", "home to"], ["donald-judd", "formed"]],
  },
  {
    id: "101-spring", type: "place", title: "101 Spring Street", start: 1968,
    lat: 40.7223, lon: -74.0006, place: "SoHo, New York",
    content:
      "A five-storey cast-iron building Judd bought in 1968 for $68,000. He installed his and others' work floor by floor and left it fixed—the birth of his idea of permanent installation, where the placement of a work is part of the work. Restored by Judd Foundation, it stands today exactly as he arranged it.",
    edges: [["donald-judd", "inhabited by"], ["permanent-installation", "birthplace of"], ["judd-foundation", "preserved by"], ["nyc", "in"]],
  },
  {
    id: "marfa", type: "place", title: "Marfa, Texas", start: 1971, end: 1994,
    lat: 30.3094, lon: -104.0207, place: "West Texas",
    content:
      "A high-desert ranching town near the Mexican border. Judd first leased buildings here in 1971 and moved permanently in 1977, acquiring an army fort, ranch land, and half a downtown—all to install art at the scale and permanence galleries could never give. He turned a remote town into a destination and a discipline.",
    edges: [["donald-judd", "remade by"], ["chinati", "contains"], ["the-block", "contains"], ["untitled-concrete", "holds"], ["permanent-installation", "realized at"]],
  },
  {
    id: "the-block", type: "place", title: "The Block (La Mansana de Chinati)", start: 1973, end: 1994,
    lat: 30.3055, lon: -104.0180, place: "Marfa, Texas",
    content:
      "Judd's own walled compound in Marfa—two former army hangars and a city block enclosed by an adobe wall. His library, his furniture, his living arrangements and art, all kept as he left them. The most personal of the permanent installations: a portrait of a mind in adobe and metal.",
    edges: [["donald-judd", "home of"], ["marfa", "within"], ["judd-furniture", "holds"], ["judd-foundation", "preserved by"]],
  },

  // ---- INSTITUTIONS -----------------------------------------------------
  {
    id: "chinati", type: "institution", title: "Chinati Foundation", start: 1986,
    lat: 30.2930, lon: -104.0300, place: "Marfa, Texas",
    content:
      "Founded by Judd in 1986 on the former Fort D.A. Russell, Chinati exists for one radical idea: large-scale work installed permanently, in spaces designed for it, in dialogue with the land. It holds Judd's 100 aluminum and 15 concrete works alongside permanent installations by Flavin, Chamberlain, and others—a museum that refuses to rotate.",
    edges: [["donald-judd", "founded by"], ["untitled-aluminum", "holds"], ["untitled-concrete", "holds"], ["dan-flavin", "holds work by"], ["john-chamberlain", "holds work by"], ["permanent-installation", "institutionalizes"], ["dia", "split from"]],
  },
  {
    id: "judd-foundation", type: "institution", title: "Judd Foundation", start: 1996,
    content:
      "Established after Judd's death to maintain his permanently installed spaces and writings—101 Spring Street in New York and the Marfa properties. Led by his children, it preserves not just objects but their exact placement, the part of the work Judd cared about most.",
    edges: [["101-spring", "preserves"], ["the-block", "preserves"], ["flavin-judd", "led by"], ["rainer-judd", "led by"]],
  },
  {
    id: "green-gallery", type: "institution", title: "Green Gallery", start: 1963,
    lat: 40.7616, lon: -73.9719, place: "57th Street, New York",
    content:
      "Richard Bellamy's 57th Street gallery, where in December 1963 Judd held his first solo show of three-dimensional work—reliefs and floor pieces that announced the end of his painting and the start of the objects. The breakthrough that 'Specific Objects' would explain two years later.",
    edges: [["donald-judd", "launched"], ["specific-objects", "preceded"], ["nyc", "in"]],
  },
  {
    id: "dia", type: "institution", title: "Dia Art Foundation", start: 1979, end: 1986,
    content:
      "The foundation that first funded Judd's Marfa ambitions, underwriting the army-fort acquisition and the aluminum installations from 1979. When Dia's support faltered in the mid-1980s, Judd broke away and founded Chinati to secure the work permanently—independence bought at the price of a patron.",
    edges: [["chinati", "preceded"], ["marfa", "funded work in"], ["donald-judd", "patron of"]],
  },
  {
    id: "arts-magazine", type: "institution", title: "Arts Magazine", start: 1959, end: 1965,
    content:
      "The journal where Judd worked as a critic from 1959 to 1965, reviewing the New York scene with a severity that made his reputation in words before metal. His criticism and his art shared one standard: no illusion, no fakery, no inherited hierarchy.",
    edges: [["donald-judd", "employed"], ["complete-writings", "source of"], ["specific-objects", "published adjacent to"]],
  },

  // ---- IDEAS ------------------------------------------------------------
  {
    id: "minimalism", type: "concept", title: "Minimalism", start: 1965,
    content:
      "The label critics fixed on Judd, Andre, Flavin, LeWitt, and Morris—reductive geometry, industrial materials, serial order. Judd hated the word: it implied less rather than specific, and a shared program where he saw only individual objects. The term won anyway, and he spent a career correcting it.",
    edges: [["donald-judd", "labeled"], ["specific-objects", "named by critics from"], ["seriality", "characterized by"]],
  },
  {
    id: "permanent-installation", type: "concept", title: "Permanent Installation", start: 1968,
    content:
      "Judd's most consequential idea: that where a work sits, and for how long, is part of the work. Against the rotating museum and the temporary show, he argued for spaces built around art and left unchanged. It governs 101 Spring Street, The Block, and all of Chinati—and reshaped how institutions think about installation.",
    edges: [["101-spring", "first realized at"], ["chinati", "institutionalized by"], ["donald-judd", "argued by"]],
  },
  {
    id: "seriality", type: "concept", title: "Seriality & Repetition", start: 1964,
    content:
      "One unit, repeated by rule rather than arranged by taste. Judd used division, progression, and 'one thing after another' to escape relational composition—the European habit of balancing parts. Repetition with an interval makes both the object and the space between objects visible.",
    edges: [["stacks", "structures"], ["progressions", "structures"], ["untitled-aluminum", "structures"], ["minimalism", "central to"]],
  },
  {
    id: "industrial-fabrication", type: "concept", title: "Industrial Fabrication", start: 1964,
    content:
      "Judd did not make his objects by hand; he specified them, and metalworkers built them. The decision removed the artist's touch and the aura of craft, letting the idea and the material stand without a maker's signature. The fabricator was a collaborator, the drawing a score.",
    edges: [["bernstein-brothers", "carried out by"], ["stacks", "produces"], ["donald-judd", "method of"], ["anti-illusion", "supports"]],
  },
  {
    id: "wholeness", type: "concept", title: "Wholeness", start: 1965,
    content:
      "Judd wanted an object grasped all at once—a single whole, not a composition assembled from relating parts. 'A work needs only to be interesting,' he wrote; what made it interesting was its undivided thereness. Wholeness is why his boxes have no front, no hierarchy, no story.",
    edges: [["barnett-newman", "learned from"], ["specific-objects", "argued in"], ["anti-illusion", "allied with"]],
  },
  {
    id: "anti-illusion", type: "concept", title: "Anti-Illusionism", start: 1962,
    content:
      "Painting's original sin, for Judd, was illusion—depth where there is only surface, space where there is only canvas. His objects answer with literal space: the volume is actual, the void is actual, the metal is exactly itself. What you see is what is there.",
    edges: [["specific-objects", "core of"], ["frank-stella", "shared with"], ["wholeness", "allied with"]],
  },
  {
    id: "color", type: "concept", title: "Color", start: 1984, end: 1994,
    content:
      "Color was Judd's last great problem. In his final decade he made works in dozens of saturated hues—enameled aluminum, colored Plexiglas—treating color as a material with structure, not decoration. The late color works argue that even color can be specific: a fact, not an effect.",
    edges: [["donald-judd", "late pursuit of"], ["stacks", "applied in"], ["industrial-fabrication", "realized through"]],
  },

  // ---- A few connective nodes ------------------------------------------
  {
    id: "bernstein-brothers", type: "institution", title: "Bernstein Brothers", start: 1964, end: 1994,
    lat: 40.7505, lon: -73.9410, place: "New York",
    content:
      "The Long Island City sheet-metal shop that fabricated Judd's works for decades. The partnership between artist and metalworkers—drawings exchanged, tolerances held—was the hidden engine of the objects. Without Bernstein Brothers there are no Stacks.",
    edges: [["donald-judd", "fabricated for"], ["stacks", "built"], ["industrial-fabrication", "embodied"]],
  },

  // ---- MOMENTS (time anchors) ------------------------------------------
  {
    id: "moment-1963", type: "event", title: "First Objects—Green Gallery", start: 1963,
    content:
      "December 1963: Judd's first solo show of three-dimensional work opens at the Green Gallery. The paintings are over; the objects have begun. Critics don't yet have a word for what they're seeing.",
    edges: [["green-gallery", "held at"], ["donald-judd", "turning point for"], ["specific-objects", "two years before"]],
  },
  {
    id: "moment-1968", type: "event", title: "Buys 101 Spring Street", start: 1968,
    content:
      "1968: Judd buys a cast-iron building in then-industrial SoHo and begins to install art permanently inside it. The single decision that will eventually pull him toward Marfa and toward a whole new idea of how art is kept.",
    edges: [["101-spring", "founds"], ["permanent-installation", "begins"], ["donald-judd", "for"]],
  },
  {
    id: "moment-1994", type: "event", title: "Death in New York", start: 1994,
    content:
      "12 February 1994: Judd dies of lymphoma in New York at 65. He leaves behind not just objects but two preserved cities of them, a foundation to keep them fixed, and an argument about art that institutions are still catching up to.",
    edges: [["donald-judd", "ends"], ["judd-foundation", "two years before"], ["chinati", "leaves behind"]],
  },
];

// Build a fast lookup + reciprocal adjacency for traversal in the UI.
export function buildIndex(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = [];
  const adj = new Map(nodes.map((n) => [n.id, new Set()]));
  for (const n of nodes) {
    for (const [target, relation] of n.edges || []) {
      if (!byId.has(target)) continue;
      links.push({ source: n.id, target, relation });
      adj.get(n.id).add(target);
      adj.get(target).add(n.id);
    }
  }
  return { byId, links, adj };
}

// The full time span the atlas covers.
export const TIME_MIN = 1905;
export const TIME_MAX = 2020;
