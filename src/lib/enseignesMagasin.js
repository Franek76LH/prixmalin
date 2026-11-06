// Chantier 115 — Reconnaissance de l'enseigne d'un ticket à partir de la table
// `enseignes` (colonnes `nom`, `slug`) au lieu d'une liste figée.
//
// Constat : la liste en dur de storeIdFromName ignorait Utile, U Express et
// Leader Price, qui existent pourtant en base. Un ticket « UTILE AIX EN
// PROVENCE » retombait sur "autre" et le magasin était créé SANS enseigne.
//
// Règles :
//   - comparaison en minuscules, sans accents, ponctuation ignorée (« u express »
//     retrouve le slug « u-express ») ;
//   - correspondance par MOTS ENTIERS (« utile » ne matche pas « inutile ») ;
//   - la plus LONGUE l'emporte : « CARREFOUR CITY » donne « Carrefour City »
//     si elle existe, et seulement sinon « Carrefour » (un magasin de proximité
//     ne doit pas être rangé avec les hypermarchés, les prix diffèrent) ;
//   - SECOURS OBLIGATOIRE : table injoignable, vide, ou aucun nom reconnu
//     -> on retombe sur la liste en dur historique (storeIdFromNameSecours),
//     conservée telle quelle. Rien ici ne throw : le scan n'est jamais bloqué.
//
// Identifiant renvoyé : le slug de la table débarrassé de tout ce qui n'est pas
// alphanumérique ("u-express" -> "uexpress", "leader-price" -> "leaderprice").
// C'est la convention des identifiants legacy (superu, uexpress, hyperu…) et la
// RPC resoudre_ou_creer_magasin_core applique exactement la même normalisation
// pour retrouver l'enseigne_id : les deux circuits restent alignés.
import { supabase } from './supabase';

// Minuscules, sans accents, tout caractère non alphanumérique -> espace.
export function normaliserTexteEnseigne(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// "u-express" -> "uexpress" (même règle que la RPC côté SQL).
export function idEnseigneDepuisSlug(slug) {
  return String(slug ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Liste historique en dur — CONSERVÉE comme secours (ne pas supprimer).
export function storeIdFromNameSecours(n) {
  if(!n) return "autre";
  const s=n.toLowerCase();
  if(s.includes("leclerc"))   return "leclerc";
  if(s.includes("carrefour")) return "carrefour";
  if(s.includes("auchan"))    return "auchan";
  if(s.includes("lidl"))      return "lidl";
  if(s.includes("intermarché")||s.includes("intermarche")) return "intermarche";
  if(s.includes("monoprix"))  return "monoprix";
  if(s.includes("vival"))     return "vival";
  if(s.includes("spar"))      return "spar";
  if(s.includes("netto"))     return "netto";
  if(s.includes("franprix"))  return "franprix";
  if(s.includes("casino"))   return "casino";
  if(s.includes("super u")||s.includes("superu")) return "superu";
  if(s.includes("simply"))   return "simply";
  if(s.includes("bio c"))    return "biocbon";
  return "autre";
}

// Enseigne de la table présente dans le nom lu par l'OCR, la plus longue
// l'emportant. Renvoie { nom, slug, id } ou null.
export function trouverEnseigneDansNom(nomOcr, enseignes) {
  const texte = normaliserTexteEnseigne(nomOcr);
  if (!texte || !Array.isArray(enseignes) || enseignes.length === 0) return null;
  const borne = ` ${texte} `;
  let meilleure = null;
  let meilleureLongueur = 0;
  for (const e of enseignes) {
    if (!e) continue;
    // On essaie le nom ET le slug (« leader-price » -> « leader price »).
    for (const brut of [e.nom, e.slug]) {
      const cle = normaliserTexteEnseigne(brut);
      if (!cle) continue;
      if (borne.includes(` ${cle} `) && cle.length > meilleureLongueur) {
        meilleure = e;
        meilleureLongueur = cle.length;
      }
    }
  }
  if (!meilleure) return null;
  const id = idEnseigneDepuisSlug(meilleure.slug) || idEnseigneDepuisSlug(meilleure.nom);
  return id ? { nom: meilleure.nom, slug: meilleure.slug, id } : null;
}

// Identifiant d'enseigne d'un nom de ticket : table d'abord, liste en dur
// ensuite (enseigne absente de la table, ou table non chargée), "autre" sinon.
export function storeIdFromNameAvecEnseignes(n, enseignes) {
  if (!n) return "autre";
  try {
    const trouvee = trouverEnseigneDansNom(n, enseignes);
    if (trouvee) return trouvee.id;
  } catch (e) {
    console.error('[C115] correspondance enseigne', e);
  }
  return storeIdFromNameSecours(n);
}

// ── Cache module : la table est chargée une fois par session d'app ─────────
let enseignesCache = null;     // null = pas (encore) chargée -> secours
let chargementEnCours = null;  // promesse partagée entre appelants simultanés

export function enseignesEnCache() {
  return enseignesCache;
}

// Pour les tests uniquement.
export function definirEnseignesEnCache(liste) {
  enseignesCache = Array.isArray(liste) && liste.length > 0 ? liste : null;
}

// Ne throw jamais. Échec réseau / base / liste vide / délai dépassé : le cache
// reste null (=> liste en dur) et un appel ultérieur pourra réessayer.
export function chargerEnseignes({ timeoutMs = 3000 } = {}) {
  if (enseignesCache) return Promise.resolve(enseignesCache);
  if (chargementEnCours) return chargementEnCours;
  const requete = (async () => {
    try {
      const { data, error } = await supabase.from('enseignes').select('nom, slug');
      if (error) { console.error('[C115] chargement enseignes', error); return null; }
      const liste = (data || []).filter(e => e && (e.nom || e.slug));
      if (liste.length > 0) enseignesCache = liste;
      return enseignesCache;
    } catch (e) {
      console.error('[C115] chargement enseignes (exception)', e);
      return null;
    }
  })();
  const delai = new Promise(resolve => setTimeout(() => resolve(null), timeoutMs));
  chargementEnCours = Promise.race([requete, delai])
    .then(() => enseignesCache)
    .catch(() => enseignesCache)
    .finally(() => { chargementEnCours = null; });
  return chargementEnCours;
}

// Point d'entrée synchrone utilisé partout dans l'app.
export function storeIdFromName(n) {
  return storeIdFromNameAvecEnseignes(n, enseignesCache);
}
