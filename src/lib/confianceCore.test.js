import { describe, it, expect } from 'vitest';
import { peutValiderSoiMeme, seuilsConfiance, joursDepuis, SEUILS_CONFIANCE_DEFAUT } from './confianceCore';

const maintenant = new Date('2026-11-26T12:00:00Z');
const ilYa = (j) => new Date(maintenant.getTime() - j * 86400000).toISOString();

describe('seuilsConfiance', () => {
  it('réglages absents → 300 / 7 / 3', () => {
    expect(seuilsConfiance(null)).toEqual({ points: 300, anciennete: 7, joursTickets: 3 });
    expect(seuilsConfiance({})).toEqual(SEUILS_CONFIANCE_DEFAUT);
  });
  it('lit les lignes de parametres_globaux', () => {
    expect(seuilsConfiance([
      { cle: 'confiance_points_min', valeur: '500' },
      { cle: 'confiance_anciennete_jours', valeur: ' 14 ' },
      { cle: 'confiance_jours_tickets_min', valeur: '0' },
    ])).toEqual({ points: 500, anciennete: 14, joursTickets: 0 });
  });
  it('valeur illisible ou négative → défaut', () => {
    expect(seuilsConfiance({ confiance_points_min: 'beaucoup', confiance_anciennete_jours: '-3', confiance_jours_tickets_min: '2.5' }))
      .toEqual({ points: 300, anciennete: 7, joursTickets: 3 });
  });
});

describe('joursDepuis', () => {
  it('compte les jours entiers', () => {
    expect(joursDepuis(ilYa(7), maintenant)).toBe(7);
    expect(joursDepuis(new Date(maintenant.getTime() - 6.9 * 86400000).toISOString(), maintenant)).toBe(6);
  });
  it('date absente ou fausse → null', () => {
    expect(joursDepuis(null, maintenant)).toBeNull();
    expect(joursDepuis('pas une date', maintenant)).toBeNull();
  });
});

describe('peutValiderSoiMeme', () => {
  const base = { pointsValides: 300, compteCreeLe: ilYa(7), joursTickets: 3, maintenant };

  it('seuils pile atteints → oui (règle)', () => {
    expect(peutValiderSoiMeme(base)).toEqual({ ok: true, raison: 'regle', manque: {} });
  });
  it('299 points → non, il manque 1 point', () => {
    const r = peutValiderSoiMeme({ ...base, pointsValides: 299 });
    expect(r.ok).toBe(false);
    expect(r.manque).toEqual({ points: 1 });
  });
  it('compte de 6 jours → non', () => {
    expect(peutValiderSoiMeme({ ...base, compteCreeLe: ilYa(6) }).manque).toEqual({ jours: 1 });
  });
  it('tickets sur 2 jours seulement → non', () => {
    expect(peutValiderSoiMeme({ ...base, joursTickets: 2 }).manque).toEqual({ joursTickets: 1 });
  });
  it('date de création inconnue → non', () => {
    expect(peutValiderSoiMeme({ ...base, compteCreeLe: null }).ok).toBe(false);
  });
  it('débutant complet : tout manque', () => {
    const r = peutValiderSoiMeme({ maintenant, compteCreeLe: ilYa(1) });
    expect(r).toEqual({ ok: false, raison: 'pas_encore', manque: { points: 300, jours: 6, joursTickets: 3 } });
  });
  it('testeur → oui sans condition', () => {
    expect(peutValiderSoiMeme({ estTesteur: true, maintenant })).toEqual({ ok: true, raison: 'testeur', manque: {} });
  });
  it('testeur suspendu → non', () => {
    expect(peutValiderSoiMeme({ estTesteur: true, estSuspendu: true, maintenant }).raison).toBe('suspendu');
  });
  it('compte suspendu même avec tous les seuils → non', () => {
    expect(peutValiderSoiMeme({ ...base, estSuspendu: true }).ok).toBe(false);
  });
  it('admin → oui, même suspendu (l\'admin ne peut pas être suspendu en base)', () => {
    expect(peutValiderSoiMeme({ estAdmin: true, estSuspendu: true, maintenant }).raison).toBe('admin');
  });
  it('seuils réglés autrement', () => {
    const seuils = seuilsConfiance({ confiance_points_min: '100', confiance_anciennete_jours: '0', confiance_jours_tickets_min: '1' });
    expect(peutValiderSoiMeme({ pointsValides: 100, compteCreeLe: ilYa(0), joursTickets: 1, seuils, maintenant }).ok).toBe(true);
  });
  it('appel sans argument → non, sans planter', () => {
    expect(peutValiderSoiMeme().ok).toBe(false);
  });
});
