import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ETATS_SELECTION } from '../lib/coherenceAssociation';

// Chantier 110 — garde-fou de NON-RÉGRESSION sur le BRANCHEMENT.
//
// La logique est testée dans lib/coherenceAssociation.test.js. Ce qui ne s'y
// voit pas, c'est le câblage — et c'est précisément le câblage qui a produit
// les cinq mauvaises associations du 16-17/08 : la logique n'avait rien de
// faux, le composant n'était simplement jamais remis à zéro entre deux lignes.
//
// Le projet n'a ni jsdom ni testing-library (même parti pris que
// RechercheProduitSheet.test.js et ControleLectureTicket.test.js) : on
// verrouille au niveau du source.

const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8');
const app = lire('../App.jsx');
const ecran = lire('./RecapitulatifAssociation.jsx');

// Les déclarations d'état de CorrigerProduitSheet, isolées pour être inspectées.
const corpsComposant = (() => {
  const debut = app.indexOf('function CorrigerProduitSheet(');
  const fin = app.indexOf('const finaliser = async (', debut);
  return app.slice(debut, fin);
})();

describe('remise à zéro entre deux lignes', () => {
  // LA correction du défaut. Sans cette clé, React garde le même composant
  // monté quand on passe d'une ligne à l'autre (même type, même position dans
  // l'arbre) : seule la prop `item` change, et le produit choisi, la variante,
  // le terme cherché et les résultats affichés restent ceux de la ligne
  // précédente. C'est exactement ce qui a envoyé « Tendres perles à
  // l'italienne » pour une glace puis pour un ketchup.
  it('la feuille est REMONTÉE à chaque ligne : aucun état ne franchit la frontière', () => {
    expect(app).toMatch(/<CorrigerProduitSheet\s+key=\{correctionCible\.cleLigne\}/);
  });

  it('chaque ligne a une clé qui lui est propre', () => {
    // arc.id + index de l'article : deux articles d'un même ticket ont deux
    // clés distinctes, donc deux composants distincts.
    expect(app).toMatch(/setCorrectionCible\(\{arc,item,cleLigne:`\$\{arc\.id\}_\$\{j\}`\}\)/);
  });

  // Le test qui MORD : déclarer un état de sélection avec autre chose qu'une
  // valeur vide (par exemple en le semant depuis une prop) le ferait survivre
  // au remontage. Ajouter un état à ETATS_SELECTION sans le déclarer vide ici
  // fait rougir la suite.
  it.each(ETATS_SELECTION)('l\'état « %s » est déclaré VIDE, jamais semé', (nom) => {
    const declaration = new RegExp(
      `const \\[${nom}, set[A-Za-z]+\\] = useState\\(([^)]*)\\)`
    ).exec(corpsComposant);
    expect(declaration, `${nom} n'est pas déclaré dans CorrigerProduitSheet`).not.toBeNull();
    const initial = declaration[1].trim();
    expect(['""', "''", '[]', 'null'], `${nom} démarre avec « ${initial} »`).toContain(initial);
  });

  it('l\'enseigne et le libellé brut sont vidés AVANT d\'être rechargés', () => {
    // Ces deux-là vivent dans ArchiveTab, pas dans la feuille : le remontage ne
    // les nettoie pas. Sans ce vidage, l'écran de la ligne B affiche encore le
    // libellé brut de la ligne A pendant toute la durée de la requête.
    const effet = app.slice(app.indexOf('setEnseigneCourante(null);\n    setLibelleTicketCible(null);'));
    expect(effet.slice(0, 200)).toContain('if (!correctionCible) return;');
  });
});

describe('relecture avant d\'appliquer', () => {
  it('un tap sur un résultat n\'appelle plus la RPC : il ouvre la relecture', () => {
    // Le chemin « 0 ou 1 variante » et le chemin « plusieurs variantes »
    // passent tous deux par demanderRelecture.
    const choisir = app.slice(app.indexOf('const choisir = async (produit) => {'));
    expect(choisir.slice(0, 1400)).toMatch(/else demanderRelecture\(produit, varianteId/);

    const validerVariante = app.slice(app.indexOf('const validerVariante = () => {'));
    expect(validerVariante.slice(0, 500)).toMatch(/else demanderRelecture\(\s*produitEnAttente/);
  });

  it('la correction n\'est appliquée QUE depuis « Confirmer »', () => {
    const confirmer = app.slice(app.indexOf('const confirmerAssociation = () => {'));
    expect(confirmer.slice(0, 220)).toContain('finaliser(recapitulatif.produit, recapitulatif.varianteId)');
    expect(app).toMatch(/onConfirmer=\{confirmerAssociation\}/);
  });

  it('« Annuler » n\'écrit rien et relâche le produit choisi', () => {
    const annuler = app.slice(app.indexOf('const annulerRelecture = () => {'));
    const corps = annuler.slice(0, 220);
    expect(corps).toContain('setRecapitulatif(null)');
    expect(corps).toContain('setProduitEnAttente(null)');
    expect(corps).toContain('setVarianteChoisie(null)');
    expect(corps).not.toContain('finaliser');
  });

  it('le chemin code-barres garde son propre écran (rien n\'est retiré)', () => {
    expect(app).toContain('const relierViaBarcode = () => {');
    expect(app).toMatch(/if \(codeBarresEnAttente\) await procederApprentissage\(produit, varianteId\);/);
  });

  it('la relecture compare et affiche le texte BRUT du ticket', () => {
    // libelle_ticket est bien ramené de la base...
    expect(app).toContain("libelle_brut, libelle_ticket");
    // ...et transmis à la feuille.
    expect(app).toMatch(/libelleTicket=\{libelleTicketCible\}/);
    // Le récapitulatif est construit avec, jamais avec le libellé normalisé.
    const demander = app.slice(app.indexOf('const demanderRelecture = async ('));
    expect(demander.slice(0, 1100)).toContain('libelleTicket,');
  });
});

describe('l\'écran de relecture lui-même', () => {
  it('met les deux identités face à face, en toutes lettres', () => {
    expect(ecran).toContain('Ligne du ticket');
    expect(ecran).toContain('Produit choisi');
  });

  it('les deux boutons demandés, et pas d\'autre sortie', () => {
    expect(ecran).toContain("Confirmer l'association");
    expect(ecran).toContain('Annuler');
  });

  it('le garde-fou est un AVERTISSEMENT, pas un blocage', () => {
    expect(ecran).toContain('Ce produit ne ressemble pas à la ligne du ticket. Vérifie avant de confirmer.');
    // Le bouton de confirmation ne doit dépendre que de `enCours` (appel en
    // cours), JAMAIS de `divergent` : François doit pouvoir confirmer quand même.
    const boutonConfirmer = ecran.slice(ecran.indexOf('onClick={onConfirmer}'));
    expect(boutonConfirmer.slice(0, 400)).toContain('disabled={enCours}');
    expect(boutonConfirmer.slice(0, 400)).not.toContain('divergent');
  });

  it('sans texte brut, l\'écran s\'affiche quand même et le dit', () => {
    expect(ecran).toContain('!libelleTicketDisponible');
    expect(ecran).toContain('Texte brut du ticket indisponible');
  });

  it('ne plante pas sur une donnée manquante', () => {
    expect(ecran).toContain('if (!recapitulatif) return null;');
    expect(ecran).toContain("nomProduit || '(produit sans nom)'");
  });
});

// ── Chantier 111b — le vocabulaire élargi, côté branchement ─────────────────
describe('vocabulaire du produit chargé avant la relecture', () => {
  const chargeur = app.slice(app.indexOf('const chargerVocabulaireProduit = async ('));

  it('lit les alias ACTIFS et les marques des variantes ACTIVES', () => {
    const corps = chargeur.slice(0, 1400);
    expect(corps).toContain("from('alias_produits')");
    expect(corps).toContain(".eq('statut', 'actif')");
    expect(corps).toContain("from('variantes_produit')");
    expect(corps).toContain(".eq('actif', true)");
    expect(corps).toContain('marques(nom)');
  });

  // Le filtre statut='actif' n'est PAS redondant avec la RLS : la policy dit
  // « statut = 'actif' OR est_administrateur() ». Sans ce filtre explicite,
  // François (administrateur) verrait aussi les alias inactifs et le garde-fou
  // rendrait un verdict différent du sien pour tous les autres utilisateurs.
  it('le filtre actif est explicite, pas laissé à la RLS', () => {
    expect(chargeur.slice(0, 1400)).toMatch(/alias_produits'\)[\s\S]{0,200}statut', 'actif'/);
  });

  it('toute défaillance retombe sur des listes vides (repli du 111b)', () => {
    const corps = chargeur.slice(0, 1600);
    expect(corps).toContain('const vide = { alias: [], marquesVariantes: [] };');
    expect(corps).toContain('if (!produitId) return vide;');
    expect(corps).toContain('return vide;');
    expect(corps).toContain('} catch (e) {');
  });

  it('le vocabulaire est chargé AVANT l\'ouverture du récapitulatif', () => {
    // Un bandeau qui s'affiche puis disparaît serait pire que pas de bandeau :
    // on ne saurait plus s'il a crié.
    const demander = app.slice(app.indexOf('const demanderRelecture = async ('));
    const corps = demander.slice(0, 1100);
    const posCharge = corps.indexOf('await chargerVocabulaireProduit(');
    const posRecap = corps.indexOf('setRecapitulatif(');
    expect(posCharge).toBeGreaterThanOrEqual(0);
    expect(posRecap).toBeGreaterThanOrEqual(0);
    expect(posCharge).toBeLessThan(posRecap);
  });

  it('et il est bien transmis au calcul de divergence', () => {
    const demander = app.slice(app.indexOf('const demanderRelecture = async ('));
    const corps = demander.slice(0, 1100);
    expect(corps).toContain('alias,');
    expect(corps).toContain('marquesVariantes,');
  });

  it('le côté TICKET n\'a pas bougé : toujours le texte de caisse brut', () => {
    const demander = app.slice(app.indexOf('const demanderRelecture = async ('));
    expect(demander.slice(0, 1100)).toContain('libelleTicket,');
    // Et surtout PAS le libellé normalisé par l'OCR.
    expect(demander.slice(0, 1100)).not.toContain('libelle_brut');
  });
});
