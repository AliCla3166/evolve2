/* Helpers d'affichage (nombres, durées) — présentation uniquement. */

export function fmtInt(n: number): string {
  return Math.floor(n).toLocaleString("fr-FR");
}

/** "1 234" ou "12,5" pour les petits taux. */
export function fmtRate(perHour: number): string {
  if (perHour >= 100) return fmtInt(perHour);
  return perHour.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}

/** Durée compacte, pour les libellés de boutons : "2j 4h", "1h 20m", "45m", "30s".
 *  fmtDuration est trop bavard là où la place manque ("2h 00m 00s"). */
export function fmtDurationShort(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}j ${h}h` : `${d}j`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${total}s`;
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
