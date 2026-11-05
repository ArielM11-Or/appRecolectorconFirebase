import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';

export interface CamionMapItem {
  id: string;
  placa?: string;
  lat: number;
  lng: number;
  velocidad?: number;
  estado?: string;
  activo?: boolean;
  direccion?: string;
}

export interface LeafletMapProps {
  latitude?: number;
  longitude?: number;
  camionId?: string;
  placa?: string;
  estado?: string;
  velocidad?: number;
  direccion?: string;
  camiones?: CamionMapItem[];
}

// Plantilla HTML estática: se carga UNA SOLA VEZ para evitar parpadeos y recargas de iframe.
const STATIC_MAP_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>Leaflet OpenStreetMap</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #map {
      width: 100%;
      height: 100%;
      background: #0f172a;
      overflow: hidden;
    }
    
    /* Estilos del Marcador de Camión Custom (Inspirados en sistemaMonitoreo) */
    .truck-marker-custom {
      background: none !important;
      border: none !important;
    }
    .custom-marker-container {
      position: relative;
      width: 44px;
      height: 44px;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    /* Badge flotante de Estado sobre el camión */
    .state-badge-float {
      position: absolute;
      top: -26px;
      left: 50%;
      transform: translateX(-50%);
      color: #ffffff;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
      transition: all 0.3s ease;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.3);
      z-index: 10;
      pointer-events: none;
      letter-spacing: 0.3px;
    }
    /* Wrapper circular con borde blanco y sombra */
    .marker-circle-wrapper {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      display: flex;
      justify-content: center;
      align-items: center;
      border: 3px solid #ffffff;
      position: relative;
      transition: transform 0.6s ease-out, background-color 0.3s ease;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
      cursor: pointer;
    }
    .marker-circle-wrapper svg {
      width: 28px;
      height: 28px;
      display: block;
    }
    /* Anillo de Onda / Radar Pulsante */
    .marker-pulse-ring {
      position: absolute;
      top: -3px;
      left: -3px;
      width: calc(100% + 6px);
      height: calc(100% + 6px);
      border-radius: 50%;
      border: 2px solid;
      animation: pulse-wave 1.6s infinite ease-out;
      opacity: 0;
      pointer-events: none;
    }
    @keyframes pulse-wave {
      0% {
        transform: scale(0.9);
        opacity: 0.9;
      }
      50% {
        opacity: 0.45;
      }
      100% {
        transform: scale(2.2);
        opacity: 0;
      }
    }
    .pulse-collecting {
      animation: collect-pulse 1.2s infinite alternate ease-in-out !important;
    }
    @keyframes collect-pulse {
      0% {
        transform: scale(1);
        filter: brightness(1);
      }
      100% {
        transform: scale(1.08);
        filter: brightness(1.2);
      }
    }

    .leaflet-popup-content-wrapper {
      background: #1e293b !important;
      color: #f1f5f9 !important;
      border-radius: 12px !important;
      border: 1px solid rgba(0, 242, 254, 0.35) !important;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.6) !important;
    }
    .leaflet-popup-tip {
      background: #1e293b !important;
    }
    .popup-title {
      font-weight: 800;
      font-size: 15px;
      color: #00f2fe;
      margin-bottom: 4px;
    }
    .popup-text {
      font-size: 12px;
      color: #94a3b8;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const DEFAULT_LAT = -17.9647;
    const DEFAULT_LNG = -67.1060;

    const map = L.map('map', { zoomControl: true }).setView([DEFAULT_LAT, DEFAULT_LNG], 14);

    // OpenStreetMap official tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
    }).addTo(map);

    const TRUCK_COLORS = {
      'REC-01': {
        name: 'Azul',
        bg: '#0284c7',
        border: '#38bdf8',
        ring: '#38bdf8',
        glow: 'rgba(2, 132, 199, 0.7)',
        truckFill: '#0369a1'
      },
      'REC-02': {
        name: 'Amarillo',
        bg: '#eab308',
        border: '#facc15',
        ring: '#fde047',
        glow: 'rgba(234, 179, 8, 0.7)',
        truckFill: '#ca8a04'
      },
      'REC-03': {
        name: 'Naranja',
        bg: '#f97316',
        border: '#fb923c',
        ring: '#fdba74',
        glow: 'rgba(249, 115, 22, 0.7)',
        truckFill: '#ea580c'
      }
    };
    const DEFAULT_COLOR = {
      name: 'Púrpura',
      bg: '#8b5cf6',
      border: '#c084fc',
      ring: '#c084fc',
      glow: 'rgba(139, 92, 246, 0.7)',
      truckFill: '#7c3aed'
    };

    const ESTADOS = {
      en_camino:    { label: 'Avanzando', bg: '#16a34a' },
      recolectando: { label: 'Recolectando', bg: '#f59e0b' },
      comprimiendo: { label: 'Comprimiendo', bg: '#8b5cf6' },
      parado:       { label: 'Parado', bg: '#ef4444' }
    };

    function normalizeEstado(est) {
      if (!est) return 'parado';
      const clean = String(est).toLowerCase().replace(/ /g, '_');
      if (clean.includes('camino') || clean.includes('avanzando')) return 'en_camino';
      if (clean.includes('recol')) return 'recolectando';
      if (clean.includes('compri')) return 'comprimiendo';
      return 'parado';
    }

    function createTruckIcon(id, rawEstado, isMulti) {
      const color = TRUCK_COLORS[id] || DEFAULT_COLOR;
      const normState = normalizeEstado(rawEstado);
      const estInfo = ESTADOS[normState] || ESTADOS.parado;
      const labelText = isMulti ? (id + ' • ' + estInfo.label) : estInfo.label;
      const isStopped = normState === 'parado';
      const isCollecting = normState === 'recolectando';

      const ringHtml = !isStopped
        ? '<div class="marker-pulse-ring" style="border-color: ' + color.ring + ';"></div>'
        : '';

      const wrapperAnimClass = isCollecting ? 'pulse-collecting' : '';

      const svgHtml =
        '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
          '<rect x="30" y="10" width="40" height="25" fill="#f8fafc" rx="4"/>' +
          '<rect x="25" y="35" width="50" height="55" fill="' + color.truckFill + '" rx="4"/>' +
          '<circle cx="20" cy="30" r="8" fill="#1e293b"/>' +
          '<circle cx="80" cy="30" r="8" fill="#1e293b"/>' +
          '<circle cx="20" cy="80" r="8" fill="#1e293b"/>' +
          '<circle cx="80" cy="80" r="8" fill="#1e293b"/>' +
          '<path d="M40,15 L60,15 L65,30 L35,30 Z" fill="#38bdf8"/>' +
        '</svg>';

      const html =
        '<div class="custom-marker-container">' +
          '<div class="state-badge-float" style="background: ' + estInfo.bg + ';">' + labelText + '</div>' +
          '<div class="marker-circle-wrapper ' + wrapperAnimClass + '" style="background-color: ' + color.bg + '; box-shadow: 0 0 16px ' + color.glow + ';">' +
            ringHtml +
            svgHtml +
          '</div>' +
        '</div>';

      return L.divIcon({
        html: html,
        className: 'truck-marker-custom',
        iconSize: [44, 44],
        iconAnchor: [22, 22],
        popupAnchor: [0, -28]
      });
    }

    const markers = {};

    function updateSingleMarker(data) {
      if (!data) return;
      const lat = typeof data.lat === 'number' ? data.lat : DEFAULT_LAT;
      const lng = typeof data.lng === 'number' ? data.lng : DEFAULT_LNG;
      const camionId = data.camionId || 'REC-01';
      const placa = data.placa || '';
      const vel = Math.round(data.velocidad || 0);
      const estado = data.estado || '—';

      // Limpiar otros marcadores si veníamos de modo multi-camión
      Object.keys(markers).forEach(id => {
        if (id !== camionId) {
          map.removeLayer(markers[id]);
          delete markers[id];
        }
      });

      const color = TRUCK_COLORS[camionId] || DEFAULT_COLOR;
      const normState = normalizeEstado(estado);
      const estInfo = ESTADOS[normState] || ESTADOS.parado;

      const direccionHtml = data.direccion
        ? '<div style="margin:2px 0 4px 0; color:#38bdf8; font-size:11px;">📍 <b>' + data.direccion + '</b></div>'
        : '<div style="margin:2px 0 4px 0; color:#94a3b8; font-size:11px;">📍 Oruro, Bolivia</div>';

      const popupHtml = 
        '<div class="popup-title" style="color:' + color.ring + ';">🚛 ' + camionId + ' (' + color.name + ')</div>' +
        '<div class="popup-text">' +
        'Placa: <b>' + placa + '</b><br>' +
        direccionHtml +
        'Velocidad: <b>' + vel + ' km/h</b><br>' +
        'Estado: <b style="color:' + estInfo.bg + ';">' + estInfo.label + '</b></div>';

      const icon = createTruckIcon(camionId, estado, false);

      if (!markers[camionId]) {
        markers[camionId] = L.marker([lat, lng], { icon: icon }).addTo(map);
      } else {
        markers[camionId].setLatLng([lat, lng]);
        markers[camionId].setIcon(icon);
      }
      markers[camionId].bindPopup(popupHtml);
      map.panTo([lat, lng], { animate: true, duration: 0.6 });
    }

    function updateMultiMarkers(list) {
      if (!list || !Array.isArray(list)) return;
      const currentIds = {};
      const bounds = [];

      list.forEach(c => {
        if (typeof c.lat !== 'number' || typeof c.lng !== 'number') return;
        currentIds[c.id] = true;
        bounds.push([c.lat, c.lng]);

        const color = TRUCK_COLORS[c.id] || DEFAULT_COLOR;
        const normState = normalizeEstado(c.estado);
        const estInfo = ESTADOS[normState] || ESTADOS.parado;

        const direccionHtml = c.direccion
          ? '<div style="margin:2px 0 4px 0; color:#38bdf8; font-size:11px;">📍 <b>' + c.direccion + '</b></div>'
          : '<div style="margin:2px 0 4px 0; color:#94a3b8; font-size:11px;">📍 Oruro, Bolivia</div>';

        const popupHtml = 
          '<div class="popup-title" style="color:' + color.ring + ';">🚛 ' + c.id + ' (' + color.name + ')</div>' +
          '<div class="popup-text">' +
          'Placa: <b>' + (c.placa || '') + '</b><br>' +
          direccionHtml +
          'Velocidad: <b>' + Math.round(c.velocidad || 0) + ' km/h</b><br>' +
          'Estado: <b style="color:' + estInfo.bg + ';">' + estInfo.label + '</b></div>';

        const icon = createTruckIcon(c.id, c.estado, true);

        if (!markers[c.id]) {
          markers[c.id] = L.marker([c.lat, c.lng], { icon: icon }).addTo(map);
        } else {
          markers[c.id].setLatLng([c.lat, c.lng]);
          markers[c.id].setIcon(icon);
        }
        markers[c.id].bindPopup(popupHtml);
      });

      // Eliminar marcadores que ya no estén en la lista
      Object.keys(markers).forEach(id => {
        if (!currentIds[id]) {
          map.removeLayer(markers[id]);
          delete markers[id];
        }
      });

      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
      } else if (bounds.length === 1) {
        map.panTo(bounds[0], { animate: true, duration: 0.6 });
      }
    }

    // Escuchar mensajes sin recargar el iframe
    window.addEventListener('message', function(event) {
      try {
        const msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (msg) {
          if (msg.type === 'UPDATE_CAMIONES') {
            updateMultiMarkers(msg.camiones);
          } else if (msg.type === 'UPDATE_LOCATION') {
            updateSingleMarker(msg);
          }
        }
      } catch (err) {}
    });

    // Notificar al padre que el mapa ya está listo
    window.parent.postMessage({ type: 'MAP_READY' }, '*');
  </script>
</body>
</html>`;

export function LeafletMap({
  latitude = -17.9647,
  longitude = -67.106,
  camionId = 'REC-01',
  placa = '1234-ABC',
  estado = 'parado',
  velocidad = 0,
  direccion,
  camiones,
}: LeafletMapProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const isLoadedRef = useRef(false);

  // Enviar mensaje suave al iframe cuando cambian los datos (sin reconstruir el iframe)
  useEffect(() => {
    const sendUpdate = () => {
      if (iframeRef.current && iframeRef.current.contentWindow) {
        if (camiones && camiones.length > 0) {
          iframeRef.current.contentWindow.postMessage(
            {
              type: 'UPDATE_CAMIONES',
              camiones,
            },
            '*'
          );
        } else {
          iframeRef.current.contentWindow.postMessage(
            {
              type: 'UPDATE_LOCATION',
              lat: latitude,
              lng: longitude,
              camionId,
              placa,
              estado,
              velocidad,
              direccion,
            },
            '*'
          );
        }
      }
    };

    if (isLoadedRef.current) {
      sendUpdate();
    } else {
      const t = setTimeout(sendUpdate, 600);
      return () => clearTimeout(t);
    }
  }, [latitude, longitude, camionId, placa, estado, velocidad, direccion, camiones]);

  const Iframe = 'iframe' as any;

  return (
    <View style={styles.container}>
      <Iframe
        ref={iframeRef}
        title="Leaflet OpenStreetMap"
        srcDoc={STATIC_MAP_HTML}
        onLoad={() => {
          isLoadedRef.current = true;
          if (iframeRef.current && iframeRef.current.contentWindow) {
            if (camiones && camiones.length > 0) {
              iframeRef.current.contentWindow.postMessage(
                {
                  type: 'UPDATE_CAMIONES',
                  camiones,
                },
                '*'
              );
            } else {
              iframeRef.current.contentWindow.postMessage(
                {
                  type: 'UPDATE_LOCATION',
                  lat: latitude,
                  lng: longitude,
                  camionId,
                  placa,
                  estado,
                  velocidad,
                  direccion,
                },
                '*'
              );
            }
          }
        }}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0f172a',
  },
});
