/* Sync cloud (Firebase Auth Google + Firestore) — Phase Firebase.
   Réutilise le projet v1 `evolve-game-ebc60` (décision actée), mais dans une
   collection SÉPARÉE `saves_v2/{uid}` : la sauvegarde v1 (`saves/{uid}`) n'est
   jamais touchée. Tout est optionnel : sans variables NEXT_PUBLIC_FIREBASE_*,
   le jeu tourne en local exactement comme avant (aucune clé en dur ici).

   Phase 8 (perfs) : le SDK Firebase (~200 Ko gzip) est chargé en IMPORT
   DYNAMIQUE — il n'entre jamais dans le bundle initial, et n'est téléchargé
   que si la config existe ET qu'une fonction cloud est réellement appelée. */

import type { FirebaseApp } from "firebase/app";
import type { User } from "firebase/auth";
import type { GameState } from "@/lib/game/types";

/** true si la config est injectée (Vercel / .env.local). */
export const cloudConfigured = !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

async function app(): Promise<FirebaseApp> {
  const { getApps, initializeApp } = await import("firebase/app");
  if (getApps().length) return getApps()[0];
  return initializeApp({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  });
}

export type CloudUser = User;

/** S'abonne à l'état de connexion (no-op si non configuré). */
export function watchAuth(cb: (user: CloudUser | null) => void): () => void {
  if (!cloudConfigured) {
    cb(null);
    return () => {};
  }
  let unsub: (() => void) | null = null;
  let cancelled = false;
  (async () => {
    const [{ getAuth, onAuthStateChanged }, a] = await Promise.all([
      import("firebase/auth"),
      app(),
    ]);
    if (cancelled) return;
    unsub = onAuthStateChanged(getAuth(a), cb);
  })();
  return () => {
    cancelled = true;
    unsub?.();
  };
}

/** Connexion Google — popup, avec repli redirect (mobiles qui bloquent les popups). */
export async function signInGoogle(): Promise<void> {
  const [{ getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect }, a] =
    await Promise.all([import("firebase/auth"), app()]);
  const auth = getAuth(a);
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch {
    await signInWithRedirect(auth, provider);
  }
}

export async function signOutCloud(): Promise<void> {
  const [{ getAuth, signOut }, a] = await Promise.all([import("firebase/auth"), app()]);
  await signOut(getAuth(a));
}

export interface CloudSave {
  state: GameState;
  /** lastTick de la sauvegarde cloud (résolution de conflit : le plus récent gagne). */
  lastTick: number;
}

/** Lit la sauvegarde cloud (null si aucune).
 *  Le GameState est stocké en blob JSON : robuste aux types imbriqués Firestore. */
export async function loadCloud(uid: string): Promise<CloudSave | null> {
  const [{ doc, getDoc, getFirestore }, a] = await Promise.all([
    import("firebase/firestore"),
    app(),
  ]);
  const snap = await getDoc(doc(getFirestore(a), "saves_v2", uid));
  if (!snap.exists()) return null;
  const raw = snap.data();
  if (typeof raw?.data !== "string") return null;
  try {
    const state = JSON.parse(raw.data) as GameState;
    return { state, lastTick: state.lastTick ?? 0 };
  } catch {
    return null;
  }
}

/** Pousse la sauvegarde locale vers le cloud. */
export async function pushCloud(uid: string, state: GameState): Promise<void> {
  const [{ doc, getFirestore, serverTimestamp, setDoc }, a] = await Promise.all([
    import("firebase/firestore"),
    app(),
  ]);
  await setDoc(doc(getFirestore(a), "saves_v2", uid), {
    data: JSON.stringify(state),
    lastTick: state.lastTick,
    saveVersion: state.saveVersion,
    updatedAt: serverTimestamp(),
  });
}
