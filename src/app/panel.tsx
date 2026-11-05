import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
  ActivityIndicator,
  TextInput,
  StatusBar as RNStatusBar,
} from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  limit,
} from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import {
  useTurno,
  EstadoCamion,
  TurnoType,
  CAMIONES_DISPONIBLES,
} from '@/context/TurnoContext';
import { flushQueue } from '@/lib/offlineQueue';
import { db } from '@/lib/firebase';

type TabType = 'operativo' | 'dashboard';

type EstadoConfig = {
  label: string;
  emoji: string;
  color: string;
};

const ESTADOS: Record<EstadoCamion, EstadoConfig> = {
  en_camino: { label: 'En Camino', emoji: '🚛', color: '#22c55e' },
  recolectando: { label: 'Recolectando', emoji: '🗑️', color: '#f59e0b' },
  comprimiendo: { label: 'Comprimiendo', emoji: '⚙️', color: '#a855f7' },
  parado: { label: 'Parado / Ralentí', emoji: '⏸️', color: '#ef4444' },
};

const TURNOS: { key: TurnoType; label: string; emoji: string }[] = [
  { key: 'mañana', label: 'Mañana', emoji: '☀️' },
  { key: 'tarde', label: 'Tarde', emoji: '🌅' },
  { key: 'noche', label: 'Noche', emoji: '🌙' },
];

interface TurnoDoc {
  id?: string;
  camionId?: string;
  fecha?: string;
  turno?: TurnoType;
  estadoTurno?: 'en_progreso' | 'finalizado';
  kmRecorridos?: number;
  litrosEstimados?: number;
  ciclosCompresion?: number;
  tiempoTransitoMin?: number;
  tiempoRecoleccionMin?: number;
  tiempoRalentiMin?: number;
  tiempoCompresionMin?: number;
  horaInicio?: { seconds: number } | null;
}

export default function PanelScreen() {
  const { user, signOut } = useAuth();
  const turno = useTurno();
  const [activeTab, setActiveTab] = useState<TabType>('operativo');

  // Conductor state
  const [selectedTurno, setSelectedTurno] = useState<TurnoType>('mañana');
  const [velocidad, setVelocidad] = useState<number>(0);
  const [iniciandoTurno, setIniciandoTurno] = useState(false);
  const [finalizandoTurno, setFinalizandoTurno] = useState(false);
  const [gpsPermission, setGpsPermission] = useState<boolean | null>(null);
  const watchRef = useRef<Location.LocationSubscription | null>(null);

  // Dashboard state
  const [filterDate, setFilterDate] = useState(() => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  });
  const [filterTurno, setFilterTurno] = useState<string>('');
  const [turnosHistory, setTurnosHistory] = useState<TurnoDoc[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const statusBarHeight =
    Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 24) : 44;

  // Ref mutable para actualizarGPS: evita destruir y re-crear el watcher de GPS en cada render
  const actualizarGPSRef = useRef(turno.actualizarGPS);
  useEffect(() => {
    actualizarGPSRef.current = turno.actualizarGPS;
  }, [turno.actualizarGPS]);

  // GPS tracking for active truck (inicia una sola vez en el montaje)
  useEffect(() => {
    let mounted = true;

    const setupLocation = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (!mounted) return;

      if (status !== 'granted') {
        setGpsPermission(false);
        return;
      }

      setGpsPermission(true);

      watchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,
          distanceInterval: 10,
        },
        (location) => {
          const { latitude, longitude, speed } = location.coords;
          const speedKmh = Math.max(0, Math.round((speed || 0) * 3.6));
          setVelocidad(speedKmh);

          actualizarGPSRef.current(latitude, longitude, speedKmh);
          flushQueue(db).catch(() => {});
        }
      );
    };

    setupLocation();

    return () => {
      mounted = false;
      watchRef.current?.remove();
    };
  }, []);

  // Load dashboard data
  const fetchDashboardData = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const colRef = collection(db, 'turnos_recoleccion');
      let q = query(colRef, orderBy('horaInicio', 'desc'), limit(50));

      if (filterDate.trim()) {
        q = query(q, where('fecha', '==', filterDate.trim()));
      }
      if (filterTurno) {
        q = query(q, where('turno', '==', filterTurno));
      }

      const snap = await getDocs(q);
      const docs: TurnoDoc[] = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      setTurnosHistory(docs);
    } catch {
      // Fallback query without compound sorting if indexes aren't created yet
      try {
        const snap = await getDocs(
          query(collection(db, 'turnos_recoleccion'), limit(50))
        );
        let docs: TurnoDoc[] = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        if (filterDate.trim()) {
          docs = docs.filter((item) => item.fecha === filterDate.trim());
        }
        if (filterTurno) {
          docs = docs.filter((item) => item.turno === filterTurno);
        }
        setTurnosHistory(docs);
      } catch (e) {
        console.error('Error fetching turnos history:', e);
      }
    } finally {
      setLoadingHistory(false);
    }
  }, [filterDate, filterTurno]);

  useEffect(() => {
    if (activeTab === 'dashboard') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchDashboardData();
    }
  }, [activeTab, fetchDashboardData]);

  const handleIniciarTurno = async () => {
    setIniciandoTurno(true);
    try {
      await turno.iniciarTurno(selectedTurno);
    } catch {
      Alert.alert('Error', 'No se pudo iniciar el turno. Intenta nuevamente.');
    } finally {
      setIniciandoTurno(false);
    }
  };

  const handleFinalizarTurno = () => {
    Alert.alert(
      'Finalizar Turno',
      '¿Deseas cerrar y finalizar el turno de recolección actual?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Finalizar',
          style: 'destructive',
          onPress: async () => {
            setFinalizandoTurno(true);
            try {
              await turno.finalizarTurno();
            } catch {
              Alert.alert('Error', 'No se pudo finalizar el turno.');
            } finally {
              setFinalizandoTurno(false);
            }
          },
        },
      ]
    );
  };

  const handleSignOut = () => {
    Alert.alert('Cerrar Sesión', '¿Deseas salir del panel?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar Sesión',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/');
        },
      },
    ]);
  };

  const estadoConfig = ESTADOS[turno.estadoActual];
  const tiempoTotalMin = Math.round(
    turno.tiempoTransitoMin +
      turno.tiempoRecoleccionMin +
      turno.tiempoRalentiMin +
      turno.tiempoCompresionMin
  );

  // Dashboard Aggregates
  const totalLitrosDash = turnosHistory.reduce(
    (acc, curr) => acc + (curr.litrosEstimados || 0),
    0
  );
  const totalKmDash = turnosHistory.reduce(
    (acc, curr) => acc + (curr.kmRecorridos || 0),
    0
  );
  const totalCompresionesDash = turnosHistory.reduce(
    (acc, curr) => acc + (curr.ciclosCompresion || 0),
    0
  );
  const rendimientoPromedio =
    totalKmDash > 0 ? (totalLitrosDash / totalKmDash).toFixed(2) : '0.00';

  // Desglose de combustible estimado por estado en el dashboard
  const sumTransito = turnosHistory.reduce(
    (acc, curr) => acc + (curr.tiempoTransitoMin || 0),
    0
  );
  const sumRecoleccion = turnosHistory.reduce(
    (acc, curr) => acc + (curr.tiempoRecoleccionMin || 0),
    0
  );
  const sumRalenti = turnosHistory.reduce(
    (acc, curr) => acc + (curr.tiempoRalentiMin || 0),
    0
  );
  const sumCompresion = turnosHistory.reduce(
    (acc, curr) => acc + (curr.tiempoCompresionMin || 0),
    0
  );

  const totalMinutosHistorial =
    sumTransito + sumRecoleccion + sumRalenti + sumCompresion;
  const transitoPct =
    totalMinutosHistorial > 0
      ? Math.round((sumTransito / totalMinutosHistorial) * 100)
      : 25;
  const recoleccionPct =
    totalMinutosHistorial > 0
      ? Math.round((sumRecoleccion / totalMinutosHistorial) * 100)
      : 25;
  const ralentiPct =
    totalMinutosHistorial > 0
      ? Math.round((sumRalenti / totalMinutosHistorial) * 100)
      : 25;
  const compresionPct =
    totalMinutosHistorial > 0
      ? Math.round((sumCompresion / totalMinutosHistorial) * 100)
      : 25;

  return (
    <View style={styles.root}>
      {/* ===== BARRA SUPERIOR CON ACCIONES ===== */}
      <View style={[styles.topBar, { paddingTop: statusBarHeight + 8 }]}>
        <View style={styles.topBarLeft}>
          <Text style={styles.topBarTitle}>Panel Interno</Text>
          <Text style={styles.userEmailText}>
            {user?.email || 'Usuario autenticado'}
          </Text>
        </View>

        <View style={styles.topBarActions}>
          <TouchableOpacity
            style={styles.navBtnPublic}
            onPress={() => router.replace('/')}
            activeOpacity={0.8}
          >
            <Text style={styles.navBtnPublicText}>🗺️ Ver Mapa</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.navBtnLogout}
            onPress={handleSignOut}
            activeOpacity={0.8}
          >
            <Text style={styles.navBtnLogoutText}>🚪 Salir</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ===== SELECTOR DE MÓDULOS (TABS) ===== */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'operativo' && styles.tabButtonActive]}
          onPress={() => setActiveTab('operativo')}
          activeOpacity={0.85}
        >
          <Text
            style={[
              styles.tabButtonText,
              activeTab === 'operativo' && styles.tabButtonTextActive,
            ]}
          >
            🚛 Operativo Conductor
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'dashboard' && styles.tabButtonActive]}
          onPress={() => setActiveTab('dashboard')}
          activeOpacity={0.85}
        >
          <Text
            style={[
              styles.tabButtonText,
              activeTab === 'dashboard' && styles.tabButtonTextActive,
            ]}
          >
            📊 Dashboard Combustible
          </Text>
        </TouchableOpacity>
      </View>

      {/* ===== CONTENIDO SEGÚN TAB ACTIVA ===== */}
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'operativo' ? (
          /* ============================================================ */
          /*                       MÓDULO A: CONDUCTOR                    */
          /* ============================================================ */
          <>
            {/* Header Telemetría Activa */}
            <View style={styles.cardHeader}>
              <View>
                <Text style={styles.camionTitle}>🚛 {turno.camionId}</Text>
                <Text style={styles.placaSubtitle}>Placa: {turno.placa} · Oruro</Text>
              </View>

              <View style={styles.headerRight}>
                <View style={styles.velocidadBadge}>
                  <Text style={styles.velocidadText}>{velocidad}</Text>
                  <Text style={styles.velocidadUnit}>km/h</Text>
                </View>

                <View
                  style={[
                    styles.estadoBadge,
                    {
                      backgroundColor: estadoConfig.color + '25',
                      borderColor: estadoConfig.color,
                    },
                  ]}
                >
                  <Text style={[styles.estadoBadgeText, { color: estadoConfig.color }]}>
                    {estadoConfig.emoji} {estadoConfig.label}
                  </Text>
                </View>
              </View>
            </View>

            {/* Aviso de GPS */}
            {gpsPermission === false && (
              <View style={styles.warningCard}>
                <Text style={styles.warningText}>
                  ⚠️ Permiso de ubicación no otorgado. El cálculo en tiempo real requiere GPS.
                </Text>
                <TouchableOpacity
                  style={styles.warningBtn}
                  onPress={async () => {
                    const { status } = await Location.requestForegroundPermissionsAsync();
                    setGpsPermission(status === 'granted');
                  }}
                >
                  <Text style={styles.warningBtnText}>Activar GPS</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Selector de Turno y Unidad (si no hay turno activo) */}
            {!turno.turnoId && (
              <View style={styles.glassCard}>
                <Text style={styles.sectionHeaderTitle}>Unidad Asignada</Text>
                <Text style={styles.sectionHeaderSub}>
                  Selecciona el camión recolector para operar
                </Text>
                <View style={styles.unitSelectorRow}>
                  {CAMIONES_DISPONIBLES.map((c) => {
                    const isSelected = turno.camionId === c.id;
                    return (
                      <TouchableOpacity
                        key={c.id}
                        style={[styles.unitChipBtn, isSelected && styles.unitChipBtnActive]}
                        onPress={() => turno.setCamionId(c.id)}
                        activeOpacity={0.8}
                      >
                        <Text
                          style={[
                            styles.unitChipBtnText,
                            isSelected && styles.unitChipBtnTextActive,
                          ]}
                        >
                          🚛 {c.id} ({c.placa})
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={{ height: 16 }} />

                <Text style={styles.sectionHeaderTitle}>Iniciar Nuevo Turno</Text>
                <Text style={styles.sectionHeaderSub}>
                  Selecciona la jornada correspondiente para comenzar el monitoreo
                </Text>

                <View style={styles.turnoRow}>
                  {TURNOS.map((t) => (
                    <TouchableOpacity
                      key={t.key}
                      style={[
                        styles.turnoBtn,
                        selectedTurno === t.key && styles.turnoBtnActive,
                      ]}
                      onPress={() => setSelectedTurno(t.key)}
                    >
                      <Text style={styles.turnoEmoji}>{t.emoji}</Text>
                      <Text
                        style={[
                          styles.turnoLabel,
                          selectedTurno === t.key && styles.turnoLabelActive,
                        ]}
                      >
                        {t.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity
                  style={[styles.iniciarBtn, iniciandoTurno && styles.btnDisabled]}
                  onPress={handleIniciarTurno}
                  disabled={iniciandoTurno}
                  activeOpacity={0.85}
                >
                  {iniciandoTurno ? (
                    <ActivityIndicator color="#0f172a" />
                  ) : (
                    <Text style={styles.iniciarBtnText}>🚀 INICIAR TURNO ({turno.camionId})</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* 4 Botones Táctiles de Estado (Turno Activo) + Inferencia Automática */}
            {turno.turnoId && (
              <View style={styles.glassCard}>
                {/* Control de Modo Automático / Manual */}
                <View style={styles.autoModeCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.autoModeTitle}>
                      {turno.modoAutomatico
                        ? '🤖 Inferencia GPS Automática'
                        : '✋ Modo Manual'}
                    </Text>
                    <Text style={styles.autoModeSub}>
                      {turno.modoAutomatico
                        ? '>20 km/h: En Camino | 3-20 km/h: Recolectando | <3 km/h: Parado'
                        : 'El estado se fija manualmente hasta que actives automático.'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.autoModeToggleBtn,
                      turno.modoAutomatico && styles.autoModeToggleBtnActive,
                    ]}
                    onPress={() => turno.setModoAutomatico(!turno.modoAutomatico)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.autoModeToggleBtnText,
                        turno.modoAutomatico && styles.autoModeToggleBtnTextActive,
                      ]}
                    >
                      {turno.modoAutomatico ? 'GPS AUTO' : 'MANUAL'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {turno.estadoActual === 'comprimiendo' && (
                  <View style={styles.comprimiendoAlert}>
                    <Text style={styles.comprimiendoAlertText}>
                      ⚙️ Estado Comprimiendo bloqueado: se liberará automáticamente al superar 5 km/h.
                    </Text>
                  </View>
                )}

                <View style={{ height: 12 }} />

                <Text style={styles.sectionHeaderTitle}>Override Manual de Estado</Text>
                <Text style={styles.sectionHeaderSub}>
                  Toca cualquier botón para forzar el cambio inmediato en RTDB
                </Text>

                <View style={styles.estadosGrid}>
                  {(Object.entries(ESTADOS) as [EstadoCamion, EstadoConfig][]).map(
                    ([key, cfg]) => {
                      const isActive = turno.estadoActual === key;
                      return (
                        <TouchableOpacity
                          key={key}
                          style={[
                            styles.estadoBtn,
                            { borderColor: cfg.color + '44' },
                            isActive && {
                              backgroundColor: cfg.color + '24',
                              borderColor: cfg.color,
                              shadowColor: cfg.color,
                              shadowOpacity: 0.7,
                              shadowRadius: 10,
                              elevation: 6,
                            },
                          ]}
                          onPress={() => turno.cambiarEstado(key, true)}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.estadoBtnEmoji}>{cfg.emoji}</Text>
                          <Text
                            style={[
                              styles.estadoBtnLabel,
                              { color: isActive ? cfg.color : '#94a3b8' },
                            ]}
                          >
                            {cfg.label}
                          </Text>
                          {isActive && (
                            <View
                              style={[
                                styles.activePillIndicator,
                                { backgroundColor: cfg.color },
                              ]}
                            />
                          )}
                        </TouchableOpacity>
                      );
                    }
                  )}
                </View>
              </View>
            )}

            {/* 4 Tarjetas KPI */}
            <View style={styles.kpiGrid}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiEmoji}>📍</Text>
                <Text style={styles.kpiValue}>{turno.kmRecorridos.toFixed(2)}</Text>
                <Text style={styles.kpiLabel}>KM Recorridos</Text>
              </View>

              <View style={styles.kpiCard}>
                <Text style={styles.kpiEmoji}>⛽</Text>
                <Text style={styles.kpiValue}>{turno.litrosEstimados.toFixed(2)}</Text>
                <Text style={styles.kpiLabel}>Litros Est.</Text>
              </View>

              <View style={styles.kpiCard}>
                <Text style={styles.kpiEmoji}>🔄</Text>
                <Text style={styles.kpiValue}>{turno.ciclosCompresion}</Text>
                <Text style={styles.kpiLabel}>Compresiones</Text>
              </View>

              <View style={styles.kpiCard}>
                <Text style={styles.kpiEmoji}>⏱️</Text>
                <Text style={styles.kpiValue}>{tiempoTotalMin}</Text>
                <Text style={styles.kpiLabel}>Tiempo (min)</Text>
              </View>
            </View>

            {/* Desglose de Minutos por Estado */}
            {turno.turnoId && (
              <View style={styles.glassCard}>
                <Text style={styles.sectionHeaderTitle}>Tiempos Acumulados</Text>
                <View style={styles.tiempoRow}>
                  <View style={styles.tiempoItem}>
                    <Text style={[styles.tiempoValue, { color: '#22c55e' }]}>
                      {Math.round(turno.tiempoTransitoMin)}m
                    </Text>
                    <Text style={styles.tiempoLabel}>Tránsito</Text>
                  </View>

                  <View style={styles.tiempoItem}>
                    <Text style={[styles.tiempoValue, { color: '#f59e0b' }]}>
                      {Math.round(turno.tiempoRecoleccionMin)}m
                    </Text>
                    <Text style={styles.tiempoLabel}>Recolección</Text>
                  </View>

                  <View style={styles.tiempoItem}>
                    <Text style={[styles.tiempoValue, { color: '#a855f7' }]}>
                      {Math.round(turno.tiempoCompresionMin)}m
                    </Text>
                    <Text style={styles.tiempoLabel}>Compresión</Text>
                  </View>

                  <View style={styles.tiempoItem}>
                    <Text style={[styles.tiempoValue, { color: '#ef4444' }]}>
                      {Math.round(turno.tiempoRalentiMin)}m
                    </Text>
                    <Text style={styles.tiempoLabel}>Ralentí</Text>
                  </View>
                </View>
              </View>
            )}

            {/* Botón Finalizar Turno */}
            {turno.turnoId && (
              <TouchableOpacity
                style={[styles.finalizarBtn, finalizandoTurno && styles.btnDisabled]}
                onPress={handleFinalizarTurno}
                disabled={finalizandoTurno}
                activeOpacity={0.85}
              >
                {finalizandoTurno ? (
                  <ActivityIndicator color="#f1f5f9" />
                ) : (
                  <Text style={styles.finalizarBtnText}>🏁 FINALIZAR TURNO</Text>
                )}
              </TouchableOpacity>
            )}
          </>
        ) : (
          /* ============================================================ */
          /*                       MÓDULO B: DASHBOARD                    */
          /* ============================================================ */
          <>
            {/* Filtros */}
            <View style={styles.glassCard}>
              <Text style={styles.sectionHeaderTitle}>Filtros de Auditoría</Text>

              <View style={styles.filterInputsRow}>
                <View style={styles.filterField}>
                  <Text style={styles.filterFieldLabel}>Fecha (YYYY-MM-DD)</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#64748b"
                    value={filterDate}
                    onChangeText={setFilterDate}
                  />
                </View>

                <View style={styles.filterField}>
                  <Text style={styles.filterFieldLabel}>Turno</Text>
                  <View style={styles.turnoFilterRow}>
                    {['', 'mañana', 'tarde', 'noche'].map((t) => (
                      <TouchableOpacity
                        key={t}
                        style={[
                          styles.turnoFilterChip,
                          filterTurno === t && styles.turnoFilterChipActive,
                        ]}
                        onPress={() => setFilterTurno(t)}
                      >
                        <Text
                          style={[
                            styles.turnoFilterChipText,
                            filterTurno === t && styles.turnoFilterChipTextActive,
                          ]}
                        >
                          {t === '' ? 'Todos' : t.charAt(0).toUpperCase() + t.slice(1)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>

              <TouchableOpacity
                style={styles.aplicarFiltroBtn}
                onPress={fetchDashboardData}
                activeOpacity={0.85}
              >
                <Text style={styles.aplicarFiltroBtnText}>🔍 Consultar Turnos</Text>
              </TouchableOpacity>
            </View>

            {/* 4 KPIs Dashboard */}
            <View style={styles.kpiGrid}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiEmoji}>⛽</Text>
                <Text style={styles.kpiValue}>{totalLitrosDash.toFixed(2)}</Text>
                <Text style={styles.kpiLabel}>Litros Totales</Text>
              </View>

              <View style={styles.kpiCard}>
                <Text style={styles.kpiEmoji}>📍</Text>
                <Text style={styles.kpiValue}>{totalKmDash.toFixed(2)}</Text>
                <Text style={styles.kpiLabel}>KM Totales</Text>
              </View>

              <View style={styles.kpiCard}>
                <Text style={styles.kpiEmoji}>🔄</Text>
                <Text style={styles.kpiValue}>{totalCompresionesDash}</Text>
                <Text style={styles.kpiLabel}>Compresiones</Text>
              </View>

              <View style={styles.kpiCard}>
                <Text style={styles.kpiEmoji}>📊</Text>
                <Text style={styles.kpiValue}>{rendimientoPromedio}</Text>
                <Text style={styles.kpiLabel}>Rendimiento (L/km)</Text>
              </View>
            </View>

            {/* Gráfico / Desglose visual de consumo por estado */}
            <View style={styles.glassCard}>
              <Text style={styles.sectionHeaderTitle}>Consumo por Estado Operativo</Text>
              <Text style={styles.sectionHeaderSub}>
                Distribución porcentual del tiempo y gasto asociado
              </Text>

              <View style={styles.barsContainer}>
                {/* Tránsito */}
                <View style={styles.barItem}>
                  <View style={styles.barHeader}>
                    <Text style={[styles.barLabel, { color: '#22c55e' }]}>
                      🚛 Tránsito / En Camino
                    </Text>
                    <Text style={styles.barPercent}>{transitoPct}% ({Math.round(sumTransito)} min)</Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${transitoPct}%`, backgroundColor: '#22c55e' },
                      ]}
                    />
                  </View>
                </View>

                {/* Recolección */}
                <View style={styles.barItem}>
                  <View style={styles.barHeader}>
                    <Text style={[styles.barLabel, { color: '#f59e0b' }]}>
                      🗑️ Recolección
                    </Text>
                    <Text style={styles.barPercent}>{recoleccionPct}% ({Math.round(sumRecoleccion)} min)</Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${recoleccionPct}%`, backgroundColor: '#f59e0b' },
                      ]}
                    />
                  </View>
                </View>

                {/* Compresión */}
                <View style={styles.barItem}>
                  <View style={styles.barHeader}>
                    <Text style={[styles.barLabel, { color: '#a855f7' }]}>
                      ⚙️ Compresión Hidráulica
                    </Text>
                    <Text style={styles.barPercent}>{compresionPct}% ({Math.round(sumCompresion)} min)</Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${compresionPct}%`, backgroundColor: '#a855f7' },
                      ]}
                    />
                  </View>
                </View>

                {/* Ralentí */}
                <View style={styles.barItem}>
                  <View style={styles.barHeader}>
                    <Text style={[styles.barLabel, { color: '#ef4444' }]}>
                      ⏸️ Ralentí / Parado
                    </Text>
                    <Text style={styles.barPercent}>{ralentiPct}% ({Math.round(sumRalenti)} min)</Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${ralentiPct}%`, backgroundColor: '#ef4444' },
                      ]}
                    />
                  </View>
                </View>
              </View>
            </View>

            {/* Tabla / Lista de Historial de Turnos */}
            <View style={styles.glassCard}>
              <View style={styles.rowBetween}>
                <Text style={styles.sectionHeaderTitle}>Historial de Turnos</Text>
                {loadingHistory && <ActivityIndicator size="small" color="#00f2fe" />}
              </View>

              {turnosHistory.length === 0 && !loadingHistory ? (
                <Text style={styles.emptyText}>
                  No se encontraron registros para la fecha o turno seleccionados.
                </Text>
              ) : (
                <View style={styles.historyList}>
                  {turnosHistory.map((item, idx) => {
                    const tiempoTotal = Math.round(
                      (item.tiempoTransitoMin || 0) +
                        (item.tiempoRecoleccionMin || 0) +
                        (item.tiempoRalentiMin || 0) +
                        (item.tiempoCompresionMin || 0)
                    );
                    const isProgress = item.estadoTurno === 'en_progreso';

                    return (
                      <View key={item.id || idx} style={styles.historyCard}>
                        <View style={styles.historyCardTop}>
                          <View>
                            <Text style={styles.historyIdText}>{item.id}</Text>
                            <Text style={styles.historySubText}>
                              📅 {item.fecha} · Turno {item.turno}
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.historyBadge,
                              {
                                backgroundColor: isProgress
                                  ? 'rgba(34,197,94,0.15)'
                                  : 'rgba(148,163,184,0.15)',
                                borderColor: isProgress ? '#22c55e' : '#64748b',
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.historyBadgeText,
                                { color: isProgress ? '#22c55e' : '#94a3b8' },
                              ]}
                            >
                              {isProgress ? '🟢 En curso' : '✅ Finalizado'}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.historyStatsGrid}>
                          <View style={styles.statCol}>
                            <Text style={styles.statLabel}>Distancia</Text>
                            <Text style={styles.statVal}>
                              {(item.kmRecorridos || 0).toFixed(2)} km
                            </Text>
                          </View>

                          <View style={styles.statCol}>
                            <Text style={styles.statLabel}>Consumo</Text>
                            <Text style={[styles.statVal, { color: '#00f2fe' }]}>
                              {(item.litrosEstimados || 0).toFixed(2)} L
                            </Text>
                          </View>

                          <View style={styles.statCol}>
                            <Text style={styles.statLabel}>Compresiones</Text>
                            <Text style={styles.statVal}>
                              {item.ciclosCompresion || 0}
                            </Text>
                          </View>

                          <View style={styles.statCol}>
                            <Text style={styles.statLabel}>Duración</Text>
                            <Text style={styles.statVal}>{tiempoTotal} min</Text>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  // Barra superior
  topBar: {
    backgroundColor: 'rgba(15,23,42,0.95)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,242,254,0.15)',
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topBarLeft: {
    flex: 1,
  },
  topBarTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#00f2fe',
  },
  userEmailText: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  topBarActions: {
    flexDirection: 'row',
    gap: 8,
  },
  navBtnPublic: {
    backgroundColor: 'rgba(0,242,254,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,242,254,0.3)',
  },
  navBtnPublicText: {
    color: '#00f2fe',
    fontSize: 12,
    fontWeight: '700',
  },
  navBtnLogout: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
  },
  navBtnLogoutText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '700',
  },
  // Tabs selector
  tabsContainer: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: 'rgba(30,41,59,0.5)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    gap: 8,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  tabButtonActive: {
    backgroundColor: 'rgba(0,242,254,0.15)',
    borderColor: '#00f2fe',
  },
  tabButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
  },
  tabButtonTextActive: {
    color: '#00f2fe',
  },
  // Scrollable container
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    gap: 16,
  },
  // Header Telemetria
  cardHeader: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  camionTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#00f2fe',
  },
  placaSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  headerRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  velocidadBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },
  velocidadText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#f1f5f9',
  },
  velocidadUnit: {
    fontSize: 11,
    color: '#94a3b8',
  },
  estadoBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  estadoBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  // Glass Cards
  glassCard: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 16,
    gap: 12,
  },
  sectionHeaderTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#f1f5f9',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionHeaderSub: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: -6,
  },
  // Selector Turno
  turnoRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  turnoBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    gap: 4,
  },
  turnoBtnActive: {
    backgroundColor: 'rgba(0,242,254,0.15)',
    borderColor: '#00f2fe',
  },
  turnoEmoji: {
    fontSize: 22,
  },
  turnoLabel: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  turnoLabelActive: {
    color: '#00f2fe',
  },
  iniciarBtn: {
    backgroundColor: '#00f2fe',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  iniciarBtnText: {
    color: '#0f172a',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 1.2,
  },
  // Estados 2x2
  estadosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  estadoBtn: {
    width: '47.5%',
    alignItems: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1.5,
    gap: 4,
    position: 'relative',
  },
  estadoBtnEmoji: {
    fontSize: 26,
  },
  estadoBtnLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  activePillIndicator: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  // KPIs
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  kpiCard: {
    width: '47.5%',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 16,
    alignItems: 'center',
    gap: 4,
  },
  kpiEmoji: {
    fontSize: 22,
  },
  kpiValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#00f2fe',
  },
  kpiLabel: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  // Tiempos
  tiempoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  tiempoItem: {
    alignItems: 'center',
    gap: 3,
  },
  tiempoValue: {
    fontSize: 15,
    fontWeight: '700',
  },
  tiempoLabel: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  finalizarBtn: {
    backgroundColor: '#ef4444',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  finalizarBtnText: {
    color: '#f1f5f9',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 1.2,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  // Warning
  warningCard: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    padding: 14,
    alignItems: 'center',
    gap: 8,
  },
  warningText: {
    color: '#ef4444',
    fontSize: 12,
    textAlign: 'center',
  },
  warningBtn: {
    backgroundColor: '#ef4444',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  warningBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  // Dashboard Filters
  filterInputsRow: {
    gap: 12,
  },
  filterField: {
    gap: 6,
  },
  filterFieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
  },
  textInput: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#f1f5f9',
    fontSize: 13,
  },
  turnoFilterRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  turnoFilterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  turnoFilterChipActive: {
    backgroundColor: 'rgba(0,242,254,0.15)',
    borderColor: '#00f2fe',
  },
  turnoFilterChipText: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  turnoFilterChipTextActive: {
    color: '#00f2fe',
    fontWeight: '700',
  },
  aplicarFiltroBtn: {
    backgroundColor: '#00f2fe',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  aplicarFiltroBtnText: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '800',
  },
  // Bars / Gráfico
  barsContainer: {
    gap: 12,
    marginTop: 6,
  },
  barItem: {
    gap: 4,
  },
  barHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  barLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  barPercent: {
    fontSize: 11,
    color: '#94a3b8',
  },
  barTrack: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
  },
  // History table
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  emptyText: {
    color: '#64748b',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 16,
  },
  historyList: {
    gap: 10,
    marginTop: 4,
  },
  historyCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 12,
    gap: 10,
  },
  historyCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  historyIdText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#f1f5f9',
  },
  historySubText: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  historyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  historyBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  historyStatsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
    paddingTop: 8,
  },
  statCol: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 9,
    color: '#64748b',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  statVal: {
    fontSize: 12,
    fontWeight: '700',
    color: '#e2e8f0',
    marginTop: 2,
  },
  // Selector multi-unidad en Conductor
  unitSelectorRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 6,
  },
  unitChipBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  unitChipBtnActive: {
    backgroundColor: 'rgba(0,242,254,0.15)',
    borderColor: '#00f2fe',
  },
  unitChipBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  unitChipBtnTextActive: {
    color: '#00f2fe',
    fontWeight: '800',
  },
  // Modo Automático por GPS
  autoModeCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 10,
  },
  autoModeTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#f1f5f9',
  },
  autoModeSub: {
    fontSize: 10,
    color: '#94a3b8',
    marginTop: 2,
    lineHeight: 14,
  },
  autoModeToggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  autoModeToggleBtnActive: {
    backgroundColor: 'rgba(34,197,94,0.2)',
    borderColor: '#22c55e',
  },
  autoModeToggleBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
  },
  autoModeToggleBtnTextActive: {
    color: '#22c55e',
    fontWeight: '800',
  },
  // Alerta de Comprimiendo
  comprimiendoAlert: {
    backgroundColor: 'rgba(168,85,247,0.15)',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#a855f7',
    marginTop: 10,
  },
  comprimiendoAlertText: {
    fontSize: 11,
    color: '#d8b4fe',
    fontWeight: '700',
    textAlign: 'center',
  },
});
