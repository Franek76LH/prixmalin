import { describe, it, expect, vi } from 'vitest';
vi.mock('./supabase', () => ({ supabase: {} }));
import { emojiArticleListe, emojiCategorieDevinee, cleProduitsListe, EMOJI_PAR_DEFAUT } from './iconeListe';

describe('Chantier 224 — icône de repli de « Ma liste »', () => {
  const rayons = new Map([[12, { categorie_slug: 'produits-laitiers-oeufs' }], [7, { categorie_slug: 'boissons-non-alcoolisees' }]]);

  it('prend le rayon réel du produit en priorité', () => {
    expect(emojiArticleListe({ produit_id: 12, product: 'Coca' }, rayons, () => 'Boissons non alcoolisées')).toBe('🥛');
    expect(emojiArticleListe({ produit_id: 7 }, rayons)).toBe('🥤');
  });

  it('devine sur le nom quand la ligne n’a pas de produit relié', () => {
    expect(emojiArticleListe({ product: 'pain de mie' }, new Map(), () => 'Épicerie salée')).toBe('🧂');
  });

  it('panier par défaut sinon (catégorie inconnue, rien de relié, rien à deviner)', () => {
    expect(emojiArticleListe({ product: 'truc' }, new Map(), () => 'Autres')).toBe(EMOJI_PAR_DEFAUT);
    expect(emojiArticleListe({ produit_id: 99 }, new Map())).toBe(EMOJI_PAR_DEFAUT);
    expect(emojiArticleListe(null, null)).toBe(EMOJI_PAR_DEFAUT);
  });

  it('rayon réel avec un slug inconnu → panier, sans planter', () => {
    expect(emojiArticleListe({ produit_id: 3 }, new Map([[3, { categorie_slug: 'nouveau' }]]))).toBe(EMOJI_PAR_DEFAUT);
  });

  it('la sous-catégorie donne un dessin plus précis que le rayon', () => {
    const r = new Map([['p', { categorie_slug: 'epicerie-salee', sous_categorie_nom: 'Pâtes' }], ['q', { categorie_slug: 'epicerie-salee', sous_categorie_nom: 'Inconnue' }]]);
    expect(emojiArticleListe({ produit_id: 'p' }, r)).toBe('🍝');
    expect(emojiArticleListe({ produit_id: 'q' }, r)).toBe('🧂');
  });

  it('libellés devinés connus', () => {
    expect(emojiCategorieDevinee('Fruits et légumes')).toBe('🥦');
    expect(emojiCategorieDevinee('Autres')).toBe(null);
  });

  it('clé stable : ordre et doublons sans effet, coches sans effet', () => {
    expect(cleProduitsListe([{ produit_id: 5 }, { produit_id: 2 }, { produit_id: 5, checked: true }, { product: 'x' }])).toBe('2,5');
    expect(cleProduitsListe([])).toBe('');
  });
});
