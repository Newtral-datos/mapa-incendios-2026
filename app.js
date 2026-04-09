/* ── Ficheros PMTiles (generados por generar_pmtiles.py) ── */
const AREAS_FILE   = 'incendios_areas.pmtiles';
const ACTIVOS_FILE = 'incendios_activos.pmtiles';

/* ── Mapa ── */
const map = new maplibregl.Map({
  container: 'map',
  style: { version: 8, sources: {}, layers: [] },
  center: [-8.5, 36.5],
  zoom: 4.3,
  minZoom: 4.3,
  maxBounds: [[-60, 20], [50, 58]],
  antialias: true
});

/* ── Geocoder (Nominatim) ── */
class GeocoderControl {
  onAdd(map) {
    this._map = map;
    this._container = document.createElement('div');
    this._container.className = 'maplibregl-ctrl geocoder-ctrl';

    this._input = document.createElement('input');
    this._input.type = 'text';
    this._input.placeholder = 'Buscar lugar…';
    this._input.className = 'geocoder-input';
    this._input.setAttribute('autocomplete', 'off');

    this._list = document.createElement('div');
    this._list.className = 'geocoder-results';

    this._container.appendChild(this._input);
    this._container.appendChild(this._list);

    let timer;
    this._input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = this._input.value.trim();
      if (q.length < 3) { this._list.innerHTML = ''; this._list.hidden = true; return; }
      timer = setTimeout(() => this._search(q), 350);
    });
    this._input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._list.hidden = true;
    });
    document.addEventListener('click', (e) => {
      if (!this._container.contains(e.target)) this._list.hidden = true;
    });
    return this._container;
  }

  async _search(q) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&accept-language=es&countrycodes=es`;
      const data = await fetch(url).then(r => r.json());
      this._render(data);
    } catch { /* red no disponible */ }
  }

  _render(items) {
    this._list.innerHTML = '';
    if (!items.length) {
      const el = document.createElement('div');
      el.className = 'geocoder-item geocoder-empty';
      el.textContent = 'Sin resultados';
      this._list.appendChild(el);
    } else {
      items.forEach(item => {
        const el = document.createElement('div');
        el.className = 'geocoder-item';
        el.textContent = item.display_name;
        el.addEventListener('click', () => {
          this._input.value = item.display_name;
          this._list.hidden = true;
          const bb = item.boundingbox;
          if (bb) {
            this._map.fitBounds(
              [[parseFloat(bb[2]), parseFloat(bb[0])], [parseFloat(bb[3]), parseFloat(bb[1])]],
              { padding: 60, maxZoom: 14 }
            );
          } else {
            this._map.flyTo({ center: [parseFloat(item.lon), parseFloat(item.lat)], zoom: 13 });
          }
        });
        this._list.appendChild(el);
      });
    }
    this._list.hidden = false;
  }

  onRemove() {
    this._container.parentNode?.removeChild(this._container);
    this._map = undefined;
  }
}

map.addControl(new GeocoderControl(), 'top-right');
map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

/* ── Tooltip hover ── */
const tooltip = document.createElement('div');
tooltip.className = 'map-tooltip';
document.body.appendChild(tooltip);

/* ── Estado de capas ── */
let areasVisible   = true;
let focosVisible   = true;
let statsData      = null;
let añoSeleccionado = '2026';

/* ── Carga ── */
map.on('load', async () => {
  statsData = await fetch('stats.json').then(r => r.json()).catch(() => null);

  if (statsData?.actualizado) {
    const el = document.getElementById('map-updated');
    const d = new Date(statsData.actualizado + 'T00:00:00');
    el.textContent = 'Actualizado ' + d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    el.style.display = '';
  }

  /* Mapa base */
  map.addSource('basemap', {
    type: 'raster',
    tiles: ['https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/{z}/{x}/{y}{r}.png'],
    tileSize: 256,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
  });
  map.addLayer({ id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-opacity': 0.85 } });

  /* Protocolo PMTiles */
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));

  if (location.protocol === 'file:') {
    for (const file of [AREAS_FILE, ACTIVOS_FILE]) {
      const buf = await fetch(file).then(r => r.arrayBuffer());
      protocol.add(new pmtiles.PMTiles({
        getBytes: (off, len) => Promise.resolve({ data: buf.slice(off, off + len) }),
        getKey:   () => file
      }));
    }
  }

  /* ── Áreas quemadas (polígonos Copernicus) ── */
  map.addSource('incendios-areas', {
    type: 'vector',
    url: `pmtiles://${AREAS_FILE}`
  });

  /* Fill coloreado por hectáreas */
  map.addLayer({
    id: 'areas-fill',
    type: 'fill',
    source: 'incendios-areas',
    'source-layer': 'incendios_areas',
    paint: {
      'fill-color': [
        'interpolate', ['linear'],
        ['to-number', ['get', 'AREA_HA'], 0],
           0, '#fef08a',
          50, '#fbbf24',
         500, '#f97316',
        2000, '#ef4444',
        8000, '#7f1d1d'
      ],
      'fill-opacity': [
        'interpolate', ['linear'], ['zoom'],
        4, 0.65,
        10, 0.8
      ]
    }
  });

  /* Contorno del área */
  map.addLayer({
    id: 'areas-outline',
    type: 'line',
    source: 'incendios-areas',
    'source-layer': 'incendios_areas',
    paint: {
      'line-color': '#fb923c',
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 1.5],
      'line-opacity': 0.9
    }
  });

  /* Resaltado al hacer hover */
  map.addLayer({
    id: 'areas-highlight',
    type: 'line',
    source: 'incendios-areas',
    'source-layer': 'incendios_areas',
    filter: ['==', ['id'], -1],
    paint: {
      'line-color': '#ffffff',
      'line-width': 2.5,
      'line-opacity': 0.95
    }
  });

  /* ── Focos activos (puntos FIRMS) ── */
  map.addSource('incendios-activos', {
    type: 'vector',
    url: `pmtiles://${ACTIVOS_FILE}`
  });


  /* Puntos 48h (ultimos) — ámbar, más pequeños, semitransparentes */
  map.addLayer({
    id: 'activos-48h',
    type: 'circle',
    source: 'incendios-activos',
    'source-layer': 'incendios_activos',
    filter: ['==', ['get', 'ventana'], 'ultimos'],
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        4, 4,
        9, 7,
        14, 11
      ],
      'circle-color': '#FFB700',
      'circle-opacity': 0.65,
      'circle-stroke-width': 1,
      'circle-stroke-color': '#7c4a00'
    }
  });

  /* Puntos 24h (nuevo) — naranja vivo, más grandes, encima */
  map.addLayer({
    id: 'activos-24h',
    type: 'circle',
    source: 'incendios-activos',
    'source-layer': 'incendios_activos',
    filter: ['==', ['get', 'ventana'], 'nuevo'],
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        4, 6,
        9, 10,
        14, 15
      ],
      'circle-color': '#FF2B00',
      'circle-opacity': 0.95,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#8B0000'
    }
  });

  /* ── Contadores ── */
  const fmtNum = n => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  function animarEl(elId, desde, hasta) {
    const duracion = 600;
    const inicio   = performance.now();
    const el = document.getElementById(elId);
    function tick(ahora) {
      const t = Math.min((ahora - inicio) / duracion, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = fmtNum(Math.round(desde + (hasta - desde) * eased));
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  let valHa = 0, valFocos = 0;

  function actualizarContadores() {
    const año = añoSeleccionado ?? '2026';
    const nuevoHa = statsData?.por_año?.[año]?.hectareas ?? statsData?.hectareas_2026 ?? 0;
    const nuevoFocos = statsData?.focos_24h ?? 0;
    document.getElementById('contador-ha-label').textContent = `ha quemadas en ${año}`;
    animarEl('contador-ha', valHa, nuevoHa);
    animarEl('contador-focos', valFocos, nuevoFocos);
    valHa = nuevoHa;
    valFocos = nuevoFocos;
  }

  function actualizarLeyenda() {
    document.getElementById('leyenda-areas').classList.toggle('hidden', !areasVisible);
    document.getElementById('leyenda-focos').classList.toggle('hidden', !focosVisible);
  }

  /* ── Selector de años ── */
  function aplicarFiltroAño() {
    const filtro = añoSeleccionado
      ? ['==', ['get', 'AÑO'], añoSeleccionado]
      : null;
    map.setFilter('areas-fill',    filtro);
    map.setFilter('areas-outline', filtro);
    actualizarContadores();
  }

  function construirSelectorAños() {
    const pills = document.getElementById('year-pills');
    pills.innerHTML = '';
    if (!statsData?.por_año) return;

    const años = Object.keys(statsData.por_año).sort().reverse();

    // Pill "Todos"
    const todosBtn = document.createElement('button');
    todosBtn.className = 'year-pill';
    todosBtn.textContent = 'Todos';
    todosBtn.addEventListener('click', () => {
      añoSeleccionado = null;
      document.querySelectorAll('.year-pill').forEach(p => p.classList.remove('active'));
      todosBtn.classList.add('active');
      aplicarFiltroAño();
    });
    pills.appendChild(todosBtn);

    // Pill por año (más reciente arriba)
    años.forEach(año => {
      const btn = document.createElement('button');
      btn.className = 'year-pill' + (año === añoSeleccionado ? ' active' : '');
      btn.textContent = año;
      btn.addEventListener('click', () => {
        añoSeleccionado = año;
        document.querySelectorAll('.year-pill').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        aplicarFiltroAño();
      });
      pills.appendChild(btn);
    });
  }

  construirSelectorAños();
  aplicarFiltroAño();
  document.getElementById('year-selector').classList.remove('hidden');

  actualizarLeyenda();
  actualizarContadores();

  /* ── Hover en áreas ── */
  let hoverAreaId = null;

  map.on('mousemove', 'areas-fill', (e) => {
    map.getCanvas().style.cursor = 'pointer';
    const feat = e.features?.[0];
    if (!feat) return;

    tooltip.style.left = (e.originalEvent.clientX + 14) + 'px';
    tooltip.style.top  = (e.originalEvent.clientY - 40) + 'px';

    const ha = parseFloat(feat.properties.AREA_HA);
    const prov = feat.properties.PROVINCE || '—';
    const ha_fmt = Number.isFinite(ha) ? fmtNum(Math.round(ha)) + ' ha' : '—';
    tooltip.textContent = `${prov} · ${ha_fmt}`;
    tooltip.classList.add('visible');

    if (feat.id !== hoverAreaId) {
      if (hoverAreaId !== null) map.setFilter('areas-highlight', ['==', ['id'], -1]);
      hoverAreaId = feat.id;
      map.setFilter('areas-highlight', ['==', ['id'], feat.id]);
    }
  });

  map.on('mouseleave', 'areas-fill', () => {
    map.getCanvas().style.cursor = '';
    tooltip.classList.remove('visible');
    hoverAreaId = null;
    map.setFilter('areas-highlight', ['==', ['id'], -1]);
  });

  /* ── Cursor pointer en focos ── */
  ['activos-24h', 'activos-48h'].forEach(layer => {
    map.on('mousemove', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
  });

  /* ── Popup al hacer clic en área ── */
  let popup = null;

  map.on('click', 'areas-fill', (e) => {
    const p = e.features?.[0]?.properties;
    if (!p) return;

    const ha       = parseFloat(p.AREA_HA);
    const ha_fmt   = Number.isFinite(ha) ? fmtNum(Math.round(ha)) + ' ha' : '—';
    const prov     = p.PROVINCE  || p.PROVINCIA || '—';
    const muni     = p.COMMUNE   || p.MUNICIPIO || '—';
    const fecha    = p.FECHA_INCENDIO || p.FIREDATE || '—';
    const año      = p.AÑO || '—';

    const claseHa = ha >= 2000 ? 'badge-grave' : ha >= 500 ? 'badge-alto' : ha >= 50 ? 'badge-medio' : 'badge-leve';
    const textHa  = ha >= 2000 ? 'Gran incendio' : ha >= 500 ? 'Incendio grande' : ha >= 50 ? 'Incendio medio' : 'Incendio pequeño';

    const html = `
      <div class="pp">
        <div class="pp-top-bar"></div>
        <div class="pp-inner">
          <div class="pp-header">
            <p class="pp-nombre">${prov}</p>
            <div class="pp-meta">
              <span class="pp-badge ${claseHa}">${textHa}</span>
            </div>
          </div>
          <div class="pp-dato-row">
            <span class="pp-dato-label">Municipio</span>
            <span class="pp-dato-val">${muni}</span>
          </div>
          <div class="pp-dato-row">
            <span class="pp-dato-label">Fecha</span>
            <span class="pp-dato-val">${fecha}</span>
          </div>
          <div class="pp-dato-row">
            <span class="pp-dato-label">Año</span>
            <span class="pp-dato-val">${año}</span>
          </div>
          <div class="pp-ha-row">
            <span class="pp-ha-num">${ha_fmt}</span>
            <span class="pp-ha-label">superficie afectada</span>
          </div>
        </div>
      </div>`;

    if (!popup) {
      popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 12, maxWidth: '280px' });
    }
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  });

  /* ── Popup al hacer clic en foco activo ── */
  map.on('click', (e) => {
    // Prioriza 24h sobre 48h si se solapan
    const f24 = map.queryRenderedFeatures(e.point, { layers: ['activos-24h'] });
    const f48 = map.queryRenderedFeatures(e.point, { layers: ['activos-48h'] });
    const feat = f24[0] || f48[0];
    if (!feat) return;

    const p       = feat.properties;
    const es24h   = p.ventana === 'nuevo';
    const etiqueta = es24h ? 'Foco activo · últimas 24h' : 'Foco activo · últimas 48h';
    const fechaRaw = p.ACQ_DATE || '';
    const fecha = fechaRaw
      ? new Date(fechaRaw + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
      : '—';

    const html = `
      <div class="pp">
        <div class="pp-top-bar" style="background:${es24h ? '#FF2B00' : '#FFB700'}"></div>
        <div class="pp-inner">
          <div class="pp-header">
            <p class="pp-nombre">${etiqueta}</p>
          </div>
          <div class="pp-dato-row">
            <span class="pp-dato-label">Fecha detección</span>
            <span class="pp-dato-val">${fecha}</span>
          </div>
        </div>
      </div>`;

    if (!popup) {
      popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 12, maxWidth: '260px' });
    }
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  });

  /* ── Reset vista ── */
  document.getElementById('reset-btn').addEventListener('click', () => {
    map.easeTo({ center: [-8.5, 36.5], zoom: 4.3, duration: 700 });
  });

  /* ── Toggle áreas ── */
  document.getElementById('areas-btn').addEventListener('click', () => {
    areasVisible = !areasVisible;
    const vis = areasVisible ? 'visible' : 'none';
    map.setLayoutProperty('areas-fill',      'visibility', vis);
    map.setLayoutProperty('areas-outline',   'visibility', vis);
    map.setLayoutProperty('areas-highlight', 'visibility', vis);
    document.getElementById('areas-btn').classList.toggle('active', areasVisible);
    document.getElementById('year-selector').classList.toggle('hidden', !areasVisible);
    actualizarLeyenda();
    actualizarContadores();
  });

  /* ── Toggle focos ── */
  document.getElementById('focos-btn').addEventListener('click', () => {
    focosVisible = !focosVisible;
    const vis = focosVisible ? 'visible' : 'none';
    map.setLayoutProperty('activos-24h', 'visibility', vis);
    map.setLayoutProperty('activos-48h', 'visibility', vis);
    document.getElementById('focos-btn').classList.toggle('active', focosVisible);
    actualizarLeyenda();
    actualizarContadores();
  });


});
