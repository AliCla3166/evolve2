/* Composants UI pixel art de base — Âge 1 Cellule.
   Tous consomment les assets de public/assets/ui/ (kit PixelLab). */
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

const UI = "/assets/ui";

/** Vignette sobre (refonte lisibilité Phase 7) : le pixel art vit dans les
 *  sprites/cartes/scène, les CONTENEURS restent calmes et lisibles.
 *  variant : membrane = standard · noyau = bord renforcé · tooltip = compact. */
export function Panel({
  variant = "membrane",
  children,
  className = "",
  style,
}: {
  variant?: "membrane" | "noyau" | "tooltip";
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const cls =
    variant === "noyau" ? "tile tile-strong" : variant === "tooltip" ? "tile tile-compact" : "tile";
  return (
    <div className={`${cls} ${className}`} style={style}>
      {children}
    </div>
  );
}

/** Bouton organique 4 états (normal / hover / pressed / disabled).
 *  Avec `href`, rend un Link Next stylé à l'identique (navigation). */
export function PixelButton({
  children,
  onClick,
  disabled = false,
  className = "",
  href,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  href?: string;
}) {
  const cls = `pixel-btn relative select-none px-5 py-2 text-xs tracking-widest text-cell-cyan ${className}`;
  if (href && !disabled) {
    return (
      <Link href={href} className={`inline-flex items-center justify-center ${cls}`}>
        {children}
      </Link>
    );
  }
  return (
    <button onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}

/** Barre de ressource : cadre organique + remplissage CSS. */
export function ResourceBar({
  value,
  max,
  color = "var(--cyan)",
  large = false,
  label,
  width,
  title,
}: {
  value: number;
  max: number;
  color?: string;
  large?: boolean;
  label?: string;
  /** Largeur en px (défaut : 192, ou 256 en large) — pour les HUD compacts. */
  width?: number;
  /** Tooltip natif (infobulle de ressource). */
  title?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const frame = large ? "bar_frame_large" : "bar_frame";
  const h = large ? 24 : 16;
  return (
    <div
      className="relative inline-block"
      style={{ width: width ?? (large ? 256 : 192), height: h * 2 }}
      title={title}
    >
      <div
        className="absolute rounded-full"
        style={{
          left: "6%",
          right: "6%",
          top: "28%",
          bottom: "28%",
          background: `linear-gradient(90deg, ${color}, ${color}cc ${pct}%, transparent ${pct}%)`,
          boxShadow: `0 0 8px ${color}55 inset`,
        }}
      />
      <img
        src={`${UI}/age01_cell_ui_${frame}_v001.png`}
        alt=""
        className="pixelated absolute inset-0 h-full w-full"
        draggable={false}
      />
      {label && (
        <span className="absolute inset-0 flex items-center justify-center text-[11px] tracking-wider text-white/90">
          {label}
        </span>
      )}
    </div>
  );
}

export type Rarity =
  | "commune"
  | "peucommune"
  | "rare"
  | "epique"
  | "legendaire"
  | "mythique";

export const RARITY_LABEL: Record<Rarity, string> = {
  commune: "Commune",
  peucommune: "Peu commune",
  rare: "Rare",
  epique: "Épique",
  legendaire: "Légendaire",
  mythique: "Mythique",
};

/** Cadre de carte d'unité (6 raretés) avec contenu (ex. portrait). */
export function CardFrame({
  rarity,
  children,
  scale = 1,
}: {
  rarity: Rarity;
  children?: ReactNode;
  scale?: number;
}) {
  return (
    <div className="relative" style={{ width: 96 * scale, height: 128 * scale }}>
      <div className="absolute flex items-center justify-center" style={{ inset: 10 * scale }}>
        {children}
      </div>
      <img
        src={`${UI}/age01_cell_ui_card_${rarity}_v001.png`}
        alt={RARITY_LABEL[rarity]}
        className="pixelated pointer-events-none absolute inset-0 h-full w-full"
        draggable={false}
      />
    </div>
  );
}

/** Icône de navigation du HUD. */
export function NavIcon({
  id,
  size = 32,
  active = false,
}: {
  id: "base" | "habits" | "mare" | "units" | "mutation" | "reports" | "settings";
  size?: number;
  active?: boolean;
}) {
  return (
    <img
      src={`${UI}/age01_cell_ui_icon_${id}_v001.png`}
      alt={id}
      width={size}
      height={size}
      className={`pixelated ${active ? "drop-shadow-[0_0_6px_rgba(109,246,255,0.9)]" : "opacity-80"}`}
      draggable={false}
    />
  );
}
