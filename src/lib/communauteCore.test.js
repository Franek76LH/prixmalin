import { describe, it, expect } from 'vitest';
import { prochainPalier, nombre, defiCommunaute, motPourToi, merciApresScan, MEMBRES_MIN } from './communauteCore';

describe('prochainPalier', () => {
  it('vise toujours le palier juste au-dessus', () => {
    expect(prochainPalier(0)).toBe(50);
    expect(prochainPalier(55)).toBe(100);
    expect(prochainPalier(100)).toBe(250);
    expect(prochainPalier(2419)).toBe(2500);
  });
  it('au-delà du dernier palier : le prochain multiple de 100 000', () => {
    expect(prochainPalier(100000)).toBe(200000);
    expect(prochainPalier(250001)).toBe(300000);
  });
  it('valeur absente ou absurde : comme zéro', () => {
    expect(prochainPalier(null)).toBe(50);
    expect(prochainPalier(-3)).toBe(50);
  });
});

describe('nombre', () => {
  it('sépare les milliers', () => expect(nombre(2419)).toBe('2 419'));
});

describe('defiCommunaute', () => {
  const stats = { prix_30j: 55, prix_total: 2419, produits: 865, magasins: 20, contributeurs_30j: 1, mes_prix_30j: 12 };
  it('rend les vrais chiffres et le palier visé', () => {
    expect(defiCommunaute(stats)).toMatchObject({ recents: 55, palier: 100, reste: 45, pourcentage: 55, miens: 12, total: 2419, produits: 865, magasins: 20 });
  });
  it('ne montre pas le nombre de membres tant qu’ils sont trop peu', () => {
    expect(defiCommunaute(stats).membres).toBeNull();
    expect(defiCommunaute({ ...stats, contributeurs_30j: MEMBRES_MIN }).membres).toBe(MEMBRES_MIN);
  });
  it('la barre n’est jamais vide ni pleine', () => {
    expect(defiCommunaute({ ...stats, prix_30j: 0 }).pourcentage).toBe(4);
    expect(defiCommunaute({ ...stats, prix_30j: 249 }).pourcentage).toBe(99);
  });
  it('mes prix ne dépassent jamais ceux de la communauté', () => {
    expect(defiCommunaute({ ...stats, mes_prix_30j: 999 }).miens).toBe(55);
  });
  it('chiffres absents : rien à afficher', () => {
    expect(defiCommunaute(null)).toBeNull();
    expect(defiCommunaute({})).toBeNull();
  });
});

describe('motPourToi', () => {
  it('invite quand on n’a encore rien apporté', () => {
    expect(motPourToi({ miens: 0 })).toMatch(/prochain ticket/);
  });
  it('remercie avec le vrai compte', () => {
    expect(motPourToi({ miens: 1 })).toBe('Tu as apporté 1 prix ce mois-ci. Merci !');
    expect(motPourToi({ miens: 12 })).toBe('Tu as apporté 12 prix ce mois-ci. Merci !');
  });
});

describe('merciApresScan', () => {
  it('accorde au singulier et au pluriel', () => {
    expect(merciApresScan(1)).toBe('1 prix enregistré. Merci, il aide toute la communauté !');
    expect(merciApresScan(16)).toBe('16 prix enregistrés. Merci, ils aident toute la communauté !');
  });
  it('aucun prix : pas de faux merci', () => expect(merciApresScan(0)).toBe('Ticket enregistré.'));
});
