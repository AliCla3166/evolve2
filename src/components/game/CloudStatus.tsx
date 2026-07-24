/* Bloc de connexion/statut cloud de l'écran titre.
   Sans config Firebase : simple mention locale (comportement inchangé). */
"use client";

import { PixelButton } from "@/components/ui/Pixel";
import { cloudConfigured, signInGoogle, signOutCloud } from "@/lib/cloud/firebase";
import { useCloudSync } from "@/lib/cloud/useCloudSync";

export function CloudStatus() {
  const { user, status } = useCloudSync();

  if (!cloudConfigured) {
    return (
      <span className="rounded-full border border-cell-cyan/30 px-4 py-1 text-xs tracking-widest text-cell-cyan/60">
        Sauvegarde locale sur cet appareil · sync cloud à configurer
      </span>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <PixelButton className="!min-w-[210px] !px-8 !py-2 text-[11px]" onClick={() => signInGoogle()}>
          ☁️ SYNC GOOGLE
        </PixelButton>
        <span className="text-[10px] text-cell-teal/50">
          Retrouve ta cellule sur tous tes appareils — ou continue en local.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="rounded-full border border-cell-lime/40 px-4 py-1 text-xs tracking-widest text-cell-lime">
        {status === "synced" && "☁️ Synchronisé"}
        {status === "syncing" && "☁️ Synchronisation…"}
        {status === "error" && "☁️ Erreur de sync — le local fait foi"}
        {status === "signedout" && "☁️ …"}
        {" · "}
        {user.displayName ?? user.email}
      </span>
      <button
        onClick={() => signOutCloud()}
        className="text-[10px] tracking-widest text-cell-teal/50 hover:text-cell-teal"
      >
        se déconnecter
      </button>
    </div>
  );
}
