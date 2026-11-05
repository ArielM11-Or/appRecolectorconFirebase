/**
 * Servidor de Retransmisión en Tiempo Real (Live Relay Server)
 * 
 * Permite sincronización instantánea entre la App Móvil y la Plataforma Web
 * incluso cuando la cuota de Firebase Firestore esté agotada (RESOURCE_EXHAUSTED).
 * 
 * Usa únicamente módulos nativos de Node.js (http), sin librerías externas.
 */
const http = require('http');

const PORT = 3001;

let camionState = {
  id: 'REC-01',
  placa: '1234-ABC',
  activo: true,
  estado: 'parado',
  velocidad: 0,
  ubicacion: { latitude: -17.9647, longitude: -67.1060 },
  ultimaActualizacion: new Date().toISOString()
};

const sseClients = new Set();

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. SSE Stream para navegadores / web (Push en tiempo real)
  if (req.url === '/api/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Enviar estado actual de inmediato al conectar
    res.write(`data: ${JSON.stringify(camionState)}\n\n`);
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // 2. Obtener estado actual (GET /api/camion)
  if (req.url === '/api/camion' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(camionState));
    return;
  }

  // 3. Actualizar estado desde el móvil o web (POST /api/camion)
  if (req.url === '/api/camion' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        camionState = {
          ...camionState,
          ...data,
          ultimaActualizacion: new Date().toISOString()
        };

        // Difundir inmediatamente a todos los clientes web conectados
        const payload = `data: ${JSON.stringify(camionState)}\n\n`;
        sseClients.forEach((client) => {
          try {
            client.write(payload);
          } catch (e) {
            sseClients.delete(client);
          }
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, state: camionState }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`📡 Servidor Live Relay activo en http://localhost:${PORT}`);
  console.log(`   Stream SSE: http://localhost:${PORT}/api/stream`);
});

