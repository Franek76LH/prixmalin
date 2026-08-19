import { describe, it, expect } from 'vitest';
import {
  interpreterResultatCore,
  NIVEAU_SUCCES,
  NIVEAU_INFO,
  NIVEAU_ECHEC,
} from './resultatEcritureCore';

const alias = (libelle) => ({ motif: 'alias_non_trouve', libelle });

describe('statut rejet — RIEN n\'a été écrit', () => {
  it('magasin_non_resolu : échec, message clair, et quoi faire', () => {
    const r = interpreterResultatCore(
      { statut: 'rejet', prix_ecrits: 0, rejets: [{ motif: 'magasin_non_resolu' }] },
      { lignesEnvoyees: 20 },
    );
    expect(r.niveau).toBe(NIVEAU_ECHEC);
    expect(r.titre).toBe("Tes prix n'ont pas été enregistrés dans le comparateur");
    expect(r.detail).toMatch(/magasin n'a pas été reconnu/i);
    expect(r.detail).toMatch(/rescanne/i);
    expect(r.prixEcrits).toBe(0);
  });

  // LE cas réel du 18/08 : contrainte violée par la valeur memoire_enseigne_flou.
  it('erreur_technique : échec, et le message brut est conservé pour diagnostic', () => {
    const brut = 'new row for relation "lignes_ticket" violates check constraint "lignes_ticket_methode_validation_produit_check"';
    const r = interpreterResultatCore(
      { statut: 'rejet', prix_ecrits: 0, rejets: [{ motif: 'erreur_technique', message: brut }] },
      { lignesEnvoyees: 20 },
    );
    expect(r.niveau).toBe(NIVEAU_ECHEC);
    expect(r.detail).toMatch(/problème technique/i);
    expect(r.messageTechnique).toBe(brut);
  });

  it('motif inconnu : échec quand même, jamais un succès par défaut', () => {
    const r = interpreterResultatCore({ statut: 'rejet', prix_ecrits: 0, rejets: [{ motif: 'zzz' }] });
    expect(r.niveau).toBe(NIVEAU_ECHEC);
    expect(r.messageTechnique).toMatch(/zzz/);
  });
});

describe('réussite complète — on ne dit rien de plus', () => {
  it('statut ok, tous les prix écrits : aucun message d\'alerte', () => {
    const r = interpreterResultatCore({ statut: 'ok', prix_ecrits: 20, rejets: [] }, { lignesEnvoyees: 20 });
    expect(r.niveau).toBe(NIVEAU_SUCCES);
    expect(r.titre).toBeNull();
    expect(r.detail).toBeNull();
  });

  it('sans dénominateur connu, on n\'invente pas de réussite partielle', () => {
    const r = interpreterResultatCore({ statut: 'ok', prix_ecrits: 14, rejets: [] });
    expect(r.niveau).toBe(NIVEAU_SUCCES);
  });
});

describe('alias_non_trouve — le fonctionnement NORMAL, pas un échec', () => {
  it('6 alias non trouvés : information neutre, jamais présentée comme un échec', () => {
    const r = interpreterResultatCore(
      { statut: 'rejet_partiel', prix_ecrits: 14, rejets: Array.from({ length: 6 }, (_, i) => alias(`ART ${i}`)) },
      { lignesEnvoyees: 20 },
    );
    expect(r.niveau).toBe(NIVEAU_INFO);
    expect(r.niveau).not.toBe(NIVEAU_ECHEC);
    expect(r.aRattacher).toBe(6);
    expect(r.detail).toBe('14 prix enregistrés sur 20 · 6 lignes à rattacher');
    // Aucun vocabulaire d'échec ni d'alarme.
    expect(r.titre).toBeNull();
    expect(r.detail).not.toMatch(/échec|erreur|problème/i);
  });

  it('une seule ligne à rattacher : le singulier est respecté', () => {
    const r = interpreterResultatCore(
      { statut: 'rejet_partiel', prix_ecrits: 19, rejets: [alias('ART')] },
      { lignesEnvoyees: 20 },
    );
    expect(r.detail).toBe('19 prix enregistrés sur 20 · 1 ligne à rattacher');
  });
});

describe('réussite partielle avec un vrai problème', () => {
  it('erreur_technique sur une ligne : information, pas échec total (le ticket est en base)', () => {
    const r = interpreterResultatCore(
      {
        statut: 'rejet_partiel',
        prix_ecrits: 18,
        rejets: [{ motif: 'erreur_technique', message: 'prix unitaire manquant ou negatif' }, alias('X')],
      },
      { lignesEnvoyees: 20 },
    );
    expect(r.niveau).toBe(NIVEAU_INFO);
    expect(r.titre).toBe('Enregistrement incomplet');
    expect(r.detail).toMatch(/18 prix enregistrés sur 20/);
    expect(r.messageTechnique).toBe('prix unitaire manquant ou negatif');
  });

  it('prix_ecrits inférieur aux lignes sans aucun rejet : on le dit quand même', () => {
    const r = interpreterResultatCore({ statut: 'ok', prix_ecrits: 14, rejets: [] }, { lignesEnvoyees: 20 });
    expect(r.niveau).toBe(NIVEAU_INFO);
    expect(r.detail).toBe('14 prix enregistrés sur 20');
  });
});

describe('dans le doute, l\'échec', () => {
  it('réponse absente (RPC en erreur réseau) : échec honnête, jamais un faux succès', () => {
    for (const valeur of [null, undefined, 0, '', 'ok', [], { prix_ecrits: 20 }, { statut: 42 }]) {
      const r = interpreterResultatCore(valeur, { lignesEnvoyees: 20 });
      expect(r.niveau).toBe(NIVEAU_ECHEC);
      expect(r.titre).toBe("Tes prix n'ont pas été enregistrés dans le comparateur");
    }
  });

  it('statut inconnu : échec, avec le statut brut pour diagnostic', () => {
    const r = interpreterResultatCore({ statut: 'perplexe', prix_ecrits: 3, rejets: [] }, { lignesEnvoyees: 20 });
    expect(r.niveau).toBe(NIVEAU_ECHEC);
    expect(r.messageTechnique).toMatch(/perplexe/);
  });

  it('ne plante jamais, même sans argument', () => {
    expect(() => interpreterResultatCore()).not.toThrow();
    expect(interpreterResultatCore().niveau).toBe(NIVEAU_ECHEC);
  });

  it('un dénominateur absurde est ignoré plutôt que d\'inventer un compte', () => {
    const r = interpreterResultatCore({ statut: 'ok', prix_ecrits: 20, rejets: [] }, { lignesEnvoyees: 'vingt' });
    expect(r.lignesEnvoyees).toBeNull();
    expect(r.niveau).toBe(NIVEAU_SUCCES);
  });
});
