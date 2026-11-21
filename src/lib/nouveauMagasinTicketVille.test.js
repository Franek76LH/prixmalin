import { describe, it, expect } from 'vitest';
import { normaliserVille, villeSansAdresse, magasinsEnseigneVille, magasinConnuPourTicket, doitProposerNouveauMagasin, magasinReconnuPourTicket } from './nouveauMagasinTicket';

const auchan = (id, ville, adresse = null, cp = null) => ({ id, nom: `Auchan ${ville}`, ville, adresse, code_postal: cp, enseignes: { slug: 'auchan' } });
const magasins = [
  auchan('stloup', 'Marseille', '1 bd de St Loup', '13010'),
  { id: 'inter', nom: 'Intermarché', ville: 'AIX EN PROVENCE', adresse: 'av X', code_postal: '13100', enseignes: { slug: 'intermarche' } },
];

describe('chantier 165 — ticket qui n\'imprime que la ville (Auchan Aix, 21/11)', () => {
  it('ville normalisée, ville seule reconnue, adresse avec chiffres laissée à l\'ancienne règle', () => {
    expect(normaliserVille('AIX-EN-PROVENCE')).toBe('aix en provence');
    expect(normaliserVille('Aix en Provence Cedex')).toBe('aix en provence');
    expect(villeSansAdresse('AIX-EN-PROVENCE')).toBe('aix en provence');
    expect(villeSansAdresse('210 av de Brédasque 13090 Aix')).toBeNull();
    expect(villeSansAdresse('')).toBeNull();
  });

  it('nouveau magasin proposé : pas d\'Auchan à Aix, même si un Intermarché y est', () => {
    expect(doitProposerNouveauMagasin({ nom: 'Auchan', adresse: 'AIX-EN-PROVENCE', enseigneId: 'auchan', magasins })).toBe(true);
  });

  it('ticket SANS aucune adresse : la carte est proposée si l\'enseigne est connue (elle demandera la ville)', () => {
    expect(doitProposerNouveauMagasin({ nom: 'Auchan', adresse: '', enseigneId: 'auchan', magasins })).toBe(true);
    expect(doitProposerNouveauMagasin({ nom: 'Épicerie', adresse: '', enseigneId: 'autre', magasins })).toBe(false);
    expect(doitProposerNouveauMagasin({ nom: '', adresse: '', enseigneId: 'auchan', magasins })).toBe(false);
  });

  it('au ticket suivant, le magasin créé avec la ville est RECONNU : pas de nouvelle carte, présélection', () => {
    const apres = [...magasins, auchan('aix', 'AIX-EN-PROVENCE')];
    expect(magasinConnuPourTicket({ adresse: 'AIX-EN-PROVENCE', enseigneId: 'auchan', magasins: apres })?.id).toBe('aix');
    expect(doitProposerNouveauMagasin({ nom: 'Auchan', adresse: 'Aix-en-Provence', enseigneId: 'auchan', magasins: apres })).toBe(false);
    expect(magasinReconnuPourTicket({ adresse: 'AIX-EN-PROVENCE', enseigneId: 'auchan', magasins: apres })?.id).toBe('aix');
  });

  it('magasin créé avec son adresse complète : reconnu aussi par la ville', () => {
    const apres = [...magasins, auchan('hyper', 'Aix-en-Provence', '210 Avenue de Brédasque', '13090')];
    expect(magasinReconnuPourTicket({ adresse: 'AIX-EN-PROVENCE', enseigneId: 'auchan', magasins: apres })?.id).toBe('hyper');
  });

  it('deux Auchan dans la même ville : pas de présélection (on choisit), pas de carte « nouveau »', () => {
    const deux = [...magasins, auchan('a1', 'Aix-en-Provence'), auchan('a2', 'Aix-en-Provence', 'rue Y', '13100')];
    expect(magasinReconnuPourTicket({ adresse: 'AIX-EN-PROVENCE', enseigneId: 'auchan', magasins: deux })).toBeNull();
    expect(doitProposerNouveauMagasin({ nom: 'Auchan', adresse: 'AIX-EN-PROVENCE', enseigneId: 'auchan', magasins: deux })).toBe(false);
    expect(magasinsEnseigneVille({ ville: 'aix en provence', enseigneId: 'auchan', magasins: deux })).toHaveLength(2);
  });

  it('les tickets AVEC adresse gardent l\'ancienne règle', () => {
    const avec = [auchan('h', 'Aix-en-Provence', '210 Avenue de Brédasque', '13090')];
    expect(magasinReconnuPourTicket({ adresse: '210 AVENUE DE BREDASQUE 13090 AIX-EN-PROVENCE', enseigneId: 'auchan', magasins: avec })?.id).toBe('h');
  });
});
