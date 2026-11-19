// Chantier 156 — comptes de confiance (décision de François, 19/11 : Nico et
// Bouchman voient les fonctions qui lui étaient réservées — micro, import d'un
// ticket en fichier).
//
// La liste vit dans la base (parametres_globaux), jamais dans le code : on
// l'allonge sans redéployer, et aucun identifiant de compte n'est publié.
// Deux clés lues : `testeurs_confiance` (dédiée, facultative) et
// `scan_apres_ticket_testeurs` (déjà en service depuis le chantier 142).
// Réglage absent, vide ou illisible : personne n'est testeur.

export const CLES_TESTEURS = ['testeurs_confiance', 'scan_apres_ticket_testeurs'];

// "id1, id2" -> ['id1', 'id2']
export function listeDeComptes(valeur) {
  return String(valeur ?? '').split(',').map(t => t.trim()).filter(Boolean);
}

// reglages : { cle: valeur } tel que lu dans parametres_globaux.
export function estTesteurDeConfiance(reglages, idCompte) {
  if (!idCompte || !reglages || typeof reglages !== 'object') return false;
  return CLES_TESTEURS.some(cle => listeDeComptes(reglages[cle]).includes(idCompte));
}
