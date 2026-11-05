import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { useAuth } from '@/context/AuthContext';
import {
  useTurno,
  EstadoCamion,
  TurnoType,
  CAMIONES_DISPONIBLES,
} from '@/context/TurnoContext';
import { flushQueue } from '@/lib/offlineQueue';
import { db } from '@/lib/firebase';

type EstadoConfig = {
  label: string;
  emoji: string;
  color: string;
};

const ESTADOS: Record<EstadoCamion, EstadoConfig> = {
  en_camino: { label: 'En Camino', emoji: '🚛', color: '#22c55e' },
  recolectando: { label: 'Recolectando', emoji: '🗑️', color: '#f59e0b' },
  comprimiendo: { label: 'Comprimiendo', emoji: '⚙️', color: '#a855f7' },
  parado: { label: 'Parado', emoji: '⏸️', color: '#ef4444' },
};

const TURNOS: { key: TurnoType; label: string; emoji: string }[] = [
  { key: 'mañana', label: 'Mañana', emoji: '☀️' },
  { key: 'tarde', label: 'Tarde', emoji: '🌅' },
  { key: 'noche', label: 'Noche', emoji: '🌙' },
];

export default function OperativoScreen() {
  const { signOut } = useAuth();
  const turno = useTurno();
  const [selectedTurno, setSelectedTurno] = useState<TurnoType>('mañana');
  const [velocidad, setVelocidad] = useState<number>(0);
  const [iniciandoTurno, setIniciandoTurno] = useState(false);
  const [finalizandoTurno, setFinalizandoTurno] = useState(false);
  const [gpsPermission, setGpsPermission] = useState<boolean | null>(null);
  const watchRef = useRef<Location.LocationSubscription | null>(null);

  // Ref mutable para actualizarGPS: evita destruir y re-crear el watcher de GPS en cada render
  const actualizarGPSRef = useRef(turno.actualizarGPS);
  useEffect(() => {
    actualizarGPSRef.current = turno.actualizarGPS;
  }, [turno.actualizarGPS]);

  // Request GPS permissions and start watching (inicia una sola vez en el montaje)
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

          // Flush offline queue when connected
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

  const handleIniciarTurno = async () => {
    setIniciandoTurno(true);
    try {
      await turno.iniciarTurno(selectedTurno);
    } catch {
      Alert.alert('Error', 'No se pudo iniciar el turno. Intenta de nuevo.');
    } finally {
      setIniciandoTurno(false);
    }
  };

  const handleFinalizarTurno = () => {
    Alert.alert(
      'Finalizar Turno',
      '¿Estás seguro de que deseas finalizar el turno actual?',
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

  const handleSignOut = async () => {
    Alert.alert('Cerrar Sesión', '¿Deseas cerrar sesión?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Salir',
        onPress: async () => {
          await signOut();
          router.replace('/login');
        },
      },
    ]);
  };

  const handleRequestPermission = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    setGpsPermission(status === 'granted');
  };

  const estadoConfig = ESTADOS[turno.estadoActual];
  const tiempoTotalMin = Math.round(
    turno.tiempoTransitoMin +
      turno.tiempoRecoleccionMin +
      turno.tiempoRalentiMin +
      turno.tiempoCompresionMin
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      {/* ===== HEADER ===== */}
      <View style={styles.header}>
        <View>
          <Text style={styles.camionId}>🚛 {turno.camionId}</Text>
          <Text style={styles.placa}>{turno.placa}</Text>
        </View>

        <View style={styles.headerRight}>
          <View style={styles.velocidadBadge}>
            <Text style={styles.velocidadText}>{velocidad}</Text>
            <Text style={styles.velocidadUnit}>km/h</Text>
          </View>
          <View style={[styles.estadoBadge, { backgroundColor: estadoConfig.color + '33', borderColor: estadoConfig.color }]}>
            <Text style={[styles.estadoBadgeText, { color: estadoConfig.color }]}>
              {estadoConfig.emoji} {estadoConfig.label}
            </Text>
          </View>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleSignOut}>
            <Text style={styles.logoutEmoji}>🚪</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ===== GPS PERMISSION WARNING ===== */}
      {gpsPermission === false && (
        <View style={styles.warningCard}>
          <Text style={styles.warningText}>
            ⚠️ Sin permisos de GPS. El tracking no funcionará.
          </Text>
          <TouchableOpacity style={styles.warningBtn} onPress={handleRequestPermission}>
            <Text style={styles.warningBtnText}>Solicitar Permisos</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ===== SELECTOR DE TURNO (sin turno activo) ===== */}
      {!turno.turnoId && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Unidad Asignada</Text>
          <View style={styles.unitSelectorRow}>
            {CAMIONES_DISPONIBLES.map((c) => {
              const isSelected = turno.camionId === c.id;
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.unitChip, isSelected && styles.unitChipActive]}
                  onPress={() => turno.setCamionId(c.id)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.unitChipText, isSelected && styles.unitChipTextActive]}>
                    🚛 {c.id}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={{ height: 16 }} />

          <Text style={styles.sectionTitle}>Seleccionar Turno</Text>
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
          >
            {iniciandoTurno ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <Text style={styles.iniciarBtnText}>🚀 INICIAR TURNO ({turno.camionId})</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* ===== BOTONES DE ESTADO (turno activo) ===== */}
      {turno.turnoId && (
        <View style={styles.card}>
          {/* Toggle de Inferencia Automática */}
          <View style={styles.autoRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.autoTitle}>
                {turno.modoAutomatico ? '🤖 Inferencia GPS Activa' : '✋ Modo Manual Fijo'}
              </Text>
              <Text style={styles.autoDesc}>
                {turno.modoAutomatico
                  ? '>20 km/h: En Camino | 3-20 km/h: Recolectando | <3 km/h: Parado'
                  : 'Estado manual activo. Toca para reactivar el cálculo GPS.'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.autoToggleBtn, turno.modoAutomatico && styles.autoToggleBtnActive]}
              onPress={() => turno.setModoAutomatico(!turno.modoAutomatico)}
              activeOpacity={0.8}
            >
              <Text style={[styles.autoToggleText, turno.modoAutomatico && styles.autoToggleTextActive]}>
                {turno.modoAutomatico ? 'GPS ON' : 'MANUAL'}
              </Text>
            </TouchableOpacity>
          </View>

          {turno.estadoActual === 'comprimiendo' && (
            <View style={styles.comprimiendoNotice}>
              <Text style={styles.comprimiendoNoticeText}>
                ⚙️ Comprimiendo bloqueado. Se liberará automáticamente al superar 5 km/h.
              </Text>
            </View>
          )}

          <View style={{ height: 12 }} />
          <Text style={styles.sectionTitle}>Override Manual de Estado</Text>
          <View style={styles.estadosGrid}>
            {(Object.entries(ESTADOS) as [EstadoCamion, EstadoConfig][]).map(
              ([key, cfg]) => {
                const isActive = turno.estadoActual === key;
                return (
                  <TouchableOpacity
                    key={key}
                    style={[
                      styles.estadoBtn,
                      { borderColor: cfg.color + '55' },
                      isActive && {
                        backgroundColor: cfg.color + '22',
                        borderColor: cfg.color,
                        shadowColor: cfg.color,
                        shadowOpacity: 0.6,
                        shadowRadius: 8,
                        elevation: 4,
                      },
                    ]}
                    onPress={() => turno.cambiarEstado(key, true)}
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
                  </TouchableOpacity>
                );
              }
            )}
          </View>
        </View>
      )}

      {/* ===== KPI CARDS ===== */}
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

      {/* ===== DESGLOSE DE TIEMPO ===== */}
      {turno.turnoId && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Desglose de Tiempo</Text>
          <View style={styles.tiempoRow}>
            <View style={styles.tiempoItem}>
              <Text style={[styles.tiempoValue, { color: '#22c55e' }]}>
                {Math.round(turno.tiempoTransitoMin)} min
              </Text>
              <Text style={styles.tiempoLabel}>Tránsito</Text>
            </View>
            <View style={styles.tiempoItem}>
              <Text style={[styles.tiempoValue, { color: '#f59e0b' }]}>
                {Math.round(turno.tiempoRecoleccionMin)} min
              </Text>
              <Text style={styles.tiempoLabel}>Recolección</Text>
            </View>
            <View style={styles.tiempoItem}>
              <Text style={[styles.tiempoValue, { color: '#ef4444' }]}>
                {Math.round(turno.tiempoRalentiMin)} min
              </Text>
              <Text style={styles.tiempoLabel}>Ralentí</Text>
            </View>
            <View style={styles.tiempoItem}>
              <Text style={[styles.tiempoValue, { color: '#a855f7' }]}>
                {Math.round(turno.tiempoCompresionMin)} min
              </Text>
              <Text style={styles.tiempoLabel}>Compresión</Text>
            </View>
          </View>
        </View>
      )}

      {/* ===== BOTÓN FINALIZAR TURNO ===== */}
      {turno.turnoId && (
        <TouchableOpacity
          style={[styles.finalizarBtn, finalizandoTurno && styles.btnDisabled]}
          onPress={handleFinalizarTurno}
          disabled={finalizandoTurno}
        >
          {finalizandoTurno ? (
            <ActivityIndicator color="#f1f5f9" />
          ) : (
            <Text style={styles.finalizarBtnText}>🏁 FINALIZAR TURNO</Text>
          )}
        </TouchableOpacity>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  contentContainer: {
    padding: 16,
    gap: 16,
  },
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingTop: Platform.OS === 'android' ? 40 : 12,
    paddingBottom: 8,
  },
  camionId: {
    fontSize: 22,
    fontWeight: '800',
    color: '#00f2fe',
  },
  placa: {
    fontSize: 13,
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
    fontSize: 12,
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
  logoutBtn: {
    padding: 4,
  },
  logoutEmoji: {
    fontSize: 20,
  },
  // Warning
  warningCard: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    padding: 14,
    alignItems: 'center',
    gap: 10,
  },
  warningText: {
    color: '#ef4444',
    fontSize: 13,
    textAlign: 'center',
  },
  warningBtn: {
    backgroundColor: '#ef4444',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  warningBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  // Cards
  card: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    padding: 16,
    gap: 14,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  // Turno selector
  turnoRow: {
    flexDirection: 'row',
    gap: 10,
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
  },
  iniciarBtnText: {
    color: '#0f172a',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 1,
  },
  // Estado buttons
  estadosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  estadoBtn: {
    width: '47%',
    alignItems: 'center',
    paddingVertical: 18,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1.5,
    gap: 6,
  },
  estadoBtnEmoji: {
    fontSize: 26,
  },
  estadoBtnLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  // KPI
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  kpiCard: {
    width: '47%',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    padding: 16,
    alignItems: 'center',
    gap: 4,
  },
  kpiEmoji: {
    fontSize: 22,
  },
  kpiValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#00f2fe',
  },
  kpiLabel: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // Tiempo desglose
  tiempoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
  // Finalizar
  finalizarBtn: {
    backgroundColor: '#ef4444',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  finalizarBtnText: {
    color: '#f1f5f9',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 1,
  },
  // Selector multi-unidad
  unitSelectorRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 6,
  },
  unitChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  unitChipActive: {
    backgroundColor: 'rgba(0,242,254,0.15)',
    borderColor: '#00f2fe',
  },
  unitChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  unitChipTextActive: {
    color: '#00f2fe',
    fontWeight: '800',
  },
  // Inferencia automática
  autoRow: {
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
  autoTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#f1f5f9',
  },
  autoDesc: {
    fontSize: 10,
    color: '#94a3b8',
    marginTop: 2,
    lineHeight: 14,
  },
  autoToggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  autoToggleBtnActive: {
    backgroundColor: 'rgba(34,197,94,0.2)',
    borderColor: '#22c55e',
  },
  autoToggleText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
  },
  autoToggleTextActive: {
    color: '#22c55e',
    fontWeight: '800',
  },
  // Comprimiendo notice
  comprimiendoNotice: {
    backgroundColor: 'rgba(168,85,247,0.15)',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#a855f7',
    marginTop: 10,
  },
  comprimiendoNoticeText: {
    fontSize: 11,
    color: '#d8b4fe',
    fontWeight: '700',
    textAlign: 'center',
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
