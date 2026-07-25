/* Réglages des rappels (étape 9, piste 2 du diagnostic UX).
 *
 *  Trois états possibles, et un seul est un cul-de-sac :
 *   - « default »  : rien n'a encore été demandé -> un bouton d'activation ;
 *   - « granted »  : la liste des catégories, coupables une par une ;
 *   - « denied »   : on ne peut PLUS rien demander (le prompt natif ne se joue
 *     qu'une fois par installation). On le dit franchement et on renvoie vers
 *     les réglages du navigateur, au lieu d'afficher des interrupteurs qui ne
 *     feraient rien.
 *
 *  L'autorisation et les préférences vivent hors de React : elles arrivent par
 *  `useSyncExternalStore` (cf. notifications.ts), jamais par un état amorcé
 *  dans un effet. Aucun texte ni aucune valeur ici : tout vient du JSON. */
"use client";

import { useSyncExternalStore } from "react";
import { Panel, PixelButton, Switch } from "@/components/ui/Pixel";
import {
  NOTIF,
  NOTIF_CATEGORIES,
  getNotifServerSnapshot,
  getNotifSnapshot,
  requestNotifPermission,
  setNotifPrefs,
  subscribeNotifStore,
} from "@/lib/notifications";

const P = NOTIF.permission;

export function NotifSettings() {
  const { state, prefs } = useSyncExternalStore(
    subscribeNotifStore,
    getNotifSnapshot,
    getNotifServerSnapshot,
  );

  /* Un navigateur qui ne sait pas notifier ne mérite pas un panneau qui
     explique ce qu'il ne fera pas : on ne montre rien du tout. */
  if (state === "unsupported") return null;

  return (
    <Panel className="space-y-2 p-3">
      <div className="text-xs text-cell-cyan">{P.settings_title}</div>
      <p className="text-[11px] leading-relaxed text-cell-teal/60">{P.settings_hint}</p>

      {state === "denied" && (
        <p className="text-[11px] leading-relaxed text-cell-amber">{P.settings_blocked}</p>
      )}

      {state === "default" && (
        <PixelButton className="!py-1 text-[10px]" onClick={() => void requestNotifPermission()}>
          {P.settings_ask}
        </PixelButton>
      )}

      {state === "granted" &&
        NOTIF_CATEGORIES.map((cat) => (
          <div
            key={cat.id}
            className="flex items-center justify-between gap-3 border-t border-cell-cyan/10 pt-2 first:border-0 first:pt-0"
          >
            <div className="min-w-0">
              <div className="text-xs text-cell-cyan">{cat.label}</div>
              <div className="text-[11px] leading-snug text-cell-teal/60">{cat.hint}</div>
            </div>
            <Switch
              on={!!prefs.on[cat.id]}
              label={cat.label}
              onToggle={() => setNotifPrefs({ on: { ...prefs.on, [cat.id]: !prefs.on[cat.id] } })}
            />
          </div>
        ))}

      {/* L'heure n'a de sens que si le rappel d'habitudes est réellement actif :
          proposer de régler une heure qui ne servira à rien est une promesse
          creuse. */}
      {state === "granted" && prefs.on.habitudes && (
        <label className="flex items-center justify-between gap-3 border-t border-cell-cyan/10 pt-2">
          <span className="text-[11px] text-cell-teal/80">{P.settings_hour_label}</span>
          <input
            type="time"
            value={`${String(prefs.hour).padStart(2, "0")}:${String(prefs.minute).padStart(2, "0")}`}
            onChange={(e) => {
              const [h, m] = e.target.value.split(":").map(Number);
              if (Number.isFinite(h) && Number.isFinite(m)) setNotifPrefs({ hour: h, minute: m });
            }}
            /* 16 px minimum : en dessous, iOS zoome au focus et ne dézoome
               jamais (cf. étape 8, la vraie cause du pinch-to-zoom désactivé). */
            className="tap-h rounded-md border border-cell-cyan/30 bg-abyss px-2 text-base text-cell-cyan"
          />
        </label>
      )}
    </Panel>
  );
}
