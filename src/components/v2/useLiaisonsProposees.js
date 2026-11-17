// Chantier 126 — propositions de liaison pour les produits de la liste écrits
// en texte libre (« Coca-Cola », « fromage râpé », « knacky »).
//
// Tant qu'un produit de la liste n'est pas relié à une fiche du catalogue, le
// comparateur ne lui trouve aucun prix : c'est ce qui a donné « Aucun prix
// enregistré pour Coca-Cola, fromage râpé, knacky » le 09/11 alors que ces
// produits ont des prix. Ce hook cherche, pour chacun, jusqu'à 3 fiches qui
// ressemblent. Il ne modifie RIEN : relier reste un geste de l'utilisateur.
import { useEffect, useRef, useState } from 'react';
import { proposerLiaison, motsUtiles } from '../../lib/liaisonAutoListe';

// Produits de la liste qui ne sont reliés à aucune fiche.
export function produitsNonRelies(items) {
  return (items || []).filter(i => !i?.produit_id && motsUtiles(i?.product).length > 0);
}

// chercher(terme) -> Promise<fiches[]> (recherche catalogue).
// Rend { [idDeLigne]: [{ produit_id, produit_nom }] }.
export function useLiaisonsProposees(items, chercher) {
  const [parTexte, setParTexte] = useState({});
  const demandes = useRef(new Set()); // textes déjà cherchés (ou en cours)
  const monte = useRef(true);
  useEffect(() => { monte.current = true; return () => { monte.current = false; }; }, []);

  useEffect(() => {
    // Chantier 130 — on garde le texte tel qu'il est écrit (accents compris) :
    // c'est lui qui départage « pâtes » et « pâté ». La clé sans accent ne
    // sert qu'à ne pas chercher deux fois la même chose.
    const aChercher = new Map();
    for (const i of produitsNonRelies(items)) {
      const cle = motsUtiles(i.product).join(' ');
      if (!demandes.current.has(cle) && !aChercher.has(cle)) aChercher.set(cle, i.product);
    }
    aChercher.forEach(async (texte, cle) => {
      demandes.current.add(cle);
      const decision = await proposerLiaison(texte, chercher);
      const propositions = decision.produit ? [decision.produit] : decision.suggestions;
      if (monte.current) setParTexte(prev => ({ ...prev, [cle]: propositions.map(p => ({ produit_id: p.produit_id, produit_nom: p.produit_nom })) }));
    });
  }, [items, chercher]);

  const parLigne = {};
  for (const i of produitsNonRelies(items)) {
    const propositions = parTexte[motsUtiles(i.product).join(' ')];
    if (propositions?.length) parLigne[i.id] = propositions;
  }
  return parLigne;
}
