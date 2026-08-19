import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Chantier 111 — garde-fou de NON-RÉGRESSION sur le BRANCHEMENT.
//
// La logique est testée dans lib/suggestionsRattachement.test.js. Ce qui ne
// s'y voit pas, c'est la règle qui fait tout l'intérêt du chantier : une
// suggestion S'AFFICHE, elle ne se PRÉ-REMPLIT JAMAIS.
//
// C'est la leçon directe du 110 : un état pré-rempli finit par être validé
// sans être lu. Le 110 a corrigé un état qui SURVIVAIT d'une ligne à l'autre ;
// pré-remplir volontairement la sélection depuis une devinette de la base
// recréerait le même défaut par la porte d'à côté, en pire — cette fois avec
// l'apparence d'une fonctionnalité.
//
// Le projet n'a ni jsdom ni testing-library : on verrouille au niveau du
// source (même parti pris que RecapitulatifAssociation.test.js).

const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8');
const app = lire('../App.jsx');
const carte = lire('./CarteSuggestion.jsx');

const corpsComposant = (() => {
  const debut = app.indexOf('function CorrigerProduitSheet(');
  const fin = app.indexOf('// ── MULTI PHOTO SHEET', debut);
  return app.slice(debut, fin);
})();

// Les états qui font qu'un écran « a l'air déjà rempli ». Volontairement sans
// `recapitulatif` : ouvrir le récapitulatif EST l'effet attendu de « Oui,
// c'est ça », et il n'a rien de silencieux — c'est un écran que François lit.
const ETATS_PRESELECTION = ['Query', 'Results', 'ProduitEnAttente', 'VariantesAChoisir', 'VarianteChoisie'];

describe('la suggestion ne pré-remplit rien', () => {
  // LE test qui MORD. Semer la suggestion dans l'un de ces états le fait
  // rougir.
  it.each(ETATS_PRESELECTION)('set%s n\'est jamais alimenté par la suggestion', (etat) => {
    // Argument de CE seul appel : `[^;]*` traversait le JSX (qui contient très
    // peu de points-virgules) et allait chercher le mot « suggestion » des
    // centaines de lignes plus bas.
    const seme = new RegExp(`set${etat}\\([^)\\n]*suggestion`, 'i');
    expect(corpsComposant).not.toMatch(seme);
  });

  it('aucun effet ne se déclenche sur la suggestion (pas de remplissage automatique)', () => {
    // Un useEffect réagissant à `suggestion` est LE vecteur d'un pré-remplissage
    // silencieux : il s'exécuterait sans que personne n'ait rien tapé.
    const effets = corpsComposant.split('useEffect(').slice(1);
    for (const effet of effets) {
      expect(effet.slice(0, 900)).not.toContain('suggestion');
    }
  });

  it('la carte est DÉRIVÉE à chaque rendu, elle ne vit dans aucun état', () => {
    expect(corpsComposant).toMatch(/const carteSuggestion = suggestionRefusee/);
    expect(corpsComposant).not.toMatch(/useState\([^)]*carteSuggestion/);
  });

  it('la suggestion arrive par une prop d\'affichage, pas par un état', () => {
    expect(app).toMatch(/function CorrigerProduitSheet\(\{[^}]*suggestion = null/);
    expect(app).toMatch(/suggestion=\{suggestionCible\}/);
  });
});

describe('« Oui, c\'est ça » ne saute pas la relecture', () => {
  it('il passe par le récapitulatif du 110, jamais directement par la RPC', () => {
    const accepter = corpsComposant.slice(corpsComposant.indexOf('const accepterSuggestion = () => {'));
    const corps = accepter.slice(0, 500);
    expect(corps).toContain('demanderRelecture(');
    // Ni la RPC ni l'écriture directe : la suggestion suit exactement le même
    // chemin qu'un produit cherché à la main.
    expect(corps).not.toContain('finaliser(');
    expect(corps).not.toContain('onChoisir(');
  });

  it('le garde-fou de mots communs s\'applique donc à la suggestion', () => {
    // demanderRelecture construit le récapitulatif avec le libellé BRUT, qui
    // porte `divergent`. Passer par lui, c'est hériter du garde-fou.
    const demander = app.slice(app.indexOf('const demanderRelecture = async ('));
    expect(demander.slice(0, 1100)).toContain('construireRecapitulatif(');
    expect(demander.slice(0, 1100)).toContain('libelleTicket,');
  });

  it('une suggestion sans produit résolu ne déclenche rien', () => {
    const accepter = corpsComposant.slice(corpsComposant.indexOf('const accepterSuggestion = () => {'));
    expect(accepter.slice(0, 200)).toContain('if (!suggestion?.produit?.id) return;');
  });
});

describe('« Non, chercher autre chose »', () => {
  it('efface la carte et rend l\'écran de recherche habituel', () => {
    expect(app).toMatch(/onRefuser=\{\(\)=>setSuggestionRefusee\(true\)\}/);
    expect(corpsComposant).toMatch(/const carteSuggestion = suggestionRefusee\s*\n?\s*\?\s*null/);
  });
});

describe('la suggestion est vidée entre deux lignes', () => {
  it('suggestionCible est remise à null AVANT tout rechargement', () => {
    const effet = app.slice(app.indexOf('setEnseigneCourante(null);'));
    const tete = effet.slice(0, 260);
    expect(tete).toContain('setSuggestionCible(null);');
    expect(tete).toContain('if (!correctionCible) return;');
  });

  it('la feuille reste remontée par ligne (protection du 110 intacte)', () => {
    expect(app).toMatch(/<CorrigerProduitSheet\s+key=\{correctionCible\.cleLigne\}/);
  });
});

describe('le compte des lignes à confirmer', () => {
  it('est affiché sur la carte du ticket, avec un ton neutre', () => {
    expect(app).toContain('à confirmer');
    expect(app).toMatch(/comptesAConfirmer\.get\(jourArchive\(arc\.date\)\)/);
  });

  it('ne compte que les lignes suggérées ET non rattachées', () => {
    const requete = app.slice(app.indexOf('const rechargerComptesAConfirmer'));
    const corps = requete.slice(0, 700);
    expect(corps).toContain(".not('produit_suggere_ia_id', 'is', null)");
    expect(corps).toContain(".is('produit_id', null)");
  });

  it('une erreur de chargement garde le compte précédent, jamais un faux zéro', () => {
    const requete = app.slice(app.indexOf('const rechargerComptesAConfirmer'));
    expect(requete.slice(0, 800)).toMatch(/if \(error\) \{[^}]*return; \}/);
  });

  it('est rafraîchi après une confirmation (retour à la liste, compte à jour)', () => {
    const rattacher = app.slice(app.indexOf('const rattacherProduit = async ('));
    expect(rattacher.slice(0, 2200)).toContain('rechargerComptesAConfirmer();');
  });

  it('la confirmation ne fait PAS enchaîner sur la ligne suivante', () => {
    // finaliser ferme la feuille : on revient à la liste des lignes du ticket.
    // Enchaîner automatiquement est précisément ce qui a produit le défaut du
    // 110, et rien dans le code ne doit rouvrir une autre ligne tout seul.
    const finaliser = app.slice(app.indexOf('const finaliser = async ('));
    const corps = finaliser.slice(0, 700);
    expect(corps).toContain('setTimeout(onClose, 900)');
    expect(corps).not.toContain('setCorrectionCible');
  });
});

describe('l\'écran de la carte lui-même', () => {
  it('dit ce qu\'il a deviné et d\'où ça vient', () => {
    expect(carte).toContain('On dirait :');
    expect(carte).toContain('{origine}');
  });

  it('les deux boutons demandés', () => {
    expect(carte).toContain("Oui, c'est ça");
    expect(carte).toContain('Non, chercher autre chose');
  });

  it('affiche le texte BRUT du ticket quand il existe', () => {
    expect(carte).toContain('libelleTicketDisponible &&');
    expect(carte).toContain('{libelleTicket}');
  });

  it('ne plante pas sans carte ni sans variante', () => {
    expect(carte).toContain('if (!carte) return null;');
    expect(carte).toContain('{(marque || format) && (');
  });
});
