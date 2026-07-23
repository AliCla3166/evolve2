/* Helpers d'affichage (nombres, durées) — présentation uniquement. */

export function fmtInt(n: number): string {
  return Math.floor(n).toLocaleString("fr-FR");
}

/** "1 234" ou "12,5" pour les petits taux. */
export function fmtRate(perHour: number): string {
  if (perHour >= 100) return fmtInt(perHour);
  return perHour.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}

/** Durée lisible : "2j 3h 05m", "1h 04m 12s", "3m 09s", "42s". */
export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  if (h >= 24) return `${Math.floor(h / 24)}j ${h % 24}h ${pad(m)}m`;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}
