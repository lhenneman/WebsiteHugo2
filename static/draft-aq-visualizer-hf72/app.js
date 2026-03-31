document.addEventListener('DOMContentLoaded', () => {
    const map = L.map('map').setView([38.9072, -77.0369], 10);

    // Panes for map layering hierarchy (Restored from website)
    map.createPane('boundariesPane');
    map.getPane('boundariesPane').style.zIndex = 390;
    map.createPane('roadsPane');
    map.getPane('roadsPane').style.zIndex = 395;
    map.createPane('cordonPane');
    map.getPane('cordonPane').style.zIndex = 410;
    map.getPane('cordonPane').style.pointerEvents = 'none';

    const tileLayerUrl = 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png';
    const tileLayerAttrib = '&copy; OpenStreetMap &copy; CARTO';
    L.tileLayer(tileLayerUrl, { attribution: tileLayerAttrib, maxZoom: 19 }).addTo(map);

    let geojsonData = null;
    let geojsonLayer = null;
    let cordonLayer = null;
    let boundariesLayer = null;
    let cachedCordons = {};

    const CORDON_FILES = {
        'c0_t1': 'dc_cordon_small_te.geojson',
        'c0_t2': 'dc_cordon_small_te.geojson',
        'c1_t1': 'dc_cordon_small_ti.geojson',
        'c1_t2': 'dc_cordon_small_ti.geojson',
        'c2_t1': 'dc_cordon_large.geojson',
        'c2_t2': 'dc_cordon_large.geojson'
    };

    // --- State ---
    const POLLUTANTS = ['O3_MDA8_MO', 'NO2_MO', 'PM25_TOT_MO'];
    const MONTHS = ['Feb', 'May', 'Aug', 'Nov'];
    const SCENARIOS = ['c0_t1', 'c0_t2', 'c1_t1', 'c1_t2', 'c2_t1', 'c2_t2'];
    let globalLimits = {};
    let isUserSliding = false;

    let currentMonth = 'Feb';
    let currentScenario = 'baseline';
    let currentScenarioType = 'baseline';
    let currentPollutant = 'NO2_MO';

    // --- DOM Elements ---
    const pollutantSelect = document.getElementById('pollutantSelect');
    const scenarioDesc = document.getElementById('scenarioDesc');
    const legendGradient = document.getElementById('legendGradient');
    const scaleMinSlider = document.getElementById('scaleMinSlider');
    const scaleMaxSlider = document.getElementById('scaleMaxSlider');
    const sliderMinReadout = document.getElementById('sliderMinReadout');
    const sliderMaxReadout = document.getElementById('sliderMaxReadout');
    const labelGlobalMin = document.getElementById('labelGlobalMin');
    const labelGlobalMid = document.getElementById('labelGlobalMid');
    const labelGlobalMax = document.getElementById('labelGlobalMax');
    const infoPanel = document.getElementById('infoPanel');
    const infoContent = document.getElementById('infoContent');

    // Secure custom tooltip from HTML
    const customTooltip = document.getElementById('scenarioTooltip');
    const getTooltipText = (scen) => {
        const cordonTxt = scen.startsWith('c0') ? 'Small cordon with no toll on 395' : (scen.startsWith('c1') ? 'Small cordon with toll on 395' : 'Large cordon');
        const tollTxt = scen.endsWith('t1') ? 'Low Toll ($)' : 'High Toll ($$)';
        return `${cordonTxt} - ${tollTxt}`;
    };

    // --- Render Scenario SVGs ---
    function renderScenarioGrid() {
        const grid = document.getElementById('scenarioGrid');

        // Explicit shapefiles parsed to SVG
        const svgBoundaries = `<path d="M 20.6,24.4 L 23.6,25.2 L 25.5,25.7 L 31.8,29.0 L 31.8,29.0 L 31.7,34.4 L 36.5,36.7 L 42.2,37.2 L 44.9,41.1 L 44.9,41.1 L 47.9,45.0 L 53.1,49.7 L 53.1,53.2 L 53.1,59.7 L 53.1,60.5 L 52.9,65.5 L 52.9,66.7 L 51.6,70.3 L 49.0,70.4 L 48.3,70.9 L 43.6,75.0 L 43.8,80.1 L 34.3,80.0 L 32.0,80.0 L 29.9,84.1 L 5.0,78.7 L 17.0,23.8 L 20.6,24.4 Z M 52.9,33.1 L 56.8,37.0 L 66.2,46.5 L 59.1,53.6 L 53.1,59.7 L 53.1,53.2 L 53.1,49.7 L 47.9,45.0 L 44.9,41.1 L 52.9,33.1 Z M 38.4,84.5 L 43.9,82.8 L 43.8,80.1 L 43.6,75.0 L 48.3,70.9 L 49.0,70.4 L 51.6,70.3 L 52.9,66.7 L 52.9,65.5 L 53.1,60.5 L 53.1,59.7 L 59.1,53.6 L 66.2,46.5 L 56.8,37.0 L 52.9,33.1 L 44.9,41.1 L 44.9,41.1 L 42.2,37.2 L 36.5,36.7 L 31.7,34.4 L 31.8,29.0 L 31.8,29.0 L 25.5,25.7 L 23.6,25.2 L 20.6,24.4 L 17.0,23.8 L 21.1,5.0 L 95.0,21.5 L 78.3,95.0 L 37.4,85.8 L 38.4,84.5 Z" fill="#f8fafc" stroke="#1f2937" stroke-width="1.5" />`;

        const getCordonSVG = (scen) => {
            if (scen.startsWith('c0')) return `<path d="M 51.9,44.0 L 52.2,44.0 L 52.5,44.1 L 52.7,44.1 L 53.0,44.4 L 53.9,44.7 L 54.0,44.8 L 55.2,44.9 L 55.3,45.1 L 56.9,45.1 L 56.9,48.0 L 55.9,47.8 L 54.9,47.8 L 54.1,47.7 L 53.8,48.1 L 53.1,48.4 L 52.7,48.5 L 51.8,47.6 L 51.8,47.5 L 51.4,46.4 L 51.3,45.5 L 51.3,45.0 L 51.9,44.3 L 51.9,44.0 Z M 54.8,51.1 L 53.8,50.0 L 52.9,49.0 L 53.5,48.4 L 54.4,47.9 L 54.9,47.9 L 55.8,47.9 L 56.9,48.3 L 57.2,48.3 L 57.7,48.5 L 57.8,48.7 L 57.8,49.2 L 56.9,49.3 L 56.0,50.4 L 55.2,50.6 L 54.8,51.1 Z" fill="#ef4444" fill-opacity="0.65" />`;
            if (scen.startsWith('c1')) return `<path d="M 55.2,50.6 L 54.8,51.1 L 53.3,49.4 L 51.8,47.8 L 51.8,47.5 L 51.5,46.5 L 51.3,45.5 L 51.3,45.0 L 51.9,44.3 L 51.9,44.0 L 52.2,44.0 L 52.5,44.1 L 52.7,44.1 L 52.8,44.2 L 53.0,44.4 L 53.9,44.7 L 54.0,44.8 L 55.2,44.9 L 55.3,45.1 L 56.9,45.1 L 56.9,47.1 L 56.9,48.3 L 57.2,48.3 L 57.7,48.5 L 57.8,48.7 L 57.8,49.2 L 56.9,49.2 L 56.5,49.8 L 56.0,50.4 L 55.2,50.6 Z" fill="#f59e0b" fill-opacity="0.65" />`;
            if (scen.startsWith('c2')) return `<path d="M 51.9,44.0 L 51.9,44.3 L 51.8,44.5 L 50.8,44.5 L 50.1,44.6 L 49.9,44.6 L 49.5,44.9 L 49.5,45.2 L 49.5,45.5 L 49.2,45.6 L 49.4,46.8 L 49.2,47.0 L 49.0,47.3 L 48.6,47.5 L 48.7,48.7 L 49.0,49.2 L 49.4,49.7 L 49.7,49.8 L 49.8,49.9 L 49.9,49.9 L 50.3,49.8 L 50.6,50.1 L 50.6,50.7 L 50.9,50.8 L 51.1,50.8 L 51.6,50.8 L 51.7,50.9 L 51.6,52.1 L 51.8,52.1 L 51.9,52.2 L 52.0,52.2 L 52.2,51.8 L 52.2,50.8 L 52.6,49.7 L 53.5,49.4 L 54.8,51.1 L 55.2,50.6 L 56.0,50.4 L 56.7,49.5 L 57.0,49.3 L 57.8,49.3 L 57.8,48.7 L 57.8,48.5 L 57.8,48.1 L 57.8,45.6 L 56.9,45.6 L 56.9,44.1 L 56.6,44.2 L 52.7,44.2 L 52.7,44.1 L 52.5,44.1 L 52.2,44.0 L 51.9,44.0 Z" fill="#8b5cf6" fill-opacity="0.65" />`;
            return '';
        };

        const getTollText = (scen) => {
            return scen.endsWith('t1') ? '$' : '$$';
        };

        grid.innerHTML = SCENARIOS.map(scen => {
            return `
            <button class="scenario-btn flex flex-row items-center justify-between p-2 rounded-lg border-[3px] border-gray-200 bg-white hover:border-blue-400 hover:bg-blue-50 transition shadow-sm h-24" data-val="${scen}">
                
                <!-- Zoomed SVG contained beautifully inside an explicit box without covering the dollar sign -->
                <div class="relative w-[76px] h-[76px] bg-gray-50 rounded border border-gray-100 flex-shrink-0 overflow-hidden">
                    <svg viewBox="0 0 100 100" class="w-full h-full">
                        <!-- Scale pushes bounds to edge, translated to center purely on DC -->
                        <g transform="translate(50, 50) scale(3.5) translate(-55, -46)">
                            ${svgBoundaries}
                            ${getCordonSVG(scen)}
                        </g>
                    </svg>
                </div>
                
                <!-- Separated distinct toll sign -->
                <div class="flex-1 text-center pr-2 font-black text-green-700" style="font-size: 32px;">
                    ${getTollText(scen)}
                </div>

            </button>
            `;
        }).join('');

        // Attach robust non-bubbling tooltip events directly to the new buttons
        document.querySelectorAll('.scenario-btn').forEach(btn => {
            btn.addEventListener('mouseenter', e => {
                if (btn.dataset.val === 'baseline') return;
                customTooltip.textContent = getTooltipText(btn.dataset.val);
                customTooltip.style.opacity = '1';
                customTooltip.style.left = e.clientX + 15 + 'px';
                customTooltip.style.top = e.clientY + 15 + 'px';
            });
            btn.addEventListener('mousemove', e => {
                customTooltip.style.left = e.clientX + 15 + 'px';
                customTooltip.style.top = e.clientY + 15 + 'px';
            });
            btn.addEventListener('mouseleave', () => {
                customTooltip.style.opacity = '0';
            });
        });
    }
    renderScenarioGrid();

    // Fast delegated tooltip listener logic removed due to bubbling issues

    // --- Init UI Interactions ---
    function updateScenarioActiveState() {
        document.querySelectorAll('.scenario-btn').forEach(b => {
            b.classList.remove('bg-blue-100', 'border-blue-500', 'text-blue-800', 'bg-blue-50');
            b.classList.add('bg-white', 'border-gray-200', 'text-gray-700');
            if (b.id === 'baselineBtn') {
                b.classList.add('bg-gray-50');
            }
        });
        const activeBtn = document.querySelector(`.scenario-btn[data-val="${currentScenario}"]`);
        if (activeBtn) {
            activeBtn.classList.remove('bg-white', 'border-gray-200', 'text-gray-700', 'bg-gray-50');
            activeBtn.classList.add('bg-blue-100', 'border-blue-500', 'text-blue-800');
        }
    }

    document.querySelectorAll('.month-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.month-btn').forEach(b => {
                b.classList.remove('bg-blue-500', 'text-white');
                b.classList.add('bg-gray-100', 'text-gray-700');
            });
            const t = e.currentTarget;
            t.classList.remove('bg-gray-100', 'text-gray-700');
            t.classList.add('bg-blue-500', 'text-white');
            currentMonth = t.dataset.val;
            updateMap();
        });
    });

    document.querySelectorAll('.scenario-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            let newScenario = e.currentTarget.dataset.val;
            let newType = newScenario === 'baseline' ? 'baseline' : 'delta';
            if (newType !== currentScenarioType) isUserSliding = false;
            currentScenarioType = newType;
            currentScenario = newScenario;
            updateScenarioActiveState();
            updateScenarioDescription();
            updateMap();
            updateCordon(); // Re-render cordon shapefile outline
        });
    });
    updateScenarioActiveState();

    pollutantSelect.addEventListener('change', (e) => {
        currentPollutant = e.target.value;
        isUserSliding = false;
        updateMap();
    });

    // Info Modal Logic
    document.getElementById('infoBtn').addEventListener('click', () => {
        document.getElementById('infoModalOverlay').classList.remove('hidden');
    });
    document.getElementById('closeInfoBtn').addEventListener('click', () => {
        document.getElementById('infoModalOverlay').classList.add('hidden');
    });
    document.getElementById('infoModalOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
    });

    // Sliders
    scaleMinSlider.addEventListener('input', (e) => {
        isUserSliding = true;
        let val = Math.round(parseFloat(e.target.value) * 10) / 10;
        let activeMid = parseFloat(labelGlobalMid.textContent);
        let upperLimit = (currentScenario === 'baseline') ? activeMid : -0.1;
        if (val > upperLimit) { val = upperLimit; e.target.value = val; }
        sliderMinReadout.textContent = val.toFixed(1);
        updateMapDebounced();
    });

    scaleMaxSlider.addEventListener('input', (e) => {
        isUserSliding = true;
        let val = Math.round(parseFloat(e.target.value) * 10) / 10;
        let activeMid = parseFloat(labelGlobalMid.textContent);
        let lowerLimit = (currentScenario === 'baseline') ? activeMid : 0.1;
        if (val < lowerLimit) { val = lowerLimit; e.target.value = val; }
        sliderMaxReadout.textContent = val.toFixed(1);
        updateMapDebounced();
    });

    let debounceTimer;
    function updateMapDebounced() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => { updateMap(); }, 50);
    }

    function updateScenarioDescription() {
        if (currentScenario === 'baseline') {
            scenarioDesc.textContent = "Baseline scenario showing absolute concentrations.";
        } else {
            scenarioDesc.textContent = `Showing difference from Baseline. Red = Increase, Blue = Decrease.`;
        }
    }

    // --- Data Fetching ---
    fetch('./data/dc_tracts_aq.geojson').then(res => res.json()).then(tractsData => {
        geojsonData = tractsData;
        calculateGlobalLimits();

        // Fetch Boundaries (Restored)
        fetch('./data/boundaries.geojson').then(res => res.json()).then(bd => {
            boundariesLayer = L.geoJSON(bd, {
                pane: 'boundariesPane',
                style: {
                    color: '#6B7280', // Gray-500
                    weight: 2.5,
                    opacity: 0.8,
                    dashArray: '6, 6' // Dashed for state borders
                },
                interactive: false
            }).addTo(map);
        }).catch(e => console.log('No boundaries geojson', e));

        fetch('./data/roads.geojson').then(res => res.json()).then(roadsData => {
            if (roadsData) {
                L.geoJSON(roadsData, {
                    pane: 'roadsPane',
                    style: { color: '#9CA3AF', weight: 2.0, opacity: 0.8 },
                    interactive: false
                }).addTo(map);
            }
            updateMap();
        }).catch(() => { updateMap(); });
    }).catch(error => console.error('Error loading data:', error));

    function calculateGlobalLimits() {
        POLLUTANTS.forEach(pollutant => {
            let baselineValues = [];
            MONTHS.forEach(month => {
                geojsonData.features.forEach(f => {
                    const val = f.properties[`${month}_baseline_${pollutant}`];
                    if (val !== null && !isNaN(val)) baselineValues.push(val);
                });
            });
            let deltaValues = [];
            MONTHS.forEach(month => {
                SCENARIOS.forEach(scen => {
                    geojsonData.features.forEach(f => {
                        const val = f.properties[`${month}_${scen}_${pollutant}_delta`];
                        if (val !== null && !isNaN(val)) deltaValues.push(val);
                    });
                });
            });
            globalLimits[pollutant] = {
                baseline: [Math.min(...baselineValues), Math.max(...baselineValues)],
                delta: [Math.min(...deltaValues), Math.max(...deltaValues)]
            };
        });
    }

    // --- Cordon Logic ---
    function updateCordon() {
        if (cordonLayer) {
            map.removeLayer(cordonLayer);
            cordonLayer = null;
        }

        if (currentScenario === 'baseline') return;

        const filename = CORDON_FILES[currentScenario];
        if (!filename) return;

        if (cachedCordons[filename]) {
            renderCordon(cachedCordons[filename]);
        } else {
            fetch(`./data/cordons/${filename}`)
                .then(res => res.json())
                .then(data => {
                    cachedCordons[filename] = data;
                    if (CORDON_FILES[currentScenario] === filename) {
                        renderCordon(data);
                    }
                })
                .catch(err => console.error("Error loading cordon:", err));
        }
    }

    function renderCordon(data) {
        cordonLayer = L.geoJSON(data, {
            pane: 'cordonPane',
            style: {
                color: '#000000', // Solid black
                weight: 3,
                opacity: 0.8,
                dashArray: '',
                fill: false
            },
            interactive: false
        }).addTo(map);
    }

    // --- Map Logic ---
    function updateMap() {
        if (!geojsonData) return;
        if (geojsonLayer) map.removeLayer(geojsonLayer);

        let propertyKey;
        let showDelta = false;
        if (currentScenario === 'baseline') {
            propertyKey = `${currentMonth}_baseline_${currentPollutant}`;
            showDelta = false;
        } else {
            propertyKey = `${currentMonth}_${currentScenario}_${currentPollutant}_delta`;
            showDelta = true;
        }

        const limits = globalLimits[currentPollutant];
        if (!limits) return;

        let min, max, mid;
        if (!showDelta) {
            [min, max] = limits.baseline;
            if (currentPollutant === 'NO2_MO' || currentPollutant === 'PM25_TOT_MO') min = 0;
            min = Math.floor(min);
            max = Math.ceil(max);
            mid = (min + max) / 2;
        } else {
            let [dMin, dMax] = limits.delta;
            const rawAbsMax = Math.max(Math.abs(dMin), Math.abs(dMax));
            const absMax = Math.ceil((Math.round(rawAbsMax * 1000) / 1000) * 10) / 10;
            min = -absMax; max = absMax; mid = 0;
        }

        if (!isUserSliding) {
            scaleMinSlider.min = min; scaleMinSlider.max = max + 0.001; scaleMinSlider.value = min;
            scaleMaxSlider.min = min; scaleMaxSlider.max = max + 0.001; scaleMaxSlider.value = max;
            sliderMinReadout.textContent = min.toFixed(1);
            sliderMaxReadout.textContent = max.toFixed(1);
            labelGlobalMin.textContent = min.toFixed(1);
            labelGlobalMid.textContent = mid.toFixed(1);
            labelGlobalMax.textContent = max.toFixed(1);
        }

        let activeMin = Math.round(parseFloat(scaleMinSlider.value) * 10) / 10;
        let activeMax = Math.round(parseFloat(scaleMaxSlider.value) * 10) / 10;

        let safeMin = activeMin, safeMax = activeMax, colorScale;
        if (showDelta) {
            if (safeMax === 0) safeMax = 1e-6;
            if (safeMin === 0) safeMin = -1e-6;
            colorScale = chroma.scale(['#2563EB', '#D1D5DB', '#EF4444']).domain([safeMin, 0, safeMax]);
        } else {
            if (safeMax === safeMin) safeMax = safeMin + 1e-6;
            colorScale = chroma.scale(['#10B981', '#FBBF24', '#EF4444']).domain([safeMin, (safeMin + safeMax) / 2, safeMax]);
        }

        let minColor = showDelta ? '#2563eb' : '#10b981';
        let midColor = showDelta ? '#d1d5db' : '#fbbf24';
        let maxColor = '#ef4444';

        let totalRange = max - min;
        let minPercent = totalRange > 0 ? ((activeMin - min) / totalRange) * 100 : 0;
        let maxPercent = totalRange > 0 ? ((activeMax - min) / totalRange) * 100 : 100;

        legendGradient.style.background = `linear-gradient(to right, ${minColor} 0%, ${minColor} ${minPercent}%, ${midColor} 50%, ${maxColor} ${maxPercent}%, ${maxColor} 100%)`;

        geojsonLayer = L.geoJSON(geojsonData, {
            style: function (feature) {
                let val = feature.properties[propertyKey];
                let colorHex = '#ccc';
                if (val !== null && !isNaN(val)) {
                    if (val <= activeMin) colorHex = minColor;
                    else if (val >= activeMax) colorHex = maxColor;
                    else colorHex = colorScale(val).hex();
                }
                return { fillColor: colorHex, weight: 0, opacity: 1, color: 'transparent', fillOpacity: 0.7 };
            },
            onEachFeature: function (feature, layer) {
                layer.on({ mouseover: highlightFeature, mouseout: resetHighlight });
            }
        }).addTo(map);

        function highlightFeature(e) {
            const l = e.target;
            l.setStyle({ weight: 2, color: '#666', fillOpacity: 0.9, dashArray: '' });

            const val = l.feature.properties[propertyKey];
            infoPanel.classList.remove('hidden');
            infoContent.innerHTML = `
                <div class="font-medium">${l.feature.properties.NAMELSAD || 'Tract ' + l.feature.properties.GEOID}</div>
                <div class="text-lg font-bold ${showDelta ? (val > 0 ? 'text-red-600' : 'text-blue-600') : 'text-gray-900'}">
                    ${val !== null && val !== undefined ? val.toFixed(1) : 'N/A'} <span class="text-xs font-normal text-gray-500">${currentPollutant.includes('PM25') ? 'µg/m³' : 'ppb'}</span>
                </div>
            `;
        }
        function resetHighlight(e) {
            geojsonLayer.resetStyle(e.target);
            infoPanel.classList.add('hidden');
        }

        // Cordon stays on top
        if (cordonLayer) {
            cordonLayer.bringToFront();
        }
    }
});
