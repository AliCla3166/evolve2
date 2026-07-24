/* Hook de synchronisation cloud — monté sur l'écran titre ET sur /play
   (une seule page vit à la fois). Règle de conflit simple et sûre :
   à la connexion, la sauvegarde au lastTick le PLUS RÉCENT gagne ;
   ensuite, push périodique (90 s) + à la mise en arrière-plan de l'onglet. */
"use client";

import { useEffect, useState } from "react";
import {
  cloudConfigured,
  loadCloud,
  pushCloud,
  watchAuth,
  type CloudUser,
} from "./firebase";
import { exportSave, useGame } from "@/lib/game/store";

export type CloudStatus = "off" | "signedout" | "syncing" | "synced" | "error";

const PUSH_INTERVAL_MS = 90_000;

export function useCloudSync(): { user: CloudUser | null; status: CloudStatus } {
  const [user, setUser] = useState<CloudUser | null>(null);
  const [status, setStatus] = useState<CloudStatus>(cloudConfigured ? "signedout" : "off");

  // État de connexion Google.
  useEffect(() => {
    return watchAuth((u) => {
      setUser(u);
      if (cloudConfigured) setStatus(u ? "syncing" : "signedout");
    });
  }, []);

  // À la connexion : adoption de la sauvegarde la plus récente, puis premier push.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const cloud = await loadCloud(user.uid);
        if (cancelled) return;
        const local = exportSave();
        if (cloud && cloud.lastTick > local.lastTick) {
          useGame.getState().adoptSave(cloud.state);
        }
        await pushCloud(user.uid, exportSave());
        if (!cancelled) setStatus("synced");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Push périodique + quand l'onglet passe en arrière-plan.
  useEffect(() => {
    if (!user) return;
    const push = () => {
      pushCloud(user.uid, exportSave())
        .then(() => setStatus("synced"))
        .catch(() => setStatus("error"));
    };
    const id = setInterval(push, PUSH_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") push();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user]);

  return { user, status };
}
