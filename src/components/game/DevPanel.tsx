/* Panneau développeur — demande utilisateur : dans le slot "dev" (séparé de
   la vraie partie), pouvoir se rajouter librement des ressources pour tester
   le jeu. N'apparaît QUE si le slot actif est "dev" (cf. store.devGrant, qui
   est de toute façon un no-op silencieux en perso — double garde-fou). */
/* eslint-disable @next/next/no-img-element */
"use client";

import { Panel, PixelButton } from "@/components/ui/Pixel";
import { RESOURCE_IDS, resourceName } from "@/lib/game/economy";
import { useGame } from "@/lib/game/store";

export function DevPanel() {
  const devGrant = useGame((s) => s.devGrant);
  const devGrantBastionTestCards = useGame((s) => s.devGrantBastionTestCards);

  return (
    <Panel variant="noyau" className="space-y-2 p-3" style={{ borderColor: "rgba(255, 84, 214, 0.4)" }}>
      <div className="text-xs tracking-widest text-cell-magenta">🧪 Mode développeur</div>
      <p className="text-[11px] leading-relaxed text-cell-teal/60">
        Ajoute librement des ressources pour tester — cette partie est isolée,
        aucun effet sur ta vraie sauvegarde perso.
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {RESOURCE_IDS.filter((r) => r !== "energie" && r !== "vitalite").map((res) => (
          <button
            key={res}
            onClick={() => devGrant({ resources: { [res]: 1000 } })}
            className="flex items-center gap-1.5 rounded-md border border-cell-magenta/25 bg-black/20 px-2 py-1.5 text-left text-[11px] text-cell-teal transition hover:border-cell-magenta/70"
          >
            <img src={`/assets/resources/${res}.png`} alt="" width={16} height={16} className="pixelated shrink-0" draggable={false} />
            <span className="truncate">+1000 {resourceName(res)}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-cell-magenta/15 pt-2">
        <PixelButton className="!py-1 text-[10px]" onClick={() => devGrant({ resources: { energie: 500 } })}>
          +500 ⚡ ÉNERGIE
        </PixelButton>
        <PixelButton className="!py-1 text-[10px]" onClick={() => devGrant({ jetons: 10 })}>
          +10 JETONS
        </PixelButton>
        <PixelButton className="!py-1 text-[10px]" onClick={() => devGrant({ fragments: 8 })}>
          +8 FRAGMENTS
        </PixelButton>
        <PixelButton className="!py-1 text-[10px]" onClick={devGrantBastionTestCards}>
          ⚔️ CARTES BASTION TEST
        </PixelButton>
      </div>
    </Panel>
  );
}
