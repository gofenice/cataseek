/* global React, ReactDOM */
const { useState, useEffect, useMemo, useRef } = React;

// The Cataseek app (login / signup / dashboard).
// Local dev: http://localhost:3000 — Production: change to your app subdomain, e.g. "https://app.yourdomain.com"
const DASHBOARD_URL = "http://localhost:3000";

/* ============================================================
   TWEAK DEFAULTS
   ============================================================ */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#C0E457",
  "accentMode": "lime",
  "headlineStyle": "sans"
}/*EDITMODE-END*/;

const ACCENT_PRESETS = {
  lime:    { value: "#C0E457", label: "Lime"   },
  ember:   { value: "#FF6A3D", label: "Ember"  },
  cobalt:  { value: "#3D6AFF", label: "Cobalt" },
  sand:    { value: "#E9D7A2", label: "Sand"   }
};

/* ============================================================
   LOGO
   ============================================================ */
const Logo = ({ size = 22, color }) => (
  /* light pages use the dark wordmark; pass any `color` to get the white variant (dark footer) */
  <img src={color ? "logo-white.png" : "logo.png"} alt="Cataseek" style={{ height: size, display: "block" }} />
);

/* ============================================================
   ICONS (small, single-stroke)
   ============================================================ */
const Icon = {
  arrow: (p) => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...p}>
      <path d="M3 7h8m-3-3 3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  check: (p) => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...p}>
      <path d="m3 7.5 2.5 2.5L11 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  plus: (p) => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...p}>
      <path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  bolt: (p) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" {...p}>
      <path d="M9 1 3 9h4l-1 6 6-8H8l1-6Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
    </svg>
  ),
  device: (p) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" {...p}>
      <rect x="2" y="3" width="9" height="10" rx="1.2" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="9" y="6" width="5" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.4" fill="var(--card)"/>
    </svg>
  ),
  brain: (p) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" {...p}>
      <circle cx="5" cy="8" r="3" stroke="currentColor" strokeWidth="1.4"/>
      <circle cx="11" cy="8" r="3" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M5 5v6M11 5v6" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  chart: (p) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" {...p}>
      <path d="M2 13h12M4 11V7m3 4V4m3 7V8m3 3V6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  filter: (p) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" {...p}>
      <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  layers: (p) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" {...p}>
      <path d="m8 2 6 3-6 3-6-3 6-3ZM2 11l6 3 6-3M2 8l6 3 6-3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
    </svg>
  ),
  shield: (p) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" {...p}>
      <path d="M8 1 3 3v5c0 3 2.5 5.5 5 7 2.5-1.5 5-4 5-7V3L8 1Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
    </svg>
  ),
  search: (p) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" {...p}>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  close: (p) => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...p}>
      <path d="m3 3 6 6m0-6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
};

/* ============================================================
   NAV
   ============================================================ */
const Nav = () => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div className={"nav-shell" + (scrolled ? " scrolled" : "")}>
      <div className="wrap nav">
        <Logo />
        <div className="nav-links">
          <a className="nav-link">Features</a>
          <a className="nav-link">Pricing</a>
          <a className="nav-link">Integrations</a>
          <a className="nav-link">Docs</a>
          <a className="nav-link">Changelog</a>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <a href={DASHBOARD_URL + "/login"} className="btn btn-ghost" style={{ padding: "8px 12px" }}>Sign in</a>
          <a href={DASHBOARD_URL + "/register"} className="btn btn-primary">Start free trial</a>
        </div>
      </div>
    </div>
  );
};

/* ============================================================
   HERO + LIVE SEARCH DEMO
   ============================================================ */
const IMG = (id, w = 320) => `https://images.unsplash.com/photo-${id}?w=${w}&auto=format&fit=crop&q=80`;

const SAMPLE_PRODUCTS = [
  { name: "Linen Camp Shirt — Sand",  price: "€48",  tag: "Apparel",   stock: "In stock",  img: IMG("1620799140408-edc6dcb6d633"), sizes: ["XS","S","M"],     colors: ["sand"]   },
  { name: "Linen Camp Shirt — Olive", price: "€48",  tag: "Apparel",   stock: "In stock",  img: IMG("1591047139829-d91aecb6caea"), sizes: ["S","M","L","XL","2XL"], colors: ["olive"]  },
  { name: "Linen Trouser — Bone",     price: "€72",  tag: "Apparel",   stock: "Low stock", img: IMG("1594633312681-425c7b97ccd1"), sizes: ["M","L"],         colors: ["bone"]   },
  { name: "Linen Wrap Dress",         price: "€118", tag: "Apparel",   stock: "In stock",  img: IMG("1490481651871-ab68de25d43d"), sizes: ["S","M"],          colors: ["ecru"]   },
  { name: "Cream Knit Sweater",       price: "€96",  tag: "Apparel",   stock: "In stock",  img: IMG("1612722432474-b971cdcea546"), sizes: ["S","M","L"],     colors: ["cream"]  },
  { name: "Wide-leg Trouser",         price: "€72",  tag: "Apparel",   stock: "In stock",  img: IMG("1434389677669-e08b4cac3105"), sizes: ["S","M","L","2XL"], colors: ["black"]  },
  { name: "Linen Tunic — Ecru",       price: "€86",  tag: "Apparel",   stock: "In stock",  img: IMG("1521572163474-6864f9cf17ab"), sizes: ["L","XL","2XL"],     colors: ["ecru"]   },
  { name: "Linen Set — Olive",        price: "€120", tag: "Apparel",   stock: "Low stock", img: IMG("1602810318383-e386cc2a3ccf"), sizes: ["S","M"],          colors: ["olive"]  },
  { name: "Linen Bucket Hat",         price: "€32",  tag: "Accessory", stock: "In stock",  img: IMG("1556306535-38febf6782e7"),    sizes: ["OS"],             colors: ["sand"]   },
  { name: "Cotton Tote — Natural",    price: "€18",  tag: "Accessory", stock: "In stock",  img: IMG("1597481499750-3e6b22637e12"), sizes: ["OS"],             colors: ["ecru"]   },
  { name: "Wool Beanie — Stone",      price: "€28",  tag: "Accessory", stock: "In stock",  img: IMG("1576871337622-98d48d1cf531"), sizes: ["OS"],             colors: ["stone"]  },
  { name: "Leather Belt — Tan",       price: "€54",  tag: "Accessory", stock: "In stock",  img: IMG("1624222247344-550fb60583dc"), sizes: ["S","M","L"],     colors: ["tan"]    }
];

const SAMPLE_SUGGESTIONS = ["linen shirt", "linen trousers", "linen bucket hat", "linen tote", "olive set", "size m"];
const SAMPLE_CATEGORIES  = ["Apparel · 124", "Accessories · 38", "Sale · 21"];

// Cycles through three different intents — keyword, color, size — to show Cataseek matches across attributes.
const TYPED_QUERIES = [
  { q: "linen", label: "keyword" },
  { q: "olive", label: "colour"  },
  { q: "2XL",   label: "size"    }
];

const SearchDemo = () => {
  const [typed, setTyped] = useState("");
  const [queryIdx, setQueryIdx] = useState(0);
  const [showCursor, setShowCursor] = useState(true);

  // Type animation cycles through TYPED_QUERIES
  useEffect(() => {
    let i = 0;
    let dir = 1;
    let qi = 0;
    let timer;
    const tick = () => {
      const target = TYPED_QUERIES[qi].q;
      i += dir;
      if (i > target.length) {
        dir = -1;
        i = target.length;
        timer = setTimeout(tick, 2200);
        return;
      }
      if (i < 0) {
        dir = 1;
        i = 0;
        qi = (qi + 1) % TYPED_QUERIES.length;
        setQueryIdx(qi);
        timer = setTimeout(tick, 600);
        return;
      }
      setTyped(target.slice(0, i));
      timer = setTimeout(tick, dir > 0 ? 130 : 80);
    };
    tick();
    const blink = setInterval(() => setShowCursor(s => !s), 500);
    return () => { clearTimeout(timer); clearInterval(blink); };
  }, []);

  const queryLabel = TYPED_QUERIES[queryIdx].label;

  // Match logic: query against name, color words, and sizes (sizes are case-insensitive exact tokens)
  const isMatchProduct = (p, q) => {
    if (!q) return true;
    const ql = q.toLowerCase();
    if (p.name.toLowerCase().includes(ql)) return true;
    if (p.colors && p.colors.some(c => c.includes(ql))) return true;
    if (p.sizes && p.sizes.some(s => s.toLowerCase() === ql)) return true;
    return false;
  };

  const matches = useMemo(() => {
    if (!typed) return [];
    return SAMPLE_PRODUCTS.filter(p => isMatchProduct(p, typed)).slice(0, 4);
  }, [typed]);

  const matchedSuggestions = useMemo(() => {
    if (!typed) return [];
    const ql = typed.toLowerCase();
    return SAMPLE_SUGGESTIONS.filter(s => s.includes(ql)).slice(0, 3);
  }, [typed]);

  const isMatch = (p) => isMatchProduct(p, typed);
  const matchCount = useMemo(() => SAMPLE_PRODUCTS.filter(isMatch).length, [typed]);
  const firstMatchIdx = useMemo(() => SAMPLE_PRODUCTS.findIndex(isMatch), [typed]);

  return (
    <div className="browser" style={{ position: "relative" }}>
      <div className="browser-bar">
        <div className="browser-dots"><i/><i/><i/></div>
        <div className="browser-url">store.example.com</div>
        <div style={{ width: 60 }}/>
      </div>

      {/* faux store header */}
      <div style={{
        padding: "12px 18px",
        display: "flex", alignItems: "center", gap: 14,
        borderBottom: "1px solid var(--line)",
        background: "#FFFFFF"
      }}>
        <div style={{ fontFamily: "Instrument Serif, serif", fontStyle: "italic", fontSize: 18, letterSpacing: "-0.01em" }}>
          Maison Linen
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--ink-2)" }}>
          <span>New</span><span>Apparel</span><span>Home</span>
        </div>
        {/* Search field */}
        <div style={{
          marginLeft: "auto",
          display: "flex", alignItems: "center", gap: 7,
          background: "var(--bg)", border: "1px solid var(--line)",
          borderRadius: 999, padding: "6px 12px", width: 220,
          fontSize: 12.5, color: "var(--ink)"
        }}>
          <Icon.search style={{ color: "var(--ink-3)" }}/>
          <span style={{ minHeight: 16 }}>{typed}<span style={{ opacity: showCursor ? 1 : 0, marginLeft: 1 }}>|</span></span>
          {!typed && <span style={{ color: "var(--ink-3)" }}>Search products…</span>}
          <span className="mono" style={{ marginLeft: "auto", fontSize: 10, color: "var(--ink-3)", border: "1px solid var(--line-2)", borderRadius: 4, padding: "0px 4px" }}>⌘K</span>
        </div>
      </div>

      {/* storefront body — product grid; dropdown overlays this */}
      <div style={{
        position: "relative",
        padding: "16px 18px 20px",
        background: "#FFFFFF"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontFamily: "Instrument Serif, serif", fontStyle: "italic", fontSize: 18, letterSpacing: "-0.01em" }}>New arrivals</span>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", letterSpacing: ".05em" }}>
              {typed ? `${matchCount} of ${SAMPLE_PRODUCTS.length} match ${queryLabel} “${typed}”` : "32 styles"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "var(--ink-3)" }}>
            <span>Filter</span><span>Sort: Featured</span>
          </div>
        </div>

        {/* Catalog — fixed positions; non-matches dim. Mask the bottom so it feels like there are more rows. */}
        <div style={{
          position: "relative",
          maxHeight: 280,
          overflow: "hidden",
          WebkitMaskImage: "linear-gradient(to bottom, #000 65%, rgba(0,0,0,0.18) 92%, rgba(0,0,0,0))",
          maskImage: "linear-gradient(to bottom, #000 65%, rgba(0,0,0,0.18) 92%, rgba(0,0,0,0))"
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {SAMPLE_PRODUCTS.map((t, idx) => {
              const matched = isMatch(t);
              const isTop = typed && idx === firstMatchIdx;
              return (
                <div
                  key={t.name}
                  style={{
                    transition: "opacity .35s ease, filter .35s ease",
                    opacity: matched ? 1 : 0.18,
                    filter: matched ? "none" : "grayscale(0.6)"
                  }}
                >
                  <div style={{
                    aspectRatio: "4/5",
                    background: `#F1EEE4 url(${t.img}) center/cover no-repeat`,
                    borderRadius: 5,
                    position: "relative",
                    overflow: "hidden",
                    outline: isTop ? "2px solid var(--accent)" : "none",
                    outlineOffset: isTop ? 1 : 0
                  }}>
                    {isTop && (
                      <span style={{
                        position: "absolute", top: 4, left: 4,
                        background: "var(--accent)", color: "var(--accent-ink)",
                        fontFamily: "Geist Mono, monospace", fontSize: 8.5,
                        letterSpacing: ".06em", textTransform: "uppercase",
                        padding: "1px 4px", borderRadius: 999,
                        lineHeight: 1.4
                      }}>Top</span>
                    )}
                  </div>
                  <div style={{ marginTop: 5, display: "flex", justifyContent: "space-between", fontSize: 10.5, gap: 4 }}>
                    <span style={{ color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
                      {typed && matched
                        ? t.name.split(new RegExp(`(${typed})`, 'i')).map((part, i) => (
                            part.toLowerCase() === typed.toLowerCase()
                              ? <span key={i} style={{ background: "var(--accent)", padding: "0 2px", borderRadius: 3 }}>{part}</span>
                              : <span key={i}>{part}</span>
                          ))
                        : t.name}
                    </span>
                    <span style={{ color: "var(--ink-2)", flexShrink: 0 }}>{t.price}</span>
                  </div>
                  <div style={{ marginTop: 3, display: "flex", gap: 3, alignItems: "center", minHeight: 14 }}>
                    {t.sizes.map(s => {
                      const sizeMatch = matched && typed && s.toLowerCase() === typed.toLowerCase();
                      return (
                        <span key={s} className="mono" style={{
                          fontSize: 8.5,
                          letterSpacing: ".04em",
                          padding: "1px 4px",
                          borderRadius: 3,
                          border: "1px solid var(--line-2)",
                          color: sizeMatch ? "var(--accent-ink)" : "var(--ink-3)",
                          background: sizeMatch ? "var(--accent)" : "transparent",
                          borderColor: sizeMatch ? "var(--accent)" : "var(--line-2)",
                          lineHeight: 1.3
                        }}>{s}</span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Dropdown — overlays the grid, anchored to the search field */}
        {matches.length > 0 && (
          <div style={{
            position: "absolute", right: 18, top: -14,
            width: 320,
            background: "#fff", border: "1px solid var(--line)",
            borderRadius: 12, boxShadow: "var(--shadow-lg)",
            overflow: "hidden",
            zIndex: 5
          }}>
            <div style={{ padding: "6px 0" }}>
              <div className="mono" style={{ fontSize: 10, color: "var(--ink-3)", letterSpacing: ".06em", textTransform: "uppercase", padding: "6px 12px 4px" }}>
                Products · {matches.length}
              </div>
              {matches.slice(0, 3).map((p, idx) => (
                <div key={p.name} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "7px 12px",
                  background: idx === 0 ? "rgba(192,228,87,0.18)" : "transparent",
                  borderLeft: idx === 0 ? "2px solid var(--accent)" : "2px solid transparent"
                }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 5,
                    backgroundImage: `url(${p.img})`,
                    backgroundSize: "cover", backgroundPosition: "center",
                    border: "1px solid rgba(14,14,12,0.08)"
                  }}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: "-0.005em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.name.split(new RegExp(`(${typed})`, 'i')).map((part, i) => (
                        part.toLowerCase() === typed.toLowerCase()
                          ? <span key={i} style={{ background: "var(--accent)", padding: "0 2px", borderRadius: 3 }}>{part}</span>
                          : <span key={i}>{part}</span>
                      ))}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{p.tag} · {p.stock}</div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{p.price}</div>
                </div>
              ))}
              <div style={{ borderTop: "1px solid var(--line)", padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10.5, color: "var(--ink-3)" }}>
                <span>{matches.length} of 12 results</span>
                <span className="mono">↵ view all</span>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

const Hero = ({ headlineStyle }) => (
  <section style={{ paddingTop: 56, paddingBottom: 56 }}>
    <div className="wrap hero-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1.05fr", gap: 56, alignItems: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 540 }}>
        <span className="eyebrow"><span className="dot"/>v1.0 · Now in public beta</span>
        <h1 style={{
          fontSize: "clamp(38px, 4.6vw, 64px)",
          margin: 0, letterSpacing: "-0.035em", lineHeight: 1.0,
          fontWeight: 500
        }}>
          Search that <br/>
          {headlineStyle === "serif"
            ? <span className="serif-i" style={{ fontWeight: 400 }}>actually sells.</span>
            : <span style={{ fontWeight: 500 }}>actually <span style={{ color: "var(--ink-3)" }}>sells.</span></span>
          }
        </h1>
        <p style={{ fontSize: 16.5, color: "var(--ink-2)", maxWidth: 480, margin: 0, lineHeight: 1.5 }}>
          Cataseek is a drop-in product search for your store. Instant results, smart typo handling,
          and a design that fits your brand — installed in under a minute.
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
          <a href={DASHBOARD_URL + "/register"} className="btn btn-primary btn-lg">Start 14-day free trial <Icon.arrow/></a>
          <a href={DASHBOARD_URL + "/login"} className="btn btn-outline btn-lg">Sign in</a>
        </div>
        <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
          No credit card · Cancel anytime
        </span>
      </div>
      <SearchDemo />
    </div>
    <style>{`
      @media (max-width: 760px) {
        .hero-grid { grid-template-columns: 1fr !important; gap: 36px !important; }
      }
    `}</style>
  </section>
);

/* ============================================================
   INTEGRATIONS STRIP
   ============================================================ */
const Integrations = () => {
  const live = [
    { name: "WooCommerce", status: "Live" },
    { name: "PrestaShop",  status: "Live" }
  ];
  const soon = [
    { name: "Shopify",     status: "Q3 2026" },
    { name: "Magento",     status: "Q3 2026" },
    { name: "BigCommerce", status: "Q4 2026" },
    { name: "OpenCart",    status: "Q4 2026" }
  ];

  return (
    <section style={{ padding: "48px 0" }}>
      <div className="wrap" style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 24, flexWrap: "wrap" }}>
          <span className="eyebrow"><span className="dot"/>Built for your stack</span>
          <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>2 platforms live · 4 in roadmap</span>
        </div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(6, 1fr)", gap: 0, border: "1px solid var(--line)", borderRadius: "var(--r-lg)", background: "var(--card)", overflow: "hidden" }}>
          {[...live, ...soon].map((p, i) => (
            <div key={p.name} style={{
              padding: "26px 22px",
              borderRight: i < 5 ? "1px solid var(--line)" : "none",
              display: "flex", flexDirection: "column", gap: 10,
              minHeight: 120,
              position: "relative"
            }}>
              <PlatformGlyph name={p.name}/>
              <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 14, fontWeight: 500, letterSpacing: "-0.005em" }}>{p.name}</div>
                <div className="mono" style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase",
                  color: p.status === "Live" ? "var(--ink)" : "var(--ink-3)"
                }}>
                  {p.status === "Live"
                    ? <><span style={{ display: "inline-block", width: 6, height: 6, background: "var(--accent)", borderRadius: 999, marginRight: 6, verticalAlign: 1 }}/>Live</>
                    : <>Coming · {p.status}</>
                  }
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

/* Abstract platform glyphs (NOT brand logos — original wordmark fragments) */
const PlatformGlyph = ({ name }) => {
  const initial = name[0];
  return (
    <div style={{
      width: 32, height: 32, borderRadius: 8,
      border: "1px solid var(--line)",
      background: "var(--bg-2)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "Geist Mono, monospace", fontSize: 14, fontWeight: 500,
      color: "var(--ink)"
    }}>
      {initial}
    </div>
  );
};

/* ============================================================
   FEATURES
   ============================================================ */
const FEATURES = [
  { icon: "bolt",   tag: "01 / Speed",      title: "Sub-50ms results",        body: "Edge-cached index responds before the user finishes typing — even on catalogues over 100k SKUs." },
  { icon: "brain",  tag: "02 / Relevance",  title: "Typo & synonym smart",    body: "Built-in tolerance for misspellings, plurals and language variants. Train custom synonyms in one click." },
  { icon: "device", tag: "03 / Mobile",     title: "Native on every device",  body: "Full-screen overlay on mobile, inline dropdown on desktop, with hit-area sizes that pass WCAG out of the box." },
  { icon: "filter", tag: "04 / Refinement", title: "Faceted on the fly",      body: "Price, stock, category and custom attributes filter the result set instantly — no page reload, no skeletons." },
  { icon: "chart",  tag: "05 / Insight",    title: "Search analytics",        body: "See zero-result queries, trending terms and conversion per query. Find demand your catalogue is missing." },
  { icon: "layers", tag: "06 / Theming",    title: "Pixel-fits any theme",    body: "CSS variables for every surface. The default looks great; the override layer stays out of your way." }
];

const Features = () => (
  <section id="features">
    <div className="wrap">
      <div className="section-head">
        <span className="eyebrow"><span className="dot"/>What you ship</span>
        <h2>Six things you'd <span className="serif-i">otherwise build yourself</span>.</h2>
        <p>Everything teams ask us to add first — already in the box. Toggle off what you don't need.</p>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {FEATURES.map(f => {
          const Ico = Icon[f.icon];
          return (
            <div key={f.title} style={{
              border: "1px solid var(--line)",
              borderRadius: "var(--r-lg)",
              background: "var(--card)",
              padding: 26,
              display: "flex", flexDirection: "column", gap: 14,
              minHeight: 220
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8,
                  border: "1px solid var(--line)",
                  background: "var(--bg)",
                  display: "flex", alignItems: "center", justifyContent: "center"
                }}>
                  <Ico/>
                </div>
                <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)", letterSpacing: ".06em" }}>{f.tag}</span>
              </div>
              <div style={{ marginTop: 8 }}>
                <h3 style={{ fontSize: 18, margin: "0 0 8px", letterSpacing: "-0.015em", fontWeight: 500 }}>{f.title}</h3>
                <p style={{ fontSize: 14.5, color: "var(--ink-2)", margin: 0, lineHeight: 1.5 }}>{f.body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  </section>
);

/* ============================================================
   HOW IT WORKS
   ============================================================ */
const Steps = () => {
  const steps = [
    { n: "01", title: "Install the plugin",   body: "One-click from the WooCommerce or PrestaShop marketplace. Your store keeps running." },
    { n: "02", title: "Cataseek builds the index", body: "Catalogue is mirrored to our edge index in minutes. Webhooks keep it in sync forever." },
    { n: "03", title: "Drop in the search bar", body: "Replace your default search with a single shortcode or block. Theme variables do the rest." }
  ];
  return (
    <section style={{ background: "var(--bg-2)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow"><span className="dot"/>How it works</span>
          <h2>Live on your store in <span className="serif-i">under a minute</span>.</h2>
        </div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          {steps.map((s, i) => (
            <div key={s.n} style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 24, borderTop: "1px solid var(--line-2)", position: "relative" }}>
              <div style={{ position: "absolute", top: -1, left: 0, height: 1, background: "var(--ink)", width: i === 0 ? 60 : 0 }}/>
              <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)", letterSpacing: ".06em" }}>{s.n}</span>
              <h3 style={{ fontSize: 22, margin: 0, letterSpacing: "-0.02em", fontWeight: 500 }}>{s.title}</h3>
              <p style={{ color: "var(--ink-2)", margin: 0, fontSize: 15 }}>{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

/* ============================================================
   PRICING
   ============================================================ */
const PLANS = [
  {
    name: "Starter",
    blurb: "For new stores finding their first 1,000 customers.",
    price: 19,
    cta: "Start free trial",
    featured: false,
    feats: [
      "Up to 5,000 SKUs",
      "10,000 searches / month",
      "WooCommerce or PrestaShop",
      "Standard relevance & typo tolerance",
      "Email support"
    ]
  },
  {
    name: "Growth",
    blurb: "Most popular — built for stores doing real volume.",
    price: 49,
    cta: "Start free trial",
    featured: true,
    feats: [
      "Up to 50,000 SKUs",
      "100,000 searches / month",
      "Search analytics dashboard",
      "Custom synonyms & merchandising",
      "Priority support"
    ]
  },
  {
    name: "Scale",
    blurb: "For multi-store operations and high-traffic catalogues.",
    price: 129,
    cta: "Talk to us",
    featured: false,
    feats: [
      "Unlimited SKUs",
      "Unlimited searches",
      "Multi-store / multi-region index",
      "SLA + 99.99% uptime",
      "Dedicated CSM"
    ]
  }
];

const CURRENCY_SYMBOLS = { INR: "₹", USD: "$", EUR: "€", GBP: "£", AED: "د.إ", SGD: "S$" };

// Format 29.99 → "29.99", 30.00 → "30"
const fmtPrice = (n) => {
  const num = Number(n);
  return Number.isInteger(num) ? String(num) : num.toFixed(2);
};

const Pricing = () => {
  // Live plans from the Cataseek app — falls back to the static PLANS if the API is unreachable
  const [livePlans, setLivePlans] = useState(null);
  const [currency, setCurrency] = useState("USD");

  useEffect(() => {
    fetch(DASHBOARD_URL + "/api/plans/plans")
      .then(r => r.json())
      .then(data => {
        if (!data.plans || data.plans.length === 0) return;
        if (data.currency) setCurrency(data.currency);
        const parseFeats = (f) => { try { return Array.isArray(f) ? f : JSON.parse(f || "[]"); } catch { return []; } };
        setLivePlans(data.plans.map((p, i) => ({
          name: p.name,
          blurb: p.description || "",
          price: Number(p.price),
          period: p.billing_period === "yearly" ? "year" : "month",
          cta: "Start free trial",
          featured: i === 1 && data.plans.length >= 3, // middle plan = highlighted
          feats: [
            `Up to ${Number(p.max_products).toLocaleString()} SKUs`,
            `${Number(p.max_requests_per_month).toLocaleString()} searches / month`,
            ...parseFeats(p.features),
          ],
        })));
      })
      .catch(() => { /* keep static fallback */ });
  }, []);

  const symbol = CURRENCY_SYMBOLS[currency] || "$";
  const plansToShow = livePlans || PLANS.map(p => ({ ...p, period: "month" }));
  const sym = livePlans ? symbol : "€";

  return (
    <section id="pricing">
      <div className="wrap">
        <div className="section-head" style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", maxWidth: "100%", flexWrap: "wrap", gap: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 640 }}>
            <span className="eyebrow"><span className="dot"/>Pricing</span>
            <h2 style={{ fontSize: "clamp(32px, 4.2vw, 48px)", margin: 0, letterSpacing: "-0.025em", lineHeight: 1.05, fontWeight: 500 }}>
              One plan per store. <span className="serif-i" style={{ color: "var(--ink-3)" }}>Cancel any month.</span>
            </h2>
          </div>
        </div>

        <div className="price-grid">
          {plansToShow.map(p => (
            <div key={p.name} className={"price-card" + (p.featured ? " featured" : "")}>
              {p.featured && <span className="feat-pill">Most popular</span>}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 14, fontWeight: 500, letterSpacing: "-0.005em" }}>{p.name}</div>
                <div style={{ fontSize: 13, color: p.featured ? "rgba(246,244,238,0.6)" : "var(--ink-3)" }}>{p.blurb}</div>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 48, letterSpacing: "-0.03em", fontWeight: 500, lineHeight: 1 }}>{sym}{fmtPrice(p.price)}</span>
                <span style={{ fontSize: 13, color: p.featured ? "rgba(246,244,238,0.6)" : "var(--ink-3)" }}>/ {p.period}</span>
              </div>
              <a href={DASHBOARD_URL + "/register"} className={p.featured ? "btn btn-accent btn-lg" : "btn btn-primary btn-lg"} style={{ justifyContent: "center" }}>
                {p.cta} <Icon.arrow/>
              </a>
              <div style={{ height: 1, background: p.featured ? "rgba(246,244,238,0.12)" : "var(--line)" }}/>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {p.feats.map(f => (
                  <li key={f} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, color: p.featured ? "rgba(246,244,238,0.85)" : "var(--ink-2)" }}>
                    <span style={{ marginTop: 4, color: p.featured ? "var(--accent)" : "var(--ink)" }}><Icon.check/></span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", marginTop: 28, color: "var(--ink-3)", fontSize: 13 }} className="mono">
          All plans include 14-day free trial · No setup fees · VAT calculated at checkout
        </div>
      </div>
    </section>
  );
};

/* ============================================================
   FAQ
   ============================================================ */
const FAQS = [
  { q: "How long does setup actually take?",
    a: "Most stores are live in under five minutes. Install the plugin, paste your API key, and the initial index build runs in the background. You can keep using your old search until you're ready to switch." },
  { q: "Will it slow down my store?",
    a: "No — Cataseek runs from your customers' nearest edge node and never blocks page rendering. The plugin itself adds about 6KB of JavaScript, loaded async." },
  { q: "What about non-English stores?",
    a: "Cataseek ships with stemmers and stopword lists for 30+ languages including French, German, Spanish, Italian, Polish and Portuguese. Multi-language stores can index per-locale." },
  { q: "Do you support PrestaShop and WooCommerce equally?",
    a: "Yes. Both plugins are first-class and ship feature parity. Other platforms — Shopify, Magento, BigCommerce, OpenCart — are on the public roadmap for 2026." },
  { q: "Can I cancel any time?",
    a: "Yes. Subscriptions are month-to-month with no lock-in. Annual plans get a 20% discount but can still be cancelled at the end of the current period." },
  { q: "What happens to my data if I cancel?",
    a: "Your index is purged within 24 hours of cancellation. We never sell or share search data, and we'll export your analytics on request." }
];

const FAQ = () => {
  const [open, setOpen] = useState(0);
  return (
    <section>
      <div className="wrap" style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 56 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, position: "sticky", top: 100, alignSelf: "start" }}>
          <span className="eyebrow"><span className="dot"/>FAQ</span>
          <h2 style={{ fontSize: "clamp(32px, 4vw, 44px)", margin: 0, letterSpacing: "-0.025em", lineHeight: 1.05, fontWeight: 500 }}>
            Questions, <br/><span className="serif-i" style={{ color: "var(--ink-3)" }}>answered.</span>
          </h2>
          <p style={{ color: "var(--ink-2)", margin: 0 }}>
            Can't find what you're looking for? <span style={{ borderBottom: "1px solid var(--ink)", cursor: "pointer" }}>Email the team →</span>
          </p>
        </div>
        <div>
          {FAQS.map((f, i) => (
            <div key={f.q} className="faq-item" onClick={() => setOpen(open === i ? -1 : i)}>
              <div className="faq-q">
                <span>{f.q}</span>
                <span style={{ color: "var(--ink-3)", transform: open === i ? "rotate(45deg)" : "none", transition: "transform .2s ease" }}>
                  <Icon.plus/>
                </span>
              </div>
              {open === i && <div className="faq-a">{f.a}</div>}
            </div>
          ))}
        </div>
      </div>
      <style>{`@media (max-width: 900px) { section .wrap[style*="grid-template-columns"] { grid-template-columns: 1fr !important; gap: 32px !important; } }`}</style>
    </section>
  );
};

/* ============================================================
   CTA
   ============================================================ */
const CTA = () => (
  <section style={{ padding: "32px 0 0" }}>
    <div className="wrap">
      <div style={{
        background: "var(--ink)", color: "var(--bg)",
        borderRadius: 22, padding: "72px 56px",
        position: "relative", overflow: "hidden"
      }}>
        <div style={{ position: "absolute", inset: 0, background:
          "radial-gradient(1200px 300px at 90% 0%, color-mix(in srgb, var(--accent) 28%, transparent), transparent 60%)" }}/>
        <div style={{ position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 36, flexWrap: "wrap" }}>
          <div style={{ maxWidth: 560 }}>
            <span className="eyebrow" style={{ color: "rgba(246,244,238,0.65)" }}><span className="dot"/>Ready when you are</span>
            <h2 style={{ fontSize: "clamp(36px, 4.6vw, 56px)", margin: "16px 0 14px", letterSpacing: "-0.03em", lineHeight: 1.02, fontWeight: 500 }}>
              Try Cataseek on your store, <br/>
              <span className="serif-i" style={{ color: "var(--accent)" }}>free for 14 days.</span>
            </h2>
            <p style={{ color: "rgba(246,244,238,0.7)", margin: 0, fontSize: 16 }}>
              No credit card. Real catalogue. Cancel any time.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <a href={DASHBOARD_URL + "/register"} className="btn btn-accent btn-lg">Start free trial <Icon.arrow/></a>
            <a href={DASHBOARD_URL + "/login"} className="btn btn-lg" style={{ background: "transparent", color: "var(--bg)", border: "1px solid rgba(246,244,238,0.2)" }}>
              Sign in
            </a>
          </div>
        </div>
      </div>
    </div>
  </section>
);

/* ============================================================
   FOOTER
   ============================================================ */
const Footer = () => (
  <footer>
    <div className="wrap" style={{ display: "grid", gridTemplateColumns: "1.6fr repeat(4, 1fr)", gap: 40 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Logo color="#FAFAF5"/>
        <p style={{ fontSize: 13.5, color: "#8C8A82", margin: 0, maxWidth: 260, lineHeight: 1.5 }}>
          Drop-in product search for modern e-commerce. Made in Lisbon and Berlin.
        </p>
      </div>
      <div>
        <h5>Product</h5>
        <ul><li>Features</li><li>Pricing</li><li>Integrations</li><li>Changelog</li><li>Roadmap</li></ul>
      </div>
      <div>
        <h5>Platforms</h5>
        <ul><li>WooCommerce</li><li>PrestaShop</li><li>Shopify <span className="mono" style={{ color: "#5C5A53", fontSize: 11 }}> · soon</span></li><li>Magento <span className="mono" style={{ color: "#5C5A53", fontSize: 11 }}> · soon</span></li></ul>
      </div>
      <div>
        <h5>Resources</h5>
        <ul>
          <li>Documentation</li>
          <li>Help center</li>
          <li>Status</li>
          <li><a href="contact.html" style={{ color: "inherit" }}>Contact</a></li>
        </ul>
      </div>
      <div>
        <h5>Company</h5>
        <ul>
          <li><a href="contact.html" style={{ color: "inherit" }}>Contact us</a></li>
          <li><a href="terms.html" style={{ color: "inherit" }}>Terms &amp; Conditions</a></li>
          <li><a href="privacy.html" style={{ color: "inherit" }}>Privacy Policy</a></li>
          <li><a href="refund-policy.html" style={{ color: "inherit" }}>Refund Policy</a></li>
        </ul>
      </div>
    </div>
    <div className="wrap mono" style={{ marginTop: 56, paddingTop: 24, borderTop: "1px solid #2A2825", display: "flex", justifyContent: "space-between", alignItems: "center", color: "#5C5A53", fontSize: 12.5, flexWrap: "wrap", gap: 10 }}>
      <span className="mono">© 2026 Cataseek · Operated by Gofenice</span>
      <span className="mono" style={{ display: "flex", gap: 16 }}>
        <a href="terms.html" style={{ color: "#8C8A82" }}>Terms</a>
        <a href="privacy.html" style={{ color: "#8C8A82" }}>Privacy</a>
        <a href="refund-policy.html" style={{ color: "#8C8A82" }}>Refunds</a>
        <a href="contact.html" style={{ color: "#8C8A82" }}>Contact</a>
      </span>
      <span className="mono">All systems operational <span style={{ display: "inline-block", width: 6, height: 6, background: "var(--accent)", borderRadius: 999, marginLeft: 6, verticalAlign: 1 }}/></span>
    </div>
  </footer>
);

/* ============================================================
   APP
   ============================================================ */
const { TweaksPanel, useTweaks, TweakSection, TweakRadio, TweakColor } = window;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Apply accent live
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", t.accent);
  }, [t.accent]);

  return (
    <>
      <Nav/>
      <Hero headlineStyle={t.headlineStyle}/>
      <Integrations/>
      <Features/>
      <Steps/>
      <Pricing/>
      <FAQ/>
      <CTA/>
      <Footer/>

      <TweaksPanel title="Tweaks">
        <TweakSection title="Accent">
          <TweakColor
            value={t.accent}
            onChange={v => setTweak("accent", v)}
            options={["#C0E457", "#FF6A3D", "#3D6AFF", "#E9D7A2", "#11A98A"]}
          />
        </TweakSection>
        <TweakSection title="Headline style">
          <TweakRadio
            value={t.headlineStyle}
            onChange={v => setTweak("headlineStyle", v)}
            options={[
              { value: "sans",  label: "Sans"  },
              { value: "serif", label: "Serif italic" }
            ]}
          />
        </TweakSection>
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
