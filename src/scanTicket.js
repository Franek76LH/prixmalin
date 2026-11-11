import { supabase } from "./lib/supabase";
import { badgeDepuisMethode } from "./lib/scanDepuisHistorique";
import { controlerCoherenceTicket, NIVEAU_OK, NIVEAU_AVERTISSEMENT, NIVEAU_BLOCAGE } from "./lib/coherenceTicket";
import { comparerLectures, lignesIncoherentes } from "./lib/lectureDouteuse";
import { detecterCadreTicket } from "./lib/cadreTicket";

// Correctif « scan anti-invention » — sur le serveur de dev UNIQUEMENT (mode
// 'development'), la lecture passe par la fonction de test locale servie par
// vite.config.js, qui exécute la nouvelle version du code de lecture. En
// production (mode 'production') et dans les tests (mode 'test'), rien ne
// change : appel de l'Edge Function scan-ticket.
const SCAN_TEST_LOCAL = import.meta.env.DEV && import.meta.env.MODE === "development";

async function appelerScanTicket(body) {
  if (SCAN_TEST_LOCAL) {
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch("/__scan-ticket-test", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error(data?.error || `Erreur HTTP ${r.status}`);
    return data;
  }
  const { data, error } = await supabase.functions.invoke("scan-ticket", { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

// Convertit n'importe quel format image (HEIC, PNG, WEBP…) en JPEG base64
// via canvas, avec redimensionnement si > 2000px pour limiter la taille du payload.
export function imageFileToJpegBase64(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 2000;
      let { naturalWidth: w, naturalHeight: h } = img;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else        { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.92).split(",")[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Impossible de lire l'image")); };
    img.src = url;
  });
}

// ── Correctif orientation (11/11) — remettre la photo debout AVANT l'envoi ──
// Constat : ticket posé à plat, iPhone tenu au-dessus -> la photo arrive
// souvent couchée (2000 × 1500) et le lecteur invente. Méthode : 4 miniatures
// de la photo, tournées de 0/90/180/270° (sens horaire), envoyées à la
// fonction (mode « orientation ») qui demande deux fois à un modèle rapide
// laquelle se lit à l'endroit. Accord certain -> on tourne la photo d'autant ;
// sinon -> « Reprends la photo, téléphone bien droit », RIEN ne part au
// lecteur. ~3 s et ~0,5 centime par photo.
export const COTE_MINIATURE_SENS = 768;

// Dimensions d'une image de w × h tournée de `rotation` degrés. Pure.
export function dimensionsTournees(w, h, rotation) {
  return rotation === 90 || rotation === 270 ? { largeur: h, hauteur: w } : { largeur: w, hauteur: h };
}

function chargerImageBase64(base64) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Impossible de lire l'image"));
    img.src = `data:image/jpeg;base64,${base64}`;
  });
}

// Dessine `img` tournée de `rotation` degrés (sens horaire), réduite pour que
// son plus grand côté ne dépasse pas `maxCote`, et renvoie le JPEG en base64.
function tournerImage(img, rotation, maxCote, qualite) {
  const echelle = Math.min(1, maxCote / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * echelle);
  const h = Math.round(img.naturalHeight * echelle);
  const { largeur, hauteur } = dimensionsTournees(w, h, rotation);
  const canvas = document.createElement("canvas");
  canvas.width = largeur; canvas.height = hauteur;
  const ctx = canvas.getContext("2d");
  ctx.translate(largeur / 2, hauteur / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return canvas.toDataURL("image/jpeg", qualite).split(",")[1];
}

// Demande à la fonction dans quel sens est la photo. Lève une Error en cas
// d'échec technique. -> { rotation: 0|90|180|270|null, certain: bool }
export async function verifierSensPhoto(base64, { recadrage = null } = {}) {
  const img = await chargerImageBase64(base64);
  const candidats = [0, 90, 180, 270].map(rotation => ({
    rotation,
    image: tournerImage(img, rotation, COTE_MINIATURE_SENS, 0.8),
  }));
  // `recadrage` ne sert qu'aux journaux (savoir si la photo a été recadrée).
  const data = await appelerScanTicket({ orientation: { candidats, recadrage } });
  const o = data?.orientation;
  return { rotation: o?.rotation ?? null, certain: o?.certain === true };
}

export async function tournerPhotoBase64(base64, rotation) {
  const img = await chargerImageBase64(base64);
  return tournerImage(img, rotation, 2000, 0.92);
}

// ── Correctif 9h58 — recadrer sur le ticket AVANT la lecture ───────────────
// Le service du lecteur réduit l'image à ~1,1 Mpx : un ticket qui n'occupe
// que la moitié de la photo devient illisible dans le détail (Leffe de 9h58).
// detecterCadreTicket (lib/cadreTicket.js, sans réseau) trouve le papier sur
// une miniature ; au moindre doute il renvoie null et la photo reste ENTIÈRE.
export const COTE_MINIATURE_CADRE = 256;

// -> { base64, cadre } : la photo recadrée et son cadre (fractions), ou la
// photo d'origine inchangée et cadre null.
export async function recadrerSurTicket(base64) {
  const img = await chargerImageBase64(base64);
  const k = Math.min(1, COTE_MINIATURE_CADRE / Math.max(img.naturalWidth, img.naturalHeight));
  const mw = Math.max(1, Math.round(img.naturalWidth * k)), mh = Math.max(1, Math.round(img.naturalHeight * k));
  const mini = document.createElement("canvas");
  mini.width = mw; mini.height = mh;
  const mctx = mini.getContext("2d", { willReadFrequently: true });
  mctx.drawImage(img, 0, 0, mw, mh);
  const cadre = detecterCadreTicket({ data: mctx.getImageData(0, 0, mw, mh).data, largeur: mw, hauteur: mh });
  if (!cadre) return { base64, cadre: null };
  const sx = Math.floor(cadre.gauche * img.naturalWidth), sy = Math.floor(cadre.haut * img.naturalHeight);
  const sw = Math.ceil(cadre.droite * img.naturalWidth) - sx, sh = Math.ceil(cadre.bas * img.naturalHeight) - sy;
  const canvas = document.createElement("canvas");
  canvas.width = sw; canvas.height = sh;
  canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return { base64: canvas.toDataURL("image/jpeg", 0.92).split(",")[1], cadre };
}

// Ne throw JAMAIS. Renvoie :
//   { statut: 'ok', base64, rotation }        photo debout (inchangée si 0)
//   { statut: 'sens_incertain' }              sens non établi avec certitude
//   { statut: 'service_indisponible', message } échec technique de la vérif
// `verifier` / `tourner` injectables pour les tests (pas de canvas sous Node).
// Correctif 9h58 — avant la vérification du sens, la photo est recadrée sur
// le ticket quand il est localisé avec certitude (sinon : photo entière).
// Le recadrage ne dépend pas du sens : le même cadre vaut dans les 4 sens.
// Un échec du recadrage n'empêche jamais le scan : photo entière.
export async function redresserPhoto(base64, { verifier = verifierSensPhoto, tourner = tournerPhotoBase64, recadrer = recadrerSurTicket } = {}) {
  let source = base64;
  let recadrage = null;
  try {
    const r = await recadrer(base64);
    if (r?.cadre && r.base64) { source = r.base64; recadrage = r.cadre; }
  } catch { /* photo entière */ }

  let sens;
  try {
    sens = await verifier(source, { recadrage });
  } catch (e) {
    return { statut: 'service_indisponible', message: e?.message || 'Service indisponible' };
  }
  if (!sens?.certain || ![0, 90, 180, 270].includes(sens.rotation)) return { statut: 'sens_incertain' };
  if (sens.rotation === 0) return { statut: 'ok', base64: source, rotation: 0, recadrage };
  try {
    return { statut: 'ok', base64: await tourner(source, sens.rotation), rotation: sens.rotation, recadrage };
  } catch {
    // Impossible de tourner l'image : on n'envoie pas une photo qu'on sait de travers.
    return { statut: 'sens_incertain' };
  }
}

// Chantier 96 — produits EXPLOITABLES d'un résultat de scan : un libellé et
// un prix strictement positif (mêmes critères que le filtre d'import). Sert
// de garde-fou : un scan qui n'en produit AUCUN ne doit jamais enchaîner vers
// l'import — c'est ce trou qui laissait passer un « ticket scanné » fantôme
// (archive marquée, zéro écriture Core, realized_saving sur un vieux ticket).
// Chantier 99 — le libellé est "name" OU, à défaut, "libelle_ticket" : le
// prompt anti-faux-rattachement laisse VOLONTAIREMENT name vide quand le
// produit ne matche pas le catalogue (confiance "faible") ; exiger name
// jetait ces produits pourtant bien lus (faux « ticket illisible »). Pure.
export function filtrerProduitsExploitables(products) {
  return (products || []).filter(p => p && (p.name || p.libelle_ticket) && Number(p.price) > 0);
}

// Chantier 100 — badge d'une ligne de l'écran de validation :
//   'reconnu'    -> la BASE reconnaîtra ce produit à l'import (RPC de
//                   prévisualisation, même cascade mémoire/alias que
//                   enregistrer_ticket_core) — prime sur la confiance IA ;
//   'a_verifier' -> pas reconnu ET confiance IA "faible" ;
//   null         -> rien à afficher. Pure, jamais d'exception.
//
// Chantier 118 — TROIS états quand la base a répondu pour la ligne (la map
// porte alors l'objet { methode } renvoyé par la RPC) :
//   'reconnu'    -> UNIQUEMENT methode = 'memoire_exacte' (égalité exacte) ;
//   'suggere'    -> methode = 'suggestion' ;
//   'a_verifier' -> tout le reste (methode nulle ou inattendue).
// Défaut constaté le 09/11 : une simple suggestion s'affichait en vert. Un
// booléen `reconnu: true` SANS methode n'est donc plus jamais une preuve.
// Base muette pour la ligne (RPC en échec, ligne absente de la réponse) :
// comportement d'avant, piloté par la seule confiance IA.
export function badgeProduit(p, reconnaissanceParId = {}) {
  const r = reconnaissanceParId?.[p?.id];
  if (r && typeof r === 'object') return badgeDepuisMethode(r.methode);
  if (p?.confiance === 'faible') return 'a_verifier';
  return null;
}

export async function scanTicketWithClaude(imageBase64, refProducts = []) {
  return appelerScanTicket({ imageBase64, refProducts });
}

// Chantier 98 — lecture OCR fiabilisée. Constat (14/08) : le MÊME ticket net
// donne 2 produits un jour et 0 le lendemain (Edge Function en 200 les deux
// fois) : la lecture est instable côté modèle, PAS côté photo — l'image
// envoyée (2000 px, JPEG 0,92) dépasse déjà le plafond d'ingestion du modèle
// (~1,15 Mpx). D'où : 1 réessai automatique quand le service échoue OU quand
// la lecture ne rend aucun produit exploitable, et un statut honnête pour ne
// plus accuser la photo par défaut. Ne throw JAMAIS — renvoie toujours :
//   { statut: 'ok',                    resultat }  -> ≥ 1 produit exploitable
//   { statut: 'lecture_vide',          resultat }  -> réponses valides mais 0 produit
//   { statut: 'service_indisponible',  message  }  -> échec technique aux 2 essais
//
// Correctif « scan anti-invention » (11/11) — les deux lectures partent
// désormais EN MÊME TEMPS (pas plus d'attente qu'avant) au lieu d'une
// seconde seulement en cas d'échec : le même ticket donnait 7, 21 puis 5
// produits, et seule une seconde lecture permet de voir que le lecteur
// hésite. Toujours 2 appels au plus, comme au chantier 98 (le coût normal
// d'un scan double). En plus de { statut, resultat } :
//   lecturesDivergentes -> true quand les deux lectures valides ne donnent
//                          pas le même nombre de produits exploitables ;
//   comptesLectures     -> ces nombres, pour l'afficher.
// Résultat retenu : celui des lectures exploitables dont le contrôle 108 est
// le meilleur (ok > avertissement > blocage), la 1re à égalité.
const RANG_NIVEAU = { [NIVEAU_OK]: 0, [NIVEAU_AVERTISSEMENT]: 1, [NIVEAU_BLOCAGE]: 2 };
function rangCoherence(resultat) {
  try { return RANG_NIVEAU[controlerCoherenceTicket(resultat || {}).niveau] ?? 0; }
  catch { return 0; }
}

//
// Correctif orientation (11/11) — AVANT toute lecture, la photo est remise
// debout (redresserPhoto). Sens incertain ou vérification impossible : on
// s'arrête là, aucune image douteuse ne part au lecteur (statuts
// 'sens_incertain' / 'service_indisponible'). `onEtape('sens')` puis
// `onEtape('lecture')` permettent à l'écran d'afficher le bon message
// d'attente. `redresser` est injectable pour les tests.
export async function scanTicketRobuste(imageBase64, refProducts = [], { essais = 2, onEtape = null, redresser = redresserPhoto } = {}) {
  const signaler = (etape) => { try { onEtape?.(etape); } catch { /* affichage seulement */ } };
  signaler('sens');
  const sens = await redresser(imageBase64);
  if (sens.statut !== 'ok') return sens.statut === 'sens_incertain' ? { statut: 'sens_incertain' } : { statut: 'service_indisponible', message: sens.message || 'Service indisponible' };
  imageBase64 = sens.base64;
  signaler('lecture');

  const tentatives = await Promise.all(
    Array.from({ length: essais }, () =>
      scanTicketWithClaude(imageBase64, refProducts).then(
        resultat => ({ ok: true, resultat }),
        erreur => ({ ok: false, erreur }),
      ),
    ),
  );
  const valides = tentatives.filter(t => t.ok).map(t => t.resultat);
  const comptesLectures = valides.map(r => filtrerProduitsExploitables(r?.products).length);
  const exploitables = valides.filter((_, i) => comptesLectures[i] > 0);
  if (exploitables.length > 0) {
    // Correctif 9h58 — à contrôle 108 égal, on préfère la lecture dont les
    // lignes sont cohérentes (quantité × prix = total).
    const score = (r) => rangCoherence(r) * 1000 + lignesIncoherentes(r).length;
    const resultat = exploitables.reduce((meilleur, r) => (score(r) < score(meilleur) ? r : meilleur));
    // Correctif 9h58 — divergence : nombre de produits différent, OU mêmes
    // nombres mais chiffres différents sur une ligne (quantité, prix, total).
    const lignesDivergentes = valides.length >= 2 ? comparerLectures(valides[0], valides[1]) : [];
    const lecturesDivergentes = comptesLectures.length >= 2 && (new Set(comptesLectures).size > 1 || lignesDivergentes.length > 0);
    return { statut: 'ok', resultat, lecturesDivergentes, comptesLectures, lignesDivergentes, rotation: sens.rotation, recadrage: sens.recadrage ?? null };
  }
  if (valides.length > 0) return { statut: 'lecture_vide', resultat: valides[valides.length - 1] };
  const derniereErreur = [...tentatives].reverse().find(t => !t.ok)?.erreur;
  return { statut: 'service_indisponible', message: derniereErreur?.message || 'Service indisponible' };
}

// Messages honnêtes par statut d'échec : on ne rejette la faute sur la photo
// que si elle peut réellement être en cause, et on propose toujours une porte
// de sortie (réessayer / saisie manuelle).
export const MESSAGES_SCAN = {
  // Correctif orientation — le sens du ticket n'a pas pu être établi avec
  // certitude : on n'envoie rien au lecteur.
  sens_incertain: "Reprends la photo, téléphone bien droit : je n'arrive pas à savoir dans quel sens est le ticket. Ticket entier, bien à plat, téléphone tenu droit au-dessus.",
  lecture_vide: "Le ticket n'a pas pu être lu (2 tentatives). Si ta photo est nette et entière, c'est un raté du service de lecture : réessaie dans un instant. Sinon, reprends la photo — ou passe en saisie manuelle.",
  service_indisponible: "Le service de lecture est momentanément indisponible — ta photo n'y est pour rien. Réessaie dans un instant, ou passe en saisie manuelle.",
};

export async function scanMultipleTicketsWithClaude(imagesBase64, refProducts = []) {
  return appelerScanTicket({ imagesBase64, refProducts });
}
