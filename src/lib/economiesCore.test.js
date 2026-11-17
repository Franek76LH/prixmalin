import { describe, it, expect } from 'vitest';
import { bilanEconomies, coursesDuMois, coursesAnalysees, nomDuMois } from './economiesCore';

const archives = [
  { date: '2026-08-03T10:00:00Z', ticket_scanned: true, realized_saving: 30.2 },
  { date: '2026-08-20T10:00:00Z', ticket_scanned: true, realized_saving: 10.39 },
  { date: '2026-07-11T10:00:00Z', ticket_scanned: true, realized_saving: -8.34 },
  { date: '2026-11-02T10:00:00Z', ticket_scanned: true, realized_saving: 0 },
  { date: '2025-12-24T10:00:00Z', ticket_scanned: true, realized_saving: 0.73 },
  { date: '2026-08-21T10:00:00Z', ticket_scanned: false, realized_saving: 99 },
  { date: '2026-08-22T10:00:00Z', ticket_scanned: true, realized_saving: null },
  { date: null, ticket_scanned: true, realized_saving: 1 },
];

describe('bilanEconomies', () => {
  const b = bilanEconomies(archives);
  it('ne compte que les courses dont le ticket a été scanné et comparé', () => {
    expect(coursesAnalysees(archives)).toHaveLength(6);
    expect(b.nbCourses).toBe(6);
    expect(b.total).toBe(33.98);
  });
  it('mois du plus récent au plus ancien, un mois négatif reste négatif', () => {
    expect(b.mois).toEqual([
      { mois: '2026-11', total: 0, nb: 1 },
      { mois: '2026-08', total: 40.59, nb: 2 },
      { mois: '2026-07', total: -8.34, nb: 1 },
      { mois: '2025-12', total: 0.73, nb: 1 },
    ]);
    expect(b.annees).toEqual([2026, 2025]);
  });
  it('meilleur mois : le plus haut, seulement s\'il est positif', () => {
    expect(b.meilleurMois).toBe('2026-08');
    expect(bilanEconomies([{ date: '2026-07-01', ticket_scanned: true, realized_saving: -2 }]).meilleurMois).toBeNull();
  });
  it('rien à analyser : zéros, jamais d\'exception', () => {
    expect(bilanEconomies(null)).toEqual({ total: 0, nbCourses: 0, mois: [], annees: [], meilleurMois: null });
  });
});

describe('coursesDuMois / nomDuMois', () => {
  it('les courses d\'un mois, la plus récente d\'abord', () => {
    expect(coursesDuMois(archives, '2026-08').map(c => c.realized_saving)).toEqual([10.39, 30.2]);
    expect(coursesDuMois(archives, '2024-01')).toEqual([]);
  });
  it('nom lisible', () => {
    expect(nomDuMois('2026-08')).toBe('Août 2026');
  });
});
