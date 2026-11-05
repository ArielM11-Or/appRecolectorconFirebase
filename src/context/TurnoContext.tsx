import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  ReactNode,
  useCallback,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import {
  ref as dbRef,
  update as dbUpdate,
  onValue as dbOnValue,
} from 'firebase/database';
import { db, rtdb } from '@/lib/firebase';
import { haversineKm } from '@/lib/haversine';
import { calcularLitros } from '@/lib/fuel';
import { enqueueUpdate } from '@/lib/offlineQueue';
import { reverseGeocodeOruro } from '@/lib/geocoding';

export type EstadoCamion =
  | 'en_camino'
  | 'recolectando'
  | 'comprimiendo'
  | 'parado';

export type TurnoType = 'mañana' | 'tarde' | 'noche';

export interface CamionInfo {
  id: string;
  placa: string;
  modelo: string;
}

export const CAMIONES_DISPONIBLES: CamionInfo[] = [
  { id: 'REC-01', placa: '1234-ABC', modelo: 'Volvo FL280 Compactador' },
  { id: 'REC-02', placa: '5678-DEF', modelo: 'Mercedes Atego 1729' },
  { id: 'REC-03', placa: '9012-GHI', modelo: 'Hino 500 Series' },
];

export interface CamionColorConfig {
  name: string;
  primary: string;
  border: string;
  glow: string;
  ring: string;
  truckFill: string;
  badgeBg: string;
}

export const CAMION_COLORS: Record<string, CamionColorConfig> = {
  'REC-01': {
    name: 'Azul',
    primary: '#0284c7',
    border: '#38bdf8',
    glow: 'rgba(2, 132, 199, 0.7)',
    ring: '#38bdf8',
    truckFill: '#0369a1',
    badgeBg: 'rgba(2, 132, 199, 0.2)',
  },
  'REC-02': {
    name: 'Amarillo',
    primary: '#eab308',
    border: '#facc15',
    glow: 'rgba(234, 179, 8, 0.7)',
    ring: '#fde047',
    truckFill: '#ca8a04',
    badgeBg: 'rgba(234, 179, 8, 0.2)',
  },
  'REC-03': {
    name: 'Naranja',
    primary: '#f97316',
    border: '#fb923c',
    glow: 'rgba(249, 115, 22, 0.7)',
    ring: '#fdba74',
    truckFill: '#ea580c',
    badgeBg: 'rgba(249, 115, 22, 0.2)',
  },
};

export const DEFAULT_CAMION_COLOR: CamionColorConfig = {
  name: 'Púrpura',
  primary: '#8b5cf6',
  border: '#c084fc',
  glow: 'rgba(139, 92, 246, 0.7)',
  ring: '#c084fc',
  truckFill: '#7c3aed',
  badgeBg: 'rgba(139, 92, 246, 0.2)',
};

export function getCamionColor(id: string): CamionColorConfig {
  return CAMION_COLORS[id] || DEFAULT_CAMION_COLOR;
}

export function getPlacaForCamion(id: string): string {
  const found = CAMIONES_DISPONIBLES.find((c) => c.id === id);
  return found ? found.placa : `${id}-PLACA`;
}

interface TurnoState {
  turnoId: string | null;
  camionId: string;
  placa: string;
  estadoActual: EstadoCamion;
  modoAutomatico: boolean;
  kmRecorridos: number;
  tiempoTransitoMin: number;
  tiempoRecoleccionMin: number;
  tiempoRalentiMin: number;
  tiempoCompresionMin: number;
  ciclosCompresion: number;
  litrosEstimados: number;
  direccion?: string;
}

interface TurnoContextValue extends TurnoState {
  setCamionId: (id: string) => Promise<void>;
  setModoAutomatico: (auto: boolean) => void;
  iniciarTurno: (turno: TurnoType) => Promise<void>;
  cambiarEstado: (nuevoEstado: EstadoCamion, esManual?: boolean) => Promise<void>;
  finalizarTurno: () => Promise<void>;
  actualizarGPS: (lat: number, lng: number, velocidad: number) => Promise<void>;
}

const CAMION_ID_STORAGE_KEY = '@camion_id';
const LOCAL_STORAGE_PREFIX = 'active_turno_state_v2_';

const TurnoContext = createContext<TurnoContextValue | null>(null);

function getTurnoSuffix(turno: TurnoType): string {
  if (turno === 'mañana') return 'M';
  if (turno === 'tarde') return 'T';
  return 'N';
}

function buildTurnoId(turno: TurnoType, cid: string): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const cleanId = cid.replace(/[^A-Za-z0-9]/g, '');
  return `TURNO-${yyyy}${mm}${dd}-${cleanId}-${getTurnoSuffix(turno)}`;
}

function getFechaStr(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function TurnoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TurnoState>({
    turnoId: null,
    camionId: 'REC-01',
    placa: '1234-ABC',
    estadoActual: 'parado',
    modoAutomatico: true,
    kmRecorridos: 0,
    tiempoTransitoMin: 0,
    tiempoRecoleccionMin: 0,
    tiempoRalentiMin: 0,
    tiempoCompresionMin: 0,
    ciclosCompresion: 0,
    litrosEstimados: 0,
    direccion: 'Oruro, Bolivia',
  });

  const estadoStartRef = useRef<number | null>(null);
  const lastGPSRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastFirestoreGPSSyncRef = useRef<number>(0);
  const manualComprimiendoRef = useRef<boolean>(false);
  const lastGeocodeRef = useRef<{ lat: number; lng: number; time: number; addr: string }>({
    lat: 0,
    lng: 0,
    time: 0,
    addr: 'Oruro, Bolivia',
  });

  /**
   * 1. Cargar unidad seleccionada desde AsyncStorage (@camion_id)
   */
  useEffect(() => {
    let mounted = true;
    const initCamionId = async () => {
      try {
        const savedCid = await AsyncStorage.getItem(CAMION_ID_STORAGE_KEY);
        if (savedCid && mounted) {
          const placa = getPlacaForCamion(savedCid);
          setState((prev) => ({ ...prev, camionId: savedCid, placa }));
        }
      } catch (e) {
        console.warn('Error leyendo @camion_id:', e);
      }
    };
    initCamionId();
    return () => {
      mounted = false;
    };
  }, []);

  /**
   * 2. Cargar estado persistente local del camión actual y escuchar RTDB
   */
  useEffect(() => {
    let mounted = true;
    const currentCamionId = state.camionId;
    const storageKey = `${LOCAL_STORAGE_PREFIX}${currentCamionId}`;

    const restoreLocalState = async () => {
      try {
        const saved = await AsyncStorage.getItem(storageKey);
        if (saved && mounted) {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.turnoId) {
            setState((prev) => ({
              ...prev,
              ...parsed,
              camionId: currentCamionId,
              placa: getPlacaForCamion(currentCamionId),
            }));
            estadoStartRef.current = Date.now();
          }
        }
      } catch (err) {
        console.warn('Error leyendo estado local:', err);
      }
    };

    restoreLocalState();

    // Sincronización en vivo con RTDB para la unidad seleccionada
    const camionRtdbRef = dbRef(rtdb, `camiones/${currentCamionId}`);
    const unsubRtdb = dbOnValue(
      camionRtdbRef,
      async (snapshot) => {
        if (!mounted || !snapshot.exists()) return;
        const data = snapshot.val();
        const activo = data.activo ?? false;
        const turnoActivoId = data.turnoActivoId || null;
        const estadoRemoto = (data.estado as EstadoCamion) || 'parado';

        if (activo && turnoActivoId) {
          try {
            const turnoSnap = await getDoc(doc(db, 'turnos_recoleccion', turnoActivoId));
            if (turnoSnap.exists() && mounted) {
              const tData = turnoSnap.data();
              setState((prev) => {
                const updated: TurnoState = {
                  ...prev,
                  turnoId: turnoActivoId,
                  camionId: currentCamionId,
                  placa: getPlacaForCamion(currentCamionId),
                  estadoActual: estadoRemoto,
                  kmRecorridos: Math.max(prev.kmRecorridos, tData.kmRecorridos || 0),
                  tiempoTransitoMin: Math.max(prev.tiempoTransitoMin, tData.tiempoTransitoMin || 0),
                  tiempoRecoleccionMin: Math.max(prev.tiempoRecoleccionMin, tData.tiempoRecoleccionMin || 0),
                  tiempoRalentiMin: Math.max(prev.tiempoRalentiMin, tData.tiempoRalentiMin || 0),
                  tiempoCompresionMin: Math.max(prev.tiempoCompresionMin, tData.tiempoCompresionMin || 0),
                  ciclosCompresion: Math.max(prev.ciclosCompresion, tData.ciclosCompresion || 0),
                  litrosEstimados: Math.max(prev.litrosEstimados, tData.litrosEstimados || 0),
                };
                AsyncStorage.setItem(storageKey, JSON.stringify(updated)).catch(() => {});
                return updated;
              });
              estadoStartRef.current = Date.now();
            }
          } catch {
            // Mantener estado local si Firestore está limitado
          }
        }
      },
      (err) => {
        console.warn('Error escuchando RTDB:', err);
      }
    );

    return () => {
      mounted = false;
      unsubRtdb();
    };
  }, [state.camionId]);

  function acumularTiempo(
    estadoAnterior: EstadoCamion,
    elapsedMs: number,
    current: TurnoState
  ): Partial<TurnoState> {
    const minutos = elapsedMs / 60000;
    switch (estadoAnterior) {
      case 'en_camino':
        return { tiempoTransitoMin: current.tiempoTransitoMin + minutos };
      case 'recolectando':
        return { tiempoRecoleccionMin: current.tiempoRecoleccionMin + minutos };
      case 'comprimiendo':
        return { tiempoCompresionMin: current.tiempoCompresionMin + minutos };
      case 'parado':
        return { tiempoRalentiMin: current.tiempoRalentiMin + minutos };
      default:
        return {};
    }
  }

  const setCamionId = useCallback(async (newId: string) => {
    const placa = getPlacaForCamion(newId);
    await AsyncStorage.setItem(CAMION_ID_STORAGE_KEY, newId).catch(() => {});
    manualComprimiendoRef.current = false;
    lastGPSRef.current = null;
    estadoStartRef.current = Date.now();

    // Intentar restaurar estado previo de esa unidad
    let loadedState: Partial<TurnoState> = {
      turnoId: null,
      estadoActual: 'parado',
      kmRecorridos: 0,
      tiempoTransitoMin: 0,
      tiempoRecoleccionMin: 0,
      tiempoRalentiMin: 0,
      tiempoCompresionMin: 0,
      ciclosCompresion: 0,
      litrosEstimados: 0,
    };

    try {
      const saved = await AsyncStorage.getItem(`${LOCAL_STORAGE_PREFIX}${newId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed) loadedState = { ...loadedState, ...parsed };
      }
    } catch {}

    setState((prev) => ({
      ...prev,
      ...loadedState,
      camionId: newId,
      placa,
    }));
  }, []);

  const setModoAutomatico = useCallback((auto: boolean) => {
    setState((prev) => ({ ...prev, modoAutomatico: auto }));
  }, []);

  const iniciarTurno = useCallback(async (turno: TurnoType) => {
    const fecha = getFechaStr();
    const horaInicio = Timestamp.now();
    estadoStartRef.current = Date.now();
    lastGPSRef.current = null;
    manualComprimiendoRef.current = false;

    let cid = 'REC-01';
    let cPlaca = '1234-ABC';

    setState((prev) => {
      cid = prev.camionId;
      cPlaca = prev.placa;
      const turnoId = buildTurnoId(turno, cid);

      const initialTurnoState: TurnoState = {
        ...prev,
        turnoId,
        camionId: cid,
        placa: cPlaca,
        estadoActual: 'en_camino',
        kmRecorridos: 0,
        tiempoTransitoMin: 0,
        tiempoRecoleccionMin: 0,
        tiempoRalentiMin: 0,
        tiempoCompresionMin: 0,
        ciclosCompresion: 0,
        litrosEstimados: 0,
      };

      // 1. Guardar localmente
      AsyncStorage.setItem(`${LOCAL_STORAGE_PREFIX}${cid}`, JSON.stringify(initialTurnoState)).catch(() => {});

      // 2. Transmitir a Firebase Realtime Database
      dbUpdate(dbRef(rtdb, `camiones/${cid}`), {
        id: cid,
        placa: cPlaca,
        activo: true,
        turnoActivoId: turnoId,
        estado: 'en_camino',
        velocidad: 0,
        lat: -17.9647,
        lng: -67.1060,
        ultimaActualizacion: Date.now(),
      }).catch((err) => console.warn('Error en RTDB iniciarTurno:', err));

      // 3. Documento histórico en Firestore
      const turnoData = {
        camionId: cid,
        placa: cPlaca,
        fecha,
        turno,
        estadoTurno: 'en_progreso',
        horaInicio,
        horaFin: null,
        kmRecorridos: 0,
        tiempoTransitoMin: 0,
        tiempoRecoleccionMin: 0,
        tiempoRalentiMin: 0,
        tiempoCompresionMin: 0,
        ciclosCompresion: 0,
        litrosEstimados: 0,
      };

      setDoc(doc(db, 'turnos_recoleccion', turnoId), turnoData, { merge: true }).catch((err) => {
        console.warn('Sincronización de turno en cola offline:', err?.message || err);
        enqueueUpdate({ docPath: `turnos_recoleccion/${turnoId}`, data: turnoData }).catch(() => {});
      });

      return initialTurnoState;
    });
  }, []);

  const cambiarEstado = useCallback(async (nuevoEstado: EstadoCamion, esManual = true) => {
    setState((prev) => {
      const now = Date.now();
      const prevStart = estadoStartRef.current ?? now;
      const elapsed = Math.max(0, now - prevStart);
      estadoStartRef.current = now;

      if (esManual) {
        manualComprimiendoRef.current = (nuevoEstado === 'comprimiendo');
      }

      const tiempoDelta = acumularTiempo(prev.estadoActual, elapsed, prev);
      const nuevoCiclos =
        nuevoEstado === 'comprimiendo'
          ? prev.ciclosCompresion + 1
          : prev.ciclosCompresion;

      const newState: TurnoState = {
        ...prev,
        ...tiempoDelta,
        estadoActual: nuevoEstado,
        ciclosCompresion: nuevoCiclos,
      };

      const litros = calcularLitros(
        newState.kmRecorridos,
        newState.tiempoRecoleccionMin,
        newState.tiempoRalentiMin,
        newState.ciclosCompresion,
        newState.tiempoCompresionMin
      );
      newState.litrosEstimados = litros;

      // 1. Guardar localmente
      AsyncStorage.setItem(`${LOCAL_STORAGE_PREFIX}${prev.camionId}`, JSON.stringify(newState)).catch(() => {});

      // 2. Transmisión directa a RTDB
      dbUpdate(dbRef(rtdb, `camiones/${prev.camionId}`), {
        id: prev.camionId,
        placa: prev.placa,
        estado: nuevoEstado,
        ultimaActualizacion: Date.now(),
      }).catch((err) => console.warn('Error en RTDB cambiarEstado:', err));

      // 3. Sincronizar reporte en Firestore
      const turnoUpdate = {
        ...tiempoDelta,
        ciclosCompresion: nuevoCiclos,
        litrosEstimados: litros,
      };

      if (prev.turnoId) {
        setDoc(doc(db, 'turnos_recoleccion', prev.turnoId), turnoUpdate, { merge: true }).catch(() => {
          enqueueUpdate({ docPath: `turnos_recoleccion/${prev.turnoId}`, data: turnoUpdate }).catch(() => {});
        });
      }

      return newState;
    });
  }, []);

  const finalizarTurno = useCallback(async () => {
    let finalSnapshot: TurnoState | null = null;

    setState((prev) => {
      const now = Date.now();
      const prevStart = estadoStartRef.current ?? now;
      const elapsed = Math.max(0, now - prevStart);
      estadoStartRef.current = null;
      manualComprimiendoRef.current = false;

      const tiempoDelta = acumularTiempo(prev.estadoActual, elapsed, prev);
      const litros = calcularLitros(
        prev.kmRecorridos,
        (prev.tiempoRecoleccionMin || 0) + (tiempoDelta.tiempoRecoleccionMin || 0),
        (prev.tiempoRalentiMin || 0) + (tiempoDelta.tiempoRalentiMin || 0),
        prev.ciclosCompresion,
        (prev.tiempoCompresionMin || 0) + (tiempoDelta.tiempoCompresionMin || 0)
      );

      finalSnapshot = {
        ...prev,
        ...tiempoDelta,
        litrosEstimados: litros,
      };

      const endedState: TurnoState = {
        ...prev,
        ...tiempoDelta,
        turnoId: null,
        estadoActual: 'parado',
        litrosEstimados: litros,
      };

      // 1. Limpiar almacenamiento local
      AsyncStorage.removeItem(`${LOCAL_STORAGE_PREFIX}${prev.camionId}`).catch(() => {});

      // 2. Transmisión directa a RTDB
      dbUpdate(dbRef(rtdb, `camiones/${prev.camionId}`), {
        id: prev.camionId,
        placa: prev.placa,
        activo: false,
        estado: 'parado',
        velocidad: 0,
        turnoActivoId: '',
        ultimaActualizacion: Date.now(),
      }).catch((err) => console.warn('Error en RTDB finalizarTurno:', err));

      // 3. Finalizar documento histórico en Firestore
      if (finalSnapshot && (finalSnapshot as TurnoState).turnoId) {
        const snap = finalSnapshot as TurnoState;
        const turnoFinData = {
          estadoTurno: 'finalizado',
          horaFin: serverTimestamp(),
          kmRecorridos: snap.kmRecorridos,
          tiempoTransitoMin: snap.tiempoTransitoMin,
          tiempoRecoleccionMin: snap.tiempoRecoleccionMin,
          tiempoRalentiMin: snap.tiempoRalentiMin,
          tiempoCompresionMin: snap.tiempoCompresionMin,
          ciclosCompresion: snap.ciclosCompresion,
          litrosEstimados: snap.litrosEstimados,
        };

        setDoc(doc(db, 'turnos_recoleccion', snap.turnoId!), turnoFinData, { merge: true }).catch(() => {
          enqueueUpdate({ docPath: `turnos_recoleccion/${snap.turnoId!}`, data: turnoFinData }).catch(() => {});
        });
      }

      return endedState;
    });
  }, []);

  const actualizarGPS = useCallback(
    async (lat: number, lng: number, velocidad: number) => {
      const velocidadKmH = Math.max(0, Math.round(velocidad));
      const now = Date.now();

      // Reverse geocoding throttled a cada 15 segundos o al desplazarse > 30 metros
      const distFromLastGeocode = haversineKm(
        lastGeocodeRef.current.lat,
        lastGeocodeRef.current.lng,
        lat,
        lng
      );
      if (
        now - lastGeocodeRef.current.time > 15000 ||
        distFromLastGeocode > 0.03 ||
        lastGeocodeRef.current.time === 0
      ) {
        lastGeocodeRef.current.time = now;
        lastGeocodeRef.current.lat = lat;
        lastGeocodeRef.current.lng = lng;
        reverseGeocodeOruro(lat, lng)
          .then((addr) => {
            lastGeocodeRef.current.addr = addr;
            dbUpdate(dbRef(rtdb, `camiones/${state.camionId}`), {
              direccion: addr,
            }).catch(() => {});
          })
          .catch(() => {});
      }

      setState((prev) => {
        let newKm = prev.kmRecorridos;
        if (lastGPSRef.current !== null) {
          const dist = haversineKm(
            lastGPSRef.current.lat,
            lastGPSRef.current.lng,
            lat,
            lng
          );
          newKm = prev.kmRecorridos + dist;
        }
        lastGPSRef.current = { lat, lng };

        // ===== INFERENCIA AUTOMÁTICA DE ESTADO POR VELOCIDAD GPS =====
        let targetEstado: EstadoCamion = prev.estadoActual;

        if (manualComprimiendoRef.current) {
          // Si el chofer fijó 'comprimiendo', mantener hasta superar 5 km/h
          if (velocidadKmH > 5) {
            manualComprimiendoRef.current = false;
            // Retoma cálculo automático
            if (velocidadKmH > 20) {
              targetEstado = 'en_camino';
            } else if (velocidadKmH >= 3) {
              targetEstado = 'recolectando';
            } else {
              targetEstado = 'parado';
            }
          } else {
            targetEstado = 'comprimiendo';
          }
        } else if (prev.modoAutomatico) {
          // Inferencia estándar por velocidad
          if (velocidadKmH > 20) {
            targetEstado = 'en_camino';
          } else if (velocidadKmH >= 3 && velocidadKmH <= 20) {
            targetEstado = 'recolectando';
          } else {
            targetEstado = 'parado';
          }
        }

        // Si cambió el estado inferido, acumular tiempos
        let tiempoDelta: Partial<TurnoState> = {};
        if (targetEstado !== prev.estadoActual) {
          const prevStart = estadoStartRef.current ?? now;
          const elapsed = Math.max(0, now - prevStart);
          estadoStartRef.current = now;
          tiempoDelta = acumularTiempo(prev.estadoActual, elapsed, prev);
        }

        const litros = calcularLitros(
          newKm,
          (prev.tiempoRecoleccionMin || 0) + (tiempoDelta.tiempoRecoleccionMin || 0),
          (prev.tiempoRalentiMin || 0) + (tiempoDelta.tiempoRalentiMin || 0),
          prev.ciclosCompresion,
          (prev.tiempoCompresionMin || 0) + (tiempoDelta.tiempoCompresionMin || 0)
        );

        const updatedState: TurnoState = {
          ...prev,
          ...tiempoDelta,
          estadoActual: targetEstado,
          kmRecorridos: newKm,
          litrosEstimados: litros,
          direccion: lastGeocodeRef.current.addr,
        };

        // 1. Guardar localmente
        AsyncStorage.setItem(`${LOCAL_STORAGE_PREFIX}${prev.camionId}`, JSON.stringify(updatedState)).catch(() => {});

        // 2. Transmisión continua a Firebase Realtime Database (RTDB)
        const payload = {
          id: prev.camionId,
          placa: prev.placa,
          activo: Boolean(prev.turnoId),
          lat,
          lng,
          velocidad: velocidadKmH,
          estado: targetEstado,
          direccion: lastGeocodeRef.current.addr,
          ultimaActualizacion: Date.now(),
        };

        dbUpdate(dbRef(rtdb, `camiones/${prev.camionId}`), payload).catch((err) =>
          console.warn('Error en RTDB actualizarGPS:', err)
        );

        // 3. Sincronización periódica de reporte en Firestore (máximo 1 vez cada 30 segundos)
        if (now - lastFirestoreGPSSyncRef.current >= 30000) {
          lastFirestoreGPSSyncRef.current = now;

          if (prev.turnoId) {
            setDoc(
              doc(db, 'turnos_recoleccion', prev.turnoId),
              { kmRecorridos: newKm, litrosEstimados: litros },
              { merge: true }
            ).catch(() => {});
          }
        }

        return updatedState;
      });
    },
    [state.camionId]
  );

  return (
    <TurnoContext.Provider
      value={{
        ...state,
        setCamionId,
        setModoAutomatico,
        iniciarTurno,
        cambiarEstado,
        finalizarTurno,
        actualizarGPS,
      }}
    >
      {children}
    </TurnoContext.Provider>
  );
}

export function useTurno(): TurnoContextValue {
  const ctx = useContext(TurnoContext);
  if (!ctx) {
    throw new Error('useTurno must be used within a TurnoProvider');
  }
  return ctx;
}
