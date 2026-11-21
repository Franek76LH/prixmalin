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
import { coeurDeRue } from './adresseMagasin';

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

// ── Chantier 165 — tickets SANS adresse imprimée ───────────────────────────
// Constat réel (Auchan Aix, 21/11) : le ticket n'imprime que la ville. La
// carte « Nouveau magasin détecté » exigeait une adresse : impasse, rien
// d'enregistré. Désormais, sans code postal, on raisonne sur ENSEIGNE + VILLE.

// « AIX-EN-PROVENCE », « Aix en Provence » → « aix en provence ».
export function normaliserVille(v) {
  return String(v ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\b(cedex|france)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

// Ville seule lue sur le ticket : texte sans code postal ni chiffre (sinon
// c'est une adresse, traitée comme avant). null si rien d'exploitable.
export function villeSansAdresse(adresse) {
  const t = String(adresse ?? '').trim();
  if (!t || /\d/.test(t)) return null;
  const v = normaliserVille(t);
  return v.length >= 2 ? v : null;
}

// Magasins de la MÊME enseigne (connue) dans la même ville.
export function magasinsEnseigneVille({ ville, enseigneId, magasins }) {
  const ens = idEnseigneDepuisSlug(enseigneId);
  const v = normaliserVille(ville);
  if (!ens || ens === 'autre' || !v || !Array.isArray(magasins)) return [];
  return magasins.filter((m) => m
    && idEnseigneDepuisSlug(m?.enseignes?.slug) === ens
    && (normaliserVille(m.ville) === v
      || (!m.ville && m.adresse && normaliserVille(m.adresse).endsWith(v))));
}

// Magasin connu le plus proche de l'adresse du ticket (même règle que la RPC),
// ou null. `enseigneId` : identifiant d'enseigne du ticket ("utile", "autre"…).
export function magasinConnuPourTicket({ adresse, enseigneId, magasins }) {
  const adr = String(adresse ?? '').trim();
  const cp = extraireCodePostal(adr);
  // Chantier 165 — ville seule : connu s'il existe déjà un magasin de la même
  // enseigne dans cette ville (pas de carte « nouveau » : on choisit).
  if (!cp) {
    const ville = villeSansAdresse(adr);
    const memes = ville ? magasinsEnseigneVille({ ville, enseigneId, magasins }) : [];
    return memes[0] || null;
  }
  if (!adr || !Array.isArray(magasins)) return null;

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
//   - nom lu sur le ticket ;
//   - adresse lue, OU (chantier 165) pas d'adresse mais une enseigne connue :
//     la carte demande alors la ville (et l'adresse si on la connaît) ;
//   - liste des magasins connue (pas pendant le chargement) ;
//   - aucun magasin connu proche (même adresse, ou même enseigne dans la même
//     ville quand le ticket n'imprime que la ville).
export function doitProposerNouveauMagasin({ nom, adresse, enseigneId, magasins }) {
  try {
    if (!String(nom ?? '').trim()) return false;
    if (!Array.isArray(magasins)) return false;
    if (!String(adresse ?? '').trim()) {
      const ens = idEnseigneDepuisSlug(enseigneId);
      return !!ens && ens !== 'autre';
    }
    return magasinConnuPourTicket({ adresse, enseigneId, magasins }) === null;
  } catch (e) {
    console.error('[C115] détection nouveau magasin', e);
    return false;
  }
}

// ── Présélection du magasin reconnu (validée le 11/11, change la règle du
//    chantier 97 « l'utilisateur choisit toujours ») ─────────────────────────
// Constat : ticket Utile lu « UTILE AIX EN PROVENCE, 68, BD DU ROY RENE, 13100
// AIX-EN-PROVENCE » ; le magasin existe, mais l'étape magasin attendait un
// choix manuel et Utile n'apparaissait ni dans les habituels ni à proximité.
//
// On présélectionne UNIQUEMENT quand la correspondance est SÛRE :
//   - enseigne du ticket connue (pas « autre ») et magasin de la MÊME enseigne ;
//   - même code postal ;
//   - adresse au-dessus du seuil de RATTACHEMENT AUTOMATIQUE de la base (0,85,
//     et non 0,70 qui est le bas de la zone grise) ;
//   - et UN SEUL magasin remplit tout ça.
// Au moindre doute : null, et l'écran reste celui d'avant. Pure, ne throw pas.
export const SEUIL_RATTACHEMENT_AUTO = 0.85;

function similariteAdresseTicket(adr, cp, m) {
  const rueTicket = adr.split(cp)[0].replace(/[,\s]+$/, '');
  const complete = [m.adresse, [m.code_postal, m.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return Math.max(
    similariteTrigramme(adr, m.adresse),
    rueTicket ? similariteTrigramme(rueTicket, m.adresse) : 0,
    similariteTrigramme(adr, complete),
  );
}

// Correctif 10h38 — le numéro et le type de voie sont les parties les plus
// souvent mal lues (« 68, BD » lu « ZAC RD » : ressemblance 0,73, pas de
// présélection). On compare donc AUSSI le nom de la rue seul (« du roy
// rene »), au même seuil de 0,85. Toutes les autres conditions restent :
// même enseigne connue, même code postal, un seul magasin. Le nom de rue doit
// garder au moins 4 lettres pour compter (« 13100 AIX » seul ne prouve rien).
const LETTRES_MIN_COEUR = 4;
function nomDeRueSemblable(adr, m) {
  const a = coeurDeRue(adr), b = coeurDeRue(m.adresse);
  if (a.replace(/[^a-z]/g, '').length < LETTRES_MIN_COEUR || b.replace(/[^a-z]/g, '').length < LETTRES_MIN_COEUR) return false;
  return similariteTrigramme(a, b) >= SEUIL_RATTACHEMENT_AUTO;
}

export function magasinReconnuPourTicket({ adresse, enseigneId, magasins }) {
  try {
    const adr = String(adresse ?? '').trim();
    const cp = extraireCodePostal(adr);
    // Chantier 165 — ticket qui n'imprime que la ville : présélection si UN
    // SEUL magasin de la même enseigne (connue) existe dans cette ville.
    if (!cp) {
      const ville = villeSansAdresse(adr);
      const memes = ville ? magasinsEnseigneVille({ ville, enseigneId, magasins }) : [];
      return memes.length === 1 ? memes[0] : null;
    }
    if (!adr || !cp || !Array.isArray(magasins)) return null;
    const ens = idEnseigneDepuisSlug(enseigneId);
    if (!ens || ens === 'autre') return null;
    const surs = magasins.filter((m) =>
      m && m.adresse
      && idEnseigneDepuisSlug(m?.enseignes?.slug) === ens
      && String(m.code_postal ?? '').trim() === cp
      && (similariteAdresseTicket(adr, cp, m) >= SEUIL_RATTACHEMENT_AUTO || nomDeRueSemblable(adr, m)));
    const ids = new Set(surs.map((m) => m.id));
    return ids.size === 1 ? surs[0] : null;
  } catch (e) {
    console.error('[présélection magasin]', e);
    return null;
  }
}
