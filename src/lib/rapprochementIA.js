// Chantier 157 — rapprochement « par le sens » de la liste dictée.
//
// La fonction en ligne `rapprocher-liste` propose, pour chaque produit dit,
// les fiches du catalogue qui lui correspondent (« sopalin » -> Essuie-tout).
// Ici : la mise en forme de sa réponse et sa fusion avec les propositions
// habituelles (ressemblance des mots + habitudes d'achat). Testé seul.
//
// Quand l'IA se dit sûre (une seule fiche, sans hésitation), la fiche est
// reliée toute seule. Décidé après le premier essai réel de François (19/11) :
// « bière 8.6 Original » avait une proposition sûre, personne n'a appuyé
// dessus, et le produit est parti au caddie en texte libre — donc sans prix.
// Le lien reste visible (« ✓ fiche · changer ») et corrigeable avant l'ajout.
export const RELIER_SEUL_SI_IA_SURE = true;
export const MAX_PROPOSITIONS = 3;

// Réponse de la fonction -> { [idElement]: { propositions, sur } }.
// Tout ce qui est mal formé est ignoré : jamais d'exception.
export function lireReponseIA(reponse) {
  const parElement = {};
  for (const r of Array.isArray(reponse?.resultats) ? reponse.resultats : []) {
    if (typeof r?.id !== 'string' || !r.id) continue;
    const propositions = [];
    for (const p of Array.isArray(r.propositions) ? r.propositions : []) {
      if (typeof p?.produit_id !== 'string' || !p.produit_id || typeof p?.produit_nom !== 'string' || !p.produit_nom) continue;
      if (propositions.some(x => x.produit_id === p.produit_id)) continue;
      propositions.push({ produit_id: p.produit_id, produit_nom: p.produit_nom });
    }
    if (propositions.length > 0) parElement[r.id] = { propositions, sur: r.sur === true && propositions.length === 1 };
  }
  return parElement;
}

// Une seule liste de propositions, 3 au plus, sans doublon :
// 1. ce que les deux méthodes proposent toutes les deux (le plus fiable) ;
// 2. le reste de l'IA (elle comprend le sens) ;
// 3. le reste de la ressemblance des mots.
// Une fiche déjà achetée garde sa mention « déjà acheté ».
export function fusionnerPropositions(ia, lexicales, achats = null) {
  const duSens = Array.isArray(ia) ? ia : [];
  const desMots = Array.isArray(lexicales) ? lexicales : [];
  const dansLesMots = new Set(desMots.map(p => p.produit_id));
  const ordre = [...duSens.filter(p => dansLesMots.has(p.produit_id)), ...duSens.filter(p => !dansLesMots.has(p.produit_id)), ...desMots];
  const vues = new Set();
  const fusion = [];
  for (const p of ordre) {
    if (!p?.produit_id || vues.has(p.produit_id)) continue;
    vues.add(p.produit_id);
    const connue = desMots.find(x => x.produit_id === p.produit_id);
    fusion.push({ produit_id: p.produit_id, produit_nom: p.produit_nom, dejaAchete: !!connue?.dejaAchete || Number(achats?.[p.produit_id]) > 0 });
    if (fusion.length >= MAX_PROPOSITIONS) break;
  }
  return fusion;
}

// La fiche à relier toute seule pour cet élément, ou null.
// Exige une réponse « sûre » ET une fiche unique : au moindre doute, on propose.
export function ficheARelierSeule(resultat) {
  if (!RELIER_SEUL_SI_IA_SURE || resultat?.sur !== true) return null;
  const propositions = Array.isArray(resultat.propositions) ? resultat.propositions : [];
  return propositions.length === 1 && propositions[0]?.produit_id && propositions[0]?.produit_nom ? propositions[0] : null;
}
