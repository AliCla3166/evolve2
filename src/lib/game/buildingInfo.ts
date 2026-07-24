/* Textes "à quoi ça sert" — retour utilisateur : les fiches bâtiment/ressource
   n'expliquaient que les nombres (coût/production), jamais le RÔLE en langage
   simple. Purement descriptif (aucun chiffre d'équilibrage) : dérivé une fois
   à la main de economy_config.json + military_config.json pour rester exact,
   mais ce fichier n'est PAS relu par le simulateur (tools/economy). */

import type { BuildingId, ResourceId } from "./types";

/** Résumé, en gros, du rôle de chaque bâtiment (affiché en tête de fiche). */
export const BUILDING_PURPOSE: Record<BuildingId, string> = {
  noyau:
    "Le cœur de la cellule. Produit de la Vitalité en continu et, en montant de niveau, augmente le plafond de stockage de TOUTES tes ressources productibles — la priorité n°1 si tes stocks débordent.",
  membrane:
    "Organe de soutien : ne produit rien, mais fait grandir et muer ta cellule à mesure qu'il progresse (fait partie des organes comptés pour les stades de l'enveloppe).",
  adn:
    "Produit de l'ADN en continu. Sert à améliorer les Enzymes, les Protéines et le Capteur de signaux, et à recruter des Phages assaillants au Noyau.",
  proteine:
    "Produit des Protéines en continu. Sert à améliorer le Réacteur enzymatique, la Membrane et le Capteur de signaux, et à recruter des Gardes membranaires au Noyau.",
  biomasse:
    "Produit de la Biomasse en continu. Sert à améliorer le Générateur d'ADN, le Réservoir lipidique et le Noyau (plafond de stockage), et à recruter des Sondes ciliées.",
  enzyme:
    "Produit des Enzymes en continu. Sert à améliorer le Générateur d'ADN, le Réservoir lipidique et le Synthétiseur de protéines, et à recruter des Gardes membranaires.",
  lipide:
    "Produit des Lipides en continu. Sert à améliorer le Producteur de biomasse et la Membrane, et à recruter des Sondes ciliées.",
  signaux:
    "Produit des Signaux chimiques en continu. Sert à améliorer le Producteur de biomasse, le Centre de mutation et le Noyau, et à recruter des Phages assaillants.",
  mutation:
    "Capstone de l'Âge 1 : consomme Signaux chimiques et Vitalité. Le faire progresser prépare la transition vers l'Âge 2 — ton objectif final sur cette cellule.",
  peche:
    "Mini-jeu de pêche dédié à venir dans une future mise à jour. En attendant, la pêche se joue déjà depuis l'onglet MARE de la navigation basse.",
  defense:
    "Mini-jeu Bastion-Défense jouable : place tes créatures assignées (onglet MARE, 🛡️ défense) en barracks/mortiers, des tourelles/murs/pièges recrutés dans sa Boutique, puis défends le Noyau en direct à chaque vague. Si tu ne joues pas la vague, la défense passive (Gardes membranaires + cartes assignées) prend le relais automatiquement.",
  raid:
    "Mini-jeu Bastion-Raid à venir. En attendant, les expéditions se gèrent depuis l'onglet NOYAU.",
};

export function buildingPurpose(id: BuildingId): string {
  return BUILDING_PURPOSE[id] ?? "";
}

/** Résumé, en gros, de l'utilité de chaque ressource — pour savoir quoi farmer en premier. */
export const RESOURCE_PURPOSE: Record<ResourceId, string> = {
  energie:
    "Généré par tes habitudes réelles (repas, pas, tâches, rituels) — pas par les bâtiments. Sert à acheter des jetons de pêche (Mare) et à recruter des unités au Noyau. Pas de plafond de stockage cellulaire.",
  vitalite:
    "Produite passivement par le Noyau. N'est utile que pour le Centre de mutation (capstone de fin d'Âge 1) — laisse-la simplement s'accumuler, pas besoin de la farmer activement.",
  adn:
    "Produit par le Générateur d'ADN. Nécessaire pour améliorer le Réacteur enzymatique, le Synthétiseur de protéines et le Capteur de signaux, et pour recruter des Phages assaillants.",
  proteine:
    "Produit par le Synthétiseur de protéines. Nécessaire pour améliorer le Réacteur enzymatique, la Membrane et le Capteur de signaux, et pour recruter des Gardes membranaires.",
  biomasse:
    "Produit par le Producteur de biomasse. Nécessaire pour améliorer le Générateur d'ADN, le Réservoir lipidique ET le Noyau (donc ton plafond de stockage) — souvent la priorité si tu débordes.",
  enzyme:
    "Produit par le Réacteur enzymatique. Nécessaire pour améliorer le Générateur d'ADN, le Réservoir lipidique et le Synthétiseur de protéines, et pour recruter des Gardes membranaires.",
  lipide:
    "Produit par le Réservoir lipidique. Nécessaire pour améliorer le Producteur de biomasse et la Membrane, et pour recruter des Sondes ciliées.",
  signaux:
    "Produit par le Capteur de signaux. Nécessaire pour améliorer le Producteur de biomasse, le Centre de mutation et le Noyau, et pour recruter des Phages assaillants.",
  combat:
    "Monnaie de combat — gagnée en remportant des vagues au Bastion-Défense (jouable). Sert uniquement dans sa Boutique : emplacements, réserve, spécialisations, recrutement de tourelles/murs/pièges.",
};

export function resourcePurpose(id: ResourceId): string {
  return RESOURCE_PURPOSE[id] ?? "";
}
