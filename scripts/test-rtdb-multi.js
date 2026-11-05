// scripts/test-rtdb-multi.js
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, get, child } = require('firebase/database');

const firebaseConfig = {
  apiKey: "AIzaSyClVtCYv6bMIOi9vuN_KiUL4bgKuyGG57o",
  authDomain: "appmonitoreo-87a54.firebaseapp.com",
  databaseURL: "https://appmonitoreo-87a54-default-rtdb.firebaseio.com",
  projectId: "appmonitoreo-87a54",
  storageBucket: "appmonitoreo-87a54.firebasestorage.app",
  messagingSenderId: "889911178649",
  appId: "1:889911178649:web:83a8f739a2884751020f08"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const units = [
  { id: 'REC-01', placa: '1234-ABC', lat: -17.9647, lng: -67.1060, direccion: 'Calle 1 de Noviembre (Distrito 1)', velocidad: 24, estado: 'en_camino' },
  { id: 'REC-02', placa: '5678-DEF', lat: -17.9710, lng: -67.1120, direccion: 'Calle Potosí (Distrito 1)', velocidad: 12, estado: 'recolectando' },
  { id: 'REC-03', placa: '9012-GHI', lat: -17.9580, lng: -67.0980, direccion: 'Av. 6 de Agosto (Distrito 3)', velocidad: 0, estado: 'parado' }
];

async function runTest() {
  console.log('--- Iniciando prueba de escritura multi-vehículo con direcciones en Firebase RTDB ---');
  const start = Date.now();

  for (const unit of units) {
    const payload = {
      id: unit.id,
      placa: unit.placa,
      lat: unit.lat,
      lng: unit.lng,
      direccion: unit.direccion,
      velocidad: unit.velocidad,
      estado: unit.estado,
      activo: true,
      ultimaActualizacion: Date.now()
    };
    await set(ref(db, `camiones/${unit.id}`), payload);
    console.log(`[OK] Actualizado ${unit.id} (${unit.placa}) -> Calle: "${unit.direccion}", Estado: ${unit.estado}, Vel: ${unit.velocidad} km/h`);
  }

  const writeDuration = Date.now() - start;
  console.log(`Tiempo de escritura multi-camión: ${writeDuration} ms`);

  console.log('--- Verificando lectura multi-vehículo desde RTDB ---');
  const readStart = Date.now();
  const snapshot = await get(ref(db, 'camiones'));
  const readDuration = Date.now() - readStart;

  if (snapshot.exists()) {
    console.log(`[OK] Lectura exitosa (${readDuration} ms):`);
    const data = snapshot.val();
    Object.keys(data).forEach(k => {
      console.log(`  * ${k}: ${JSON.stringify(data[k])}`);
    });
  } else {
    console.log('[ERROR] Nodo "camiones" no encontrado.');
  }

  process.exit(0);
}

runTest().catch(err => {
  console.error('Error durante la prueba:', err);
  process.exit(1);
});

