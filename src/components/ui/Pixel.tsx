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

/** Barre de ressource : piste sobre (tile) + remplissage CSS animé.
 *  Refonte lisibilité : l'ancien cadre sprite était opaque et masquait
 *  entièrement le remplissage (la barre semblait "figée à moitié" quelle
 *  que soit la valeur réelle) — la piste est maintenant un simple fond
 *  translucide, le remplissage est le seul élément qui bouge. */
export function ResourceBar({
  value,
  max,
  color = "var(--cyan)",
  large = false,
  label,
  width,
  title,
  warnAt,
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
  /** Fraction de remplissage (0-1) à partir de laquelle la barre passe à
   *  l'ambre. Piste 10 : le joueur ne pouvait pas savoir qu'il saturait — le
   *  plafond n'existait que dans `title=`, qui ne s'ouvre qu'au survol souris,
   *  c'est-à-dire jamais sur téléphone. La couleur le dit sans un mot. */
  warnAt?: number;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const h = large ? 22 : 16;
  const warn = warnAt !== undefined && max > 0 && value / max >= warnAt;
  const fill = warn ? "var(--amber)" : color;
  return (
    <div
      className="relative overflow-hidden rounded-full"
      style={{
        width: width ?? (large ? 256 : 192),
        height: h,
        background: "rgba(5, 11, 20, 0.85)",
        border: warn ? "1px solid rgba(255, 176, 32, 0.65)" : "1px solid rgba(109, 246, 255, 0.18)",
      }}
      title={title}
      /* Le `title=` n'est lu ni par le tactile ni par un lecteur d'écran posé
         sur un `div` muet : on double l'information en accessible. */
      role="img"
      aria-label={title ?? label}
    >
      <div
        className="absolute inset-y-0 left-0 overflow-hidden rounded-full transition-[width] duration-300 ease-out"
        style={{
          width: `${pct}%`,
          minWidth: pct > 0 ? "8%" : 0,
          // Couleur pleine (pas de suffixe d'alpha concaténé sur `color` : certains
          // appelants passent un var(--xxx) CSS, et "var(--lime)99" n'est PAS une
          // couleur valide — ça invalidait TOUTE la déclaration `background` et
          // la barre restait vide quelle que soit la valeur réelle).
          background: fill,
          boxShadow: `0 0 6px ${fill}`,
        }}
      >
        {/* Glaçage : profondeur fixe, indépendante de `color` (donc toujours valide). */}
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.3), rgba(255,255,255,0) 55%)" }}
        />
      </div>
      {label && (
        <span
          className="absolute inset-0 flex items-center justify-center text-[10px] tracking-wide text-white/95"
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.85)" }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

/** Interrupteur on/off. Extrait ici à l'étape 9 : il vivait dans `PrefToggle`
 *  (Réglages), typé sur `keyof Prefs` donc inutilisable pour les rappels, qui
 *  ont leur propre stockage. Deux balisages jumeaux dans deux fichiers auraient
 *  divergé à la première retouche de style — il n'y en a plus qu'un. */
export function Switch({
  on,
  onToggle,
  label,
  disabled = false,
}: {
  on: boolean;
  onToggle: () => void;
  /** Nom accessible : le bouton n'a aucun texte à l'intérieur. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      /* La piste reste à 28 px (c'est un interrupteur, pas un bouton) mais la
         CIBLE fait bien 44 px de haut : le doigt vise la zone, pas le dessin. */
      className={`tap flex shrink-0 items-center justify-center ${disabled ? "opacity-40" : ""}`}
    >
      <span
        className={`flex h-7 w-12 items-center rounded-full border transition ${
          on ? "border-cell-lime bg-cell-lime/30" : "border-cell-teal/40 bg-abyss"
        }`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-cell-cyan transition ${on ? "translate-x-6" : "translate-x-1"}`}
        />
      </span>
    </button>
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

export type NavIconId =
  | "base"
  | "habits"
  | "mare"
  | "units"
  | "mutation"
  | "reports"
  | "settings"
  | "bastion"
  | "derive";

/* Le kit d'icônes de nav a été produit avant que le Bastion et La Dérive
   n'existent : il n'y a ni `..._icon_bastion_v001.png` ni `..._icon_derive_v001.png`.
   Plutôt que de laisser les deux onglets les plus jouables du jeu hors navigation
   en attendant des assets (piste 10), on réutilise le sprite du socle qui leur sert
   de porte dans la scène — Défense pour le Bastion, Raid pour La Dérive. C'est
   exactement ce que le joueur voit sur sa base, donc le lien est immédiat. */
const NAV_SRC: Partial<Record<NavIconId, string>> = {
  bastion: "/assets/buildings/defense/niveau1.png",
  derive: "/assets/buildings/raid/niveau1.png",
};

/** Icône de navigation du HUD. */
export function NavIcon({
  id,
  size = 32,
  active = false,
}: {
  id: NavIconId;
  size?: number;
  active?: boolean;
}) {
  return (
    <img
      src={NAV_SRC[id] ?? `${UI}/age01_cell_ui_icon_${id}_v001.png`}
      alt={id}
      width={size}
      height={size}
      className={`pixelated ${active ? "drop-shadow-[0_0_6px_rgba(109,246,255,0.9)]" : "opacity-80"}`}
      draggable={false}
    />
  );
}
