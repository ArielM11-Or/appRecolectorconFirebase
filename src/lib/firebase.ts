/**
 * Firebase v13 (modular) — Configuración para Expo SDK 58 / React Native
 */
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, setLogLevel } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';
import { LogBox } from 'react-native';

// 1. Silenciar logs internos de reconexión/gRPC de Firestore para evitar spam en consola
setLogLevel('silent');

// 2. Evitar que LogBox bloquee la pantalla táctil en el móvil con advertencias de cuota/backoff de Firebase
LogBox.ignoreLogs([
  '@firebase/firestore',
  'Using maximum backoff delay',
  'RESOURCE_EXHAUSTED',
  'Quota exceeded',
  'FirebaseError',
  'GrpcConnection',
]);

const firebaseConfig = {
  apiKey: 'AIzaSyClVtCYv6bMIOi9vuN_KiUL4bgKuyGG57o',
  authDomain: 'appmonitoreo-87a54.firebaseapp.com',
  databaseURL: 'https://appmonitoreo-87a54-default-rtdb.firebaseio.com',
  projectId: 'appmonitoreo-87a54',
  storageBucket: 'appmonitoreo-87a54.firebasestorage.app',
  messagingSenderId: '889911178649',
  appId: '1:889911178649:web:83a8f739a2884751020f08',
};

// Evitar re-inicializar si ya existe la app (Hot Reload)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);
export default app;
