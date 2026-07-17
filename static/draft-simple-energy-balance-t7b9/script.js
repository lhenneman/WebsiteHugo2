/* =========================================================
   Simple Energy Balance — script.js
   ========================================================= */

// Constants
const SIGMA = 5.67e-8; // Stefan-Boltzmann constant, W/(m^2 K^4)

// DOM Elements
const elements = {
  solar: { num: document.getElementById('solar-num'), slider: document.getElementById('solar') },
  albedo: { num: document.getElementById('albedo-num'), slider: document.getElementById('albedo') },
  layers: { num: document.getElementById('layers-num'), btnDown: document.getElementById('btn-layer-down'), btnUp: document.getElementById('btn-layer-up') },
  btnReset: document.getElementById('btn-reset'),
  
  // Math displays
  eqBalanceMath1: document.getElementById('eq-balance-math-1'),
  eqBalanceMath2: document.getElementById('eq-balance-math-2'),
  eqTempFormula: document.getElementById('eq-temp-formula'),
  eqConstSigma: document.getElementById('eq-const-sigma'),
  eqConstD: document.getElementById('eq-const-d'),
  eqSolarAvg: document.getElementById('eq-solar-avg'),
  valTemp: document.getElementById('val-temp'),
  valTempC: document.getElementById('val-temp-c'),

  // SVG Groups
  svgLayers: document.getElementById('svg-layers'),
  svgArrows: document.getElementById('svg-arrows'),
  svgLabels: document.getElementById('svg-labels'),
  svg: document.getElementById('energy-diagram')
};

// State
const state = {
  S: 1353,
  alpha: 0.0,
  n: 0
};

// Initialize
function init() {
  setupEventListeners();
  updateCalculations();
}

// Event Listeners setup
function setupEventListeners() {
  const syncInputs = (groupKey, keyInState) => {
    const group = elements[groupKey];
    
    group.slider.addEventListener('input', (e) => {
      let val = parseFloat(e.target.value);
      group.num.value = val;
      state[keyInState] = val;
      updateCalculations();
      updateSliderFill(group.slider);
    });

    group.num.addEventListener('input', (e) => {
      let val = parseFloat(e.target.value);
      // clamp based on slider min/max
      const min = parseFloat(group.slider.min);
      const max = parseFloat(group.slider.max);
      if (isNaN(val)) val = min;
      if (val < min) val = min;
      if (val > max) val = max;
      
      group.slider.value = val;
      state[keyInState] = val;
      updateCalculations();
      updateSliderFill(group.slider);
    });
    
    // Initial fill
    updateSliderFill(group.slider);
  };

  syncInputs('solar', 'S');
  syncInputs('albedo', 'alpha');

  // Layer buttons
  const updateLayerButtons = () => {
    elements.layers.btnDown.disabled = state.n <= 0;
    elements.layers.btnUp.disabled = state.n >= 5;
    elements.layers.num.value = state.n;
  };

  elements.layers.btnDown.addEventListener('click', () => {
    if (state.n > 0) {
      state.n--;
      updateLayerButtons();
      updateCalculations();
    }
  });

  elements.layers.btnUp.addEventListener('click', () => {
    if (state.n < 5) {
      state.n++;
      updateLayerButtons();
      updateCalculations();
    }
  });
  
  updateLayerButtons();

  elements.btnReset.addEventListener('click', () => {
    resetToDefaults();
  });
}

function updateSliderFill(slider) {
  const min = parseFloat(slider.min);
  const max = parseFloat(slider.max);
  const val = parseFloat(slider.value);
  const pct = ((val - min) / (max - min)) * 100;
  slider.style.setProperty('--pct', `${pct}%`);
}

function resetToDefaults() {
  elements.solar.num.value = 1353;
  elements.solar.slider.value = 1353;
  state.S = 1353;
  
  elements.albedo.num.value = 0.0;
  elements.albedo.slider.value = 0.0;
  state.alpha = 0.0;
  
  elements.layers.num.value = 0;
  state.n = 0;
  elements.layers.btnDown.disabled = true;
  elements.layers.btnUp.disabled = false;

  updateSliderFill(elements.solar.slider);
  updateSliderFill(elements.albedo.slider);
  
  updateCalculations();
}

function updateCalculations() {
  const { S, alpha, n } = state;
  
  // Math logic
  const F_avg = S / 4;
  const F_abs = F_avg * (1 - alpha);
  const F_out = (n + 1) * F_abs;
  
  // T = (F_out / sigma)^(1/4)
  let T_K = 0;
  if (F_out > 0) {
    T_K = Math.pow(F_out / SIGMA, 0.25);
  }
  const T_C = T_K - 273.15;

  // Update UI texts via KaTeX
  if (window.katex) {
    const eq1 = `\\text{Heat In} = ${n > 0 ? '(n+1)' : ''} \\frac{\\pi}{4} D^2 S (1-\\alpha)`;
    const eq2 = `\\text{Heat Out} = \\pi D^2 \\sigma T^4`;
    const eqT = `T = \\left( \\frac{${n > 0 ? '(n+1)' : ''} S (1-\\alpha)}{4\\sigma} \\right)^{\\frac{1}{4}}`;
    const eqSigma = `\\sigma = 5.672 \\times 10^{-8} \\, \\frac{\\text{W}}{\\text{m}^2 \\cdot \\text{K}^4}`;
    const eqD = `D = 12.75 \\times 10^6 \\, \\text{m}`;
    const eqAvg = `\\begin{aligned} \\text{Avg Flux} &= S \\times \\frac{\\text{Circle Area}}{\\text{Sphere Area}} \\\\ &= S \\times \\frac{\\pi r^2}{4\\pi r^2} \\\\ &= \\frac{S}{4} = ${F_avg.toFixed(1)} \\, \\frac{\\text{W}}{\\text{m}^2} \\end{aligned}`;
    
    katex.render(eq1, elements.eqBalanceMath1, { displayMode: true });
    katex.render(eq2, elements.eqBalanceMath2, { displayMode: true });
    katex.render(eqT, elements.eqTempFormula, { displayMode: true });
    if (elements.eqConstSigma) katex.render(eqSigma, elements.eqConstSigma, { displayMode: true });
    if (elements.eqConstD) katex.render(eqD, elements.eqConstD, { displayMode: true });
    if (elements.eqSolarAvg) katex.render(eqAvg, elements.eqSolarAvg, { displayMode: true });
  }

  elements.valTemp.innerText = `${T_K.toFixed(1)} K`;
  elements.valTempC.innerText = `${T_C.toFixed(1)} °C`;

  // Draw the SVG
  drawDiagram(S, alpha, n, F_abs);
}

// ─── SVG Diagram Drawing ───────────────────────────────────────────────────

function drawDiagram(S, alpha, n, F_abs) {
  // Clear previous
  elements.svgLayers.innerHTML = '';
  elements.svgArrows.innerHTML = '';
  elements.svgLabels.innerHTML = '';

  const w = 800;
  const h = 600;
  elements.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  // Base Y positions
  const ySun = 50;
  const ySpace = 50;
  const ySurface = 550;

  // Draw Earth Surface
  drawPath(`M 0 ${ySurface} Q 400 ${ySurface - 50} 800 ${ySurface} L 800 600 L 0 600 Z`, '#1e3a8a', elements.svgLayers);
  drawText(400, ySurface + 30, 'Earth Surface', '#ffffff', '18px', 'middle');

  // Draw Sun
  drawCircle(100, ySun, 40, '#facc15', elements.svgLayers);
  drawText(100, ySun + 5, 'Sun', '#000000', '16px', 'middle');

  // Layer Y positions
  // Top layer is i=1, bottom is i=n
  const layerYs = [];
  if (n > 0) {
    const startY = 150;
    const endY = 450;
    const spacing = (endY - startY) / (n + 1);
    for (let i = 1; i <= n; i++) {
      const y = startY + i * spacing;
      layerYs.push(y);
      // Draw layer rectangle
      const rectH = 24;
      drawRect(50, y - rectH/2, 700, rectH, 'rgba(180,195,255,0.2)', '#b4c3ff', elements.svgLayers);
      drawText(740, y + 5, `Atmosphere Layer ${i} ${i===1?'(Top)':''} ${i===n&&n>1?'(Bottom)':''}`, '#b4c3ff', '14px', 'end');
    }
  }

  // --- ARROWS ---
  
  // 1. Solar Radiation (Shortwave)
  const xSolar = 150;
  // Sun to surface (showing average flux across sphere)
  drawArrow(xSolar, ySun + 45, ySurface - 20, '#facc15', `${F_abs.toFixed(1)} (Absorbed avg)`, 10, 0, 'start');
  
  // Reflected
  if (alpha > 0) {
    const f_ref = (S / 4) * alpha;
    // from surface back to space (angled)
    const xReflectStart = xSolar + 10;
    const yReflectStart = ySurface - 25;
    const xReflectEnd = xSolar + 60;
    const yReflectEnd = ySpace;
    
    const dx = xReflectEnd - xReflectStart;
    const dy = yReflectEnd - yReflectStart;
    const len = Math.sqrt(dx*dx + dy*dy);
    const ux = dx / len;
    const uy = dy / len;
    
    const tipX = xReflectEnd;
    const tipY = yReflectEnd;
    const arrowLen = 12;
    const arrowWidth = 6;
    
    const baseX = tipX - arrowLen * ux;
    const baseY = tipY - arrowLen * uy;
    const nx = -uy;
    const ny = ux;
    
    const p1 = `${tipX},${tipY}`;
    const p2 = `${baseX + arrowWidth * nx},${baseY + arrowWidth * ny}`;
    const p3 = `${baseX - arrowWidth * nx},${baseY - arrowWidth * ny}`;
    
    // Draw line shortened slightly so it doesn't poke through the tip
    drawLine(xReflectStart, yReflectStart, tipX - (arrowLen - 2) * ux, tipY - (arrowLen - 2) * uy, '#facc15', elements.svgArrows);
    drawPolygon(`${p1} ${p2} ${p3}`, '#facc15', elements.svgArrows);
    
    drawText(xReflectEnd + 10, yReflectEnd + 30, `${f_ref.toFixed(1)} (Reflected)`, '#facc15', '14px', 'start');
  }

  // 2. Longwave Radiation (Red)
  const xUp = 350;
  const xDown = 550;
  
  // Surface upwards
  const surfaceEmits = (n + 1) * F_abs;
  const targetY_up = n > 0 ? layerYs[n-1] + 15 : ySpace;
  drawArrow(xUp, ySurface - 25, targetY_up, '#ef4444', `${surfaceEmits.toFixed(1)}`, -10, 0, 'end');

  // Layers emitting
  for (let i = 1; i <= n; i++) {
    const emitFlux = i * F_abs;
    const currentY = layerYs[i-1];
    
    // Upwards
    const nextY_up = (i === 1) ? ySpace : layerYs[i-2] + 15;
    drawArrow(xUp, currentY - 15, nextY_up, '#ef4444', `${emitFlux.toFixed(1)}`, -10, 0, 'end');
    
    // Downwards
    const nextY_down = (i === n) ? ySurface - 20 : layerYs[i] - 15;
    drawArrow(xDown, currentY + 15, nextY_down, '#ef4444', `${emitFlux.toFixed(1)}`, 10, 0, 'start');
  }

  // --- LEGEND ---
  const legX = 620;
  const legY = 40;
  drawRect(legX - 10, legY - 20, 160, 60, 'rgba(13,15,20,0.8)', '#b4c3ff', elements.svgLayers);
  
  drawLine(legX, legY, legX + 20, legY, '#facc15', elements.svgArrows);
  drawText(legX + 30, legY + 5, 'Visible Light', '#facc15', '14px', 'start');
  
  drawLine(legX, legY + 20, legX + 20, legY + 20, '#ef4444', elements.svgArrows);
  drawText(legX + 30, legY + 25, 'Infrared', '#ef4444', '14px', 'start');
}

// ─── SVG Helper Functions ──────────────────────────────────────────────────

function drawPath(d, fill, parent) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', fill);
  parent.appendChild(path);
}

function drawCircle(cx, cy, r, fill, parent) {
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', cx);
  circle.setAttribute('cy', cy);
  circle.setAttribute('r', r);
  circle.setAttribute('fill', fill);
  parent.appendChild(circle);
}

function drawRect(x, y, w, h, fill, stroke, parent) {
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', x);
  rect.setAttribute('y', y);
  rect.setAttribute('width', w);
  rect.setAttribute('height', h);
  rect.setAttribute('fill', fill);
  rect.setAttribute('stroke', stroke);
  rect.setAttribute('stroke-width', '1');
  rect.setAttribute('rx', '4');
  parent.appendChild(rect);
}

function drawLine(x1, y1, x2, y2, color, parent) {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '3');
  parent.appendChild(line);
}

function drawPolygon(points, fill, parent) {
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  poly.setAttribute('points', points);
  poly.setAttribute('fill', fill);
  parent.appendChild(poly);
}

function drawText(x, y, textContent, color, size, align) {
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', x);
  text.setAttribute('y', y);
  text.setAttribute('fill', color);
  text.setAttribute('font-size', size);
  text.setAttribute('font-weight', '500');
  text.setAttribute('text-anchor', align);
  text.textContent = textContent;
  
  // Add a slight text shadow for readability
  text.setAttribute('style', 'text-shadow: 0px 2px 4px rgba(0,0,0,0.8);');
  
  elements.svgLabels.appendChild(text);
}

function drawArrow(x, y1, y2, color, label, labelOffsetX, labelOffsetY, labelAlign) {
  const isUp = y1 > y2;
  
  // Draw line body, shortened slightly to make room for arrowhead
  const offset = 8;
  const endY = isUp ? y2 + offset : y2 - offset;
  drawLine(x, y1, x, endY, color, elements.svgArrows);
  
  // Draw arrowhead polygon manually
  const arrowW = 6;
  const arrowH = 10;
  let points = "";
  if (isUp) {
    points = `${x},${y2} ${x - arrowW},${y2 + arrowH} ${x + arrowW},${y2 + arrowH}`;
  } else {
    points = `${x},${y2} ${x - arrowW},${y2 - arrowH} ${x + arrowW},${y2 - arrowH}`;
  }
  drawPolygon(points, color, elements.svgArrows);
  
  // Label in the middle of the arrow
  const midY = (y1 + y2) / 2;
  drawText(x + labelOffsetX, midY + labelOffsetY, label, color, '14px', labelAlign);
}

// Start
document.addEventListener('DOMContentLoaded', init);
