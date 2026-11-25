// Chantier 190 — le bouton « retour » du téléphone ferme d'abord la fenêtre
// ouverte par-dessus l'écran (feuille du bas, choix du magasin, bilan…), au
// lieu de changer l'écran en dessous.
//
// Principe : à l'ouverture d'une feuille, on ajoute une page à l'historique.
// Le retour du téléphone retire cette page : on ferme la feuille du dessus.
// Si la feuille se ferme autrement (✕, « Annuler », choix fait), on retire
// nous-mêmes sa page, à condition qu'elle soit encore la dernière (sinon,
// un changement d'écran est passé par-dessus : on la laisse, elle ne gêne pas).
import { useEffect, useRef } from 'react';

const pile = [];        // feuilles ouvertes, de la plus ancienne à celle du dessus
let compteur = 0;
let retoursAIgnorer = 0; // reculs déclenchés par nous, pas par l'utilisateur

function historique() {
  return typeof window !== 'undefined' ? window.history : null;
}

export function ouvrirFeuille(fermerRef) {
  const id = ++compteur;
  pile.push({ id, fermerRef });
  try { historique()?.pushState({ ...(historique().state || {}), feuille: id }, ''); } catch { /* sans effet */ }
  return id;
}

export function fermerFeuille(id) {
  const i = pile.findIndex(f => f.id === id);
  if (i < 0) return; // déjà fermée par le retour du téléphone
  pile.splice(i, 1);
  // Après coup : un remontage immédiat (mode développement) ou un changement
  // d'écran a pu ajouter une page entre-temps — dans ce cas on ne recule pas.
  setTimeout(() => {
    const h = historique();
    try {
      if (h?.state?.feuille === id) { retoursAIgnorer++; h.back(); }
    } catch { /* sans effet */ }
  }, 0);
}

// Appelé par l'écouteur de retour de l'app, avant tout changement d'écran.
// Vrai si le retour a été « consommé » (feuille fermée ou recul de notre fait).
export function gererRetourFeuille(etat) {
  if (retoursAIgnorer > 0) { retoursAIgnorer--; return true; }
  const dessus = pile[pile.length - 1];
  if (dessus && etat?.feuille !== dessus.id) {
    pile.pop();
    try { dessus.fermerRef.current?.(); } catch { /* sans effet */ }
    return true;
  }
  return false;
}

export function nbFeuillesOuvertes() { return pile.length; }

// Pour les tests.
export function _reinitialiserFeuilles() { pile.length = 0; retoursAIgnorer = 0; }

// À appeler en haut de toute feuille qui n'existe que tant qu'elle est ouverte.
export function useFermerParRetour(fermer, actif = true) {
  const ref = useRef(fermer);
  useEffect(() => { ref.current = fermer; });
  useEffect(() => {
    if (!actif) return undefined;
    // Ouverture différée d'un instant : une feuille montée puis aussitôt
    // démontée (mode développement de React) n'ajoute aucune page.
    let id = null;
    const minuterie = setTimeout(() => { id = ouvrirFeuille(ref); }, 0);
    return () => { clearTimeout(minuterie); if (id !== null) fermerFeuille(id); };
  }, [actif]);
}
