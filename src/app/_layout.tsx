/**
 * Root Layout — Expo Router
 *
 * Flujo de navegación:
 *   / (index)  →  Pantalla pública ciudadana (mapa en tiempo real, sin login)
 *   /panel     →  Módulos protegidos (Operativo + Dashboard Admin)
 *
 * El login se maneja como Modal desde la pantalla pública.
 * NO hay redirección automática a /login; la app arranca siempre en el mapa.
 */
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LogBox } from 'react-native';
import { AuthProvider } from '@/context/AuthContext';
import { TurnoProvider } from '@/context/TurnoContext';

LogBox.ignoreLogs([
  '@firebase/firestore',
  'Using maximum backoff delay',
  'RESOURCE_EXHAUSTED',
  'Quota exceeded',
  'FirebaseError',
  'GrpcConnection',
]);

export default function RootLayout() {
  return (
    <AuthProvider>
      <TurnoProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#0f172a' },
            animation: 'fade',
          }}
        />
      </TurnoProvider>
    </AuthProvider>
  );
}
