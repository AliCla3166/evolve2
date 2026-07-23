/* Page de revue du kit UI — /ui
   Vitrine de tous les composants habillés (livrable Phase 1). */
/* eslint-disable @next/next/no-img-element */
import {
  CardFrame,
  NavIcon,
  Panel,
  PixelButton,
  RARITY_LABEL,
  ResourceBar,
  type Rarity,
} from "@/components/ui/Pixel";

const PORTRAITS = [
  "abyssal", "meduse", "crustace", "larve", "cephalopode",
  "predateur", "symbiote", "spore", "lanterne", "amibe",
  "trilobite", "hydre", "ver", "diatomee", "embryon",
  "radiolaire", "planaire", "colonie", "archee", "germe",
] as const;

const RARITIES: Rarity[] = [
  "commune", "peucommune", "rare", "epique", "legendaire", "mythique",
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-sm uppercase tracking-[0.4em] text-cell-teal/80">{title}</h2>
      {children}
    </section>
  );
}

export default function UiKitPage() {
  return (
    <main
      className="min-h-screen space-y-12 px-6 py-10 sm:px-12"
      style={{
        backgroundImage: "url(/assets/ui/age01_cell_ui_bg_ocean_v001.png)",
        backgroundSize: "512px",
        imageRendering: "pixelated",
      }}
    >
      <header className="space-y-2">
        <h1 className="text-2xl tracking-[0.3em] text-cell-cyan">KIT UI — ÂGE 1 CELLULE</h1>
        <p className="text-xs text-cell-teal/70">
          Revue des composants (Phase 1). Chaque élément consomme les assets PixelLab de
          /public/assets/ui.
        </p>
      </header>

      <Section title="Panneaux">
        <div className="flex flex-wrap gap-6">
          <Panel variant="membrane" className="w-64 p-4 text-xs">
            Panneau membrane standard — contenu de menu, listes, boutiques.
          </Panel>
          <Panel variant="noyau" className="w-64 p-4 text-xs">
            Panneau noyau — fenêtres importantes (bâtiments, rapports).
          </Panel>
          <Panel variant="tooltip" className="w-48 p-3 text-[10px]">
            Tooltip membrane — infobulles de ressources.
          </Panel>
        </div>
      </Section>

      <Section title="Boutons">
        <div className="flex flex-wrap items-center gap-4">
          <PixelButton>AMÉLIORER</PixelButton>
          <PixelButton disabled>INDISPONIBLE</PixelButton>
        </div>
      </Section>

      <Section title="Jauges & barres">
        <div className="flex flex-wrap items-center gap-6">
          <ResourceBar value={64} max={100} label="ADN 64/100" />
          <ResourceBar value={30} max={100} color="var(--lime)" label="Biomasse 30/100" />
          <ResourceBar value={86} max={100} large color="var(--magenta)" label="Énergie 86/100" />
        </div>
      </Section>

      <Section title="Icônes de navigation">
        <div className="flex flex-wrap items-center gap-5">
          {(["base", "habits", "mare", "units", "mutation", "reports", "settings"] as const).map(
            (id) => (
              <div key={id} className="flex flex-col items-center gap-1">
                <NavIcon id={id} size={40} active={id === "base"} />
                <span className="text-[9px] text-cell-teal/60">{id}</span>
              </div>
            ),
          )}
        </div>
      </Section>

      <Section title="Cartes d'unités (6 raretés)">
        <div className="flex flex-wrap gap-4">
          {RARITIES.map((r, i) => (
            <div key={r} className="flex flex-col items-center gap-1">
              <CardFrame rarity={r} scale={1.2}>
                <img
                  src={`/assets/portraits/age01_cell_portrait_${PORTRAITS[i]}_v001.png`}
                  alt=""
                  className="pixelated h-full w-full object-cover"
                  draggable={false}
                />
              </CardFrame>
              <span className="text-[9px] text-cell-teal/70">{RARITY_LABEL[r]}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Les 20 portraits (création de personnage)">
        <div className="grid max-w-3xl grid-cols-5 gap-3 sm:grid-cols-10">
          {PORTRAITS.map((p) => (
            <img
              key={p}
              src={`/assets/portraits/age01_cell_portrait_${p}_v001.png`}
              alt={p}
              title={p}
              className="pixelated w-full cursor-pointer rounded-sm border border-cell-cyan/20 transition hover:scale-110 hover:border-cell-cyan"
              draggable={false}
            />
          ))}
        </div>
      </Section>

      <Section title="Overlays d'état bâtiment">
        <div className="flex flex-wrap gap-6">
          {["locked", "construction", "upgrade"].map((o) => (
            <div key={o} className="flex flex-col items-center gap-1">
              <img
                src={`/assets/ui/age01_cell_ui_overlay_${o}_v001.png`}
                alt={o}
                className="pixelated h-16 w-16"
                draggable={false}
              />
              <span className="text-[9px] text-cell-teal/60">{o}</span>
            </div>
          ))}
        </div>
      </Section>
    </main>
  );
}
