// Chantier 118 — Ticket en attente + scan de code-barres depuis l'historique
// (flux « zéro saisie »). SHADOW.
//
// Après un scan de ticket, l'utilisateur n'a plus rien à saisir : le ticket
// est enregistré tel quel, et les lignes non reconnues s'identifient PLUS
// TARD, depuis l'historique, en scannant le code-barres du produit en rangeant
// les courses. Un scan = une ligne traitée (rattachement + prix + mémoire du
// libellé de caisse pour les prochains tickets).
//
// Ce module porte toute la logique de décision, sans React ni Supabase en
// direct : les accès base/réseau sont INJECTÉS (`deps`), ce qui rend chaque
// chemin testable — en particulier les refus qui ne doivent RIEN écrire.
//
// Règle du 114, rappelée parce que c'est elle qui a motivé le chantier : le
// texte de caisse brut (`libelle_ticket`) est la vérité ; `libelle_brut`
// (reformulé par l'OCR) n'est qu'une piste. C'est libelle_ticket qui sert de
// titre à une ligne inconnue et d'alias à la mémoire d'enseigne — jamais
// libelle_brut (« Carottes » pour des carrés à démaquiller).

// ── Les trois états d'une ligne de ticket ──────────────────────────────────
export const ETAT_RECONNU = 'reconnu';
export const ETAT_SUGGERE = 'suggere';
export const ETAT_INCONNU = 'inconnu';

// Pure, jamais d'exception. L'ordre des tests compte : une ligne validée est
// reconnue même si elle porte encore une ancienne suggestion IA.
export function etatLigne(ligne) {
  if (ligne?.statut_validation_produit === 'valide') return ETAT_RECONNU;
  if (ligne?.produit_suggere_ia_id) return ETAT_SUGGERE;
  return ETAT_INCONNU;
}

// Chantier 119 — ligne marquée « Pas de code-barres » (vrac, boucherie…) :
// elle n'aura JAMAIS de code à scanner. Elle reste visible dans le détail du
// ticket mais sort de TOUS les compteurs, sinon la pastille du dernier ticket
// resterait allumée à vie (constat du test iPhone : banane, chou-fleur,
// rumsteck). Réversible (« Finalement j'ai un code »).
export function estSansCodeBarres(ligne) {
  return ligne?.sans_code_barres === true;
}

// « À identifier » = pas validée ET pas marquée sans code-barres.
export function estAIdentifier(ligne) {
  return etatLigne(ligne) !== ETAT_RECONNU && !estSansCodeBarres(ligne);
}

// Ticket complet = plus rien à identifier (lignes reconnues ou sans code-barres).
export function ticketComplet(lignes) {
  return compterAIdentifier(lignes) === 0;
}

export function compterAIdentifier(lignes) {
  return (lignes || []).filter(estAIdentifier).length;
}

// Compte par ticket_id, pour les cartes de l'historique.
export function compterAIdentifierParTicket(lignes) {
  const map = new Map();
  for (const l of lignes || []) {
    if (!l?.ticket_id || !estAIdentifier(l)) continue;
    map.set(l.ticket_id, (map.get(l.ticket_id) || 0) + 1);
  }
  return map;
}

// Lignes « à identifier » en haut, reconnues en bas ; l'ordre du ticket
// (numero_ligne) est conservé à l'intérieur de chaque groupe. Ne modifie pas
// le tableau reçu.
export function trierLignesTicket(lignes) {
  const ordre = (l) => (Number.isFinite(Number(l?.numero_ligne)) && l?.numero_ligne != null ? Number(l.numero_ligne) : Infinity);
  return [...(lignes || [])]
    .map((l, i) => ({ l, i }))
    .sort((a, b) => {
      const ga = estAIdentifier(a.l) ? 0 : 1;
      const gb = estAIdentifier(b.l) ? 0 : 1;
      if (ga !== gb) return ga - gb;
      const oa = ordre(a.l), ob = ordre(b.l);
      if (oa !== ob) return oa - ob;
      return a.i - b.i;
    })
    .map(x => x.l);
}

// Après le traitement d'une ligne : la prochaine « à identifier » à mettre en
// évidence (la suivante dans l'ordre affiché, sinon la première restante).
export function ligneSuivanteAIdentifier(lignesTriees, idTraitee) {
  const restantes = (lignesTriees || []).filter(l => l?.id !== idTraitee && estAIdentifier(l));
  if (restantes.length === 0) return null;
  const idx = (lignesTriees || []).findIndex(l => l?.id === idTraitee);
  const apres = idx >= 0 ? lignesTriees.slice(idx + 1).find(l => estAIdentifier(l) && l.id !== idTraitee) : null;
  return (apres || restantes[0]).id;
}

// Titre d'une ligne inconnue : le TEXTE DE CAISSE d'abord, toujours.
export function titreLigneInconnue(ligne) {
  const t = String(ligne?.libelle_ticket || '').trim();
  if (t) return t;
  const b = String(ligne?.libelle_brut || '').trim();
  return b || 'Article sans libellé';
}

// libelle_brut n'est montré en petit que s'il apporte quelque chose.
export function pisteLigneInconnue(ligne) {
  const t = String(ligne?.libelle_ticket || '').trim();
  const b = String(ligne?.libelle_brut || '').trim();
  if (!t || !b) return null;
  return t.toLowerCase() === b.toLowerCase() ? null : b;
}

// Format lisible d'une variante : « 44 capsules », « 6 × 33 cl », « 250 g ».
export function formatVariante(v) {
  if (!v) return '';
  const q = v.quantite_nette, u = v.unite_quantite, n = Number(v.nombre_unites);
  if (q != null && u) {
    const base = `${String(q).replace('.', ',')} ${u}`;
    return n > 1 ? `${n} × ${base}` : base;
  }
  return String(v.libelle || '').trim();
}

// Prix d'UN article (chantier 117 : jamais le total de ligne).
export function prixArticle(ligne) {
  const p = Number(ligne?.prix_unitaire);
  return Number.isFinite(p) && p > 0 ? p : null;
}

// ── Codes-barres ───────────────────────────────────────────────────────────

// Garde uniquement les chiffres (le lecteur peut rendre des espaces).
export function normaliserCode(codeBrut) {
  return String(codeBrut || '').replace(/\D+/g, '');
}

// Codes « magasin » à poids/prix variable (rumsteck, fromage à la coupe…) :
// préfixe 2 (plage GS1 20–29 réservée à l'usage interne des magasins). Le même
// code désigne un autre produit dans un autre magasin, et change avec le poids
// ou le prix : il ne doit JAMAIS être appris ni servir à rattacher une ligne.
export function estCodePoidsVariable(codeBrut) {
  const c = normaliserCode(codeBrut);
  return c.length >= 8 && c.startsWith('2');
}

// Même rattrapage UPC-A ⇄ EAN-13 que la base (lever_doute_par_code_barres).
export function candidatsCode(code) {
  const c = normaliserCode(code);
  if (!c) return [];
  const out = [c];
  if (/^\d{12}$/.test(c)) out.push('0' + c);
  if (/^0\d{12}$/.test(c)) out.push(c.slice(1));
  return out;
}

// Forme envoyée à la création : EAN-13 quand le lecteur a rendu un UPC-A.
export function codePourCreation(code) {
  const c = normaliserCode(code);
  return /^\d{12}$/.test(c) ? '0' + c : c;
}

// ── Open Food Facts ────────────────────────────────────────────────────────
export const DELAI_OFF_MS = 4000;
export const champsOffCreation = 'product_name,brands,quantity,product_quantity,product_quantity_unit,image_front_small_url';
export const urlOffCreation = (ean, champs = champsOffCreation) =>
  `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json?fields=${champs}`;
// Chantier 119 — l'écran de vérification veut AUSSI le nom français et la
// grande photo (montrée en plein écran).
export const champsOffIdentification = 'product_name,product_name_fr,brands,quantity,product_quantity,product_quantity_unit,image_front_url,image_front_small_url';

// Ne garde que les champs demandés, non vides. {} quand OFF ne sait rien.
export function extraireOff(json, champs = champsOffCreation) {
  const p = json && json.status === 1 ? json.product : null;
  if (!p || typeof p !== 'object') return {};
  const out = {};
  for (const k of champs.split(',')) {
    const v = p[k];
    if (v == null) continue;
    if (typeof v === 'string' && !v.trim()) continue;
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

// OFF hors ligne, lent (> 4 s), code inconnu, JSON illisible : {} — jamais
// d'exception. La création se fera alors « à compléter ».
export async function chercherOffPourCreation(ean, { fetchImpl = globalThis.fetch, delaiMax = DELAI_OFF_MS, champs = champsOffCreation } = {}) {
  if (!ean || typeof fetchImpl !== 'function') return {};
  try {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const minuterie = ctrl ? setTimeout(() => ctrl.abort(), delaiMax) : null;
    let r;
    try {
      r = await fetchImpl(urlOffCreation(ean, champs), ctrl ? { signal: ctrl.signal } : undefined);
    } finally {
      if (minuterie) clearTimeout(minuterie);
    }
    if (!r || !r.ok) return {};
    return extraireOff(await r.json(), champs);
  } catch {
    return {};
  }
}

// Chantier 119 — même appel, champs élargis, 4 s maximum.
export function chercherOffIdentification(ean, options = {}) {
  return chercherOffPourCreation(ean, { ...options, champs: champsOffIdentification });
}

// ── Erreurs RPC ────────────────────────────────────────────────────────────
export const MESSAGE_INDISPONIBLE = 'Indisponible pour le moment — réessaie plus tard.';

// Fonction absente côté API (pas encore créée, ou cache de schéma PostgREST
// pas rechargé) : on le dit sobrement, on ne plante pas.
export function estFonctionAbsente(error) {
  if (!error) return false;
  return error.code === 'PGRST202' || /could not find the function|schema cache/i.test(error.message || '');
}

// ── Orchestration d'un scan sur une ligne ──────────────────────────────────
//
// deps (tous asynchrones, tous fournis par l'appelant) :
//   chercherVarianteParCode(candidats) -> { variante, connu, error }
//       variante : { id, produit_id, actif, ... } ou null ; connu : le code
//       existe dans codes_barres_variante (même si la variante est illisible).
//   relier({ ligneId, produitId, varianteId, libelleAlias }) -> { error }
//   chercherOff(ean) -> objet OFF ({} si rien)
//   creerDepuisCode({ ligneId, code, off }) -> { data, error }
//
// Renvoie toujours un objet { statut, message, ecrit, ... } ; n'écrit RIEN
// sur les refus (code vide, poids variable, produit archivé, ligne déjà
// reconnue) ni sur les erreurs de lecture.
export const SCAN_RECONNU = 'reconnu';
export const SCAN_CREE = 'cree';
export const SCAN_POIDS_VARIABLE = 'poids_variable';
export const SCAN_ARCHIVE = 'archive';
export const SCAN_INDISPONIBLE = 'indisponible';
export const SCAN_ERREUR = 'erreur';
export const SCAN_CODE_VIDE = 'code_vide';
export const SCAN_DEJA_RECONNUE = 'deja_reconnue';

// Chemin suivi par un scan RÉUSSI (tous écrivent un rattachement + un prix,
// donc tous doivent offrir « ↩ Annuler ») :
export const CHEMIN_CODE_CONNU = 'code_connu';             // relier_variante_scan_code_barres direct
export const CHEMIN_DEJA_CONNU = 'deja_connu';             // création demandée, la base le connaissait
export const CHEMIN_CREE_OFF = 'cree_off';                 // créé avec Open Food Facts
export const CHEMIN_CREE_A_COMPLETER = 'cree_a_completer'; // créé sans OFF, fiche à compléter

export const MESSAGE_POIDS_VARIABLE = 'Code poids variable, non réutilisable — rien n\'a été enregistré.';
export const MESSAGE_ARCHIVE = 'Produit archivé — ce code n\'est plus utilisable. Scanne un autre code de l\'emballage.';

// ── Chantier 119 — le scan en DEUX TEMPS ──────────────────────────────────
// 118 : scan -> écriture immédiate -> « ↩ Annuler » 8 s.
// 119 : scan -> RECHERCHE SEULE (aucune écriture) -> l'utilisateur voit la
// fiche et confirme -> ÉCRITURE. Les deux temps sont séparés ici ;
// traiterScanLigne (118) les enchaîne sans pause et garde son comportement.
export const RECHERCHE_CONNU = 'connu';
export const RECHERCHE_INCONNU = 'inconnu';
export const SOURCE_BASE = 'base';
export const SOURCE_OFF = 'off';
export const SOURCE_AUCUNE = 'aucune';

// Format lisible depuis OFF : « quantity » d'abord, sinon product_quantity +
// unité. null si OFF n'en dit rien.
function formatOff(off) {
  if (off?.quantity) return String(off.quantity).trim() || null;
  if (off?.product_quantity != null && off?.product_quantity_unit) return `${off.product_quantity} ${off.product_quantity_unit}`;
  return null;
}

// Nom OFF affiché ET envoyé à la création : le français d'abord.
export function nomOff(off) {
  return String(off?.product_name_fr || off?.product_name || '').trim() || null;
}

// Ce que l'écran de vérification montre. `photoOff` = URL OFF brute (grande
// de préférence), à passer par Cloudinary ; null = cadre gris.
export function ficheVerification({ statut, variante = null, off = {}, ligne = null }) {
  const photoOff = off?.image_front_url || off?.image_front_small_url || null;
  if (statut === RECHERCHE_CONNU) {
    return {
      nom: variante?.produits?.nom_reference || titreLigneInconnue(ligne),
      marque: variante?.marques?.nom || null,
      format: formatVariante(variante) || null,
      photoOff,
      source: SOURCE_BASE,
    };
  }
  const offParle = !!(nomOff(off) || off?.brands || formatOff(off) || photoOff);
  return {
    nom: nomOff(off) || titreLigneInconnue(ligne),
    marque: off?.brands || null,
    format: formatOff(off),
    photoOff,
    source: offParle ? SOURCE_OFF : SOURCE_AUCUNE,
  };
}

// JSON envoyé à creer_produit_depuis_code_barres : celui d'OFF, avec
// product_name = le nom AFFICHÉ (français d'abord) — la fiche créée porte
// exactement le nom que l'utilisateur a confirmé. {} si OFF est muet.
export function offPourCreation(off) {
  if (!off || typeof off !== 'object' || Object.keys(off).length === 0) return {};
  const out = { ...off };
  const nom = nomOff(off);
  if (nom) out.product_name = nom;
  return out;
}

// TEMPS 1 — recherche seule. deps : chercherVarianteParCode, chercherOff.
// photoPourConnu : interroger aussi OFF (pour la photo) quand le code est
// connu — le 118 ne le faisait pas, le 119 le fait. N'écrit JAMAIS.
export async function rechercherScanLigne({ ligne, codeBrut, deps, photoPourConnu = false }) {
  const code = normaliserCode(codeBrut);
  if (!ligne?.id) return { statut: SCAN_ERREUR, message: 'Ligne introuvable, rouvre le ticket.', ecrit: false };
  if (!code) return { statut: SCAN_CODE_VIDE, message: 'Code illisible, réessaie.', ecrit: false };
  if (etatLigne(ligne) === ETAT_RECONNU) {
    return { statut: SCAN_DEJA_RECONNUE, message: 'Cette ligne est déjà reconnue.', ecrit: false };
  }
  // Refus AVANT toute lecture : un code poids variable ne doit même pas être
  // cherché (il pourrait coïncider avec un code appris par erreur ailleurs).
  if (estCodePoidsVariable(code)) {
    return { statut: SCAN_POIDS_VARIABLE, message: MESSAGE_POIDS_VARIABLE, ecrit: false, code };
  }

  let lecture;
  try {
    lecture = await deps.chercherVarianteParCode(candidatsCode(code));
  } catch {
    lecture = { error: true };
  }
  if (lecture?.error) {
    return { statut: SCAN_ERREUR, message: 'Recherche du code-barres impossible, vérifie ta connexion.', ecrit: false, code };
  }

  if (lecture?.connu) {
    const v = lecture.variante;
    if (!v || v.actif === false || !v.produit_id) {
      return { statut: SCAN_ARCHIVE, message: MESSAGE_ARCHIVE, ecrit: false, code };
    }
    let off = {};
    if (photoPourConnu) {
      try { off = (await deps.chercherOff(codePourCreation(code))) || {}; } catch { off = {}; }
    }
    return { statut: RECHERCHE_CONNU, ecrit: false, code, variante: v, off, fiche: ficheVerification({ statut: RECHERCHE_CONNU, variante: v, off, ligne }) };
  }

  let off = {};
  try { off = (await deps.chercherOff(codePourCreation(code))) || {}; } catch { off = {}; }
  return { statut: RECHERCHE_INCONNU, ecrit: false, code, off, fiche: ficheVerification({ statut: RECHERCHE_INCONNU, off, ligne }) };
}

// TEMPS 2 — écriture, uniquement sur une recherche RÉUSSIE (connu/inconnu).
// deps : relier, creerDepuisCode. Toute autre recherche -> rien n'est écrit.
export async function ecrireScanLigne({ ligne, recherche, deps }) {
  const r = recherche || {};
  const code = r.code;
  if (!ligne?.id || (r.statut !== RECHERCHE_CONNU && r.statut !== RECHERCHE_INCONNU)) {
    return { statut: SCAN_ERREUR, message: 'Rien à enregistrer, rescanne le code.', ecrit: false, code };
  }
  const libelleAlias = String(ligne.libelle_ticket || '').trim() || null;

  if (r.statut === RECHERCHE_CONNU) {
    const v = r.variante;
    let rep;
    try {
      rep = await deps.relier({ ligneId: ligne.id, produitId: v.produit_id, varianteId: v.id, libelleAlias });
    } catch (e) {
      rep = { error: e || true };
    }
    if (rep?.error) {
      return {
        statut: estFonctionAbsente(rep.error) ? SCAN_INDISPONIBLE : SCAN_ERREUR,
        message: estFonctionAbsente(rep.error) ? MESSAGE_INDISPONIBLE : 'Le rattachement a échoué, réessaie.',
        ecrit: false, code,
      };
    }
    // Une réponse { succes: false } explicite de la base n'est pas un succès.
    if (rep?.data && typeof rep.data === 'object' && rep.data.succes === false) {
      return { statut: SCAN_ERREUR, message: String(rep.data.message || '').trim() || 'Rattachement refusé, la ligne reste à identifier.', ecrit: false, code };
    }
    return { statut: SCAN_RECONNU, chemin: CHEMIN_CODE_CONNU, message: 'Reconnu', ecrit: true, code, variante: v };
  }

  const off = r.off || {};
  let rep;
  try {
    rep = await deps.creerDepuisCode({ ligneId: ligne.id, code: codePourCreation(code), off: offPourCreation(off) });
  } catch (e) {
    rep = { error: e || true };
  }
  if (rep?.error) {
    return {
      statut: estFonctionAbsente(rep.error) ? SCAN_INDISPONIBLE : SCAN_ERREUR,
      message: estFonctionAbsente(rep.error) ? MESSAGE_INDISPONIBLE : 'Création impossible pour le moment, réessaie.',
      ecrit: false, code, off,
    };
  }
  const d = rep?.data || {};
  if (d.poids_variable === true) {
    return { statut: SCAN_POIDS_VARIABLE, message: MESSAGE_POIDS_VARIABLE, ecrit: false, code };
  }
  if (d.succes !== true) {
    return { statut: SCAN_ERREUR, message: String(d.message || '').trim() || 'Création refusée, la ligne reste à identifier.', ecrit: false, code, off };
  }
  return {
    statut: d.deja_connu === true ? SCAN_RECONNU : SCAN_CREE,
    chemin: d.deja_connu === true ? CHEMIN_DEJA_CONNU : (d.a_completer === true ? CHEMIN_CREE_A_COMPLETER : CHEMIN_CREE_OFF),
    message: d.deja_connu === true ? 'Reconnu' : 'Créé',
    ecrit: true,
    code,
    off,
    produitId: d.produit_id ?? null,
    varianteId: d.variante_produit_id ?? null,
    aCompleter: d.a_completer === true,
  };
}

// 118 — scan ET écriture d'un seul tenant (recherche puis écriture, sans pause).
export async function traiterScanLigne({ ligne, codeBrut, deps }) {
  const recherche = await rechercherScanLigne({ ligne, codeBrut, deps });
  if (recherche.statut !== RECHERCHE_CONNU && recherche.statut !== RECHERCHE_INCONNU) return recherche;
  return ecrireScanLigne({ ligne, recherche, deps });
}

// « Créé : <nom> · <marque> · <format> » à partir de ce que la base a écrit,
// avec repli sur OFF puis sur le texte de caisse.
export function libelleProduitCree({ variante = null, off = {}, ligne = null } = {}) {
  const nom = variante?.produits?.nom_reference || off?.product_name || titreLigneInconnue(ligne);
  const marque = variante?.marques?.nom || off?.brands || null;
  const format = formatVariante(variante) || off?.quantity || null;
  return [nom, marque, format].filter(Boolean).join(' · ');
}

// ── Pastille de l'accueil : le DERNIER ticket seulement ────────────────────
// Retour terrain du 09/11 : « 115 produits à identifier » (tous les tickets
// depuis le début) décourage — personne ne scanne 115 codes en rangeant ses
// courses. L'accueil ne parle donc que du ticket qu'on vient de scanner ;
// l'historique garde les compteurs complets.
//
// ticket : { magasins: { nom }, date_ticket } ; n : lignes à identifier de ce
// ticket. null quand il n'y a rien à dire (pastille masquée). Pure.
export function resumeDernierTicket(ticket, n) {
  const nb = Number(n);
  if (!ticket || !Number.isFinite(nb) || nb <= 0) return null;
  const magasin = String(ticket.magasins?.nom || '').trim() || 'ton magasin';
  let quand = null;
  const d = ticket.date_ticket ? new Date(`${String(ticket.date_ticket).slice(0, 10)}T12:00:00`) : null;
  if (d && !Number.isNaN(d.getTime())) {
    quand = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  return {
    ticketId: ticket.id ?? null,
    titre: `${nb} produit${nb > 1 ? 's' : ''} à scanner`,
    sousTitre: `Dernier ticket : ${[magasin, quand].filter(Boolean).join(' · ')}`,
  };
}

// ── « Pas de code-barres » (RPC marquer_ligne_sans_code_barres) ───────────
// deps.marquer(ligneId, valeur) -> { data: { succes, sans_code_barres, message }, error }.
// La base refuse de marquer une ligne déjà rattachée à un produit. Ne throw jamais.
export async function marquerSansCodeBarres({ ligneId, valeur = true, deps }) {
  if (!ligneId || typeof deps?.marquer !== 'function') return { ok: false, message: MESSAGE_INDISPONIBLE };
  let rep;
  try {
    rep = await deps.marquer(ligneId, valeur);
  } catch (e) {
    rep = { error: e || true };
  }
  if (rep?.error) {
    return { ok: false, message: estFonctionAbsente(rep.error) ? MESSAGE_INDISPONIBLE : 'Impossible de marquer la ligne pour le moment.' };
  }
  const d = rep?.data && typeof rep.data === 'object' ? rep.data : {};
  if (d.succes !== true) return { ok: false, message: String(d.message || '').trim() || 'Marquage refusé par la base.' };
  return { ok: true, sansCodeBarres: d.sans_code_barres ?? valeur };
}

// ── Filet « ↩ Annuler » après un scan ──────────────────────────────────────
// Viser la mauvaise ligne écrit un faux prix (et une fausse mémoire de caisse).
// Pendant 8 s après un scan réussi, la ligne propose d'annuler. La RPC
// annuler_scan_ligne_ticket (base) défait prix, alias, mémoire d'enseigne et
// code-barres créés par le scan, désactive la fiche/variante qu'il avait
// créées, et remet la ligne en non_valide. Elle refuse (succes=false) une
// ligne qui n'a pas été rattachée par scan, ou déjà annulée.
export const DUREE_ANNULATION_MS = 8000;

// deps.annuler(ligneId) -> { data, error }. Ne throw jamais.
export async function annulerScanLigne({ ligneId, deps }) {
  if (!ligneId) return { ok: false, message: 'Ligne introuvable, rouvre le ticket.' };
  let rep;
  try {
    rep = await deps.annuler(ligneId);
  } catch (e) {
    rep = { error: e || true };
  }
  if (rep?.error) {
    return { ok: false, message: estFonctionAbsente(rep.error) ? MESSAGE_INDISPONIBLE : 'Annulation impossible, réessaie.' };
  }
  const d = rep?.data && typeof rep.data === 'object' ? rep.data : {};
  if (d.succes !== true) {
    return { ok: false, message: String(d.message || '').trim() || 'Annulation refusée par la base.' };
  }
  return { ok: true, message: String(d.message || '').trim() || null, bilan: d };
}

// État local d'une ligne juste après une annulation RÉUSSIE (affiché tout de
// suite, avant la relecture de la base qui fait foi). La suggestion IA, si la
// ligne en portait une, est conservée : c'est l'état d'avant le scan.
export function ligneApresAnnulation(ligne) {
  if (!ligne) return ligne;
  return {
    ...ligne,
    statut_validation_produit: 'non_valide',
    methode_validation_produit: null,
    produit_id: null,
    variante_produit_id: null,
  };
}

// Applique l'annulation à la liste affichée, retriée (la ligne remonte parmi
// les « à identifier »). Ne modifie pas le tableau reçu.
export function appliquerAnnulation(lignes, ligneId) {
  return trierLignesTicket((lignes || []).map(l => (l?.id === ligneId ? ligneApresAnnulation(l) : l)));
}

// Ce que l'écran affiche après un scan : le bandeau ET la fenêtre
// d'annulation. Défaut constaté le 09/11 (bière scannée sur CHOU FLEUR PIECE,
// code déjà connu) : bandeau vert, aucun « ↩ Annuler », faux prix à défaire
// en base. D'où cette fonction unique : TOUT scan qui a écrit (ecrit = true)
// ouvre la fenêtre, quel que soit son chemin. Un refus n'en ouvre jamais.
// Pure ; `prix` = prix d'un article de la ligne, déjà calculé.
export function issueScan(r, { ligne, variante = null, prix = null } = {}) {
  if (!r) return { retour: { ton: 'erreur', titre: 'Scan impossible, réessaie.' }, annulable: null };
  if (r.ecrit === true && (r.statut === SCAN_RECONNU || r.statut === SCAN_CREE)) {
    const libelle = libelleProduitCree({ variante: variante || r.variante || null, off: r.off, ligne });
    return {
      retour: {
        ton: 'succes',
        titre: r.statut === SCAN_CREE ? `Créé : ${libelle}` : `✓ Reconnu : ${libelle}`,
        detail: prix != null ? `Prix enregistré : ${String(Number(prix).toFixed(2)).replace('.', ',')} €` : null,
        aCompleter: r.aCompleter === true,
      },
      annulable: ligne?.id ? { ligneId: ligne.id, libelle, chemin: r.chemin ?? null } : null,
    };
  }
  const ton = r.statut === SCAN_POIDS_VARIABLE || r.statut === SCAN_ARCHIVE ? 'attente' : 'erreur';
  return {
    retour: { ton, titre: r.message, detail: r.code ? `Code : ${r.code}` : null, ligneId: ligne?.id ?? null },
    annulable: null,
  };
}

// Résumé lisible de ce que la base a défait.
export function resumeAnnulation(bilan) {
  if (!bilan) return null;
  const n = (k) => Number(bilan[k]) || 0;
  const morceaux = [
    n('prix_supprimes') ? `${n('prix_supprimes')} prix` : null,
    n('alias_supprimes') ? `${n('alias_supprimes')} alias` : null,
    n('memoires_supprimees') ? `${n('memoires_supprimees')} mémoire de caisse` : null,
    n('codes_supprimes') ? `${n('codes_supprimes')} code-barres` : null,
    bilan.fiche_supprimee || bilan.variante_supprimee ? 'fiche créée désactivée' : null,
  ].filter(Boolean);
  return morceaux.length ? `Défait : ${morceaux.join(', ')}.` : null;
}

// ── Produits « à compléter » (étape 4, lecture seule) ──────────────────────
// Sous-catégorie « À reclasser (import Drive) » : la RPC de création y range
// les fiches quand Open Food Facts ne donne pas de nom.
export const SOUS_CATEGORIE_A_RECLASSER_ID = 'cba4251f-28b5-4f0d-bfb6-70af5c802205';

// Critère validé par François le 09/11 : code-barres de source 'scan' ET
// (quantité non fiable OU fiche dans « À reclasser »). Pure.
//   variante : { quantite_fiable, produits: { sous_categorie_id } }
//   sourceCode : source du code-barres de cette variante
export function estProduitACompleter(variante, sourceCode) {
  if (!variante || sourceCode !== 'scan') return false;
  if (variante.quantite_fiable === false) return true;
  return variante.produits?.sous_categorie_id === SOUS_CATEGORIE_A_RECLASSER_ID;
}

// ── Badge de l'écran de partage (étape 3) ──────────────────────────────────
// La RPC previsualiser_reconnaissance_ticket renvoie maintenant `methode`.
// Seule l'égalité exacte (mémoire) vaut « ✓ reconnu » : une suggestion ne
// doit JAMAIS s'afficher en vert. Voir badgeProduit (src/scanTicket.js).
export function badgeDepuisMethode(methode) {
  if (methode === 'memoire_exacte') return 'reconnu';
  if (methode === 'suggestion') return 'suggere';
  return 'a_verifier';
}
