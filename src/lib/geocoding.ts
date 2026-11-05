// src/lib/geocoding.ts
// Servicio de Reverse Geocoding para Oruro, Bolivia con memoria caché

const geocodeCache = new Map<string, string>();

const KNOWN_LOCATIONS: Record<string, string> = {
  '-17.965,-67.106': 'Calle 1 de Noviembre (Distrito 1)',
  '-17.971,-67.112': 'Calle Potosí (Distrito 1)',
  '-17.958,-67.098': 'Av. 6 de Agosto (Distrito 3)',
  '-17.965,-67.110': 'Plaza 10 de Febrero (Centro Histórico)',
};

/**
 * Obtiene el nombre de la calle/zona a partir de latitud y longitud.
 * Utiliza OpenStreetMap Nominatim con caché en memoria.
 */
export async function reverseGeocodeOruro(lat: number, lng: number): Promise<string> {
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
    return 'Ubicación no disponible';
  }

  // Clave de caché aproximada a ~10-20 metros
  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey)!;
  }

  // Ubicaciones conocidas pre-cargadas para respuesta inmediata (0ms)
  if (KNOWN_LOCATIONS[cacheKey]) {
    const loc = KNOWN_LOCATIONS[cacheKey];
    geocodeCache.set(cacheKey, loc);
    return loc;
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'AppRecolectorOruro/1.0 (contacto@oruro-recolector.gob.bo)',
        'Accept-Language': 'es',
      },
    });

    if (!res.ok) {
      const fallback = 'Oruro, Bolivia';
      geocodeCache.set(cacheKey, fallback);
      return fallback;
    }

    const data = await res.json();
    const addr = data.address || {};

    const street = addr.road || addr.pedestrian || addr.footway || addr.path;
    const suburb = addr.suburb || addr.neighbourhood || addr.city_district;

    let result = '';
    if (street && suburb) {
      result = `${street} (${suburb})`;
    } else if (street) {
      result = `${street}, Oruro`;
    } else if (suburb) {
      result = `${suburb}, Oruro`;
    } else if (addr.city) {
      result = `${addr.city}, Bolivia`;
    } else {
      result = 'Zona Urbana, Oruro';
    }

    geocodeCache.set(cacheKey, result);
    return result;
  } catch {
    return 'Oruro, Bolivia';
  }
}

