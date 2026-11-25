// Chantier 171 — Annuaire des magasins (table `annuaire_magasins`, 20 115
// magasins de France : OpenStreetMap + Base Adresse Nationale, lecture seule).
//
// But (inquiétude de François, 25/11) : ne plus demander l'adresse d'un
// nouveau magasin. À l'étape magasin du scan, quand le magasin du ticket est
// inconnu, on propose les magasins de la même enseigne dans la ville du ticket
// (ou autour du téléphone, « 📍 Je suis dans ce magasin ») : un appui suffit.
//
// Les fonctions pures ne throw jamais ; les recherches renvoient [] en cas de
// panne (l'écran retombe alors sur la saisie d'avant).
import { supabase } from './supabase';
import { normaliserVille, extraireCodePostal, similariteTrigramme } from './nouveauMagasinTicket';
import { idEnseigneDepuisSlug } from './enseignesMagasin';

// Mêmes règles que celles du chargement de l'annuaire (25/11) : enseigne lue
// sur le ticket → slug de l'annuaire.
const REGLES = [
  [/carrefour/, 'carrefour'], [/auchan|simply market/, 'auchan'], [/leclerc/, 'leclerc'],
  [/intermarche|ecomarche/, 'intermarche'], [/^u express\b|\bu express\b/, 'u-express'], [/^utile\b/, 'utile'],
  [/^(hyper u|super u|marche u|u)$|systeme u|\bsuper u\b|\bhyper u\b/, 'systeme-u'],
  [/^lidl|\blidl\b/, 'lidl'], [/^aldi|\baldi\b/, 'aldi'], [/^netto|\bnetto\b/, 'netto'], [/leader price/, 'leader-price'],
  [/^monop|\bmonoprix\b/, 'monoprix'], [/franprix/, 'franprix'], [/\bvival\b/, 'vival'], [/casino/, 'casino'],
  [/^spar\b|\bspar\b/, 'spar'], [/^proxi\b/, 'proxi'], [/coccinelle|cocci.?market/, 'coccinelle'],
  [/^g ?20\b/, 'g20'], [/^(8|huit) a huit/, '8-a-huit'], [/^diagonal\b/, 'diagonal'], [/^sitis\b/, 'sitis'],
  [/^cora\b/, 'cora'], [/^(supermarche )?match\b/, 'match'], [/colruyt/, 'colruyt'], [/grand frais/, 'grand-frais'],
  [/supeco/, 'supeco'], [/^norma\b/, 'norma'], [/costco/, 'costco'],
];

// Identifiants « legacy » de l'app qui n'ont pas le même nom dans l'annuaire.
const ALIAS_ID = { superu: 'systeme-u', hyperu: 'systeme-u', systemeu: 'systeme-u', simply: 'auchan', uexpress: 'u-express', leaderprice: 'leader-price' };

const sansAccents = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Slug d'annuaire pour le ticket : d'abord le nom lu (plus précis), sinon
// l'identifiant d'enseigne de l'app. null si rien de reconnu.
export function enseigneAnnuaire(nomTicket, enseigneId) {
  try {
    const n = sansAccents(nomTicket);
    if (n) for (const [re, slug] of REGLES) if (re.test(n)) return slug;
    const id = idEnseigneDepuisSlug(enseigneId);
    if (!id || id === 'autre') return null;
    if (ALIAS_ID[id]) return ALIAS_ID[id];
    for (const [, slug] of REGLES) if (idEnseigneDepuisSlug(slug) === id) return slug;
    return null;
  } catch { return null; }
}

// Code postal et ville lus dans l'adresse du ticket (ou la ville seule).
export function lieuDuTicket(adresse) {
  try {
    const t = String(adresse ?? '').trim();
    if (!t) return { cp: null, ville: null };
    const cp = extraireCodePostal(t);
    let ville = null;
    if (cp) ville = (t.split(cp)[1] || '').replace(/^[,\s]+/, '').replace(/,?\s*france$/i, '').trim() || null;
    else ville = t.split(',').pop().replace(/\d+/g, ' ').trim() || null;
    const v = ville ? normaliserVille(ville) : null;
    return { cp, ville: v && v.length >= 2 ? v : null };
  } catch { return { cp: null, ville: null }; }
}

export function distanceMetres(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const r = Math.PI / 180;
  const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.round(Math.sqrt(x * x + y * y) * 6371000);
}

// « 210 Avenue de Brédasque, 13090 Aix-en-Provence ». Adresse complétée par la
// Base Adresse Nationale = adresse la plus proche du point → « près du … ».
export function libelleAnnuaire(l) {
  if (!l) return '';
  const lieu = [l.code_postal, l.ville].filter(Boolean).join(' ');
  if (!l.adresse) return lieu;
  const rue = l.adresse_source === 'ban' ? `près du ${l.adresse}` : l.adresse;
  return [rue, lieu].filter(Boolean).join(', ');
}

// Adresse envoyée à la création du magasin (sans « près du »).
export function adressePourCreation(l) {
  if (!l) return '';
  return [l.adresse, [l.code_postal, l.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

// Tri : par distance au téléphone si on l'a, sinon par ressemblance avec la
// rue lue sur le ticket, sinon par nom. Garde au plus `max` lignes.
export function classerCandidats(lignes, { adresseTicket = null, position = null, max = 5 } = {}) {
  try {
    if (!Array.isArray(lignes)) return [];
    const rue = String(adresseTicket ?? '').split(/\b\d{5}\b/)[0].trim();
    const avecScore = lignes.filter(Boolean).map((l) => ({
      ...l,
      distance: position ? distanceMetres(position, { lat: l.latitude, lon: l.longitude }) : null,
      ressemblance: rue && /[a-z]{3}/i.test(rue) && l.adresse ? similariteTrigramme(rue, l.adresse) : 0,
    }));
    avecScore.sort((a, b) => {
      if (position) return (a.distance ?? 1e9) - (b.distance ?? 1e9);
      if (b.ressemblance !== a.ressemblance) return b.ressemblance - a.ressemblance;
      return String(a.adresse ?? '').localeCompare(String(b.adresse ?? ''));
    });
    return avecScore.slice(0, max);
  } catch { return []; }
}

// Motif ILIKE tolérant aux accents et aux tirets : « aix en provence » →
// « _ix__n_pr_v_n__ » (les voyelles et le c peuvent être accentués dans la
// base). Trop large exprès : on refiltre ensuite à l'identique.
export function motifVille(villeNormalisee) {
  return String(villeNormalisee ?? '').replace(/[aeiouyc]/g, '_').replace(/[^a-z0-9_]/g, '_');
}

const COLONNES = 'osm_id,enseigne_slug,enseigne_nom,format,nom,adresse,code_postal,ville,adresse_source,latitude,longitude';

// Magasins de l'enseigne dans le lieu du ticket (code postal, sinon ville).
export async function chercherDansLaVille({ slug, cp, ville }) {
  if (!slug || (!cp && !ville)) return [];
  try {
    if (cp) {
      const { data, error } = await supabase.from('annuaire_magasins').select(COLONNES)
        .eq('enseigne_slug', slug).eq('code_postal', cp).limit(40);
      if (!error && Array.isArray(data) && data.length) return data;
    }
    if (ville) {
      const { data, error } = await supabase.from('annuaire_magasins').select(COLONNES)
        .eq('enseigne_slug', slug).ilike('ville', motifVille(ville)).limit(80);
      if (error || !Array.isArray(data)) return [];
      return data.filter((l) => normaliserVille(l.ville) === ville);
    }
    return [];
  } catch (e) { console.error('[171] annuaire (ville)', e); return []; }
}

// Magasins de l'enseigne autour d'une position (environ 2 km).
export async function chercherAutour({ slug, position, rayonMetres = 2000 }) {
  if (!position || position.lat == null) return [];
  try {
    const dLat = rayonMetres / 111000;
    const dLon = rayonMetres / (111000 * Math.cos((position.lat * Math.PI) / 180));
    let q = supabase.from('annuaire_magasins').select(COLONNES)
      .gte('latitude', position.lat - dLat).lte('latitude', position.lat + dLat)
      .gte('longitude', position.lon - dLon).lte('longitude', position.lon + dLon).limit(60);
    if (slug) q = q.eq('enseigne_slug', slug);
    const { data, error } = await q;
    if (error || !Array.isArray(data)) return [];
    return data.filter((l) => (distanceMetres(position, { lat: l.latitude, lon: l.longitude }) ?? 1e9) <= rayonMetres);
  } catch (e) { console.error('[171] annuaire (autour)', e); return []; }
}

// Position du téléphone (null si refusée, absente ou trop lente).
export function positionDuTelephone(delaiMs = 10000) {
  return new Promise((resolve) => {
    try {
      if (typeof navigator === 'undefined' || !navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, precision: p.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: delaiMs, maximumAge: 60000 },
      );
    } catch { resolve(null); }
  });
}

// Chantier 187 — « Je fais mes courses dans un autre magasin » : les magasins
// de l'annuaire les plus proches d'une position (toutes enseignes), triés par
// distance. `position` : { lat, lon }. Chaque ligne reçoit `distance` (m).
export function plusProches(lignes, position, max = 10) {
  return (Array.isArray(lignes) ? lignes : [])
    .filter(l => l && l.latitude != null && l.longitude != null)
    .map(l => ({ ...l, distance: distanceMetres(position, { lat: Number(l.latitude), lon: Number(l.longitude) }) }))
    .filter(l => l.distance != null)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, max);
}

export function texteDistance(m) {
  if (m == null) return '';
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}
