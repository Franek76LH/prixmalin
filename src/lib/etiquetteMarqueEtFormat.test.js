import { describe, it, expect } from 'vitest';
import { etiquetteMarqueEtFormat, mapperLigneListeCourses } from './catalogueCore';

describe('étiquette d\'une ligne de liste avec marque', () => {
  it('affiche la marque devant le libellé', () => {
    expect(etiquetteMarqueEtFormat({ libelle: 'Rituel 9°', marques: { nom: 'Leffe', est_mdd: false } })).toBe('Leffe · Rituel 9°');
  });
  it('ne répète pas une marque déjà dans le libellé', () => {
    expect(etiquetteMarqueEtFormat({ libelle: 'Pepsi zéro 1,5L', marques: { nom: 'Pepsi', est_mdd: false } })).toBe('Pepsi zéro 1,5L');
    // « 8,6 % » dans le libellé dit déjà la marque 8.6
    expect(etiquetteMarqueEtFormat({ libelle: 'Original blonde intense 8,6%', marques: { nom: '8.6', est_mdd: false } })).toBe('Original blonde intense 8,6%');
  });
  it('sans libellé : marque et quantité', () => {
    expect(etiquetteMarqueEtFormat({ quantite_nette: 0.295, unite_quantite: 'kg', marques: { nom: "Lay's", est_mdd: false } })).toBe("Lay's · 0,295 kg");
    expect(etiquetteMarqueEtFormat({ marques: { nom: 'Leffe' } })).toBe('Leffe');
  });
  it('jamais le nom d\'une marque de distributeur ; sans marque, comme avant', () => {
    expect(etiquetteMarqueEtFormat({ libelle: 'Bolognaise 400 g', marques: { nom: 'Bio Village', est_mdd: true } })).toBe('Bolognaise 400 g');
    expect(etiquetteMarqueEtFormat({ quantite_nette: 500, unite_quantite: 'g' })).toBe('500 g');
    expect(etiquetteMarqueEtFormat(null)).toBe('Format indifférent');
  });
  it('la ligne de liste garde son format de calcul et gagne la marque à l\'affichage', () => {
    const ligne = mapperLigneListeCourses({ id: 'l', quantite: 2, statut: 'a_acheter', produit_id: 'p', variante_produit_id: 'v',
      produit: { nom_reference: 'Bière blonde' }, variante: { id: 'v', libelle: 'Rituel 9°', quantite_nette: 50, unite_quantite: 'cl', marques: { nom: 'Leffe', est_mdd: false } } });
    expect(ligne.format).toBe('Rituel 9°');
    expect(ligne.formatDisplay).toBe('Leffe · Rituel 9°');
  });
});

describe('chantier 204 — ligne « cette marque, tous formats »', () => {
  it('affiche la marque et la garde ; ignorée si un format précis est choisi', () => {
    const l = mapperLigneListeCourses({ id: 'l', quantite: 1, statut: 'a_acheter', produit_id: 'biere', variante_produit_id: null, marque_id: 'm86', marque_ligne: { id: 'm86', nom: '8.6' }, produit: { nom_reference: 'Bière' } });
    expect(l.formatDisplay).toBe('8.6 · tous formats');
    expect(l.marque_id).toBe('m86');
    expect(l.marque_nom).toBe('8.6');
    const sans = mapperLigneListeCourses({ id: 'l', quantite: 1, statut: 'a_acheter', produit_id: 'biere', variante_produit_id: null, produit: { nom_reference: 'Bière' } });
    expect(sans.formatDisplay).toBe('Format indifférent');
    expect(sans.marque_id).toBeNull();
    const fixe = mapperLigneListeCourses({ id: 'l', quantite: 1, statut: 'a_acheter', produit_id: 'biere', variante_produit_id: 'v', marque_id: 'm86', marque_ligne: { nom: '8.6' }, variante: { quantite_nette: 500, unite_quantite: 'ml', marques: { nom: '8.6' } } });
    expect(fixe.marque_nom).toBeNull();
  });
});
