// Chantier 83 « Photos produits » — SHADOW.
// Récupère la photo d'un produit via son code-barres (EAN) : Open Food Facts
// (API v2 publique, CORS OK) pour l'URL, Cloudinary en mode "fetch" pour
// l'optimisation/redimensionnement. Aucune clé, aucun SDK, aucune écriture.
//
// Règle d'or : ne JAMAIS casser l'app. Toute erreur réseau / absence de donnée
// renvoie null → l'appelant garde son placeholder/fallback existant.
import { supabase } from './supabase';

// Cloud name Cloudinary public (ok en dur).
export const CLOUDINARY_CLOUD_NAME = 'dur9hgqr';

const offUrl = (ean) =>
  `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json?fields=image_front_small_url,image_front_url`;

// Caches mémoire (par session) : évitent de rappeler OFF ou la base deux fois.
const cacheOff = new Map(); // ean -> { small: url|null, large: url|null }
const cacheEan = new Map(); // varianteId -> ean|null

// Construit l'URL Cloudinary fetch (optimise une image distante OFF).
// taille : 'thumb' (vignette 160x160 pad) ou 'large' (fiche 600 large pad).
export function cloudinaryFetch(urlOff, taille) {
  if (!urlOff) return null;
  const transfo = taille === 'large'
    ? 'f_auto,q_auto,w_600,c_pad,b_white'
    : 'f_auto,q_auto,w_160,h_160,c_pad,b_white';
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/fetch/${transfo}/${encodeURIComponent(urlOff)}`;
}

// EAN d'une variante : la base gère des codes-barres MULTIPLES par variante
// (table codes_barres_variante). On prend le premier disponible, le "principal"
// en priorité. null si aucun code-barres (→ pas d'appel réseau côté appelant).
export async function eanDeVariante(varianteId) {
  if (!varianteId) return null;
  if (cacheEan.has(varianteId)) return cacheEan.get(varianteId);
  let ean = null;
  try {
    const { data, error } = await supabase
      .from('codes_barres_variante')
      .select('code_barres, est_principal')
      .eq('variante_produit_id', varianteId)
      .order('est_principal', { ascending: false })
      .limit(1);
    if (!error && data && data[0]?.code_barres) ean = data[0].code_barres;
  } catch {
    ean = null;
  }
  cacheEan.set(varianteId, ean);
  return ean;
}

// Photos OFF (URLs brutes) d'un EAN. status==1 + champ image présent → URLs,
// sinon { small:null, large:null } (status!=1, champ absent, ou erreur réseau).
export async function photosOFF(ean) {
  if (!ean) return { small: null, large: null };
  if (cacheOff.has(ean)) return cacheOff.get(ean);
  let res = { small: null, large: null };
  try {
    const r = await fetch(offUrl(ean));
    if (r.ok) {
      const j = await r.json();
      if (j && j.status === 1 && j.product) {
        res = {
          small: j.product.image_front_small_url || null,
          large: j.product.image_front_url || null,
        };
      }
    }
  } catch {
    /* réseau KO → fallback (res reste { null, null }) */
  }
  cacheOff.set(ean, res);
  return res;
}

// URL finale (Cloudinary) pour une variante + taille. null si pas de code-barres
// ou pas de photo OFF : l'appelant garde alors son fallback (emoji / carré).
export async function urlPhotoVariante(varianteId, taille) {
  const ean = await eanDeVariante(varianteId);
  if (!ean) return null;
  const off = await photosOFF(ean);
  // Vignette depuis small, fiche depuis large ; repli sur l'autre si absent.
  const source = taille === 'large' ? (off.large || off.small) : (off.small || off.large);
  return cloudinaryFetch(source, taille);
}

// Chantier 83 (ajustement) — agrandi/lightbox de la fiche produit.
// URL OFF brute "large" (image_front_url, repli small) d'une variante, null si
// aucune photo. Sert de base à la version pleine résolution ci-dessous.
export async function offLargeSource(varianteId) {
  const ean = await eanDeVariante(varianteId);
  if (!ean) return null;
  const off = await photosOFF(ean);
  return off.large || off.small || null;
}

// Pleine résolution OFF : remplace le segment de taille final (.100/.200/.400)
// par .full.jpg (la version .full existe et est nette). Inchangé si le motif
// n'est pas trouvé.
export function offFullUrl(offUrl) {
  if (!offUrl) return null;
  return offUrl.replace(/\.(100|200|400)\.jpg$/, '.full.jpg');
}

// Cloudinary pour l'agrandi : c_limit (n'agrandit jamais au-delà de la source),
// pas de fond blanc forcé. URL OFF passée en encodeURIComponent.
export function cloudinaryAgrandi(offUrl) {
  if (!offUrl) return null;
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/fetch/f_auto,q_auto,c_limit,w_1000/${encodeURIComponent(offUrl)}`;
}
