// Chantier 115 — Carte « Nouveau magasin détecté » à l'étape magasin du scan.
//
// La décision définitive (rattacher / zone grise / créer) appartient à la RPC
// resoudre_ou_creer_magasin_core, appelée quand l'utilisateur valide. Ce module
// décide seulement s'il faut PROPOSER la carte : le ticket donne un nom ET une
// adresse, et aucun magasin connu ne s'en approche selon la même règle que la
// RPC (même code postal ET similarité trigramme de l'adresse >= 0,70, parmi les
// magasins de la même enseigne). Dès qu'un magasin connu s'en approche, pas de
// carte : l'écran se comporte exactement comme avant (sélecteur seul).
//
// Fonctions pures, aucune ne throw.
import { idEnseigneDepuisSlug } from './enseignesMagasin';

// Seuil bas de la zone grise de la RPC (0,70 <= sim < 0,85 -> 'ambigu').
export const SEUIL_MAGASIN_PROCHE = 0.70;

export function extraireCodePostal(adresse) {
  const m = String(adresse ?? '').match(/\b\d{5}\b/);
  return m ? m[0] : null;
}

// Trigrammes à la manière de pg_trgm : minuscules, sans accents, chaque mot
// alphanumérique est encadré de deux espaces devant et un derrière.
function trigrammes(s) {
  const mots = String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const ens = new Set();
  for (const mot of mots) {
    const p = `  ${mot} `;
    for (let i = 0; i + 3 <= p.length; i++) ens.add(p.slice(i, i + 3));
  }
  return ens;
}

// Équivalent JS de extensions.similarity (pg_trgm) : |A ∩ B| / |A ∪ B|.
export function similariteTrigramme(a, b) {
  const A = trigrammes(a);
  const B = trigrammes(b);
  if (A.size === 0 || B.size === 0) return 0;
  let commun = 0;
  for (const t of A) if (B.has(t)) commun++;
  return commun / (A.size + B.size - commun);
}

// Magasin connu le plus proche de l'adresse du ticket (même règle que la RPC),
// ou null. `enseigneId` : identifiant d'enseigne du ticket ("utile", "autre"…).
export function magasinConnuPourTicket({ adresse, enseigneId, magasins }) {
  const adr = String(adresse ?? '').trim();
  const cp = extraireCodePostal(adr);
  if (!adr || !cp || !Array.isArray(magasins)) return null;

  // Comme la RPC : on ne compare qu'à la même enseigne quand elle est connue
  // en base ; sinon (enseigne "autre" ou absente des magasins), à tous.
  const ens = idEnseigneDepuisSlug(enseigneId);
  const memeEnseigne = (m) => idEnseigneDepuisSlug(m?.enseignes?.slug) === ens;
  const filtrer = ens && ens !== 'autre' && magasins.some(memeEnseigne);
  const candidats = filtrer ? magasins.filter(memeEnseigne) : magasins;

  let meilleur = null;
  let meilleureSim = 0;
  for (const m of candidats) {
    if (!m || String(m.code_postal ?? '').trim() !== cp || !m.adresse) continue;
    // L'adresse du ticket porte souvent « rue, CP ville » alors que la fiche
    // ne porte parfois que la rue : on retient la meilleure de trois
    // comparaisons (brute comme la RPC, rue contre rue, complète contre
    // complète). Plus tolérant que la RPC = plus prudent : dans le doute, pas
    // de carte et l'écran reste celui d'avant.
    const rueTicket = adr.split(cp)[0].replace(/[,\s]+$/, '');
    const complete = [m.adresse, [m.code_postal, m.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const sim = Math.max(
      similariteTrigramme(adr, m.adresse),
      rueTicket ? similariteTrigramme(rueTicket, m.adresse) : 0,
      similariteTrigramme(adr, complete),
    );
    if (sim > meilleureSim) { meilleureSim = sim; meilleur = m; }
  }
  return meilleureSim >= SEUIL_MAGASIN_PROCHE ? meilleur : null;
}

// Faut-il afficher la carte « Nouveau magasin détecté » ?
//   - nom ET adresse lus sur le ticket (sinon : comportement d'avant) ;
//   - liste des magasins connue (pas pendant le chargement) ;
//   - aucun magasin connu proche.
export function doitProposerNouveauMagasin({ nom, adresse, enseigneId, magasins }) {
  try {
    if (!String(nom ?? '').trim() || !String(adresse ?? '').trim()) return false;
    if (!Array.isArray(magasins)) return false;
    return magasinConnuPourTicket({ adresse, enseigneId, magasins }) === null;
  } catch (e) {
    console.error('[C115] détection nouveau magasin', e);
    return false;
  }
}
