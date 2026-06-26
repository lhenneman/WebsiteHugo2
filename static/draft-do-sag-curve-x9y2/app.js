/* =========================================================
   DO Sag Curve Explorer — app.js
   ========================================================= */

// Chart instance
let sagChart = null;

// Constants for Henry's Law
const KH_STANDARD = 1.3e-3; // mol/(L*atm) at 298.15 K
const C_TEMP = 1700; // K
const T_STANDARD = 298.15; // K
const PO2_FRACTION = 0.2095;
const MO2 = 31.998; // g/mol

// Arrays to store generated data for CSV export
let exportData = [];

// DOM Elements
const elements = {
  waterTemp: { num: document.getElementById('water-temp-num'), slider: document.getElementById('water-temp') },
  pressure: { num: document.getElementById('pressure-num'), slider: document.getElementById('pressure') },
  velocity: { num: document.getElementById('velocity-num'), slider: document.getElementById('velocity') },
  doInitial: { num: document.getElementById('do-initial-num'), slider: document.getElementById('do-initial') },
  bodUltimate: { num: document.getElementById('bod-ultimate-num'), slider: document.getElementById('bod-ultimate') },
  kd: { num: document.getElementById('kd-num'), slider: document.getElementById('kd') },
  kr: { num: document.getElementById('kr-num'), slider: document.getElementById('kr') },
  toggleXAxis: document.getElementById('toggle-x-axis'),
  btnDownload: document.getElementById('btn-download'),
  btnReset: document.getElementById('btn-reset'),
  
  // Displays
  valDos: document.getElementById('val-dos'),
  valDo0: document.getElementById('val-do0'),
  calculatedD0: document.getElementById('calculated-d0'),
  statMinDo: document.getElementById('stat-min-do'),
  statCritDist: document.getElementById('stat-crit-dist'),
  statCritTime: document.getElementById('stat-crit-time')
};

// Initial Default Values
const defaults = {
  waterTemp: 20.0,
  pressure: 1.00,
  velocity: 0.30,
  doInitial: 6.0,
  bodUltimate: 20,
  kd: 0.2,
  kr: 0.4
};

function init() {
  setupEventListeners();
  initChart();
  updateModel();
}

function setupEventListeners() {
  // Sync sliders and inputs
  const pairs = [
    elements.waterTemp, elements.pressure, elements.velocity,
    elements.doInitial, elements.bodUltimate, elements.kd, elements.kr
  ];

  pairs.forEach(pair => {
    pair.slider.addEventListener('input', (e) => {
      pair.num.value = e.target.value;
      updateModel();
    });
    pair.num.addEventListener('input', (e) => {
      pair.slider.value = e.target.value;
      updateModel();
    });
  });

  elements.toggleXAxis.addEventListener('change', updateModel);
  
  elements.btnDownload.addEventListener('click', downloadCSV);
  
  elements.btnReset.addEventListener('click', () => {
    for (const [key, val] of Object.entries(defaults)) {
      elements[key].num.value = val;
      elements[key].slider.value = val;
    }
    updateModel();
  });
}

function getParams() {
  return {
    T_C: parseFloat(elements.waterTemp.num.value),
    P_atm: parseFloat(elements.pressure.num.value),
    v_ms: parseFloat(elements.velocity.num.value),
    DO_0: parseFloat(elements.doInitial.num.value),
    L_a: parseFloat(elements.bodUltimate.num.value),
    k_d: parseFloat(elements.kd.num.value),
    k_r: parseFloat(elements.kr.num.value)
  };
}

function calculateDOs(T_C, P_atm) {
  const T_K = T_C + 273.15;
  const kH = KH_STANDARD * Math.exp(C_TEMP * (1 / T_K - 1 / T_STANDARD));
  const pO2 = PO2_FRACTION * P_atm;
  const DOs_mol = kH * pO2; // mol/L
  const DOs_mg = DOs_mol * MO2 * 1000; // mg/L
  return DOs_mg;
}

function updateModel() {
  let { T_C, P_atm, v_ms, DO_0, L_a, k_d, k_r } = getParams();

  // Handle edge case k_d == k_r
  if (Math.abs(k_d - k_r) < 0.0001) {
    k_r += 0.0001;
  }

  // Calculate saturated DO & Initial Deficit
  const DO_s = calculateDOs(T_C, P_atm);
  let D_0 = DO_s - DO_0;
  
  // Constrain DO_0 so it doesn't exceed DO_s for physical realism in this context
  if (D_0 < 0) {
    D_0 = 0;
  }

  elements.valDos.textContent = DO_s.toFixed(2);
  elements.valDo0.textContent = DO_0.toFixed(2);
  elements.calculatedD0.textContent = D_0.toFixed(2);

  // Calculate Critical Time and Distance
  // tc = 1/(kr - kd) * ln[ kr/kd * (1 - D0*(kr-kd)/(kd*La)) ]
  const innerTerm = (k_r / k_d) * (1 - (D_0 * (k_r - k_d)) / (k_d * L_a));
  
  let t_c = 0;
  let x_c = 0;

  if (innerTerm > 0) {
    t_c = (1 / (k_r - k_d)) * Math.log(innerTerm);
    if (t_c < 0) t_c = 0;
  }

  x_c = v_ms * t_c * 86.4; // v(m/s) * t(d) * (86400 s/d) / (1000 m/km) = km
  
  // Generate Data for Chart (up to 20 days)
  const maxDays = 20;
  const numPoints = 200;
  const dt = maxDays / numPoints;
  
  const doData = [];
  const bodData = [];
  exportData = [];
  
  let actualMinDo = DO_s;

  const useTimeX = elements.toggleXAxis.checked;

  for (let i = 0; i <= numPoints; i++) {
    const t = i * dt;
    const x = v_ms * t * 86.4;
    
    // Streeter-Phelps
    const deficit = (k_d * L_a) / (k_r - k_d) * (Math.exp(-k_d * t) - Math.exp(-k_r * t)) + D_0 * Math.exp(-k_r * t);
    let DO_t = DO_s - deficit;
    if (DO_t < 0) DO_t = 0;
    
    const L_t = L_a * Math.exp(-k_d * t);
    
    if (DO_t < actualMinDo) {
      actualMinDo = DO_t;
    }
    
    // X-axis mapping
    const xVal = useTimeX ? t : x;
    doData.push({ x: xVal, y: DO_t });
    bodData.push({ x: xVal, y: L_t });
    
    exportData.push({
      time_days: t.toFixed(3),
      distance_km: x.toFixed(3),
      DO_mgL: DO_t.toFixed(3),
      BOD_mgL: L_t.toFixed(3),
      Deficit_mgL: deficit.toFixed(3)
    });
  }

  // Update Stats
  elements.statMinDo.textContent = actualMinDo.toFixed(2) + " mg/L";
  elements.statCritTime.textContent = t_c.toFixed(2) + " d";
  elements.statCritDist.textContent = x_c.toFixed(2) + " km";

  // Update Chart
  sagChart.data.datasets[0].data = doData;
  sagChart.data.datasets[1].data = bodData;
  sagChart.options.scales.x.title.text = useTimeX ? 'Time (days)' : 'Distance (km)';
  
  // Annotations
  const critXValue = useTimeX ? t_c : x_c;
  const initialXValue = 0;

  sagChart.options.plugins.annotation = {
    annotations: {
      lineSat: {
        type: 'line',
        yMin: DO_s,
        yMax: DO_s,
        borderColor: 'rgba(255, 255, 255, 0.4)',
        borderWidth: 2,
        borderDash: [5, 5],
        label: {
          display: true,
          content: 'DO Saturation (' + DO_s.toFixed(2) + ')',
          position: 'end',
          backgroundColor: 'rgba(0,0,0,0.6)',
          color: '#b8c4e8',
          font: { family: "'Inter', sans-serif", size: 11 }
        }
      },
      initialDeficitLine: {
        type: 'line',
        xMin: initialXValue,
        xMax: initialXValue,
        yMin: DO_0,
        yMax: DO_s,
        borderColor: '#fb923c',
        borderWidth: 2,
        arrowHeads: {
          start: { display: true, length: 8, width: 4 },
          end: { display: true, length: 8, width: 4 }
        },
        label: {
          display: true,
          content: 'Initial Deficit: ' + D_0.toFixed(2),
          position: 'end',
          xAdjust: 60,
          yAdjust: -20,
          backgroundColor: 'rgba(251, 146, 60, 0.15)',
          color: '#fb923c',
          font: { family: "'JetBrains Mono', monospace", size: 11, weight: 'bold' }
        }
      },
      maxDeficitLine: {
        type: 'line',
        xMin: critXValue,
        xMax: critXValue,
        yMin: actualMinDo,
        yMax: DO_s,
        borderColor: '#f87171',
        borderWidth: 2,
        arrowHeads: {
          start: { display: true, length: 8, width: 4 },
          end: { display: true, length: 8, width: 4 }
        },
        label: {
          display: true,
          content: 'Max Deficit: ' + (DO_s - actualMinDo).toFixed(2),
          position: 'end',
          xAdjust: 60,
          yAdjust: 20,
          backgroundColor: 'rgba(248, 113, 113, 0.15)',
          color: '#f87171',
          font: { family: "'JetBrains Mono', monospace", size: 11, weight: 'bold' }
        }
      }
    }
  };

  // Determine a nice step size for the x-axis to force integers/multiples
  let maxX = useTimeX ? maxDays : v_ms * maxDays * 86.4;
  let stepSize = undefined;
  if (maxX <= 25) {
    stepSize = Math.max(1, Math.floor(maxX / 10)); // Will be 1 or 2
  } else if (maxX <= 100) {
    stepSize = 5;
  } else if (maxX <= 200) {
    stepSize = 10;
  } else {
    stepSize = Math.floor(maxX / 10 / 10) * 10; // 20, 30, 40, etc.
  }

  if (sagChart.options.scales.x.ticks) {
    sagChart.options.scales.x.ticks.stepSize = stepSize;
  }

  sagChart.update();
}

function initChart() {
  const ctx = document.getElementById('sagChart').getContext('2d');
  
  Chart.defaults.color = '#b8c4e8';
  Chart.defaults.font.family = "'Inter', sans-serif";
  
  sagChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Dissolved Oxygen (DO)',
          data: [],
          borderColor: '#0ea5e9',
          backgroundColor: 'rgba(14, 165, 233, 0.1)',
          borderWidth: 3,
          pointRadius: 0,
          tension: 0.2,
          fill: true
        },
        {
          label: 'Biochemical Oxygen Demand (BOD)',
          data: [],
          borderColor: '#4ade80',
          borderWidth: 3,
          borderDash: [5, 5],
          pointRadius: 0,
          tension: 0.2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        tooltip: {
          backgroundColor: 'rgba(11, 14, 26, 0.9)',
          titleColor: '#fff',
          bodyColor: '#b8c4e8',
          borderColor: 'rgba(180,195,255,0.22)',
          borderWidth: 1,
          padding: 10
        },
        legend: {
          position: 'top',
          labels: {
            usePointStyle: true,
            boxWidth: 8
          }
        },
        annotation: {} // Placeholder to be populated in updateModel
      },
      scales: {
        x: {
          type: 'linear',
          title: {
            display: true,
            text: 'Distance (km)'
          },
          grid: {
            color: 'rgba(180,195,255,0.05)'
          },
          ticks: {
            maxTicksLimit: 20,
            callback: function(value) {
              if (value % 1 === 0 || value % 5 === 0 || value % 10 === 0) {
                return value;
              }
              return null;
            }
          }
        },
        y: {
          title: {
            display: true,
            text: 'Concentration (mg/L)'
          },
          min: 0,
          grid: {
            color: 'rgba(180,195,255,0.1)'
          }
        }
      }
    }
  });
}

function downloadCSV() {
  if (!exportData || exportData.length === 0) return;
  
  const headers = ['time_days', 'distance_km', 'DO_mgL', 'BOD_mgL', 'Deficit_mgL'];
  const csvRows = [];
  
  // Header row
  csvRows.push(headers.join(','));
  
  // Data rows
  for (const row of exportData) {
    csvRows.push(headers.map(h => row[h]).join(','));
  }
  
  const csvString = csvRows.join('\n');
  const blob = new Blob([csvString], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.setAttribute('href', url);
  a.setAttribute('download', 'do_sag_curve_data.csv');
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Start
document.addEventListener('DOMContentLoaded', init);
