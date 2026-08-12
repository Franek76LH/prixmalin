// Chantier 91 Lot 5 — tests du rapprochement liste / cochés / ticket.
import { describe, it, expect } from 'vitest';
import {
  normaliserLibelleLocal,
  textesARapprocher,
  rapprocherSessionTicket,
  appliquerRapprochementSession,
  deciderAchatArticle,
} from './rapprochementCoursesCore';

// ── Miroir de normaliser_libelle ────────────────────────────────────────────
// Fixtures produites par la RPC réelle (SELECT normaliser_libelle(...), 2026-08-12).
describe('normaliserLibelleLocal — miroir de la RPC', () => {
  const FIXTURES_RPC = [
    ['Häagen-Dazs Vanille 500ML', 'haagen dazs vanille 500ml'],
    ['  PÂTES Serpentini 1,5 kg  ', 'pates serpentini 1.5kg'],
    ['Yaourt 4 x 125 g', 'yaourt 4x125g'],
    ['CRISTALINE EAU 6X1.5L', 'cristaline eau 6x1.5l'],
    ["Café moulu — L'Or 250 g", 'cafe moulu l or 250g'],
    ['Riz basmati 1.000 kg', 'riz basmati 1.000kg'],
    ['Coca-Cola 1,75 L', 'coca cola 1.75l'],
    ['', null],
    ['Œufs x12 plein air', 'oeufs x12 plein air'],
    ['12x33cl bière', '12x33cl biere'],
  ];
  it.each(FIXTURES_RPC)('%s -> %s (identique à la RPC)', (entree, attendu) => {
    expect(normaliserLibelleLocal(entree)).toBe(attendu);
  });
  it('entrées non-texte : jamais de plantage', () => {
    expect(normaliserLibelleLocal(null)).toBeNull();
    expect(normaliserLibelleLocal(undefined)).toBeNull();
    expect(normaliserLibelleLocal('   ')).toBeNull();
  });
});

describe('textesARapprocher', () => {
  it('collecte noms d\'articles et libellés de lignes, sans vides', () => {
    const textes = textesARapprocher(
      [{ nom_affiche: 'A', nom_reference: '' }, { nom_reference: 'B' }],
      [{ libelle_ticket: 'C', libelle_brut: null }, { libelle_brut: 'D' }],
    );
    expect(textes).toEqual(['A', 'B', 'C', 'D']);
    expect(textesARapprocher(null, null)).toEqual([]);
  });
});

// ── Cœur : les 6 règles ─────────────────────────────────────────────────────
const article = (sur) => ({
  cle: 'lc-1', type: 'caddie', produit_id: 'p1', variante_produit_id: 'v1',
  nom_reference: 'Eau gazeuse', nom_affiche: 'Perrier Eau gazeuse 1L',
  quantite: 1, prix_prevu: 1.2, etat: 'au_caddie', coche_le: 'T1', ...sur,
});
const ligne = (sur) => ({
  produit_id: 'p1', variante_produit_id: 'v1', libelle_brut: 'PERRIER 1L',
  libelle_ticket: 'PERRIER 1L', quantite: 1, prix_unitaire: 1.19,
  statut_validation_produit: 'valide', ...sur,
});

describe('rapprocherSessionTicket — 6 règles', () => {
  it('règle 1 : coché + présent sur le ticket (variante) -> confirme', () => {
    const r = rapprocherSessionTicket([article()], [ligne()]);
    expect(r.articles[0].achat).toBe('confirme');
    expect(r.compteurs).toEqual({ confirmes: 1, non_achetes: 0, a_verifier: 0, hors_liste: 0, non_reconnues: 0 });
  });

  it('règle 2 : NON coché (a_prendre ou introuvable) mais présent -> confirme (le ticket corrige)', () => {
    for (const etat of ['a_prendre', 'introuvable']) {
      const r = rapprocherSessionTicket([article({ etat, coche_le: null })], [ligne()]);
      expect(r.articles[0].achat).toBe('confirme');
    }
  });

  it('règle 3 : coché mais absent du ticket -> a_verifier (jamais tranché tout seul)', () => {
    const r = rapprocherSessionTicket([article()], [ligne({ produit_id: 'p9', variante_produit_id: 'v9', libelle_brut: 'AUTRE CHOSE', libelle_ticket: null })]);
    expect(r.articles[0].achat).toBe('a_verifier');
    expect(r.compteurs.a_verifier).toBe(1);
  });

  it('règle 4 : non coché et absent du ticket -> non_achete', () => {
    const r = rapprocherSessionTicket([article({ etat: 'a_prendre' })], [ligne({ produit_id: 'p9', variante_produit_id: 'v9', libelle_brut: 'AUTRE CHOSE', libelle_ticket: null })]);
    expect(r.articles[0].achat).toBe('non_achete');
  });

  it('règle 5 : ligne reconnue (produit_id) sans article -> achat hors liste confirmé', () => {
    const r = rapprocherSessionTicket([], [ligne({ produit_id: 'p7', variante_produit_id: null, libelle_ticket: 'KINDER BUENO' })]);
    expect(r.achats_hors_liste).toHaveLength(1);
    expect(r.achats_hors_liste[0]).toMatchObject({
      cle: 'hors_liste:0', type: 'caddie', hors_liste: true, etat: 'au_caddie',
      achat: 'confirme', produit_id: 'p7', nom_affiche: 'KINDER BUENO', prix_prevu: 1.19,
    });
    expect(r.compteurs.hors_liste).toBe(1);
  });

  it('règle 6 : ligne non reconnue (produit_id null, aucun texte proche) -> compteur, rien de créé', () => {
    const r = rapprocherSessionTicket([article()], [ligne(), ligne({ produit_id: null, variante_produit_id: null, libelle_brut: 'XZKJQH 999', libelle_ticket: null })]);
    expect(r.lignes_non_reconnues).toBe(1);
    expect(r.achats_hors_liste).toHaveLength(0);
    expect(r.compteurs.non_reconnues).toBe(1);
  });

  it('garde-fou : 0 ligne exploitable -> aucuneLigne, RIEN n\'est classé', () => {
    const r = rapprocherSessionTicket([article()], []);
    expect(r.aucuneLigne).toBe(true);
    expect(r.articles[0].achat).toBeUndefined();
    const r2 = rapprocherSessionTicket([article()], null);
    expect(r2.aucuneLigne).toBe(true);
  });

  it('match par produit_id quand la variante manque', () => {
    const r = rapprocherSessionTicket(
      [article({ variante_produit_id: null })],
      [ligne({ variante_produit_id: null, libelle_brut: 'RIEN A VOIR', libelle_ticket: null })],
    );
    expect(r.articles[0].achat).toBe('confirme');
  });

  it('match texte normalisé quand les ids manquent des deux côtés', () => {
    const r = rapprocherSessionTicket(
      [article({ produit_id: null, variante_produit_id: null, nom_affiche: 'Pâtes Serpentini 1,5 kg', nom_reference: null })],
      [ligne({ produit_id: null, variante_produit_id: null, libelle_brut: 'PATES SERPENTINI 1.5KG', libelle_ticket: null })],
    );
    expect(r.articles[0].achat).toBe('confirme');
    expect(r.lignes_non_reconnues).toBe(0);
  });

  it('une ligne ne sert qu\'une fois : deux articles identiques, une seule ligne -> un confirmé, un à vérifier', () => {
    const r = rapprocherSessionTicket(
      [article(), article({ cle: 'lc-2' })],
      [ligne()],
    );
    const achats = r.articles.map(a => a.achat).sort();
    expect(achats).toEqual(['a_verifier', 'confirme']);
  });

  it('priorité variante > produit : la ligne avec variante va à l\'article de même variante', () => {
    const r = rapprocherSessionTicket(
      [article({ cle: 'lc-a', variante_produit_id: 'v2' }), article({ cle: 'lc-b', variante_produit_id: 'v1' })],
      [ligne({ variante_produit_id: 'v1' })],
    );
    expect(r.articles.find(a => a.cle === 'lc-b').achat).toBe('confirme');
    expect(r.articles.find(a => a.cle === 'lc-a').achat).toBe('a_verifier');
  });

  it('les notes libres ne sont ni classées ni matchées (jamais « prévues »)', () => {
    const note = { cle: 'note:n1', type: 'note', nom_affiche: 'PERRIER 1L', etat: 'au_caddie' };
    const r = rapprocherSessionTicket([note], [ligne({ produit_id: 'p7', variante_produit_id: null })]);
    expect(r.articles[0].achat).toBeUndefined();
    // La ligne reste hors liste : elle n'a pas été « consommée » par la note.
    expect(r.achats_hors_liste).toHaveLength(1);
  });
});

// ── Application au document de session ──────────────────────────────────────
describe('appliquerRapprochementSession / deciderAchatArticle', () => {
  const session = () => ({
    id: 's1', statut: 'active', modifie_le: 'T1',
    articles: [article(), { cle: 'note:n1', type: 'note', etat: 'a_prendre' }],
  });

  it('pose achat par cle + hors liste + compteur + total réel + horodatage', () => {
    const r = rapprocherSessionTicket([article({ etat: 'a_prendre' })], [ligne()]);
    const s = appliquerRapprochementSession(session(), r, 42.5, 'T9');
    expect(s.articles[0].achat).toBe('confirme');
    expect(s.articles[1].achat).toBeUndefined();
    expect(s.achats_hors_liste).toEqual([]);
    expect(s.lignes_non_reconnues).toBe(0);
    expect(s.ticket_total_reel).toBe(42.5);
    expect(s.rapprochement_le).toBe('T9');
    expect(s.modifie_le).toBe('T9');
  });

  it('aucuneLigne ou entrées nulles : même référence, rien d\'écrit', () => {
    const s = session();
    expect(appliquerRapprochementSession(s, { aucuneLigne: true }, 10, 'T9')).toBe(s);
    expect(appliquerRapprochementSession(null, {}, 10, 'T9')).toBeNull();
  });

  it('deciderAchatArticle : pose une décision réversible, refuse les valeurs inconnues', () => {
    const s0 = { ...session(), articles: [{ ...article(), achat: 'a_verifier' }] };
    const s1 = deciderAchatArticle(s0, 'lc-1', 'confirme', 'T9');
    expect(s1.articles[0].achat).toBe('confirme');
    expect(s1.modifie_le).toBe('T9');
    const s2 = deciderAchatArticle(s1, 'lc-1', 'non_achete', 'T10'); // réversible
    expect(s2.articles[0].achat).toBe('non_achete');
    expect(deciderAchatArticle(s2, 'lc-1', 'nimporte', 'T11')).toBe(s2);
    expect(deciderAchatArticle(s2, 'cle-inconnue', 'confirme', 'T11')).toBe(s2);
    expect(deciderAchatArticle(null, 'lc-1', 'confirme', 'T11')).toBeNull();
  });
});
