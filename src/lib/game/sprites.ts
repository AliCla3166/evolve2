/* Sprites de créatures pour les scènes Canvas (26/07).

   POURQUOI CE FICHIER EXISTE. Les portraits des 62 espèces sont des BUSTES de
   64×64 peints sur un fond : c'est parfait dans un cadre de carte, où le fond
   fait partie de l'illustration. Posés tels quels sur une scène — la faune qui
   nage dans la cellule, les ouvrières à leur organe, les équipages sur les
   gisements — ils y deviennent des VIGNETTES CARRÉES collées sur le décor. On
   ne voit plus une créature dans l'eau, on voit un timbre-poste.

   Un détourage classique ne marche pas ici : la moitié des portraits sont des
   bustes qui touchent les quatre bords, il n'y a donc pas de « fond » connexe à
   retirer. Ce que ces illustrations ont en commun, c'est autre chose : le fond
   est SOMBRE et la créature est bioluminescente. On fabrique donc l'alpha à
   partir de deux mesures, une fois par espèce et en mémoire :

     - la LUMINANCE : au-dessous de LUM_LO c'est de l'eau (transparent),
       au-dessus de LUM_HI c'est la créature (opaque), entre les deux un fondu ;
     - la DISTANCE AU CENTRE : au-delà de SOFT le sprite s'efface vers son bord,
       ce qui supprime l'angle droit même quand le buste déborde du cadre.

   Résultat : la créature garde sa silhouette et le décor passe au travers. Rien
   ici ne touche à l'équilibrage ni à l'état — c'est du pur rendu, et le cache
   vit au niveau du module, donc partagé entre toutes les scènes et tous les
   montages (une scène rouverte ne recalcule rien).

   Ces fonctions manipulent `document` : elles ne sont appelées que depuis les
   boucles rAF des composants "use client", jamais pendant un rendu serveur. */

const imgCache = new Map<string, HTMLImageElement>();
const cutCache = new Map<string, CanvasImageSource>();

/** Rayon (fraction du demi-côté) où commence le fondu vers le bord. */
const SOFT = 0.58;
/** Luminance en dessous de laquelle un pixel est considéré comme de l'eau. */
const LUM_LO = 0.11;
/** Luminance au-dessus de laquelle un pixel est pleinement la créature. */
const LUM_HI = 0.36;

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Image partagée pour une source donnée. Le chargement est lancé au premier
 *  appel ; les appels suivants récupèrent la même instance. */
export function creatureImage(src: string): HTMLImageElement {
  let img = imgCache.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    imgCache.set(src, img);
  }
  return img;
}

export function spriteReady(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0;
}

/** Le portrait débarrassé de son fond, prêt à être dessiné sur une scène.
 *  `null` tant que l'image n'est pas chargée — l'appelant saute simplement son
 *  tour, comme il le faisait déjà avec une image pas prête. */
export function creatureSprite(src: string): CanvasImageSource | null {
  const cached = cutCache.get(src);
  if (cached) return cached;

  const img = creatureImage(src);
  if (!spriteReady(img)) return null;

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: false });
  // Sans contexte 2D, on rend le portrait brut : moins joli, mais visible. Une
  // scène amputée de ses créatures serait un bien pire défaut qu'un carré.
  if (!ctx) return img;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);

  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, w, h);
  } catch {
    // Canvas teinté (impossible avec nos assets, servis par la même origine) :
    // on retombe sur le portrait brut plutôt que de faire tomber la boucle rAF.
    return img;
  }

  const px = data.data;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const rad = Math.max(w, h) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const alpha = px[i + 3];
      if (alpha === 0) continue;
      // Luminance perceptuelle : le vert domine, comme dans getGrayscale.
      const lum = (px[i] * 0.2 + px[i + 1] * 0.5 + px[i + 2] * 0.3) / 255;
      const keep = smooth(Math.max(0, Math.min(1, (lum - LUM_LO) / (LUM_HI - LUM_LO))));
      const d = Math.hypot(x - cx, y - cy) / rad;
      const vignette = d < SOFT ? 1 : smooth(Math.max(0, 1 - (d - SOFT) / (1 - SOFT)));
      px[i + 3] = Math.round(alpha * keep * vignette);
    }
  }
  ctx.putImageData(data, 0, 0);
  cutCache.set(src, c);
  return c;
}
