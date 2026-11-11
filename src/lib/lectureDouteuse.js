// Correctif « scan anti-invention » — quand une lecture est-elle DOUTEUSE ?
// Logique pure (ni React, ni réseau). Une lecture douteuse n'est pas refusée
// (le refus au-delà de 10 % d'écart reste celui du chantier 108) : l'écran
// « Cette lecture est peut-être fausse » propose « Reprendre la photo » en
// principal et « Continuer quand même » en second.
//
// Quatre motifs, chacun fondé sur un constat réel du 11/11 :
//   montant              — la somme des lignes ne colle pas au total imprimé
//                          (avertissement 108, plus de 0,10 € d'écart) ;
//   lectures_divergentes — deux lectures de la même photo ne trouvent pas le
//                          même nombre de produits ;
//   articles_introuvables— le nombre d'articles imprimé n'a pas été lu ALORS
//                          QUE la lecture est fragile (voir lectureFragile) ;
//   date_absurde         — date dans le futur ou de plus d'un an (scan de
//                          9h33 : « 27 avril 2013 » sur un ticket de la veille).
import { DATE_FUTURE, NIVEAU_AVERTISSEMENT, MOTIF_MONTANT } from './coherenceTicket';
import { similariteTrigramme } from './nouveauMagasinTicket';

export const MOTIF_DOUTE_MONTANT = 'montant';
export const MOTIF_DOUTE_DIVERGENCE = 'lectures_divergentes';
export const MOTIF_DOUTE_ARTICLES = 'articles_introuvables';
export const MOTIF_DOUTE_DATE = 'date_absurde';

// Au-delà d'un an, une date n'est plus « à confirmer » (bandeau date du 108,
// dès 90 jours) mais manifestement fausse pour un ticket qu'on scanne.
export const JOURS_DATE_ABSURDE = 365;

export const FRAGILE_MONTANT_NON_MESURABLE = 'montant_non_mesurable';
export const FRAGILE_DATE_ILLISIBLE = 'date_illisible';
export const FRAGILE_CONFIANCE_FAIBLE = 'confiance_faible_majoritaire';
export const FRAGILE_LIGNE_SANS_LIBELLE = 'ligne_sans_libelle';

// Une lecture est FRAGILE quand un indice net montre que le lecteur a mal vu.
// Volontairement PAS « nombre d'articles absent » à lui seul : beaucoup de
// tickets ne l'impriment pas (Carrefour, lu parfaitement, n'en a pas). Et pas
// « une ligne faible » : le catalogue en rend plusieurs faibles sur une bonne
// lecture (3 sur 9 sur le Carrefour) ; seule une MAJORITÉ de lignes faibles
// compte. Pure, jamais d'exception.
export function lectureFragile(parsed, controle, controleDate) {
  const raisons = [];
  const produits = Array.isArray(parsed?.products) ? parsed.products : [];
  if (controle?.montantNonMesure != null) raisons.push(FRAGILE_MONTANT_NON_MESURABLE);
  if (!controleDate?.dateLue) raisons.push(FRAGILE_DATE_ILLISIBLE);
  const faibles = produits.filter(p => p?.confiance === 'faible').length;
  if (produits.length >= 2 && faibles * 2 > produits.length) raisons.push(FRAGILE_CONFIANCE_FAIBLE);
  if (produits.some(p => !String(p?.libelle_ticket || '').trim())) raisons.push(FRAGILE_LIGNE_SANS_LIBELLE);
  return { fragile: raisons.length > 0, raisons };
}

// Date dans le futur, ou plus vieille qu'un an. S'appuie sur le contrôle de
// date du 108 (controlerDateTicket) : une date illisible n'est pas absurde.
export function dateAbsurde(controleDate) {
  if (!controleDate?.dateLue) return false;
  if (controleDate.raison === DATE_FUTURE) return true;
  return Number(controleDate.ecartJours) > JOURS_DATE_ABSURDE;
}

// Les motifs de doute d'une lecture, dans l'ordre d'affichage. `controle` =
// controlerCoherenceTicket, `controleDate` = controlerDateTicket (108).
export function motifsDoute({ parsed, controle, controleDate, lecturesDivergentes = false } = {}) {
  const motifs = [];
  const fragilite = lectureFragile(parsed, controle, controleDate);
  const incoherentes = lignesIncoherentes(parsed);
  if (controle?.niveau === NIVEAU_AVERTISSEMENT && (controle.motifs || []).includes(MOTIF_MONTANT)) motifs.push(MOTIF_DOUTE_MONTANT);
  if (incoherentes.length > 0) motifs.push(MOTIF_DOUTE_LIGNE);
  if (lecturesDivergentes) motifs.push(MOTIF_DOUTE_DIVERGENCE);
  if (controle && controle.articlesTicket == null && fragilite.fragile) motifs.push(MOTIF_DOUTE_ARTICLES);
  if (dateAbsurde(controleDate)) motifs.push(MOTIF_DOUTE_DATE);
  return { motifs, raisonsFragilite: fragilite.raisons, lignesIncoherentes: incoherentes };
}

// ── Correctif 9h58 — contrôles ligne par ligne ─────────────────────────────
// Constat : la Leffe lue « 3 × 1,69 € » avec un total de 7,06 €. Le contrôle du
// 108 additionne le champ total (7,06) et tombait juste ; personne ne voyait
// que 3 × 1,69 = 5,07. Et les deux lectures (3 × 1,69 / 1 × 7,06) avaient le
// même NOMBRE de produits : rien ne les distinguait.
export const MOTIF_DOUTE_LIGNE = 'ligne_incoherente';

const nombre = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const centimes = (v) => Math.round(v * 100);

// Les chiffres d'une ligne tels que l'app les utilisera.
export function chiffresLigne(p) {
  return { qty: nombre(p?.qty) ?? 1, prix: nombre(p?.unit_price) ?? nombre(p?.price), total: nombre(p?.total) };
}

// Ligne incohérente : quantité × prix unitaire, arrondi au centime, ne fait
// pas le total imprimé. Seulement quand les trois chiffres sont là : une
// absence n'est pas une anomalie. Arrondi : 0,456 kg × 3,99 € = 1,819 -> 1,82.
export function ligneIncoherente(p) {
  const { qty, prix, total } = chiffresLigne(p);
  if (!(qty > 0) || !(prix > 0) || !(total > 0)) return false;
  return centimes(qty * prix) !== centimes(total);
}

export function lignesIncoherentes(parsed) {
  const produits = Array.isArray(parsed?.products) ? parsed.products : [];
  return produits
    .map((p, i) => ({ i, p }))
    .filter(({ p }) => ligneIncoherente(p))
    .map(({ i, p }) => ({ i, libelle: String(p.libelle_ticket || p.name || '').trim(), ...chiffresLigne(p) }));
}

// ── Texte de caisse (correctif 10h36) ──────────────────────────────────────
// Constat : une lecture a rendu « B/BLUE VITTEL RITUEL 9a BI 50CL » là où
// l'autre lisait « B/BLDE LEFFE RITUEL 9ø BT 50CL », avec les MÊMES chiffres :
// rien ne le signalait. Mais le texte varie aussi pour rien d'une lecture à
// l'autre : lettre TVA en tête (« A 1X COLA… » / « 1X COLA… »), « 9ø / 9a /
// 9p », « BLDE / BLONDE », « LEFFE / LEFF ». Mesuré sur les lectures réelles
// du 11/11 : un même produit reste au-dessus de 0,57 de ressemblance, la
// confusion Leffe / Vittel tombe entre 0,38 et 0,45. Seuil : 0,5.
export const SEUIL_TEXTE_DIFFERENT = 0.5;

// Minuscules, sans accents, sans la lettre TVA isolée en tête, sans
// ponctuation ni signes (« ø » disparaît). Pure.
export function normaliserTexteCaisse(t) {
  return String(t ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/^\s*[a-z]\s+(?=\S)/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Deux textes de caisse « vraiment différents » ? Faux si l'un des deux est
// vide (une absence n'est pas une anomalie). Pure.
export function textesCaisseDifferents(a, b) {
  const na = normaliserTexteCaisse(a), nb = normaliserTexteCaisse(b);
  if (!na || !nb || na === nb) return false;
  return similariteTrigramme(na, nb) < SEUIL_TEXTE_DIFFERENT;
}

// Deux lectures de la même photo, comparées ligne à ligne (même rang) :
// quantité, prix unitaire ou total différents -> la ligne diverge. Si le
// nombre de lignes diffère, toutes les lignes en surplus divergent.
// Correctif 10h36 : texte de caisse vraiment différent -> la ligne diverge
// aussi (`texteA` / `texteB` renseignés).
export function comparerLectures(a, b) {
  const pa = Array.isArray(a?.products) ? a.products : [];
  const pb = Array.isArray(b?.products) ? b.products : [];
  const ecarts = [];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const ca = pa[i] ? chiffresLigne(pa[i]) : null;
    const cb = pb[i] ? chiffresLigne(pb[i]) : null;
    const pareil = (x, y) => (x == null && y == null) || (x != null && y != null && centimes(x) === centimes(y));
    const chiffresDifferents = !ca || !cb || !pareil(ca.qty, cb.qty) || !pareil(ca.prix, cb.prix) || !pareil(ca.total, cb.total);
    const texteDifferent = !!(pa[i] && pb[i]) && textesCaisseDifferents(pa[i].libelle_ticket, pb[i].libelle_ticket);
    if (chiffresDifferents || texteDifferent) {
      const ecart = { i, libelle: String((pa[i] || pb[i])?.libelle_ticket || (pa[i] || pb[i])?.name || '').trim(), a: ca, b: cb };
      if (texteDifferent) Object.assign(ecart, { texteA: String(pa[i].libelle_ticket).trim(), texteB: String(pb[i].libelle_ticket).trim() });
      ecarts.push(ecart);
    }
  }
  return ecarts;
}
