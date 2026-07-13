import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));

import { supabase } from './supabase';
import {
  chargerSuggestionsPourRejets,
  proposerAliasCore,
  validerSuggestionAliasCore,
  refuserSuggestionAliasCore,
} from './suggestionsAliasCore';

function creerBuilder(resultat) {
  const builder = {
    select: vi.fn(() => builder),
    in: vi.fn(() => builder),
    then: (resolve, reject) => Promise.resolve(resultat).then(resolve, reject),
  };
  return builder;
}

describe('chargerSuggestionsPourRejets', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renvoie [] sans appeler Supabase si la liste de rejets est vide', async () => {
    const resultat = await chargerSuggestionsPourRejets([]);
    expect(resultat).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('renvoie les suggestions trouvées, enrichies du nom produit/variante', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'suggestions_alias_core_ia') {
        return creerBuilder({
          data: [{ id: 1, rejet_ecriture_core_id: 10, produit_id: 'p1', variante_produit_id: 'v1' }],
          error: null,
        });
      }
      if (table === 'produits') return creerBuilder({ data: [{ id: 'p1', nom_reference: 'Lait demi-écrémé' }], error: null });
      if (table === 'variantes_produit') return creerBuilder({ data: [{ id: 'v1', libelle: '1L' }], error: null });
      throw new Error(`table inattendue : ${table}`);
    });
    const resultat = await chargerSuggestionsPourRejets([10]);
    expect(resultat).toEqual([{
      id: 1, rejet_ecriture_core_id: 10, produit_id: 'p1', variante_produit_id: 'v1',
      produit_nom: 'Lait demi-écrémé', variante_libelle: '1L',
    }]);
  });

  it('renvoie produit_nom/variante_libelle à null pour un résultat produit_inconnu (pas de produit_id)', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'suggestions_alias_core_ia') {
        return creerBuilder({ data: [{ id: 2, rejet_ecriture_core_id: 11, produit_id: null, variante_produit_id: null }], error: null });
      }
      throw new Error(`table inattendue : ${table}`);
    });
    const resultat = await chargerSuggestionsPourRejets([11]);
    expect(resultat).toEqual([{ id: 2, rejet_ecriture_core_id: 11, produit_id: null, variante_produit_id: null, produit_nom: null, variante_libelle: null }]);
  });

  it('renvoie [] sans planter en cas d\'erreur Supabase', async () => {
    supabase.from.mockImplementation(() => creerBuilder({ data: null, error: { message: 'boom' } }));
    const resultat = await chargerSuggestionsPourRejets([10]);
    expect(resultat).toEqual([]);
  });
});

describe('proposerAliasCore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('appelle l\'edge function sans body si aucune limite fournie', async () => {
    supabase.functions.invoke.mockResolvedValue({ data: { traites: 3, suggestions_creees: 1, sans_proposition: 2, erreurs: 0 }, error: null });
    const resultat = await proposerAliasCore();
    expect(supabase.functions.invoke).toHaveBeenCalledWith('proposer-alias-core', { body: {} });
    expect(resultat).toEqual({ traites: 3, suggestions_creees: 1, sans_proposition: 2, erreurs: 0 });
  });

  it('transmet la limite quand elle est fournie', async () => {
    supabase.functions.invoke.mockResolvedValue({ data: {}, error: null });
    await proposerAliasCore({ limite: 10 });
    expect(supabase.functions.invoke).toHaveBeenCalledWith('proposer-alias-core', { body: { limite: 10 } });
  });

  it('renvoie null sans planter en cas d\'erreur', async () => {
    supabase.functions.invoke.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const resultat = await proposerAliasCore();
    expect(resultat).toBeNull();
  });
});

describe('validerSuggestionAliasCore / refuserSuggestionAliasCore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('valider : renvoie le résultat de la RPC en cas de succès', async () => {
    supabase.rpc.mockResolvedValue({ data: { succes: true, alias_id: 'a1', prix_id: 'p1' }, error: null });
    const resultat = await validerSuggestionAliasCore(42);
    expect(supabase.rpc).toHaveBeenCalledWith('valider_suggestion_alias_core', { p_suggestion_id: 42 });
    expect(resultat).toEqual({ succes: true, alias_id: 'a1', prix_id: 'p1' });
  });

  it('valider : renvoie {succes:false, erreur} sans planter si la RPC échoue', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'CONFIDENCE_TOO_LOW' } });
    const resultat = await validerSuggestionAliasCore(42);
    expect(resultat).toEqual({ succes: false, erreur: 'CONFIDENCE_TOO_LOW' });
  });

  it('refuser : transmet le commentaire optionnel', async () => {
    supabase.rpc.mockResolvedValue({ data: { succes: true }, error: null });
    await refuserSuggestionAliasCore(7, 'pas la bonne marque');
    expect(supabase.rpc).toHaveBeenCalledWith('refuser_suggestion_alias_core', { p_suggestion_id: 7, p_commentaire: 'pas la bonne marque' });
  });

  it('refuser : renvoie {succes:false, erreur} sans planter si la RPC échoue', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'SUGGESTION_NOT_FOUND_OR_ALREADY_DECIDED' } });
    const resultat = await refuserSuggestionAliasCore(7);
    expect(resultat).toEqual({ succes: false, erreur: 'SUGGESTION_NOT_FOUND_OR_ALREADY_DECIDED' });
  });
});
