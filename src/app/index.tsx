/**
 * Pantalla Principal Pública — Vista Ciudadana
 *
 * - Mapa simulado centrado en Oruro con tarjeta de telemetría en tiempo real
 * - onSnapshot escucha /camiones/REC-01
 * - Botón "Iniciar Sesión" top-right abre Modal de login
 * - Al autenticarse redirige a /panel
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StatusBar as RNStatusBar,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { ref as dbRef, onValue as dbOnValue } from 'firebase/database';
import { rtdb } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import {
  useTurno,
  CAMIONES_DISPONIBLES,
  getPlacaForCamion,
  getCamionColor,
} from '@/context/TurnoContext';
import { LeafletMap } from '@/components/LeafletMap';
import { reverseGeocodeOruro } from '@/lib/geocoding';

/* ─────────────────── Tipos ─────────────────── */
type EstadoCamion = 'en_camino' | 'recolectando' | 'comprimiendo' | 'parado';

interface CamionData {
  id: string;
  placa: string;
  activo: boolean;
  estado: EstadoCamion;
  velocidad: number;
  direccion?: string;
  ubicacion?: { latitude: number; longitude: number } | null;
  ultimaActualizacion?: { seconds: number } | null;
}

/* ─────────────────── Helpers ─────────────────── */
const ESTADO_CONFIG: Record<EstadoCamion, { label: string; color: string; emoji: string }> = {
  en_camino:    { label: 'En Camino',    color: '#22c55e', emoji: '🚛' },
  recolectando: { label: 'Recolectando', color: '#f59e0b', emoji: '🗑️' },
  comprimiendo: { label: 'Comprimiendo', color: '#a855f7', emoji: '⚙️' },
  parado:       { label: 'Parado',       color: '#ef4444', emoji: '⏸️' },
};

function formatTimestamp(ts: any): string {
  if (!ts) return '—';
  let d: Date;
  if (typeof ts === 'string') {
    d = new Date(ts);
  } else if (ts instanceof Date) {
    d = ts;
  } else if (typeof ts.toDate === 'function') {
    d = ts.toDate();
  } else if (typeof ts.seconds === 'number') {
    d = new Date(ts.seconds * 1000);
  } else {
    d = new Date(ts);
  }
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/* ─────────────────── Modal Login ─────────────────── */
function LoginModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Ingresa email y contraseña.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      onClose();
      router.push('/panel' as any);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code.includes('user-not-found') || code.includes('wrong-password') || code.includes('invalid-credential')) {
        setError('Email o contraseña incorrectos.');
      } else if (code.includes('invalid-email')) {
        setError('Email inválido.');
      } else if (code.includes('too-many-requests')) {
        setError('Demasiados intentos. Intenta más tarde.');
      } else {
        setError('Error al iniciar sesión.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={modalStyles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />

        <View style={modalStyles.card}>
          {/* Header del modal */}
          <View style={modalStyles.modalHeader}>
            <Text style={modalStyles.modalEmoji}>🚛</Text>
            <Text style={modalStyles.modalTitle}>Acceso Personal</Text>
            <Text style={modalStyles.modalSubtitle}>Sistema GPS Recolector · Oruro</Text>
          </View>

          {/* Email */}
          <View style={modalStyles.inputGroup}>
            <Text style={modalStyles.label}>📧  Email</Text>
            <TextInput
              style={modalStyles.input}
              placeholder="usuario@empresa.com"
              placeholderTextColor="#475569"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
          </View>

          {/* Password */}
          <View style={modalStyles.inputGroup}>
            <Text style={modalStyles.label}>🔒  Contraseña</Text>
            <TextInput
              style={modalStyles.input}
              placeholder="••••••••"
              placeholderTextColor="#475569"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
            />
          </View>

          {/* Error */}
          {error !== '' && <Text style={modalStyles.error}>{error}</Text>}

          {/* Botón */}
          <TouchableOpacity
            style={[modalStyles.loginBtn, loading && modalStyles.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#0f172a" />
              : <Text style={modalStyles.loginBtnText}>INICIAR SESIÓN →</Text>
            }
          </TouchableOpacity>

          {/* Cerrar */}
          <TouchableOpacity style={modalStyles.closeBtn} onPress={onClose}>
            <Text style={modalStyles.closeBtnText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#1e293b',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,242,254,0.25)',
    padding: 24,
    gap: 14,
    shadowColor: '#00f2fe',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 12,
  },
  modalHeader: {
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  modalEmoji: { fontSize: 36 },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#00f2fe',
    letterSpacing: 0.5,
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
  },
  inputGroup: { gap: 6 },
  label: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#f1f5f9',
  },
  error: {
    color: '#ef4444',
    fontSize: 13,
    textAlign: 'center',
  },
  loginBtn: {
    backgroundColor: '#00f2fe',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  loginBtnDisabled: { opacity: 0.55 },
  loginBtnText: {
    color: '#0f172a',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 1.5,
  },
  closeBtn: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  closeBtnText: {
    color: '#64748b',
    fontSize: 13,
  },
});

/* ─────────────────── Tarjeta de Telemetría ─────────────────── */
function TarjetaTelemetria({
  camion,
  onVerTodas,
}: {
  camion: CamionData | null;
  onVerTodas?: () => void;
}) {
  if (!camion) {
    return (
      <View style={telStyles.card}>
        <ActivityIndicator color="#00f2fe" size="small" />
        <Text style={telStyles.connecting}>Conectando con Realtime Database…</Text>
      </View>
    );
  }

  const cfg = ESTADO_CONFIG[camion.estado];
  const colorCfg = getCamionColor(camion.id);

  return (
    <View style={[telStyles.card, { borderColor: colorCfg.border + '44' }]}>
      {/* Fila superior: ID + badge activo */}
      <View style={telStyles.topRow}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colorCfg.primary }} />
            <Text style={[telStyles.camionId, { color: colorCfg.border }]}>🚛  {camion.id}</Text>
            <Text style={{ fontSize: 11, color: '#94a3b8', fontWeight: '700' }}>({colorCfg.name})</Text>
          </View>
          <Text style={telStyles.placa}>{camion.placa}</Text>
          <Text style={{ fontSize: 12, color: '#93c5fd', fontWeight: '600', marginTop: 3 }}>
            📍 {camion.direccion || 'Oruro, Bolivia'}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <View style={[telStyles.activoBadge, { backgroundColor: camion.activo ? '#22c55e22' : '#ef444422', borderColor: camion.activo ? '#22c55e' : '#ef4444' }]}>
            <View style={[telStyles.activoDot, { backgroundColor: camion.activo ? '#22c55e' : '#ef4444' }]} />
            <Text style={[telStyles.activoText, { color: camion.activo ? '#22c55e' : '#ef4444' }]}>
              {camion.activo ? 'En servicio' : 'Fuera de ruta'}
            </Text>
          </View>
          {onVerTodas && (
            <TouchableOpacity onPress={onVerTodas} activeOpacity={0.7}>
              <Text style={{ color: '#00f2fe', fontSize: 11, fontWeight: '700' }}>🌐 Ver todas las unidades</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Divisor */}
      <View style={telStyles.divider} />

      {/* Estado + velocidad */}
      <View style={telStyles.bottomRow}>
        <View style={[telStyles.estadoBadge, { backgroundColor: cfg.color + '22', borderColor: cfg.color }]}>
          <Text style={[telStyles.estadoText, { color: cfg.color }]}>{cfg.emoji}  {cfg.label}</Text>
        </View>
        <View style={telStyles.velocidadBox}>
          <Text style={telStyles.velocidadNum}>{Math.round(camion.velocidad)}</Text>
          <Text style={telStyles.velocidadUnit}>km/h</Text>
        </View>
      </View>

      {/* Última actualización */}
      <Text style={telStyles.timestamp}>
        🕐 Actualizado: {formatTimestamp(camion.ultimaActualizacion ?? null)}
      </Text>
    </View>
  );
}

/* ─────────────────── Tarjeta Flota Completa (Todas las unidades) ─────────────────── */
function TarjetaFlotaCompleta({
  camiones,
  onSelectCamion,
}: {
  camiones: CamionData[];
  onSelectCamion: (id: string) => void;
}) {
  const activos = camiones.filter((c) => c.activo).length;
  const enCamino = camiones.filter((c) => c.estado === 'en_camino').length;
  const recolectando = camiones.filter((c) => c.estado === 'recolectando').length;
  const comprimiendo = camiones.filter((c) => c.estado === 'comprimiendo').length;
  const parados = camiones.filter((c) => c.estado === 'parado').length;

  return (
    <View style={telStyles.card}>
      {/* Header Flota General */}
      <View style={telStyles.topRow}>
        <View>
          <Text style={telStyles.camionId}>🌐 Flota General Oruro</Text>
          <Text style={telStyles.placa}>Monitoreo en vivo de {camiones.length} unidades</Text>
        </View>
        <View style={[telStyles.activoBadge, { backgroundColor: '#00f2fe22', borderColor: '#00f2fe' }]}>
          <View style={[telStyles.activoDot, { backgroundColor: '#00f2fe' }]} />
          <Text style={[telStyles.activoText, { color: '#00f2fe' }]}>
            {activos} en servicio
          </Text>
        </View>
      </View>

      {/* Resumen de estados en píldoras */}
      <View style={flotaStyles.summaryRow}>
        <View style={flotaStyles.summaryPill}>
          <Text style={flotaStyles.summaryEmoji}>🚛</Text>
          <Text style={flotaStyles.summaryText}>{enCamino} ruta</Text>
        </View>
        <View style={flotaStyles.summaryPill}>
          <Text style={flotaStyles.summaryEmoji}>🗑️</Text>
          <Text style={flotaStyles.summaryText}>{recolectando} recolec.</Text>
        </View>
        <View style={flotaStyles.summaryPill}>
          <Text style={flotaStyles.summaryEmoji}>⚙️</Text>
          <Text style={flotaStyles.summaryText}>{comprimiendo} comp.</Text>
        </View>
        <View style={flotaStyles.summaryPill}>
          <Text style={flotaStyles.summaryEmoji}>⏸️</Text>
          <Text style={flotaStyles.summaryText}>{parados} parado</Text>
        </View>
      </View>

      <View style={telStyles.divider} />

      {/* Lista de camiones en la flota */}
      <View style={flotaStyles.unitList}>
        {camiones.map((c) => {
          const cfg = ESTADO_CONFIG[c.estado] || ESTADO_CONFIG.parado;
          const colorCfg = getCamionColor(c.id);
          return (
            <TouchableOpacity
              key={c.id}
              style={[flotaStyles.unitItem, { borderColor: colorCfg.border + '33' }]}
              onPress={() => onSelectCamion(c.id)}
              activeOpacity={0.8}
            >
              <View style={flotaStyles.unitItemLeft}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colorCfg.primary }} />
                  <Text style={[flotaStyles.unitItemId, { color: colorCfg.border }]}>🚛 {c.id}</Text>
                  <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '700' }}>({colorCfg.name})</Text>
                </View>
                <Text style={flotaStyles.unitItemPlaca}>{c.placa}</Text>
                <Text style={flotaStyles.unitItemStreet} numberOfLines={1}>
                  📍 {c.direccion || 'Oruro, Bolivia'}
                </Text>
              </View>
              <View style={flotaStyles.unitItemCenter}>
                <View style={[telStyles.estadoBadge, { backgroundColor: cfg.color + '22', borderColor: cfg.color, paddingVertical: 3, paddingHorizontal: 8 }]}>
                  <Text style={[telStyles.estadoText, { color: cfg.color, fontSize: 11 }]}>{cfg.emoji} {cfg.label}</Text>
                </View>
              </View>
              <View style={flotaStyles.unitItemRight}>
                <Text style={flotaStyles.unitItemSpeed}>{Math.round(c.velocidad)} km/h</Text>
                <Text style={[flotaStyles.unitItemArrow, { color: colorCfg.border }]}>Ver ➔</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const flotaStyles = StyleSheet.create({
  summaryRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  summaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  summaryEmoji: {
    fontSize: 11,
  },
  summaryText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#cbd5e1',
  },
  unitList: {
    gap: 8,
  },
  unitItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  unitItemLeft: {
    flex: 1.4,
    marginRight: 8,
  },
  unitItemId: {
    fontSize: 13,
    fontWeight: '800',
    color: '#00f2fe',
  },
  unitItemPlaca: {
    fontSize: 10,
    color: '#94a3b8',
  },
  unitItemStreet: {
    fontSize: 10,
    color: '#93c5fd',
    fontWeight: '600',
    marginTop: 2,
  },
  unitItemCenter: {
    flex: 1,
    alignItems: 'center',
  },
  unitItemRight: {
    alignItems: 'flex-end',
    minWidth: 65,
  },
  unitItemSpeed: {
    fontSize: 12,
    fontWeight: '800',
    color: '#f1f5f9',
  },
  unitItemArrow: {
    fontSize: 10,
    fontWeight: '700',
    color: '#00f2fe',
    marginTop: 1,
  },
});

const telStyles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(15,23,42,0.88)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(0,242,254,0.2)',
    padding: 16,
    gap: 10,
    shadowColor: '#00f2fe',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
  connecting: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  camionId: {
    fontSize: 18,
    fontWeight: '800',
    color: '#00f2fe',
  },
  placa: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  activoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  activoDot: {
    width: 7, height: 7,
    borderRadius: 4,
  },
  activoText: {
    fontSize: 11,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  estadoBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  estadoText: {
    fontSize: 13,
    fontWeight: '700',
  },
  velocidadBox: {
    alignItems: 'center',
  },
  velocidadNum: {
    fontSize: 26,
    fontWeight: '800',
    color: '#f1f5f9',
    lineHeight: 28,
  },
  velocidadUnit: {
    fontSize: 11,
    color: '#64748b',
  },
  timestamp: {
    fontSize: 11,
    color: '#475569',
    textAlign: 'right',
  },
});

/* ─────────────────── Pantalla Principal ─────────────────── */
export default function PublicHomeScreen() {
  const { user } = useAuth();
  const turno = useTurno();
  const [selectedUnit, setSelectedUnit] = useState<string>('TODOS');
  const [camionesDict, setCamionesDict] = useState<Record<string, CamionData>>({});
  const [loginVisible, setLoginVisible] = useState(false);
  const statusBarHeight = Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 24) : 44;

  // Listener en tiempo real desde Firebase Realtime Database (RTDB) para toda la flota
  useEffect(() => {
    const camionesRef = dbRef(rtdb, 'camiones');
    const unsub = dbOnValue(
      camionesRef,
      (snapshot) => {
        const val = snapshot.exists() ? snapshot.val() : {};
        const newDict: Record<string, CamionData> = {};

        CAMIONES_DISPONIBLES.forEach((c) => {
          const d = val[c.id];
          if (d) {
            const lat = d.lat != null ? d.lat : (d.ubicacion?.latitude ?? -17.9647);
            const lng = d.lng != null ? d.lng : (d.ubicacion?.longitude ?? -67.1060);
            const initialDir = d.direccion || 'Oruro, Bolivia';

            newDict[c.id] = {
              id: d.id ?? c.id,
              placa: d.placa ?? c.placa,
              activo: d.activo ?? false,
              estado: (d.estado as EstadoCamion) ?? 'parado',
              velocidad: d.velocidad ?? 0,
              direccion: initialDir,
              ubicacion: { latitude: lat, longitude: lng },
              ultimaActualizacion: d.ultimaActualizacion ?? null,
            };

            // Si no tiene dirección cargada, resolver en segundo plano y actualizar estado
            if (!d.direccion) {
              reverseGeocodeOruro(lat, lng).then((resolved) => {
                setCamionesDict((prev) => {
                  if (prev[c.id] && prev[c.id].direccion !== resolved) {
                    return {
                      ...prev,
                      [c.id]: { ...prev[c.id], direccion: resolved },
                    };
                  }
                  return prev;
                });
              }).catch(() => {});
            }
          } else {
            // Unidad sin telemetría registrada aún
            newDict[c.id] = {
              id: c.id,
              placa: c.placa,
              activo: false,
              estado: 'parado',
              velocidad: 0,
              direccion: 'Oruro, Bolivia',
              ubicacion: { latitude: -17.9647, longitude: -67.1060 },
              ultimaActualizacion: null,
            };
          }
        });

        setCamionesDict(newDict);
      },
      (err) => {
        console.warn('Error escuchando camiones en RTDB:', err);
      }
    );
    return () => unsub();
  }, []);

  const handleSelectCamion = (id: string) => {
    setSelectedUnit(id);
    if (id !== 'TODOS') {
      turno.setCamionId(id);
    }
  };

  const handleAccesoPersonal = () => {
    if (user) {
      router.push('/panel' as any);
    } else {
      setLoginVisible(true);
    }
  };

  const currentCamion = selectedUnit !== 'TODOS' ? (camionesDict[selectedUnit] ?? null) : null;
  const camionesList = Object.values(camionesDict);

  return (
    <View style={styles.root}>
      {/* ── MAPA Leaflet con OpenStreetMap ── */}
      <LeafletMap
        latitude={currentCamion?.ubicacion?.latitude ?? -17.9647}
        longitude={currentCamion?.ubicacion?.longitude ?? -67.106}
        camionId={currentCamion?.id ?? 'REC-01'}
        placa={currentCamion?.placa ?? getPlacaForCamion(currentCamion?.id ?? 'REC-01')}
        estado={currentCamion?.estado ? ESTADO_CONFIG[currentCamion.estado]?.label : 'Parado'}
        velocidad={currentCamion?.velocidad ?? 0}
        direccion={currentCamion?.direccion}
        camiones={
          selectedUnit === 'TODOS'
            ? camionesList.map((c) => ({
                id: c.id,
                placa: c.placa,
                lat: c.ubicacion?.latitude ?? -17.9647,
                lng: c.ubicacion?.longitude ?? -67.1060,
                velocidad: c.velocidad,
                estado: ESTADO_CONFIG[c.estado]?.label ?? c.estado,
                activo: c.activo,
                direccion: c.direccion,
              }))
            : undefined
        }
      />

      {/* ── TOP BAR ── */}
      <View style={[styles.topBar, { paddingTop: statusBarHeight + 8 }]}>
        <View style={styles.topBarLeft}>
          <Text style={styles.appTitle}>🚛 GPS Recolectores</Text>
          <Text style={styles.appSubtitle}>Oruro, Bolivia · Tiempo Real</Text>
        </View>
        <TouchableOpacity style={styles.loginBtn} onPress={handleAccesoPersonal} activeOpacity={0.85}>
          <Text style={styles.loginBtnText}>{user ? '📊 Panel' : '🔐 Ingresar'}</Text>
        </TouchableOpacity>
      </View>

      {/* ── SELECTOR MULTI-CAMIÓN FLOTANTE ── */}
      <View style={[styles.unitSelectorBar, { top: statusBarHeight + 62 }]}>
        <Text style={styles.unitSelectorTitle}>Unidad:</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.unitChipsScroll}
        >
          {/* Opción "Todas las unidades" */}
          <TouchableOpacity
            style={[styles.unitChip, selectedUnit === 'TODOS' && styles.unitChipActive]}
            onPress={() => handleSelectCamion('TODOS')}
            activeOpacity={0.75}
          >
            <Text style={[styles.unitChipText, selectedUnit === 'TODOS' && styles.unitChipTextActive]}>
              🌐 Todas
            </Text>
            {selectedUnit === 'TODOS' && <View style={styles.unitChipDot} />}
          </TouchableOpacity>

          {CAMIONES_DISPONIBLES.map((c) => {
            const isSelected = c.id === selectedUnit;
            const colorCfg = getCamionColor(c.id);
            return (
              <TouchableOpacity
                key={c.id}
                style={[
                  styles.unitChip,
                  isSelected && styles.unitChipActive,
                  isSelected && { borderColor: colorCfg.border, backgroundColor: colorCfg.badgeBg }
                ]}
                onPress={() => handleSelectCamion(c.id)}
                activeOpacity={0.75}
              >
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colorCfg.primary, marginRight: 5 }} />
                <Text style={[styles.unitChipText, isSelected && { color: colorCfg.border, fontWeight: '800' }]}>
                  {c.id} ({colorCfg.name})
                </Text>
                {isSelected && <View style={[styles.unitChipDot, { backgroundColor: colorCfg.primary }]} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* ── TARJETA DE TELEMETRÍA (bottom overlay) ── */}
      <View style={styles.telemetryContainer}>
        <Text style={styles.telemetryHeader}>
          {selectedUnit === 'TODOS' ? 'Monitoreo de Flota Completa' : `Unidad Monitoreada (${selectedUnit})`}
        </Text>

        {selectedUnit === 'TODOS' ? (
          <TarjetaFlotaCompleta
            camiones={camionesList}
            onSelectCamion={handleSelectCamion}
          />
        ) : (
          <TarjetaTelemetria
            camion={currentCamion}
            onVerTodas={() => handleSelectCamion('TODOS')}
          />
        )}

        {/* Footer informativo */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            📡 Datos en tiempo real · Firebase Realtime Database
          </Text>
        </View>
      </View>

      {/* ── MODAL LOGIN ── */}
      <LoginModal visible={loginVisible} onClose={() => setLoginVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0d1f35',
  },
  // Top Bar
  topBar: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: 'rgba(15,23,42,0.85)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,242,254,0.12)',
    zIndex: 10,
  },
  topBarLeft: {
    gap: 2,
  },
  appTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#00f2fe',
    letterSpacing: 0.3,
  },
  appSubtitle: {
    fontSize: 11,
    color: '#64748b',
  },
  loginBtn: {
    backgroundColor: 'rgba(0,242,254,0.15)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,242,254,0.4)',
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  loginBtnText: {
    color: '#00f2fe',
    fontSize: 13,
    fontWeight: '700',
  },
  // Selector multi-camión flotante
  unitSelectorBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15,23,42,0.88)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    zIndex: 9,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  unitSelectorTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.5,
  },
  unitChipsScroll: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  unitChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
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
  unitChipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00f2fe',
  },
  // Telemetría bottom
  telemetryContainer: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    padding: 16,
    gap: 8,
  },
  telemetryHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  footer: {
    alignItems: 'center',
    paddingBottom: Platform.OS === 'android' ? 8 : 16,
  },
  footerText: {
    fontSize: 10,
    color: '#334155',
    textAlign: 'center',
  },
});
