// Mapa da rota (Leaflet): posição do avião, rastro, waypoints, alvos do radar e vento.
const D2R = Math.PI / 180;
const TYPE_COLOR = { hostile: '#ff4747', friendly: '#3cff7c', unknown: '#ffd43b' };

const PLANE_SVG = `<svg viewBox="-16 -16 32 32" width="30" height="30" aria-hidden="true">
  <path d="M0,-15 L2.2,-8 L3,-3 L14,5 L14,7.5 L3.5,6 L3,9 L8,13.5 L8,15 L1.5,13.5 L0,15 L-1.5,13.5 L-8,15 L-8,13.5 L-3,9 L-3.5,6 L-14,7.5 L-14,5 L-3,-3 L-2.2,-8 Z"
    fill="#35e3ff" stroke="#001a22" stroke-width="1"/></svg>`;

/** Ponto a `range` NM na marcação `brg` a partir de (lat, lon) — aproximação plana. */
export function offsetLatLon(lat, lon, brg, range) {
  const dLat = (range * Math.cos(brg * D2R)) / 60;
  const dLon = (range * Math.sin(brg * D2R)) / (60 * Math.cos(lat * D2R));
  return [lat + dLat, lon + dLon];
}

export function createMap(el) {
  const L = window.L;
  if (!L) {
    el.innerHTML = '<p class="gs-empty">Leaflet não carregou (sem internet?).</p>';
    const noop = () => {};
    return {
      updateNav: noop, updateTargets: noop, updateWind: noop, updateMissiles: noop, followMissile: noop, invalidate: noop, reset: noop, setFollow: noop,
    };
  }

  const map = L.map(el, { zoomControl: true, attributionControl: true, worldCopyJump: true }).setView([-16.0, -48.8], 8);
  // tiles do OpenStreetMap escurecidos via CSS (.dark-tiles) para combinar com o painel
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
    className: 'dark-tiles',
  }).addTo(map);

  const trail = L.polyline([], { color: '#35e3ff', weight: 2, opacity: 0.75 }).addTo(map);
  const route = L.polyline([], { color: '#ff63e8', weight: 1.5, opacity: 0.8, dashArray: '6 6' }).addTo(map);
  const wptLine = L.polyline([], { color: '#35e3ff', weight: 1, opacity: 0.6, dashArray: '2 6' }).addTo(map);
  const wptLayer = L.layerGroup().addTo(map);
  const targetLayer = L.layerGroup().addTo(map);
  const plane = L.marker([0, 0], {
    icon: L.divIcon({ className: 'plane-icon', html: `<div class="plane">${PLANE_SVG}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
    interactive: false,
    keyboard: false,
    zIndexOffset: 1000,
  });

  const wind = L.control({ position: 'topright' });
  wind.onAdd = () => {
    const d = L.DomUtil.create('div', 'map-wind');
    d.innerHTML = '<div class="arrow">➤</div><div class="txt">VENTO<br><b>--</b></div>';
    return d;
  };
  wind.addTo(map);
  const windEl = el.querySelector('.map-wind');

  let follow = true;
  let routeKey = '';
  let hasFix = false;
  map.on('dragstart', () => {
    follow = false;
    el.dispatchEvent(new CustomEvent('follow-change', { detail: false }));
  });

  // ---------------------------------------------------------------- mísseis
  const missileLayer = L.layerGroup().addTo(map);
  const tracks = new Map(); // id → { marker, trail, link, gone }
  let followMsl = null; // { id, fitted, zoomBefore, endedAt }

  const missileIcon = (side) => L.divIcon({
    className: 'msl-icon',
    html: `<div class="msl ${side}"><svg viewBox="-7 -12 14 24" width="14" height="24" aria-hidden="true">
      <path d="M0,-11 L2,-6 L2,6 L5.5,10.5 L-5.5,10.5 L-2,6 L-2,-6 Z"/></svg></div>`,
    iconSize: [14, 24],
    iconAnchor: [7, 12],
  });

  const announceFollow = () => el.dispatchEvent(new CustomEvent('missile-follow', { detail: followMsl?.id ?? null }));

  function stopFollowMissile() {
    if (!followMsl) return;
    const z = followMsl.zoomBefore;
    followMsl = null;
    announceFollow();
    if (hasFix) map.setView(plane.getLatLng(), z ?? map.getZoom(), { animate: true });
  }

  function missileTargetLatLng(m, contacts, nav) {
    if (m.side === 'enemy') return hasFix ? plane.getLatLng() : null;
    const c = contacts.find((k) => k.id === m.target);
    return c ? L.latLng(offsetLatLon(nav.lat, nav.lon, c.bearing, c.range)) : null;
  }

  return {
    setFollow(v) {
      follow = v;
      if (v && hasFix && !followMsl) map.panTo(plane.getLatLng(), { animate: false });
    },

    /** Acompanha um míssil: enquadra míssil + alvo e segue os dois até o desfecho. null = volta ao avião. */
    followMissile(id) {
      if (!id) return stopFollowMissile();
      followMsl = { id, fitted: false, zoomBefore: followMsl?.zoomBefore ?? map.getZoom(), endedAt: 0 };
      announceFollow();
    },

    get followedMissile() {
      return followMsl?.id ?? null;
    },

    updateMissiles(missiles, contacts, nav) {
      const now = performance.now();
      const seen = new Set();
      for (const m of missiles) {
        if (!Number.isFinite(m.lat) || !Number.isFinite(m.lon)) continue;
        seen.add(m.id);
        const ll = L.latLng(m.lat, m.lon);
        const color = m.side === 'enemy' ? '#ff4747' : '#eafff2';
        let tr = tracks.get(m.id);
        if (!tr) {
          tr = {
            marker: L.marker(ll, { icon: missileIcon(m.side), interactive: true, keyboard: false, zIndexOffset: 900 }).addTo(missileLayer),
            trail: L.polyline([ll], { color, weight: 2, opacity: 0.8 }).addTo(missileLayer),
            link: L.polyline([], { color, weight: 1, opacity: 0.6, dashArray: '3 5' }).addTo(missileLayer),
            gone: 0,
          };
          tr.marker.bindTooltip('', { direction: 'right', className: 'map-label', permanent: true, offset: [8, 0] });
          tracks.set(m.id, tr);
        }
        tr.gone = 0;
        tr.marker.setLatLng(ll);
        tr.trail.addLatLng(ll);
        const inner = tr.marker.getElement()?.querySelector('.msl');
        if (inner) {
          inner.style.transform = `rotate(${m.heading || 0}deg)`;
          inner.classList.toggle('ended', m.status !== 'flight');
        }
        const flying = m.status === 'flight';
        const tgtLL = flying ? missileTargetLatLng(m, contacts, nav) : null;
        tr.link.setLatLngs(tgtLL ? [ll, tgtLL] : []);
        const res = { hit: 'ACERTOU', miss: 'ERROU', decoyed: 'DESPISTADO' }[m.status];
        tr.marker.setTooltipContent(flying ? `${m.id} · ${Math.round(m.tof)} s` : `${m.id} · ${res}`);

        // câmera acompanhando o míssil
        if (followMsl?.id === m.id) {
          if (!flying && !followMsl.endedAt) followMsl.endedAt = now;
          if (tgtLL && !followMsl.fitted && el.offsetWidth > 0) {
            map.fitBounds(L.latLngBounds([ll, tgtLL]), { padding: [70, 70], maxZoom: 11, animate: false });
            followMsl.fitted = true;
          } else if (tgtLL) {
            map.panTo(L.latLng((ll.lat + tgtLL.lat) / 2, (ll.lng + tgtLL.lng) / 2), { animate: false });
          } else {
            map.panTo(ll, { animate: false });
          }
        }
      }
      // remove rastros de mísseis que saíram da lista (após alguns segundos)
      for (const [id, tr] of tracks) {
        if (seen.has(id)) continue;
        if (!tr.gone) tr.gone = now;
        if (now - tr.gone > 8000) {
          missileLayer.removeLayer(tr.marker);
          missileLayer.removeLayer(tr.trail);
          missileLayer.removeLayer(tr.link);
          tracks.delete(id);
        }
      }
      // fim do acompanhamento: 3 s depois do desfecho (ou se o míssil sumiu), volta ao avião
      if (followMsl && ((followMsl.endedAt && now - followMsl.endedAt > 3000) || !seen.has(followMsl.id))) {
        stopFollowMissile();
      }
    },

    updateNav(nav, flight) {
      if (!Number.isFinite(nav.lat) || !Number.isFinite(nav.lon) || (nav.lat === 0 && nav.lon === 0)) return;
      const ll = [nav.lat, nav.lon];
      if (!hasFix) {
        plane.addTo(map);
        map.setView(ll, 8, { animate: false });
        hasFix = true;
      }
      plane.setLatLng(ll);
      const inner = plane.getElement()?.querySelector('.plane');
      if (inner) inner.style.transform = `rotate(${flight.heading || 0}deg)`;
      trail.addLatLng(ll);
      const pts = trail.getLatLngs();
      if (pts.length > 1200) trail.setLatLngs(pts.slice(-1000));

      const r = nav.route || [];
      const key = r.map((p) => `${p.name}${p.lat}${p.lon}`).join('|');
      if (key !== routeKey) {
        routeKey = key;
        route.setLatLngs(r.length ? [...r.map((p) => [p.lat, p.lon]), [r[0].lat, r[0].lon]] : []);
        wptLayer.clearLayers();
        r.forEach((p, i) => {
          L.circleMarker([p.lat, p.lon], { radius: 5, color: '#ff63e8', weight: 1.5, fillOpacity: 0.15 })
            .bindTooltip(`${i + 1} · ${p.name}`, { permanent: true, direction: 'right', className: 'map-label' })
            .addTo(wptLayer);
        });
      }
      const w = r[nav.wptIndex];
      wptLine.setLatLngs(w ? [ll, [w.lat, w.lon]] : []);
      if (follow && !followMsl) map.panTo(ll, { animate: false });
    },

    updateTargets(contacts, nav, lockedId) {
      targetLayer.clearLayers();
      if (!hasFix) return;
      for (const c of contacts) {
        const ll = offsetLatLon(nav.lat, nav.lon, c.bearing, c.range);
        const col = TYPE_COLOR[c.type] || '#ffd43b';
        const locked = c.id === lockedId;
        L.circleMarker(ll, { radius: locked ? 8 : 5, color: locked ? '#ffffff' : col, weight: locked ? 2.5 : 1.5, fillColor: col, fillOpacity: 0.5 })
          .bindTooltip(`${c.id} · ${Math.round(c.alt / 100) / 10}k ft · ${c.range.toFixed(1)} NM${locked ? ' · TRAVADO' : ''}`, { direction: 'top', className: 'map-label' })
          .addTo(targetLayer);
      }
    },

    updateWind(env) {
      if (!windEl) return;
      windEl.querySelector('.arrow').style.transform = `rotate(${(env.windDir || 0) + 90}deg)`;
      windEl.querySelector('b').textContent = `${Math.round(env.windDir || 0)}° / ${Math.round(env.windSpeed || 0)} kt`;
      windEl.classList.toggle('gust', !!env.gust);
    },

    invalidate() {
      map.invalidateSize();
      if (followMsl) followMsl.fitted = false; // reenquadra míssil + alvo com o tamanho real do mapa
      else if (follow && hasFix) map.panTo(plane.getLatLng(), { animate: false });
    },

    reset() {
      trail.setLatLngs([]);
      targetLayer.clearLayers();
      missileLayer.clearLayers();
      tracks.clear();
      followMsl = null;
      announceFollow();
      hasFix = false;
      plane.remove();
    },
  };
}
