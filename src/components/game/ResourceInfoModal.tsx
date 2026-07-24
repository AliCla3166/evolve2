/* Fiche info d'une ressource — retour utilisateur : au tap sur une ressource du
   HUD, on veut son nom + à quoi elle sert, pour savoir quoi farmer en premier. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { Panel, PixelButton } from "@/components/ui/Pixel";
import { resourceName } from "@/lib/game/economy";
import { resourcePurpose } from "@/lib/game/buildingInfo";
import type { ResourceId } from "@/lib/game/types";

export function ResourceInfoModal({
  id,
  onClose,
}: {
  id: ResourceId;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-6"
      onClick={onClose}
    >
      <div className="w-full max-w-xs" onClick={(e) => e.stopPropagation()}>
        <Panel variant="noyau" className="p-4 text-center">
          <img
            src={`/assets/resources/${id}.png`}
            alt=""
            width={40}
            height={40}
            className="pixelated mx-auto mb-2"
            draggable={false}
          />
          <h3 className="text-sm tracking-widest text-cell-cyan">{resourceName(id)}</h3>
          <p className="mt-2 text-left text-xs leading-relaxed text-white/85">
            {resourcePurpose(id)}
          </p>
          <PixelButton className="mt-3 text-[11px]" onClick={onClose}>
            OK
          </PixelButton>
        </Panel>
      </div>
    </div>
  );
}
