// Chantier 120 — Importer un ticket depuis un fichier (image longue, PDF) ou
// plusieurs captures d'écran. SHADOW (François seul). Logique PURE : ni
// React, ni Supabase, ni réseau, ni canvas. Partagée avec le banc d'essai
// local de l'Edge Function (scripts/tester-scan-ticket.ts).
//
// Tout l'aval reste celui du scan photo : le résultat lu part dans
// ImportTicketSheet (contrôle 108, magasin 115, partage, enregistrer_ticket_core).
// Ce module ne décide que de ce qui se passe AVANT : bornes, découpage d'une
// image longue, date du ticket (6 mois), valeurs par défaut quand la v13 de
// l'Edge Function répond encore.

export const MAX_PAGES_PDF = 10;
export const MAX_IMAGES = 15;
export const MAX_OCTETS_IMAGE = 6 * 1024 * 1024;
export const MOIS_MAX_TICKET = 6;

export const MESSAGE_PDF_ILLISIBLE = "Impossible de lire ce PDF, essaie une capture d'écran";
export const MESSAGE_TICKET_TROP_ANCIEN = 'Ce ticket a plus de 6 mois, ses prix ne sont plus comparables';

// ── Image longue (Lidl Plus, capture défilante) ────────────────────────────
// La compression du scan photo ramène le plus grand côté à 2000 px : une
// capture de 1170 × 9000 px finirait à 260 px de large, illisible. Au-delà
// d'un rapport hauteur/largeur de 3, on DÉCOUPE donc l'image en morceaux
// consécutifs qui se recouvrent (12 %), chacun ensuite compressé comme une
// photo. L'Edge Function v14 sait recoller des morceaux qui se recouvrent.
// Renvoie la liste des bandes [{ y, h }] en pixels de l'image d'origine.
export function decouperImageLongue(largeur, hauteur, { ratioMax = 3, hauteurRelative = 1.6, recouvrement = 0.12 } = {}) {
  const L = Number(largeur), H = Number(hauteur);
  if (!(L > 0) || !(H > 0)) return [];
  if (H / L <= ratioMax) return [{ y: 0, h: H }];
  const hBande = Math.round(L * hauteurRelative);
  const pas = Math.max(1, Math.round(hBande * (1 - recouvrement)));
  const bandes = [];
  for (let y = 0; y < H; y += pas) {
    const h = Math.min(hBande, H - y);
    bandes.push({ y, h });
    if (y + h >= H) break;
  }
  // Une dernière bande minuscule ne porte rien d'utile : on la fond dans la
  // précédente (qui s'allonge jusqu'au bas de l'image).
  if (bandes.length >= 2 && bandes[bandes.length - 1].h < hBande * 0.25) {
    const der = bandes.pop();
    const prec = bandes[bandes.length - 1];
    prec.h = der.y + der.h - prec.y;
  }
  return bandes;
}

// ── Bornes ─────────────────────────────────────────────────────────────────
export function octetsBase64(b64) {
  const s = String(b64 || '');
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(s.length * 3 / 4) - pad);
}

// Vérifie la liste d'images prêtes à partir. Renvoie null si tout va bien,
// sinon le message à afficher.
export function verifierBornesImport(images) {
  const liste = Array.isArray(images) ? images : [];
  if (liste.length === 0) return 'Ajoute au moins une image ou un PDF.';
  if (liste.length > MAX_IMAGES) return `Trop d'images (${liste.length}) : ${MAX_IMAGES} maximum. Retire les morceaux inutiles (avantages fidélité, pied de ticket…).`;
  const trop = liste.findIndex(im => octetsBase64(im?.base64) > MAX_OCTETS_IMAGE);
  if (trop >= 0) return `L'image ${trop + 1} dépasse 6 Mo après compression : recadre-la ou découpe-la.`;
  return null;
}

// ── Réordonner / retirer (vignettes) ───────────────────────────────────────
export function deplacer(liste, index, sens) {
  const l = [...(liste || [])];
  const cible = index + sens;
  if (index < 0 || index >= l.length || cible < 0 || cible >= l.length) return l;
  [l[index], l[cible]] = [l[cible], l[index]];
  return l;
}

export function retirer(liste, index) {
  return (liste || []).filter((_, i) => i !== index);
}

// ── Réponse de l'Edge Function ─────────────────────────────────────────────
// v13 encore déployée : pas de `remise`, pas de `captures_peut_etre_incompletes`
// -> valeurs par défaut, aucune erreur. Une remise écrite négative (« -2,15 »)
// devient positive, comme le fait la v14 côté serveur.
export function normaliserResultatImport(resultat) {
  if (!resultat || typeof resultat !== 'object') return resultat;
  const remise = (v) => {
    const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
    return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) / 100 : 0;
  };
  return {
    ...resultat,
    products: Array.isArray(resultat.products)
      ? resultat.products.map(p => (p && typeof p === 'object' ? { ...p, remise: remise(p.remise) } : p))
      : resultat.products,
    captures_peut_etre_incompletes: resultat.captures_peut_etre_incompletes === true,
  };
}

// ── Date du ticket ─────────────────────────────────────────────────────────
// « YYYY-MM-DD » -> Date à midi UTC (même convention que le chantier 108).
function lireDateIso(texte) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texte || '').trim());
  if (!m) return null;
  const [, a, mo, j] = m.map(Number);
  const d = new Date(Date.UTC(a, mo - 1, j, 12));
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== j) return null;
  return d;
}

// Date limite : il y a 6 mois jour pour jour (le 31/08 - 6 mois = 28/02 ou 29/02).
export function dateLimiteIso(aujourdHui = new Date()) {
  const a = aujourdHui.getFullYear(), m = aujourdHui.getMonth(), j = aujourdHui.getDate();
  const cible = new Date(Date.UTC(a, m - MOIS_MAX_TICKET, 1, 12));
  const dernierJour = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0, 12)).getUTCDate();
  cible.setUTCDate(Math.min(j, dernierJour));
  return cible.toISOString().slice(0, 10);
}

// Garde-fou d'import, AVANT tout magasin et toute écriture :
//   'manquante'     -> demander la date à l'utilisateur ;
//   'trop_ancienne' -> on s'arrête (la base refuserait de toute façon) ;
//   'ok'            -> on continue (un ticket « du futur » reste l'affaire du
//                      contrôle de date du chantier 108, inchangé).
// La limite est inclusive : un ticket daté pile d'il y a 6 mois passe.
export function verifierDateImport(dateLue, aujourdHui = new Date()) {
  const d = lireDateIso(dateLue);
  if (!d) return { statut: 'manquante', date: null };
  const limite = dateLimiteIso(aujourdHui);
  if (String(dateLue).slice(0, 10) < limite) return { statut: 'trop_ancienne', date: String(dateLue).slice(0, 10), limite };
  return { statut: 'ok', date: String(dateLue).slice(0, 10), limite };
}

// ── Remise d'une ligne ─────────────────────────────────────────────────────
// « 4,29 € → 2,14 € (−2,15 €) ». null quand il n'y a pas de remise. Le
// montant AVANT remise est le total de la ligne (prix × quantité).
const euros = (n) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;

export function affichageRemise(totalLigne, remise) {
  const brut = Number(totalLigne);
  const r = Number(remise);
  if (!Number.isFinite(brut) || !Number.isFinite(r) || r <= 0) return null;
  const net = Math.max(0, brut - r);
  return `${euros(brut)} → ${euros(net)} (−${euros(r)})`;
}

// Total d'une ligne lue (même règle que le chantier 108 : total, sinon
// prix × quantité).
export function totalLigneLue(p) {
  const t = Number(p?.total);
  if (Number.isFinite(t) && t > 0) return t;
  const prix = Number(p?.price);
  const q = Number(p?.qty);
  if (!Number.isFinite(prix) || prix <= 0) return 0;
  return Number.isFinite(q) && q > 0 ? prix * q : prix;
}
