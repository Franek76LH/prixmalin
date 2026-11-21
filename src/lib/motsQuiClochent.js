// Chantier 170 — « le mot qui cloche ». Constat du 21/11 : « *PEPSI ZERO PET
// 1,5L » confirmé « Cola » d'un pouce distrait. Avant de confirmer une fiche
// proposée, on cherche dans le texte du ticket les mots qui CHANGENT le produit
// (zéro, light, bio, un taux de matière grasse, l'élevage des œufs, plate ou
// gazeuse…) et qui n'apparaissent pas dans le nom de la fiche proposée.
// Pur, sans base : rend la liste des mots à signaler (dans l'ordre du ticket).

const propre = (t) => ` ${String(t ?? '')
  .toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9%/]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()} `;

// [mot affiché, motifs dans le TICKET, motifs acceptés dans la FICHE]
const MOTS = [
  ['ZÉRO', [/ zero /, / 0 ?% sucre/, / sans sucres? /], [/ zero /, / sans sucres? /]],
  ['LIGHT', [/ light /, / allege /], [/ light /, / allege /]],
  ['BIO', [/ bio /], [/ bio /]],
  ['SANS GLUTEN', [/ sans gluten /, / s\.? ?gluten /], [/ sans gluten /]],
  ['DÉCAFÉINÉ', [/ deca /, / decaf/], [/ deca/]],
  ['ÉCRÉMÉ', [/ ecreme /, / ecr /], [/ ecreme/]],
  ['DEMI-ÉCRÉMÉ', [/ demi /, / 1\/2 ecr/], [/ demi/]],
  ['ENTIER', [/ entier /], [/ entier/]],
  ['PLEIN AIR', [/ plein air /, / pl\.? ?air /], [/ plein air /]],
  ['DE SOL', [/ oeufs? sol /, / sol /], [/ sol /]],
  ['DE CAGE', [/ cage /], [/ cage /]],
  ['GAZEUSE', [/ gazeuse /, / gaz /, / petillante /], [/ gazeuse /, / petillante /]],
  ['COMPLET', [/ complet(e|es|s)? /], [/ complet/]],
];

const POURCENT = /(\d+(?:[.,]\d+)?)\s*%/g;
const pourcentages = (t) => [...String(t ?? '').matchAll(POURCENT)].map((m) => m[1].replace(',', '.'));

export function motsQuiClochent(libelleTicket, nomFiche) {
  const ticket = propre(libelleTicket);
  const fiche = propre(nomFiche);
  if (ticket.trim() === '' || fiche.trim() === '') return [];
  const trouves = [];
  for (const [mot, dansTicket, dansFiche] of MOTS) {
    if (dansTicket.some((r) => r.test(ticket)) && !dansFiche.some((r) => r.test(fiche))) trouves.push(mot);
  }
  // « DE SOL » n'a de sens que pour des œufs.
  const i = trouves.indexOf('DE SOL');
  if (i >= 0 && !/ oeuf/.test(ticket) && !/ oeuf/.test(fiche)) trouves.splice(i, 1);
  // Un « DEMI » sans lait ni crème autour n'est pas un taux.
  const j = trouves.indexOf('DEMI-ÉCRÉMÉ');
  if (j >= 0 && !/ (lait|lt|creme|ecr)/.test(ticket)) trouves.splice(j, 1);
  const pf = pourcentages(nomFiche);
  for (const p of pourcentages(libelleTicket)) {
    if (!pf.includes(p) && !trouves.includes(`${p.replace('.', ',')} %`)) trouves.push(`${p.replace('.', ',')} %`);
  }
  return trouves;
}

// Phrase affichée sous la proposition. Vide s'il n'y a rien à signaler.
export function phraseMotsQuiClochent(mots, nomFiche) {
  if (!Array.isArray(mots) || mots.length === 0) return '';
  const liste = mots.map((m) => `« ${m} »`).join(', ');
  return `Le ticket dit ${liste}, la fiche proposée « ${nomFiche} » ne le dit pas.`;
}
