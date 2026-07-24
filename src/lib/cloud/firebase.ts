/* Sync cloud (Firebase Auth Google + Firestore) — Phase Firebase.
   Réutilise le projet v1 `evolve-game-ebc60` (décision actée), mais dans une
   collection SÉPARÉE `saves_v2/{uid}` : la sauvegarde v1 (`saves/{uid}`) n'est
   jamais touchée. Tout est optionnel : sans variables NEXT_PUBLIC_FIREBASE_*,
   le jeu tourne en local exactement comme avant (aucune clé en dur ici). */

import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from "firebase/auth";
import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from "firebase/firestore";
import type { GameState } from "@/lib/game/types";

/** true si la config est injectée (Vercel / .env.local). */
export const cloudConfigured = !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

function app(): FirebaseApp {
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
  return onAuthStateChanged(getAuth(app()), cb);
}

/** Connexion Google — popup, avec repli redirect (mobiles qui bloquent les popups). */
export async function signInGoogle(): Promise<void> {
  const auth = getAuth(app());
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch {
    await signInWithRedirect(auth, provider);
  }
}

export async function signOutCloud(): Promise<void> {
  await signOut(getAuth(app()));
}

export interface CloudSave {
  state: GameState;
  /** lastTick de la sauvegarde cloud (résolution de conflit : le plus récent gagne). */
  lastTick: number;
}

/** Lit la sauvegarde cloud (null si aucune).
 *  Le GameState est stocké en blob JSON : robuste aux types imbriqués Firestore. */
export async function loadCloud(uid: string): Promise<CloudSave | null> {
  const snap = await getDoc(doc(getFirestore(app()), "saves_v2", uid));
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
  await setDoc(doc(getFirestore(app()), "saves_v2", uid), {
    data: JSON.stringify(state),
    lastTick: state.lastTick,
    saveVersion: state.saveVersion,
    updatedAt: serverTimestamp(),
  });
}
