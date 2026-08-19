// Chantier 97 — Sélection du magasin CORE obligatoire et intelligente AVANT
// l'import du ticket. Ce module porte toute la logique du sélecteur :
//   - chargement des magasins Core actifs (RLS : lecture authentifiée) ;
//   - magasins « habituels » de l'utilisateur (fréquence dans ses tickets et
//     sessions de courses, RLS scope déjà sur ses propres lignes) ;
//   - classement habituels / à proximité (haversine) / autres ;
//   - recherche par nom, enseigne, code postal, ville (accents ignorés) ;
//   - position appareil SANS popup surprise (GPS seulement si la permission
//     est déjà accordée), repli sur la zone utilisateur (chantier 81) géré
//     par l'appelant ;
//   - correspondance magasin Core -> fiche legacy `stores` (cohérence du
//     circuit legacy avec le magasin Core validé).
// Aucune fonction ne throw : toute indisponibilité (Supabase, GPS) retombe
// sur une valeur neutre ([], null, Map vide) — jamais de blocage de l'app.
import { supabase } from './supabase';

// Distance haversine en kilomètres entre deux points { lat, lng }.
// Renvoie null si une coordonnée manque ou n'est pas numérique.
export function distanceKm(a, b) {
  // NB : Number(null) vaut 0 — les coordonnées absentes doivent être écartées
  // AVANT la conversion numérique.
  const coord = (v) => (v == null || v === '' ? NaN : Number(v));
  const lat1 = coord(a?.lat), lng1 = coord(a?.lng);
  const lat2 = coord(b?.lat), lng2 = coord(b?.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function formaterDistance(km) {
  if (km == null || !Number.isFinite(km)) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1).replace('.', ',')} km`;
}

// "adresse, CP ville" en sautant proprement les morceaux absents.
export function formaterAdresseMagasin(m) {
  const cpVille = [m?.code_postal, m?.ville].filter(Boolean).join(' ');
  return [m?.adresse, cpVille].filter(Boolean).join(', ');
}

export async function chargerMagasinsCoreActifs() {
  try {
    const { data, error } = await supabase
      .from('magasins')
      .select('id, nom, adresse, code_postal, ville, latitude, longitude, enseigne_id, enseignes(nom, slug)')
      .eq('statut', 'actif')
      .order('nom');
    if (error) { console.error('[C97] chargement magasins Core', error); return []; }
    return data || [];
  } catch (e) {
    console.error('[C97] chargement magasins Core (exception)', e);
    return [];
  }
}

// Fréquences d'usage par magasin Core : tickets + sessions de courses de
// l'utilisateur (RLS restreint déjà à ses propres lignes), les plus récents
// d'abord, plafonnés pour rester léger.
export async function chargerFrequencesMagasins({ utilisateurId = null } = {}) {
  const compte = new Map();
  try {
    // Chantier 108b — les PRIX RELEVÉS comptent au même titre que les tickets
    // et les sessions. Constat : le Netto de François porte 39 prix relevés et
    // zéro ticket, donc il n'apparaissait pas dans ses magasins habituels et il
    // devait le chercher dans la liste complète au moment du scan. Un magasin
    // où l'on relève des prix est un magasin où l'on va.
    //
    // Scopé à l'utilisateur EXPRÈS : la RLS de `prix` laisse lire tous les prix
    // validés de la communauté, donc sans ce filtre les magasins les plus
    // relevés de France deviendraient « habituels » pour tout le monde.
    // tickets et sessions_courses, eux, sont déjà scopés par leur propre RLS.
    // L'identifiant est résolu ici quand l'appelant ne le passe pas (getSession
    // est local, pas un aller-retour réseau). Introuvable ou erreur : on ne
    // compte que les deux sources d'avant, comportement strictement inchangé.
    let idUtilisateur = utilisateurId;
    if (!idUtilisateur) {
      try {
        const { data } = await supabase.auth.getSession();
        idUtilisateur = data?.session?.user?.id ?? null;
      } catch (e) {
        console.error('[C108b] identifiant utilisateur indisponible', e);
        idUtilisateur = null;
      }
    }

    const requetes = [
      supabase.from('tickets').select('magasin_id')
        .not('magasin_id', 'is', null)
        .order('cree_le', { ascending: false }).limit(200),
      supabase.from('sessions_courses').select('magasin_id')
        .not('magasin_id', 'is', null)
        .order('cree_le', { ascending: false }).limit(200),
    ];
    if (idUtilisateur) {
      requetes.push(
        supabase.from('prix').select('magasin_id')
          .eq('utilisateur_id', idUtilisateur)
          .not('magasin_id', 'is', null)
          .order('observe_le', { ascending: false }).limit(200)
      );
    }
    const reponses = await Promise.all(requetes);
    for (const reponse of reponses) {
      for (const r of (reponse?.data || [])) {
        if (r?.magasin_id) compte.set(r.magasin_id, (compte.get(r.magasin_id) || 0) + 1);
      }
    }
  } catch (e) {
    console.error('[C97] fréquences magasins', e);
  }
  return compte;
}

// Classement : habituels (fréquence décroissante), puis les plus proches par
// GPS (hors habituels, si position dispo), puis les autres par nom. Chaque
// magasin de « proches » porte distance_km. Sans position ni historique, tout
// atterrit simplement dans autres — jamais de blocage.
export function classerMagasins({ magasins = [], frequences = new Map(), position = null, maxHabituels = 4, maxProches = 3 } = {}) {
  const parNom = (x, y) => String(x.nom || '').localeCompare(String(y.nom || ''), 'fr');

  const habituels = magasins
    .filter(m => (frequences.get(m.id) || 0) > 0)
    .sort((x, y) => (frequences.get(y.id) || 0) - (frequences.get(x.id) || 0) || parNom(x, y))
    .slice(0, maxHabituels);
  const dejaPris = new Set(habituels.map(m => m.id));

  let proches = [];
  if (position && Number.isFinite(Number(position.lat)) && Number.isFinite(Number(position.lng))) {
    proches = magasins
      .filter(m => !dejaPris.has(m.id))
      .map(m => ({ ...m, distance_km: distanceKm(position, { lat: m.latitude, lng: m.longitude }) }))
      .filter(m => m.distance_km != null)
      .sort((x, y) => x.distance_km - y.distance_km)
      .slice(0, maxProches);
    proches.forEach(m => dejaPris.add(m.id));
  }

  const autres = magasins.filter(m => !dejaPris.has(m.id)).sort(parNom);
  return { habituels, proches, autres };
}

const normaliserTexte = (t) => String(t || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .trim();

// Recherche par nom d'enseigne / nom de magasin / code postal / ville / adresse.
export function filtrerMagasins(magasins = [], recherche = '') {
  const q = normaliserTexte(recherche);
  if (!q) return magasins;
  return magasins.filter(m =>
    [m.nom, m.ville, m.code_postal, m.adresse, m.enseignes?.nom]
      .some(v => normaliserTexte(v).includes(q)));
}

// Position de l'appareil SANS popup de permission surprise : on n'interroge le
// GPS que si la permission est déjà accordée (permissions.query). Tout refus,
// timeout, contexte non sécurisé ou API absente -> null, jamais d'exception.
export async function obtenirPositionAppareil({ timeoutMs = 2500 } = {}) {
  try {
    if (typeof navigator === 'undefined' || !navigator.geolocation?.getCurrentPosition) return null;
    if (!navigator.permissions?.query) return null;
    const perm = await navigator.permissions.query({ name: 'geolocation' });
    if (perm?.state !== 'granted') return null;
    return await new Promise((resolve) => {
      let fini = false;
      const finir = (v) => { if (!fini) { fini = true; resolve(v); } };
      const garde = setTimeout(() => finir(null), timeoutMs + 500);
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => { clearTimeout(garde); finir({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
          () => { clearTimeout(garde); finir(null); },
          { timeout: timeoutMs, maximumAge: 120000 }
        );
      } catch { clearTimeout(garde); finir(null); }
    });
  } catch {
    return null;
  }
}

// Fiche legacy `stores` correspondant à un magasin Core (pour que le circuit
// legacy — price_db / community_prices — reste taggé sur le MÊME magasin que
// le Core validé). Best effort : null si pas de correspondance ou erreur.
export async function trouverStoreLegacyPourMagasin(magasinId) {
  if (!magasinId) return null;
  try {
    const { data, error } = await supabase
      .from('correspondance_magasins')
      .select('store_id_legacy')
      .eq('magasin_id', magasinId)
      .limit(1);
    if (error || !data?.length) return null;
    return data[0].store_id_legacy ?? null;
  } catch {
    return null;
  }
}
