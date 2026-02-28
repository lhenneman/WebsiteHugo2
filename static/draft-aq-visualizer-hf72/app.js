document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    const map = L.map('map').setView([38.9072, -77.0369], 10); // DC Coordinates, Zoomed out

    // Explicit Z-Index Panes to prevent bringToFront DOM thrashing
    map.createPane('boundariesPane');
    map.getPane('boundariesPane').style.zIndex = 390;

    map.createPane('roadsPane');
    map.getPane('roadsPane').style.zIndex = 395;

    map.createPane('cordonPane');
    map.getPane('cordonPane').style.zIndex = 410;
    map.getPane('cordonPane').style.pointerEvents = 'none';

    const tileLayerUrl = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    const tileLayerAttrib = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

    L.tileLayer(tileLayerUrl, {
        attribution: tileLayerAttrib,
        maxZoom: 19
    }).addTo(map);

    let geojsonData = null;
    let geojsonLayer = null;

    // --- DOM Elements ---
    const monthSelect = document.getElementById('monthSelect');
    const scenarioSelect = document.getElementById('scenarioSelect');
    const pollutantSelect = document.getElementById('pollutantSelect');
    const infoPanel = document.getElementById('infoPanel');
    const infoContent = document.getElementById('infoContent');
    const legendGradient = document.getElementById('legendGradient');
    const legendMin = document.getElementById('legendMin');
    const legendMax = document.getElementById('legendMax');
    const scenarioDesc = document.getElementById('scenarioDesc');
    const scaleMinSlider = document.getElementById('scaleMinSlider');
    const scaleMaxSlider = document.getElementById('scaleMaxSlider');
    const sliderMinReadout = document.getElementById('sliderMinReadout');
    const sliderMaxReadout = document.getElementById('sliderMaxReadout');

    // --- State ---
    let cordonLayer = null;
    let cachedCordons = {};
    let isUserSliding = false;

    const CORDON_FILES = {
        'c0_t1': 'dc_cordon_small_te.geojson',
        'c0_t2': 'dc_cordon_small_te.geojson',
        'c1_t1': 'dc_cordon_small_ti.geojson',
        'c1_t2': 'dc_cordon_small_ti.geojson',
        'c2_t1': 'dc_cordon_large.geojson',
        'c2_t2': 'dc_cordon_large.geojson'
    };
    let currentMonth = monthSelect.value;
    let currentScenario = scenarioSelect.value;
    let currentPollutant = pollutantSelect.value;

    // Store global limits: { 'O3_MO': { baseline: [min, max], delta: [min, max] }, ... }
    let globalLimits = {};
    const POLLUTANTS = ['O3_MDA8_MO', 'NO2_MO', 'PM25_TOT_MO'];
    const MONTHS = ['Feb', 'May', 'Aug', 'Nov'];
    const SCENARIOS = ['c0_t1', 'c0_t2', 'c1_t1', 'c1_t2', 'c2_t1', 'c2_t2'];

    let boundariesLayer = null;

    // --- Data Fetching ---
    Promise.all([
        fetch('./data/dc_tracts_aq.geojson').then(res => res.json()),
        fetch('./data/roads.geojson').then(res => res.json()).catch(e => null),
        fetch('./data/boundaries.geojson').then(res => res.json()).catch(e => null)
    ]).then(([tractsData, roadsData, boundariesData]) => {
        geojsonData = tractsData;

        // Calculate Global Limits
        calculateGlobalLimits();

        // Add Boundaries Layer
        if (boundariesData) {
            boundariesLayer = L.geoJSON(boundariesData, {
                pane: 'boundariesPane',
                style: {
                    color: '#6B7280', // Gray-500
                    weight: 2.5,
                    opacity: 0.8,
                    dashArray: '6, 6' // Dashed for state borders
                },
                interactive: false
            }).addTo(map);
        }

        // Add Roads Layer (Primary Highways Only)
        if (roadsData) {
            L.geoJSON(roadsData, {
                pane: 'roadsPane',
                style: {
                    color: '#9CA3AF', // Lighter Gray-400
                    weight: 2.0,
                    opacity: 0.8
                },
                interactive: false
            }).addTo(map);
        }

        updateMap();
    }).catch(error => console.error('Error loading data:', error));

    function calculateGlobalLimits() {
        POLLUTANTS.forEach(pollutant => {
            // 1. Baseline Limits (Across all months)
            let baselineValues = [];
            MONTHS.forEach(month => {
                const key = `${month}_baseline_${pollutant}`;
                geojsonData.features.forEach(f => {
                    const val = f.properties[key];
                    if (val !== null && !isNaN(val)) baselineValues.push(val);
                });
            });

            // 2. Delta Limits (Across all months AND scenarios)
            let deltaValues = [];
            MONTHS.forEach(month => {
                SCENARIOS.forEach(scen => {
                    const key = `${month}_${scen}_${pollutant}_delta`;
                    geojsonData.features.forEach(f => {
                        const val = f.properties[key];
                        if (val !== null && !isNaN(val)) deltaValues.push(val);
                    });
                });
            });

            globalLimits[pollutant] = {
                baseline: [Math.min(...baselineValues), Math.max(...baselineValues)],
                delta: [Math.min(...deltaValues), Math.max(...deltaValues)]
            };
        });
        console.log("Global Limits Calculated:", globalLimits);
    }

    // --- Event Listeners ---
    monthSelect.addEventListener('change', (e) => {
        currentMonth = e.target.value;
        updateMap();
    });

    let currentScenarioType = currentScenario === 'baseline' ? 'baseline' : 'delta';

    scenarioSelect.addEventListener('change', (e) => {
        let newScenario = e.target.value;
        let newType = newScenario === 'baseline' ? 'baseline' : 'delta';

        if (newType !== currentScenarioType) {
            isUserSliding = false; // reset sliders if changing from absolute to difference
        }

        currentScenarioType = newType;
        currentScenario = newScenario;

        updateScenarioDescription();
        updateMap();
        updateCordon();
    });

    pollutantSelect.addEventListener('change', (e) => {
        currentPollutant = e.target.value;
        isUserSliding = false;
        updateMap();
    });

    scaleMinSlider.addEventListener('input', (e) => {
        isUserSliding = true;
        let val = Math.round(parseFloat(e.target.value) * 10) / 10;
        let activeMid = parseFloat(document.getElementById('labelGlobalMid').textContent);
        if (val > activeMid) {
            val = activeMid;
            e.target.value = val;
        }
        sliderMinReadout.textContent = val.toFixed(1);
        updateMapDebounced();
    });

    scaleMaxSlider.addEventListener('input', (e) => {
        isUserSliding = true;
        let val = Math.round(parseFloat(e.target.value) * 10) / 10;
        let activeMid = parseFloat(document.getElementById('labelGlobalMid').textContent);
        if (val < activeMid) {
            val = activeMid;
            e.target.value = val;
        }
        sliderMaxReadout.textContent = val.toFixed(1);
        updateMapDebounced();
    });

    let debounceTimer;
    function updateMapDebounced() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => { updateMap(); }, 50);
    }

    function updateScenarioDescription() {
        const text = scenarioSelect.options[scenarioSelect.selectedIndex].text;
        if (currentScenario === 'baseline') {
            scenarioDesc.textContent = "Baseline scenario showing absolute concentrations.";
        } else {
            scenarioDesc.textContent = `Showing difference from Baseline for: ${text}`;
        }
    }

    // --- Map Logic ---
    function updateMap() {
        if (!geojsonData) return;

        if (geojsonLayer) {
            map.removeLayer(geojsonLayer);
        }

        // Determine which property to visualize
        // If baseline: {month}_baseline_{var}
        // If scenario: {month}_{scenario}_{var}_delta
        let propertyKey;
        let showDelta = false; // Explicitly declared
        if (currentScenario === 'baseline') {
            propertyKey = `${currentMonth}_baseline_${currentPollutant}`;
            showDelta = false;
            document.getElementById('scenarioDesc').textContent = "Baseline scenario showing absolute concentrations.";
        } else {
            propertyKey = `${currentMonth}_${currentScenario}_${currentPollutant}_delta`;
            showDelta = true;
            document.getElementById('scenarioDesc').textContent = `Difference from Baseline (${currentScenario.replace('_', ' ')}). Blue = Better, Red = Worse.`;
        }

        console.log("Visualizing Property:", propertyKey);

        // Get Limits from Global State
        const limits = globalLimits[currentPollutant];
        if (!limits) {
            console.error("Limits not found for", currentPollutant);
            return;
        }

        let min, max, mid;
        let colorScale;

        if (!showDelta) {
            // Baseline: Use pre-calculated baseline limits
            [min, max] = limits.baseline;

            // Rule: For NO2 & PM25, force min to 0
            if (currentPollutant === 'NO2_MO' || currentPollutant === 'PM25_TOT_MO') {
                min = 0;
            }

            // Rule: Whole number Max/Min
            min = Math.floor(min);
            max = Math.ceil(max);
            mid = (min + max) / 2;

            colorScale = chroma.scale('YlOrRd').domain([min, max]);
        } else {
            // Delta: Use pre-calculated delta limits
            // Deltas: Center on 0 using the largest absolute value found in ANY scenario/month
            let [dMin, dMax] = limits.delta;
            const rawAbsMax = Math.max(Math.abs(dMin), Math.abs(dMax));

            // Fix bounds: Round up to nearest 0.1 so slider step='0.1' reaches the physical end of the slider track
            const cleanRawAbsMax = Math.round(rawAbsMax * 1000) / 1000;
            const absMax = Math.ceil(cleanRawAbsMax * 10) / 10;

            // Symmetric scale
            min = -absMax;
            max = absMax;
            mid = 0;
        }

        // --- Slider Logic ---
        if (!isUserSliding) {
            // Set slider bounds and values to defaults based on full domain
            scaleMinSlider.min = min;
            // Provide a tiny 0.001 float padding so step="0.1" input doesn't clip the final physical track position
            scaleMinSlider.max = max + 0.001;
            scaleMinSlider.value = min;

            scaleMaxSlider.min = min;
            scaleMaxSlider.max = max + 0.001;
            scaleMaxSlider.value = max;

            sliderMinReadout.textContent = min.toFixed(1);
            sliderMaxReadout.textContent = max.toFixed(1);

            document.getElementById('labelGlobalMin').textContent = min.toFixed(1);
            document.getElementById('labelGlobalMid').textContent = mid.toFixed(1);
            document.getElementById('labelGlobalMax').textContent = max.toFixed(1);
        }

        // Read current slider values and strictly round them to eliminate DOM float slush
        let activeMin = Math.round(parseFloat(scaleMinSlider.value) * 10) / 10;
        let activeMax = Math.round(parseFloat(scaleMaxSlider.value) * 10) / 10;

        // Prevent Chroma.js domain collapse
        let safeMin = activeMin;
        let safeMax = activeMax;

        if (showDelta) {
            if (safeMax === 0) safeMax = 1e-6;
            if (safeMin === 0) safeMin = -1e-6;
            // Changed middle color from Gray-100 to Gray-300 so near-0 tracts don't vanish against Carto Light basemap
            colorScale = chroma.scale(['#2563EB', '#D1D5DB', '#EF4444']).domain([safeMin, 0, safeMax]);
        } else {
            if (safeMax === safeMin) safeMax = safeMin + 1e-6;
            colorScale = chroma.scale(['#10B981', '#FBBF24', '#EF4444']).domain([safeMin, (safeMin + safeMax) / 2, safeMax]);
        }

        // --- Visual Legend Gradient ---
        // Hardcode semantic extreme colors to prevent Chroma outputting white/NaN when domain is perfectly 0
        let minColor = showDelta ? '#2563eb' : '#10b981';
        let midValue = showDelta ? 0 : (activeMin + activeMax) / 2;
        // Match CSS midpoint to Gray-300 baseline
        let midColor = showDelta ? '#d1d5db' : '#fbbf24';
        let maxColor = '#ef4444';

        let totalRange = max - min;
        let minPercent = totalRange > 0 ? ((activeMin - min) / totalRange) * 100 : 0;
        let maxPercent = totalRange > 0 ? ((activeMax - min) / totalRange) * 100 : 100;

        const gradientCss = `linear-gradient(to right, 
            ${minColor} 0%, 
            ${minColor} ${minPercent}%, 
            ${midColor} 50%, 
            ${maxColor} ${maxPercent}%, 
            ${maxColor} 100%
        )`;

        document.getElementById('legendGradient').style.background = gradientCss;


        // Create Layer
        geojsonLayer = L.geoJSON(geojsonData, {
            style: function (feature) {
                let val = feature.properties[propertyKey];
                let colorHex = '#ccc';
                if (val !== null && !isNaN(val)) {
                    // Clamp value to active bounds explicitly to fix JS math quirk with 0.0 domain
                    if (val <= activeMin) {
                        colorHex = minColor;
                    } else if (val >= activeMax) {
                        colorHex = maxColor;
                    } else {
                        colorHex = colorScale(val).hex();
                    }
                }
                return {
                    fillColor: colorHex,
                    weight: 0, // No border visible
                    opacity: 1,
                    color: 'transparent', // Transparent border
                    dashArray: '',
                    fillOpacity: 0.7
                };
            },
            onEachFeature: function (feature, layer) {
                layer.on({
                    mouseover: highlightFeature,
                    mouseout: resetHighlight,
                });
            }
        }).addTo(map);

        // Info Panel
        const infoPanel = document.getElementById('infoPanel');
        const infoContent = document.getElementById('infoContent');

        function highlightFeature(e) {
            const layer = e.target;
            layer.setStyle({
                weight: 2,
                color: '#666',
                dashArray: '',
                fillOpacity: 0.9
            });

            const props = layer.feature.properties;
            const val = props[propertyKey];

            infoPanel.classList.remove('hidden');
            infoContent.innerHTML = `
                <div class="font-medium">${props.NAMELSAD || 'Tract ' + props.GEOID}</div>
                <div class="text-lg font-bold ${showDelta ? (val > 0 ? 'text-red-600' : 'text-blue-600') : 'text-gray-900'}">
                    ${val !== undefined && val !== null ? val.toFixed(1) : 'N/A'} 
                    <span class="text-xs font-normal text-gray-500">${getUnit(currentPollutant)}</span>
                </div>
            `;
        }

        function resetHighlight(e) {
            geojsonLayer.resetStyle(e.target);
            infoPanel.classList.add('hidden');
        }

        // Fix Bug 1: Ensure Cordon stays on top after tracts are re-rendered
        if (cordonLayer) {
            cordonLayer.bringToFront();
        }
    }

    function getUnit(pollutant) {
        if (pollutant.includes('PM25')) return 'µg/m³';
        return 'ppb';
    }

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
});
