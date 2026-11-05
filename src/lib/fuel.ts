/**
 * Estimates fuel consumption in liters based on operational metrics.
 * Formula:
 *   litros = (km * 0.35) + (tiempoRecoleccion * 0.08) + (tiempoRalenti * 0.04)
 *          + (ciclosCompresion * 0.25) + (tiempoCompresion * 0.12)
 */
export function calcularLitros(
  kmRecorridos: number,
  tiempoRecoleccionMin: number,
  tiempoRalentiMin: number,
  ciclosCompresion: number,
  tiempoCompresionMin: number
): number {
  const litros =
    kmRecorridos * 0.35 +
    tiempoRecoleccionMin * 0.08 +
    tiempoRalentiMin * 0.04 +
    ciclosCompresion * 0.25 +
    tiempoCompresionMin * 0.12;
  return Math.round(litros * 100) / 100;
}
