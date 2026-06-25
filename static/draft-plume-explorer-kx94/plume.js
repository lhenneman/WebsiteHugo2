/**
 * plume.js — Gaussian Plume Air Quality Explorer
 *
 * Implements:
 *  - Pasquill-Gifford dispersion coefficients (σy, σz)
 *  - Gaussian plume concentration at z = 2 m receptor height (breathing level)
 *  - Wind-rotated coordinate transform for arbitrary wind direction
 *  - Leaflet canvas overlay (anchored to map container, not a pane)
 *  - Marching Squares contour extraction from the rasterised concentration grid
 *  - HTML concentration labels stacked above the colour-scale legend
 *  - Interactive wind-rose drag to set wind direction
 */

'use strict';

/* ─────────────────────────────────────────────────────────────────
   1.  GAUSSIAN PLUME SCIENCE
   ───────────────────────────────────────────────────────────────── */

/**
 * Pasquill-Gifford sigma parameterizations (power-law).
 *   σy(x) = ay * (x_km)^by * 1000  [m]
 *   σz(x) = az * (x_km)^bz * 1000  [m]
 *
 * Source: Seinfeld & Pandis (2006) Table 18.1, rural open terrain.
 */
const PG_COEFFS = {
  //       [ay,   by,    az,    bz]
  A: [0.22, 0.894, 0.200, 0.894],
  B: [0.16, 0.894, 0.120, 0.894],
  C: [0.11, 0.894, 0.080, 0.894],
  D: [0.08, 0.894, 0.060, 0.894],
  E: [0.06, 0.894, 0.030, 0.894],
  F: [0.04, 0.894, 0.016, 0.894],
};

const STABILITY_DESCRIPTIONS = {
  A: 'Extremely Unstable — strong daytime solar heating, winds <3 m/s. Rapid vertical mixing.',
  B: 'Moderately Unstable — moderate solar radiation. Common on sunny afternoons.',
  C: 'Slightly Unstable — slight insolation. Typical summer afternoon conditions.',
  D: 'Neutral — overcast skies or strong winds (>6 m/s). Most common class.',
  E: 'Slightly Stable — slight surface cooling at night. Plume stays relatively narrow.',
  F: 'Moderately Stable — clear skies, light winds, strong nighttime inversion.',
};

/** Compute σy and σz [m] for downwind distance x [m] and stability class. */
function computeSigmas(xMeters, stabClass) {
  const xKm = Math.max(xMeters / 1000, 0.001);
  const [ay, by, az, bz] = PG_COEFFS[stabClass];
  return {
    sigmaY: ay * Math.pow(xKm, by) * 1000,
    sigmaZ: az * Math.pow(xKm, bz) * 1000,
  };
}

/**
 * Gaussian plume concentration [µg/m³] at receptor height z = 2 m (breathing level)
 * with full ground reflection (image source term).
 *
 *   C(x,y,z) = Q / (2π · σy · σz · u)
 *            · exp(−y² / 2σy²)
 *            · [ exp(−(z−H)² / 2σz²) + exp(−(z+H)² / 2σz²) ]
 *
 * @param {number} xDown  downwind distance [m]  (must be > 0)
 * @param {number} yCross crosswind distance [m]
 * @param {number} Q      emission rate [g/s]
 * @param {number} u      wind speed [m/s]
 * @param {number} H      effective stack height [m]
 * @param {string} stab   Pasquill stability class A–F
 * @returns {number}      concentration [µg/m³]
 */
function gaussianConcentration(xDown, yCross, Q, u, H, stab) {
  if (xDown <= 0) return 0;
  const { sigmaY, sigmaZ } = computeSigmas(xDown, stab);
  if (sigmaY < 1e-6 || sigmaZ < 1e-6) return 0;

  const z = 2; // receptor height [m] (breathing level)
  const expY   = Math.exp(-0.5 * (yCross / sigmaY) ** 2);
  const expZ1  = Math.exp(-0.5 * ((z - H) / sigmaZ) ** 2);
  const expZ2  = Math.exp(-0.5 * ((z + H) / sigmaZ) ** 2);
  const denom  = 2 * Math.PI * sigmaY * sigmaZ * Math.max(u, 0.1);

  return (Q / denom) * expY * (expZ1 + expZ2) * 1e6;   // g/m³ → µg/m³
}

/* ─────────────────────────────────────────────────────────────────
   2.  APPLICATION STATE
   ───────────────────────────────────────────────────────────────── */

const state = {
  sourceLat: null,
  sourceLon: null,

  Q:         3.0,    // g/s
  H:         75,     // m
  windSpeed: 3.0,    // m/s
  windDir:   220,    // degrees FROM (meteorological convention)
  stab:      'C',

  pollutant:    'nox',
  opacity:      0.70,
  showContours: true,

  pollutantFactor() {
    return { nox: 1.0, no2: 0.45, pm25: 1.0 }[this.pollutant];
  },
  pollutantLabel() {
    return { nox: 'NOₓ', no2: 'NO₂ (est.)', pm25: 'PM₂.₅ (primary)' }[this.pollutant];
  },
};

/* ── Exponential slider helpers for emission rate ───────────── */
// Maps slider position [0,1] ↔ Q [0.01, 100] g/s logarithmically.
const Q_MIN = 0.0001, Q_MAX = 100;
function sliderToQ(t) {
  // t ∈ [0,1] → Q ∈ [Q_MIN, Q_MAX]
  return Q_MIN * Math.pow(Q_MAX / Q_MIN, t);
}
function qToSlider(q) {
  // Q → t ∈ [0,1]
  return Math.log(q / Q_MIN) / Math.log(Q_MAX / Q_MIN);
}

/**
 * Typical source emission rates [g/s] derived from EPA AP-42 emission factors
 * and representative plant heat inputs / engine ratings.
 *
 * NOₓ & NO₂ sources:
 *   - Diesel  (≥600 hp): AP-42 §3.4 Table 3.4-1; NOₓ EF = 0.024 lb/hp-hr (uncontrolled)
 *                        NO₂ is ~10 % of total NOₓ as primary emission (AP-42 §3.4 note)
 *                        PM₂.₅ EF = 0.00070 lb/hp-hr (AP-42 §3.4 Table 3.4-1)
 *   - Small diesel gen: EPA Tier 4 Final limits (40 CFR Part 1039)
 *                       NOₓ ≤ 4.0 g/kW-hr (~3.0 g/hp-hr) for 37–75 kW, ~134 hp @ 100 kW
 *                       PM  ≤ 0.03 g/kW-hr → 0.022 g/hp-hr
 *   - Gas turbines:     AP-42 §3.1 Table 3.1-1 (natural gas, DLN / low-NOₓ burner)
 *                       NOₓ EF ≈ 0.036–0.05 lb/MMBtu after DLN; PM₂.₅ EF ≈ 0.0066 lb/MMBtu
 *                       NO₂ is ~5 % of total NOₓ as primary (unoxidised NO dominates)
 *   - Coal (pulverised, wall-fired, bituminous):
 *                       AP-42 §1.1 Table 1.1-3; NOₓ EF = 0.088 lb/MMBtu (with SCR)
 *                       PM₂.₅ EF = 0.006 lb/MMBtu (filterable, fabric filter/ESP; §1.1 Table 1.1-6)
 *                       NO₂ is ~5 % of stack NOₓ (rest is NO after SCR)
 *
 * Plant sizes used:
 *   Small diesel gen:   100 kW  → 134 hp  → q = EF × hp / 3600 (×453.6 g/lb if lb)
 *   Large diesel genset: 2 MW   → 2,682 hp
 *   NG peaker (simple cycle GT): 100 MW, HR 10,000 BTU/kWh → 1,000 MMBtu/hr heat input
 *   CCGT 400 MW, HR 6,500 BTU/kWh → 2,600 MMBtu/hr
 *   Large coal 500 MW, HR 10,000 BTU/kWh → 5,000 MMBtu/hr
 *   Super-critical coal 800 MW, HR 8,600 BTU/kWh → 6,880 MMBtu/hr
 *
 * Conversion:  lb/MMBtu × MMBtu/hr × 453.592 g/lb ÷ 3600 s/hr  = g/s
 *              lb/hp-hr × hp       × 453.592 g/lb ÷ 3600 s/hr  = g/s
 *
 * Each entry carries independent g/s values per pollutant so no generic
 * scaling factor is applied across pollutants.
 */
const EMISSION_PRESETS = [
  // ── Diesel sources ─────────────────────────────────────────────────────
  {
    label: 'Small diesel generator (100 kW)',
    // Tier 4 Final limits (40 CFR Part 1039 / NSPS Subpart IIII), 100 kW / 134 hp
    // NOₓ: 0.298 g/hp-hr × 134 hp ÷ 3600 = 0.0111 g/s
    // NO₂: 5 % primary fraction → 0.000556 g/s
    // PM₂.₅: 0.0149 g/hp-hr × 134 hp ÷ 3600 = 0.000555 g/s
    q: { nox: 0.0111, no2: 0.000556, pm25: 0.000555 },
    cite: '40 CFR Part 1039 / NSPS Subpart IIII Tier 4 Final; 100 kW / 134 hp genset',
  },
  {
    label: 'Large diesel genset — data center (2 MW)',
    // AP-42 §3.4 Table 3.4-1 (≥600 hp, uncontrolled): NOₓ EF 0.024 lb/hp-hr, PM₂.₅ 0.0007 lb/hp-hr
    // 2 MW = 2,682 hp; conversion: EF × hp × 453.592 / 3600 = EF × hp × 0.1260
    // NOₓ: 0.024 × 2682 × 0.1260 = 8.11 g/s
    // NO₂: 5 % primary (AP-42 §3.4) → 0.406 g/s
    // PM₂.₅: 0.0007 × 2682 × 0.1260 = 0.237 g/s
    q: { nox: 8.11, no2: 0.406, pm25: 0.237 },
    cite: 'AP-42 §3.4 Table 3.4-1 (≥600 hp, uncontrolled); 2 MW / 2,682 hp unit',
  },
  // ── Natural gas turbines ──────────────────────────────────────────────────
  {
    label: 'Natural gas peaker — simple cycle (100 MW)',
    // AP-42 §3.1 Table 3.1-2a; DLN controlled: NOₓ 0.036 lb/MMBtu, PM₂.₅ 0.0066 lb/MMBtu
    // 100 MW_e, HR 10,000 BTU/kWh → heat input 1,000 MMBtu/hr
    // Conversion: EF × MMBtu/hr × 0.1260 = g/s
    // NOₓ: 0.036 × 1000 × 0.1260 = 4.54 g/s
    // NO₂: 5 % primary → 0.227 g/s
    // PM₂.₅: 0.0066 × 1000 × 0.1260 = 0.832 g/s
    q: { nox: 4.54, no2: 0.227, pm25: 0.832 },
    cite: 'AP-42 §3.1 Table 3.1-2a (natural gas, DLN); 100 MW_e, HR 10,000 BTU/kWh',
  },
  {
    label: 'Combined-cycle gas turbine — CCGT (400 MW)',
    // AP-42 §3.1: same DLN EFs apply when no supplementary duct burner
    // 400 MW_e, HR 6,800 BTU/kWh → heat input 2,720 MMBtu/hr
    // NOₓ: 0.036 × 2720 × 0.1260 = 12.34 g/s
    // NO₂: 5 % → 0.617 g/s
    // PM₂.₅: 0.0066 × 2720 × 0.1260 = 2.26 g/s
    q: { nox: 12.34, no2: 0.617, pm25: 2.26 },
    cite: 'AP-42 §3.1 Table 3.1-2a (natural gas, DLN); 400 MW_e CCGT, HR 6,800 BTU/kWh',
  },
  // ── Coal-fired boilers ────────────────────────────────────────────────────
  {
    label: 'Coal power plant, wall-fired PC (500 MW)',
    // AP-42 §1.1 Table 1.1-3: uncontrolled NOₓ 21 lb/ton bituminous (12,000 BTU/lb)
    // = 0.875 lb/MMBtu; with 90% SCR → 0.0875 lb/MMBtu
    // 500 MW_e, HR 9,800 BTU/kWh → heat input 4,900 MMBtu/hr
    // NOₓ: 0.0875 × 4900 × 0.1260 = 54.0 g/s
    // NO₂: 5 % primary → 2.70 g/s
    // PM₂.₅ (AP-42 §1.1 Table 1.1-5/6, fabric filter): 0.006 lb/MMBtu
    // PM₂.₅: 0.006 × 4900 × 0.1260 = 3.70 g/s
    q: { nox: 54.0, no2: 2.70, pm25: 3.70 },
    cite: 'AP-42 §1.1 Tables 1.1-3 & 1.1-5/6 (wall-fired PC, SCR, fabric filter); 500 MW_e',
  },
  {
    label: 'Super-critical coal boiler (800 MW)',
    // Same AP-42 EFs; supercritical HR 8,800 BTU/kWh → heat input 7,040 MMBtu/hr
    // NOₓ: 0.0875 × 7040 × 0.1260 = 77.6 g/s
    // NO₂: 5 % → 3.88 g/s
    // PM₂.₅: 0.006 × 7040 × 0.1260 = 5.32 g/s
    q: { nox: 77.6, no2: 3.88, pm25: 5.32 },
    cite: 'AP-42 §1.1 Tables 1.1-3 & 1.1-5/6 (wall-fired PC, SCR, fabric filter); 800 MW_e SC',
  },
];

/** Rebuild the preset <select> options to reflect the active pollutant. */
function updateEmissionPresets() {
  const pol = state.pollutant;                                // 'nox' | 'no2' | 'pm25'
  const sym = { nox: 'NOₓ', no2: 'NO₂', pm25: 'PM₂.₅' }[pol];
  const sel = document.getElementById('emission-preset');
  if (!sel) return;

  sel.innerHTML = '<option value="">\u2014 select \u2014</option>' +
    EMISSION_PRESETS.map(({ label, q }) => {
      const val = q[pol];
      // Format the value with sensible precision
      const qFmt = val < 0.01 ? val.toExponential(1)
                 : val < 0.1  ? val.toFixed(3)
                 : val < 10   ? val.toFixed(2)
                 : val.toFixed(1);
      return `<option value="${val}">${label} (~${qFmt} g/s ${sym})</option>`;
    }).join('');
}

/* ─────────────────────────────────────────────────────────────────
   3.  MAP INITIALISATION
   ───────────────────────────────────────────────────────────────── */

const map = L.map('map', {
  center:           [38.9072, -77.0369],   // Washington DC
  zoom:             12,
  zoomControl:      true,
  attributionControl: true,
});

// Tile layers: CartoDB dark_all as primary; OSM (dark-filtered via CSS) as fallback base.
// OSM is added first so it's always there if CartoDB tiles fail to load.
const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom:     19,
});

// CartoDB light_all: clean neutral grey — the same palette as the reference AQ visualiser.
// Provides great contrast for the coloured plume overlay without the harshness of Voyager.
const cartoLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains:  'abcd',
  maxZoom:     19,
});

// Tile layers: CartoDB Voyager (neutral, readable) as primary; plain OSM as silent fallback.
// Voyager is a medium-contrast basemap — not pitch-dark, not glaring white.
osmLayer.addTo(map);
cartoLayer.addTo(map);

// If CartoDB fails, plain OSM shows through — no dark filter needed for Voyager.
let cartoFailed = false;
cartoLayer.on('tileerror', () => { cartoFailed = true; });

/* ── Inject dynamic CSS ────────────────────────────────────── */
const dynStyle = document.createElement('style');
dynStyle.textContent = `
  /* Source marker */
  .source-marker { position:relative; width:28px; height:28px; }
  .source-inner {
    position:absolute; inset:0; margin:auto;
    width:14px; height:14px;
    background:#818cf8; border:2.5px solid #fff; border-radius:50%;
    box-shadow:0 0 12px rgba(129,140,248,0.8);
  }
  .source-pulse {
    position:absolute; inset:0; border-radius:50%;
    background:rgba(129,140,248,0.3);
    animation:pulse-ring 2s ease-out infinite;
  }
  @keyframes pulse-ring {
    0%   { transform:scale(0.6); opacity:1; }
    100% { transform:scale(1.8); opacity:0; }
  }
`;
document.head.appendChild(dynStyle);

/* ── Source marker ─────────────────────────────────────────── */
const sourceIcon = L.divIcon({
  className: '',
  html: `<div class="source-marker">
    <div class="source-pulse"></div>
    <div class="source-inner"></div>
  </div>`,
  iconSize:   [28, 28],
  iconAnchor: [14, 14],
});

let sourceMarker = null;

/* ─────────────────────────────────────────────────────────────────
   4.  PLUME CANVAS LAYER
   ─────────────────────────────────────────────────────────────────
   Key design: the <canvas> lives directly in the Leaflet map container
   div (not inside any Leaflet pane).  Leaflet panes get CSS-translated
   during pan animations, which would cause drawing artifacts if we were
   inside a pane.  By sitting outside the pane system:
     • containerPoint coordinates are always correct at draw time.
     • On 'moveend' / 'zoomend' we do a full redraw.
     • On 'move' (mid-drag) we apply a CSS translate to track the tiles
       so the plume stays locked to the source marker while panning.
   ───────────────────────────────────────────────────────────────── */

const PlumeLayer = L.Layer.extend({

  onAdd(map) {
    this._map = map;

    const canvas = document.createElement('canvas');
    canvas.style.cssText = [
      'position:absolute',
      'top:0', 'left:0',
      'pointer-events:none',
      'z-index:400',          // above tiles (200), below markers (600)
      'will-change:transform',
    ].join(';');
    map.getContainer().appendChild(canvas);
    this._canvas = canvas;

    // The container-point of the source when we last did a full draw.
    // Used to compute the CSS translate during live pan.
    this._drawnSrcPt = null;

    map.on('move',              this._onMove,    this);
    map.on('moveend zoomend resize', this._hardReset, this);
    this._hardReset();
  },

  onRemove(map) {
    this._canvas.remove();
    map.off('move',              this._onMove,    this);
    map.off('moveend zoomend resize', this._hardReset, this);
  },

  /** Called continuously during a pan drag — cheap CSS translate only. */
  _onMove() {
    if (!this._drawnSrcPt || !state.sourceLat) return;
    const cur = this._map.latLngToContainerPoint(
      L.latLng(state.sourceLat, state.sourceLon)
    );
    const dx = cur.x - this._drawnSrcPt.x;
    const dy = cur.y - this._drawnSrcPt.y;
    this._canvas.style.transform = `translate(${dx}px,${dy}px)`;
  },

  /** Called on moveend / zoomend — clear transform then full redraw. */
  _hardReset() {
    this._canvas.style.transform = '';
    const size = this._map.getSize();
    this._canvas.width  = size.x;
    this._canvas.height = size.y;
    this.draw();
  },

  draw() {
    if (!state.sourceLat) return;
    const t0 = performance.now();

    const canvas = this._canvas;
    const ctx    = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // ── Source position in container-pixel space ─────────────────
    const srcPt = this._map.latLngToContainerPoint(
      L.latLng(state.sourceLat, state.sourceLon)
    );
    this._drawnSrcPt = { x: srcPt.x, y: srcPt.y };

    // ── Meters per pixel (computed at source location) ────────────
    const eastPt     = this._map.containerPointToLatLng(
      L.point(srcPt.x + 100, srcPt.y)
    );
    const metersPerPx = haversineMeters(
      state.sourceLat, state.sourceLon,
      eastPt.lat, eastPt.lng
    ) / 100;

    // ── Wind geometry ─────────────────────────────────────────────
    // Meteorological convention: windDir is direction wind blows FROM.
    // Plume travels in opposite direction (downwind azimuth).
    const downAz = ((state.windDir + 180) % 360) * Math.PI / 180;
    // Downwind unit vector in east-north geographic coords:
    //   East component  = sin(az)
    //   North component = cos(az)
    const downE = Math.sin(downAz);
    const downN = Math.cos(downAz);
    // Crosswind unit vector (90° clockwise from downwind):
    //   East  = cos(az)
    //   North = −sin(az)
    const crossE =  Math.cos(downAz);
    const crossN = -Math.sin(downAz);

    // ── Effective emission and colour scale ───────────────────────
    const effectiveQ  = state.Q * state.pollutantFactor();
    const { maxConc, peakX } = computeCenterlineMax(effectiveQ);
    if (maxConc < 1e-6) {
      setStatus('done', 'No significant concentrations');
      return;
    }

    // ── Rasterise concentration field ─────────────────────────────
    const STEP = 4;
    const imageData = ctx.createImageData(W, H);
    const pixels    = imageData.data;

    // Grid dimensions (one cell per STEP-pixel block)
    const GW = Math.ceil(W / STEP);
    const GH = Math.ceil(H / STEP);
    const concGrid = new Float32Array(GW * GH); // concentration at each grid node

    for (let gy = 0; gy < GH; gy++) {
      const py = gy * STEP;
      for (let gx = 0; gx < GW; gx++) {
        const px = gx * STEP;
        const dpx = px - srcPt.x;
        const dpy = py - srcPt.y;
        const eE  =  dpx * metersPerPx;
        const eN  = -dpy * metersPerPx;

        const xDown  = eE * downE  + eN * downN;
        const yCross = eE * crossE + eN * crossN;

        let conc = 0;
        if (xDown > 0) {
          conc = gaussianConcentration(xDown, yCross, effectiveQ, state.windSpeed, state.H, state.stab);
        }
        concGrid[gy * GW + gx] = conc;

        const color = concToRGBA(conc, maxConc, state.opacity);
        if (!color) continue;
        const [r, g, b, a] = color;
        for (let sy = 0; sy < STEP && py + sy < H; sy++) {
          for (let sx = 0; sx < STEP && px + sx < W; sx++) {
            const i = ((py + sy) * W + (px + sx)) * 4;
            pixels[i]     = r;
            pixels[i + 1] = g;
            pixels[i + 2] = b;
            pixels[i + 3] = a;
          }
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);

    // ── Overlays ──────────────────────────────────────────────────
    if (state.showContours) {
      drawContours(ctx, concGrid, GW, GH, STEP, maxConc);
    }


    updateStats(maxConc, peakX, effectiveQ);
    updateLegend(maxConc);
    if (state.showContours) updateContourLabels(maxConc);
    else document.getElementById('contour-labels').innerHTML = '';
    setStatus('done', `Ready  (${(performance.now() - t0).toFixed(0)} ms)`);
  },
});

const plumeLayer = new PlumeLayer();
plumeLayer.addTo(map);

/* ─────────────────────────────────────────────────────────────────
   5.  HELPER FUNCTIONS
   ───────────────────────────────────────────────────────────────── */

/**
 * Scan the centreline (yCross = 0) to find the peak concentration and its
 * downwind distance.  Both values are needed by draw() (for the colour scale)
 * and updateStats() (for the stats card) — returning them together avoids
 * running the same loop twice.
 *
 * @returns {{ maxConc: number, peakX: number }}
 */
function computeCenterlineMax(effectiveQ) {
  let maxC = 0, peakX = 25;
  for (let x = 25; x <= 60000; x += 25) {
    const c = gaussianConcentration(x, 0, effectiveQ, state.windSpeed, state.H, state.stab);
    if (c > maxC) { maxC = c; peakX = x; }
    if (x > 3000 && c < maxC * 0.005) break;
  }
  return { maxConc: maxC, peakX };
}

/**
 * Map a concentration value to an RGBA colour.
 * Colour scale: transparent → teal → green → yellow → orange → red.
 */
function concToRGBA(c, maxC, opacityScale) {
  const t = c / maxC;
  if (t < 0.002) return null;

  function lerp(a, b, s) { return a + (b - a) * s; }

  let r, g, b, a;
  if (t < 0.05) {
    const s = t / 0.05;
    r = lerp(40, 50, s); g = lerp(180, 220, s); b = lerp(200, 210, s);
    a = lerp(0, 40, s);
  } else if (t < 0.25) {
    const s = (t - 0.05) / 0.20;
    r = lerp(50, 100, s); g = lerp(220, 255, s); b = lerp(210, 80, s);
    a = lerp(40, 100, s);
  } else if (t < 0.55) {
    const s = (t - 0.25) / 0.30;
    r = lerp(100, 255, s); g = lerp(255, 200, s); b = lerp(80, 0, s);
    a = lerp(100, 160, s);
  } else if (t < 0.80) {
    const s = (t - 0.55) / 0.25;
    r = lerp(255, 255, s); g = lerp(200, 60, s); b = lerp(0, 0, s);
    a = lerp(160, 200, s);
  } else {
    const s = (t - 0.80) / 0.20;
    r = lerp(255, 180, s); g = lerp(60, 0, s); b = 0;
    a = lerp(200, 230, s);
  }

  return [
    Math.round(r),
    Math.round(g),
    Math.round(b),
    Math.round(Math.min(a * opacityScale, 255)),
  ];
}

/**
 * Draw concentration isolines using the Marching Squares algorithm.
 *
 * The concentration grid produced by draw()'s rasterisation loop is reused
 * directly here so contour positions are guaranteed to match the colour overlay.
 *
 * Labels are NOT drawn on the canvas — they are rendered as HTML pills in
 * #contour-labels (above the colour-scale legend) via updateContourLabels().
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Float32Array} grid     - concentration at each grid node (row-major, GW×GH)
 * @param {number}       GW       - grid width  (number of columns)
 * @param {number}       GH       - grid height (number of rows)
 * @param {number}       STEP     - canvas pixels per grid cell
 * @param {number}       maxConc  - peak concentration [μg/m³] (used to scale thresholds)
 */
function drawContours(ctx, grid, GW, GH, STEP, maxConc) {
  const FRACTIONS = [0.05, 0.20, 0.50, 0.80];
  const COLORS    = [
    'rgba(80,220,255,0.9)',
    'rgba(80,255,160,0.9)',
    'rgba(255,220,80,0.9)',
    'rgba(255,100,60,0.95)',
  ];
  const DASH = [6, 4];

  function interp(va, vb, thr) {
    const d = vb - va;
    return Math.abs(d) < 1e-12 ? 0.5 : Math.max(0, Math.min(1, (thr - va) / d));
  }

  const EDGE_TABLE = [
    [],            // 0000
    [[3, 2]],      // 0001
    [[2, 1]],      // 0010
    [[3, 1]],      // 0011
    [[1, 0]],      // 0100
    [[3, 0],[1,2]],// 0101 saddle
    [[2, 0]],      // 0110
    [[3, 0]],      // 0111
    [[0, 3]],      // 1000
    [[0, 2]],      // 1001
    [[0, 1],[2,3]],// 1010 saddle
    [[0, 1]],      // 1011
    [[1, 3]],      // 1100
    [[1, 2]],      // 1101
    [[2, 3]],      // 1110
    [],            // 1111
  ];

  /** Extract marching-squares chains for a given threshold. */
  function extractChains(threshold) {
    const segments = [];

    for (let row = 0; row < GH - 1; row++) {
      for (let col = 0; col < GW - 1; col++) {
        const tl = grid[ row      * GW + col    ];
        const tr = grid[ row      * GW + col + 1];
        const br = grid[(row + 1) * GW + col + 1];
        const bl = grid[(row + 1) * GW + col    ];

        const idx = ((tl >= threshold) ? 8 : 0)
                  | ((tr >= threshold) ? 4 : 0)
                  | ((br >= threshold) ? 2 : 0)
                  | ((bl >= threshold) ? 1 : 0);

        const edges = EDGE_TABLE[idx];
        if (!edges.length) continue;

        const x0 = col * STEP, y0 = row * STEP;
        const x1 = x0 + STEP,  y1 = y0 + STEP;

        function edgePoint(e) {
          switch (e) {
            case 0: return [x0 + interp(tl, tr, threshold) * STEP, y0];
            case 1: return [x1, y0 + interp(tr, br, threshold) * STEP];
            case 2: return [x0 + interp(bl, br, threshold) * STEP, y1];
            case 3: return [x0, y0 + interp(tl, bl, threshold) * STEP];
          }
        }

        for (const [eA, eB] of edges) segments.push([edgePoint(eA), edgePoint(eB)]);
      }
    }

    if (!segments.length) return [];

    const EPS = STEP * 0.6;
    function key(x, y) { return `${Math.round(x / EPS)},${Math.round(y / EPS)}`; }

    const endMap = new Map();
    segments.forEach((seg, si) => {
      endMap.set(key(...seg[0]), [si, 0]);
      endMap.set(key(...seg[1]), [si, 1]);
    });

    const used = new Uint8Array(segments.length);
    const chains = [];

    for (let si = 0; si < segments.length; si++) {
      if (used[si]) continue;
      used[si] = 1;
      const chain = [segments[si][0], segments[si][1]];

      let growing = true;
      while (growing) {
        growing = false;
        const hit = endMap.get(key(...chain[chain.length - 1]));
        if (!hit) break;
        const [ni, end] = hit;
        if (used[ni]) break;
        used[ni] = 1; growing = true;
        chain.push(segments[ni][end === 0 ? 1 : 0]);
      }
      growing = true;
      while (growing) {
        growing = false;
        const hit = endMap.get(key(...chain[0]));
        if (!hit) break;
        const [ni, end] = hit;
        if (used[ni]) break;
        used[ni] = 1; growing = true;
        chain.unshift(segments[ni][end === 0 ? 1 : 0]);
      }

      if (chain.length >= 2) chains.push(chain);
    }
    return chains;
  }

  /** Find the chain with the largest bounding-box diagonal. */
  function bestChainOf(chains) {
    let best = null, bestDiag = 0;
    chains.forEach(chain => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      chain.forEach(([x, y]) => {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      });
      const d = Math.hypot(maxX - minX, maxY - minY);
      if (d > bestDiag) { bestDiag = d; best = chain; }
    });
    return best;
  }

  // ── Pass 1: collect all chain sets ─────────────────────────────
  const allChains = FRACTIONS.map(frac => extractChains(frac * maxConc));

  // ── Pass 2: draw all chains ─────────────────────────────────────
  allChains.forEach((chains, li) => {
    chains.forEach(chain => {
      ctx.beginPath();
      ctx.moveTo(chain[0][0], chain[0][1]);
      for (let i = 1; i < chain.length; i++) ctx.lineTo(chain[i][0], chain[i][1]);
      ctx.strokeStyle = COLORS[li];
      ctx.lineWidth   = 1.8;
      ctx.setLineDash(DASH);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  });

  // Labels are now rendered as HTML above the map legend (see updateContourLabels).
}



/** Populate the #contour-labels panel above the map legend. */
function updateContourLabels(maxConc) {
  const FRACTIONS = [0.05, 0.20, 0.50, 0.80];
  // CSS colours matching the canvas contour colours
  const COLORS = [
    '#50dcff',  // 5%  cyan
    '#50ffa0',  // 20% green
    '#ffdc50',  // 50% yellow
    '#ff643c',  // 80% red-orange
  ];

  const el = document.getElementById('contour-labels');
  if (!el) return;

  // Build pills ordered 80% → 5% (highest conc at top of stack)
  el.innerHTML = [3, 2, 1, 0].map(li => {
    const val  = formatConc(FRACTIONS[li] * maxConc);
    const col  = COLORS[li];
    return `
      <div class="contour-label-pill">
        <span class="contour-label-dot" style="background:${col};"></span>
        <span style="color:${col};">${val} μg/m³</span>
      </div>`;
  }).join('');

  // Dynamically position the stack just above the legend so it works
  // for any legend height (font scaling, zoom, etc.).
  const legend = document.getElementById('map-legend');
  if (legend) {
    const gap = 8;
    el.style.transform = `translateY(calc(-100% - ${legend.offsetHeight + gap}px))`;
  }
}




/** Haversine great-circle distance [m]. */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R  = 6371000;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatConc(c) {
  if (c >= 1000) return `${(c / 1000).toFixed(1)}k`;
  if (c >= 1)    return `${c.toFixed(1)}`;
  if (c >= 0.01) return `${c.toFixed(2)}`;
  return c.toExponential(1);
}

/* ─────────────────────────────────────────────────────────────────
   6.  UI UPDATES
   ───────────────────────────────────────────────────────────────── */

function setStatus(type, msg) {
  document.getElementById('status-dot').className  = 'status-dot ' + type;
  document.getElementById('status-text').textContent = msg;
}

/**
 * Update the stats card using pre-computed peak values from computeCenterlineMax(),
 * avoiding a redundant centreline scan.
 *
 * @param {number} maxConc    Peak centreline concentration [µg/m³]
 * @param {number} peakX      Downwind distance [m] of that peak
 * @param {number} effectiveQ Effective emission rate [g/s] (unused here but kept for symmetry)
 */
function updateStats(maxConc, peakX, effectiveQ) {
  const { sigmaY } = computeSigmas(peakX, state.stab);
  document.getElementById('stat-max-val').textContent   = `${formatConc(maxConc)} μg/m³`;
  document.getElementById('stat-dist-val').textContent  = `${(peakX / 1000).toFixed(2)} km`;
  document.getElementById('stat-width-val').textContent = `${(2 * sigmaY / 1000).toFixed(2)} km`;
  document.getElementById('stats-card').classList.add('visible');
}

function updateLegend(maxConc) {
  const canvas = document.getElementById('legend-canvas');
  // Match canvas pixel resolution to its CSS layout width so the
  // gradient fills edge-to-edge regardless of pollutant label length.
  const layoutW = canvas.offsetWidth;
  if (layoutW > 0) canvas.width = layoutW;

  const ctx  = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
  grad.addColorStop(0.00, 'rgba(40,180,200,0)');
  grad.addColorStop(0.10, 'rgba(50,220,210,0.5)');
  grad.addColorStop(0.35, 'rgba(100,255,80,0.9)');
  grad.addColorStop(0.60, 'rgba(255,200,0,1)');
  grad.addColorStop(0.80, 'rgba(255,60,0,1)');
  grad.addColorStop(1.00, 'rgba(180,0,0,1)');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  document.getElementById('legend-min').textContent   = '0';
  document.getElementById('legend-mid').textContent   = formatConc(maxConc * 0.5);
  document.getElementById('legend-max').textContent   = formatConc(maxConc);
  document.getElementById('legend-title').textContent = state.pollutantLabel() + ' Concentration';
}

function updateParamsTable() {
  const { sigmaY, sigmaZ } = computeSigmas(1000, state.stab);
  const qFmt = state.Q < 0.001 ? state.Q.toExponential(2) : state.Q < 0.1 ? state.Q.toFixed(4) : state.Q < 10 ? state.Q.toFixed(2) : state.Q.toFixed(1);
  document.getElementById('pt-q').textContent    = `${qFmt} g/s`;
  document.getElementById('pt-h').textContent    = `${state.H} m`;
  document.getElementById('pt-u').textContent    = `${state.windSpeed.toFixed(1)} m/s`;
  document.getElementById('pt-wd').textContent   = `${state.windDir}° (${cardinalDir(state.windDir)})`;
  document.getElementById('pt-stab').textContent = `Class ${state.stab}`;
  document.getElementById('pt-sy').textContent   = `${sigmaY.toFixed(0)} m`;
  document.getElementById('pt-sz').textContent   = `${sigmaZ.toFixed(0)} m`;
}

function cardinalDir(deg) {
  const d = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return d[Math.round(deg / 22.5) % 16];
}

/* ── Mini σ chart ──────────────────────────────────────────── */
function drawSigmaChart() {
  const canvas = document.getElementById('sigma-chart');
  const ctx    = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const pad = { top: 16, right: 12, bottom: 24, left: 38 };
  const pW  = W - pad.left - pad.right;
  const pH  = H - pad.top  - pad.bottom;

  ctx.clearRect(0, 0, W, H);

  const classes = ['A','B','C','D','E','F'];
  const colors  = ['#f87171','#fb923c','#facc15','#4ade80','#60a5fa','#a78bfa'];
  const xs      = [];
  for (let x = 100; x <= 20000; x += 200) xs.push(x);

  const maxSy = computeSigmas(20000, 'A').sigmaY;
  const xS = x => pad.left + (Math.log10(x) - 2) / (Math.log10(20000) - 2) * pW;
  const yS = s => pad.top + pH - (s / maxSy) * pH;

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth   = 1;
  [1000, 5000, 10000, 20000].forEach(x => {
    ctx.beginPath(); ctx.moveTo(xS(x), pad.top); ctx.lineTo(xS(x), pad.top + pH); ctx.stroke();
  });

  // Axis labels
  ctx.font      = '10px JetBrains Mono, monospace';
  ctx.fillStyle = 'rgba(139,146,179,0.8)';
  ctx.textAlign = 'center';
  [[100,'0.1km'],[1000,'1km'],[5000,'5km'],[10000,'10km'],[20000,'20km']].forEach(([x, lbl]) => {
    ctx.fillText(lbl, xS(x), H - 6);
  });
  ctx.textAlign = 'left';
  ctx.fillText('σy (m)', 2, 12);

  // σy lines per stability class
  classes.forEach((cls, ci) => {
    const active = cls === state.stab;
    ctx.strokeStyle  = colors[ci];
    ctx.lineWidth    = active ? 2.5 : 1;
    ctx.globalAlpha  = active ? 1.0 : 0.30;
    ctx.setLineDash(active ? [] : [4, 3]);
    ctx.beginPath();
    xs.forEach((x, i) => {
      const sy = computeSigmas(x, cls).sigmaY;
      i === 0 ? ctx.moveTo(xS(x), yS(sy)) : ctx.lineTo(xS(x), yS(sy));
    });
    ctx.stroke();
    if (active) {
      ctx.fillStyle   = colors[ci];
      ctx.globalAlpha = 1;
      ctx.font        = 'bold 10px JetBrains Mono, monospace';
      ctx.fillText(cls, xS(18000) + 3, yS(computeSigmas(18000, cls).sigmaY) + 4);
    }
  });
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

/* ── Wind rose ─────────────────────────────────────────────── */
function drawWindRose() {
  const canvas = document.getElementById('wind-rose');
  const ctx    = canvas.getContext('2d');
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const R  = 28;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background circle
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle   = 'rgba(26,30,42,0.95)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth   = 1;
  ctx.stroke();

  // Cardinal labels (N at top, E right, S bottom, W left)
  // In canvas: (cx, cy-R)=N, (cx+R, cy)=E, (cx, cy+R)=S, (cx-R, cy)=W
  ctx.font         = '9px Inter, sans-serif';
  ctx.fillStyle    = 'rgba(139,146,179,0.75)';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  const labels = [['N', 0], ['E', 90], ['S', 180], ['W', 270]];
  labels.forEach(([lbl, deg]) => {
    const rad = deg * Math.PI / 180;         // met→canvas: 0°=top, 90°=right
    ctx.fillText(lbl,
      cx + (R + 8) * Math.sin(rad),          // sin→east
      cy - (R + 8) * Math.cos(rad)           // -cos→north (canvas y-flip)
    );
  });

  // Arrow: shaft from centre toward "FROM" direction (wind vane convention).
  // "FROM" = state.windDir; plume goes toward (windDir+180).
  const fromRad = state.windDir * Math.PI / 180;  // met degrees → radians
  const tipX  = cx + R * 0.72 * Math.sin(fromRad);
  const tipY  = cy - R * 0.72 * Math.cos(fromRad);
  const baseX = cx - R * 0.40 * Math.sin(fromRad);
  const baseY = cy + R * 0.40 * Math.cos(fromRad);

  const angle = Math.atan2(tipY - baseY, tipX - baseX);
  const aLen  = 9;
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(tipX, tipY);
  ctx.strokeStyle = '#818cf8';
  ctx.lineWidth   = 2.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - aLen * Math.cos(angle - 0.4), tipY - aLen * Math.sin(angle - 0.4));
  ctx.lineTo(tipX - aLen * Math.cos(angle + 0.4), tipY - aLen * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fillStyle = '#818cf8';
  ctx.fill();
}

/* ── Wind-rose click/drag to set wind direction ─────────────── */
(function initWindRoseDrag() {
  const canvas  = document.getElementById('wind-rose');
  let dragging  = false;

  function angleFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = clientX - rect.left  - canvas.width  / 2;
    const dy = clientY - rect.top   - canvas.height / 2;
    // atan2 with canvas coords (y inverted): angle from north, clockwise
    let deg = Math.atan2(dx, -dy) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    return Math.round(deg);
  }

  function applyAngle(e) {
    const deg = angleFromEvent(e);
    state.windDir = deg;
    
    // Sync the number input
    const numIn = document.getElementById('wind-direction-num');
    if (numIn) numIn.value = deg;
    
    const unitSpan = document.getElementById('unit-wind-direction');
    if (unitSpan) unitSpan.textContent = `° (${cardinalDir(deg)})`;
    
    drawWindRose();
    scheduleRedraw();
  }

  canvas.addEventListener('mousedown', (e) => { dragging = true; applyAngle(e); e.preventDefault(); });
  window.addEventListener('mousemove', (e) => { if (dragging) applyAngle(e); });
  window.addEventListener('mouseup',   ()  => { dragging = false; });
  canvas.addEventListener('touchstart', (e) => { dragging = true; applyAngle(e); e.preventDefault(); }, { passive: false });
  window.addEventListener('touchmove',  (e) => { if (dragging) applyAngle(e); }, { passive: true });
  window.addEventListener('touchend',   ()  => { dragging = false; });

  canvas.style.cursor = 'crosshair';
})();

/* ─────────────────────────────────────────────────────────────────
   7.  DEBOUNCED REDRAW
   ───────────────────────────────────────────────────────────────── */

let _redrawTimer = null;
function scheduleRedraw(immediate = false) {
  if (!state.sourceLat) return;
  setStatus('computing', 'Computing…');
  clearTimeout(_redrawTimer);
  _redrawTimer = setTimeout(() => {
    plumeLayer.draw();
    updateParamsTable();
    drawSigmaChart();
  }, immediate ? 0 : 80);
}

/* ─────────────────────────────────────────────────────────────────
   8.  MAP INTERACTIONS
   ───────────────────────────────────────────────────────────────── */

map.on('click', (e) => {
  const { lat, lng } = e.latlng;
  state.sourceLat = lat;
  state.sourceLon = lng;

  if (sourceMarker) {
    sourceMarker.setLatLng([lat, lng]);
  } else {
    sourceMarker = L.marker([lat, lng], {
      icon: sourceIcon, draggable: true, zIndexOffset: 1000,
    }).addTo(map);

    sourceMarker.on('drag', (ev) => {
      const p = ev.target.getLatLng();
      state.sourceLat = p.lat;
      state.sourceLon = p.lng;
      updateLocationDisplay(p.lat, p.lng);
      scheduleRedraw();
    });
    sourceMarker.on('dragend', () => {
      // After drag ends, force a clean full redraw (clears any CSS transform drift)
      plumeLayer._drawnSrcPt = null;
      scheduleRedraw(true);
    });
  }

  updateLocationDisplay(lat, lng);
  document.getElementById('click-hint').classList.add('hidden');
  scheduleRedraw(true);
});

function updateLocationDisplay(lat, lng) {
  document.getElementById('loc-lat').textContent = lat.toFixed(4);
  document.getElementById('loc-lon').textContent = lng.toFixed(4);
}

/* ─────────────────────────────────────────────────────────────────
   9.  CONTROL BINDINGS
   ───────────────────────────────────────────────────────────────── */

function updateSliderFill(el) {
  const pct = ((parseFloat(el.value) - parseFloat(el.min)) /
               (parseFloat(el.max)   - parseFloat(el.min))) * 100;
  el.style.setProperty('--pct', pct + '%');
}



/* ── Exponential emission-rate slider ─────────────────────── */
(function () {
  const slider  = document.getElementById('emission-rate');
  const numIn   = document.getElementById('emission-rate-num');

  function formatQ(q) {
    if (q < 0.001) return q.toExponential(2);
    if (q < 0.1) return q.toFixed(4);
    if (q < 10)  return q.toFixed(2);
    return q.toFixed(1);
  }

  function applyQ(q) {
    q = Math.max(Q_MIN, Math.min(Q_MAX, q));
    state.Q = q;
    const t = qToSlider(q);
    slider.value = t;
    numIn.value  = formatQ(q);
    updateSliderFill(slider);
    scheduleRedraw();
  }

  slider.addEventListener('input', () => {
    const q = sliderToQ(parseFloat(slider.value));
    applyQ(q);
  });

  numIn.addEventListener('change', () => {
    const q = parseFloat(numIn.value);
    if (!isNaN(q) && q > 0) applyQ(q);
  });
  numIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') numIn.dispatchEvent(new Event('change'));
  });

  // Init
  applyQ(state.Q);
})();

/* ── Preset emission-rate selector ───────────────────────── */
document.getElementById('emission-preset').addEventListener('change', function () {
  if (!this.value) return;
  const q = parseFloat(this.value);
  // Trigger via the number input's change pathway to keep everything in sync
  const numIn = document.getElementById('emission-rate-num');
  numIn.value = q;
  numIn.dispatchEvent(new Event('change'));
  // Reset the select back to placeholder so it can be re-selected
  this.value = '';
});

/* ── Cite-link scrolls to citation card in info panel ──── */
const citeEl = document.getElementById('cite-link');
if (citeEl) {
  citeEl.addEventListener('click', (e) => {
    e.preventDefault();
    const card = document.getElementById('citation-card');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

// Opacity slider: HTML range is 0–100 (integer %) but state.opacity is 0–1.
// We wire it up manually here.
(function () {
  const el    = document.getElementById('opacity-slider');
  const valEl = document.getElementById('val-opacity');
  const fire  = () => {
    const pct = parseFloat(el.value);
    state.opacity = pct / 100;
    valEl.textContent = `${pct}%`;
    updateSliderFill(el);
    scheduleRedraw();
  };
  el.addEventListener('input', fire);
  fire();
})();

/* ── Manual number inputs for stack height, wind speed, wind direction ── */
(function bindManualInputs() {
  function bindNumericManual(numId, sliderId, stateKey, min, max, onChange) {
    const numIn  = document.getElementById(numId);
    const slider = sliderId ? document.getElementById(sliderId) : null;
    if (!numIn) return;

    function apply(v) {
      v = Math.max(min, Math.min(max, v));
      state[stateKey] = v;
      if (slider) slider.value = v;
      numIn.value  = v;
      if (slider) updateSliderFill(slider);
      if (onChange) onChange(v);
      scheduleRedraw();
    }

    if (slider) {
      // Keep number input in sync when slider changes
      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        state[stateKey] = v;
        numIn.value = v;
        updateSliderFill(slider);
        if (onChange) onChange(v);
        scheduleRedraw();
      });
    }

    numIn.addEventListener('change', () => {
      const v = parseFloat(numIn.value);
      if (!isNaN(v)) apply(v);
    });
    numIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') numIn.dispatchEvent(new Event('change'));
    });

    // Init
    apply(state[stateKey]);
  }

  bindNumericManual('stack-height-num', 'stack-height', 'H', 10, 250);

  bindNumericManual('wind-speed-num', 'wind-speed', 'windSpeed', 0.5, 15);

  bindNumericManual('wind-direction-num', null, 'windDir', 0, 359, (v) => {
    document.getElementById('unit-wind-direction').textContent = `° (${cardinalDir(v)})`;
    drawWindRose();
  });
})();

// Stability buttons
document.querySelectorAll('.stab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.stab-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    state.stab = btn.dataset.class;
    document.getElementById('val-stability-class').textContent = state.stab;
    document.getElementById('stab-desc').textContent = STABILITY_DESCRIPTIONS[state.stab];
    scheduleRedraw();
    drawSigmaChart();
  });
});
document.getElementById('stab-desc').textContent = STABILITY_DESCRIPTIONS[state.stab];


// Pollutant select
document.getElementById('pollutant-select').addEventListener('change', function () {
  state.pollutant = this.value;
  document.getElementById('val-pollutant').textContent =
    { nox: 'NOₓ', no2: 'NO₂', pm25: 'PM₂.₅' }[this.value];
  updateEmissionPresets();   // re-scale preset values and labels
  scheduleRedraw();
});

// Toggles
document.getElementById('toggle-contours').addEventListener('change', function () {
  state.showContours = this.checked; scheduleRedraw();
});


/* ── Reset ─────────────────────────────────────────────────── */
document.getElementById('btn-reset').addEventListener('click', () => {
  // ── Remove the facility marker and clear source location ──
  if (sourceMarker) {
    sourceMarker.remove();
    sourceMarker = null;
  }
  state.sourceLat = null;
  state.sourceLon = null;
  // Clear the plume canvas immediately
  const canvas = plumeLayer._canvas;
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  document.getElementById('stats-card').classList.remove('visible');
  document.getElementById('click-hint').classList.remove('hidden');
  document.getElementById('loc-lat').textContent = '—';
  document.getElementById('loc-lon').textContent = '—';

  // ── Reset all controls ────────────────────────────────────
  state.Q = 3.0; state.H = 75; state.windSpeed = 3.0;
  state.windDir = 220; state.stab = 'C'; state.pollutant = 'nox'; state.opacity = 0.70;
  state.showContours = true;

  // Emission rate (exponential slider)
  const emSlider = document.getElementById('emission-rate');
  emSlider.value = qToSlider(3.0);
  updateSliderFill(emSlider);
  document.getElementById('emission-rate-num').value = '3.00';
  document.getElementById('emission-preset').value = '';

  // Stack height
  document.getElementById('stack-height').value   = 75;
  document.getElementById('stack-height-num').value = 75;
  // Wind speed
  document.getElementById('wind-speed').value     = 3.0;
  document.getElementById('wind-speed-num').value = 3.0;
  // Wind direction
  document.getElementById('wind-direction-num').value = 220;
  // Opacity
  document.getElementById('opacity-slider').value = 70;
  document.getElementById('pollutant-select').value = 'nox';
  document.getElementById('toggle-contours').checked = true;

  ['stack-height','wind-speed','opacity-slider'].forEach(id =>
    updateSliderFill(document.getElementById(id))
  );

  document.getElementById('unit-wind-direction').textContent = `° (${cardinalDir(220)})`;
  document.getElementById('val-opacity').textContent        = '70%';
  document.getElementById('val-pollutant').textContent      = 'NOₓ';

  document.querySelectorAll('.stab-btn').forEach(b => {
    const on = b.dataset.class === 'C';
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on.toString());
  });
  document.getElementById('val-stability-class').textContent = 'C';
  document.getElementById('stab-desc').textContent           = STABILITY_DESCRIPTIONS['C'];

  drawWindRose();
  drawSigmaChart();
  updateParamsTable();
  updateEmissionPresets();   // refresh presets back to NOₓ scale
  setStatus('', 'Click the map to place an emission source');
});

/* ── Help modal ────────────────────────────────────────────── */
const helpModal = document.getElementById('help-modal');
document.getElementById('btn-help').addEventListener('click', () => { helpModal.hidden = false; });
document.getElementById('modal-close').addEventListener('click', () => { helpModal.hidden = true; });
helpModal.addEventListener('click', e => { if (e.target === helpModal) helpModal.hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') helpModal.hidden = true; });

/* ─────────────────────────────────────────────────────────────────
   10. INITIALISE
   ───────────────────────────────────────────────────────────────── */

drawWindRose();
drawSigmaChart();
updateParamsTable();
updateEmissionPresets();   // populate preset options on startup
['emission-rate','stack-height','wind-speed','opacity-slider'].forEach(id =>
  updateSliderFill(document.getElementById(id))
);
setStatus('', 'Click the map to place an emission source');

console.log('%cGaussian Plume Explorer — ready', 'color:#818cf8;font-weight:600;font-size:14px');
