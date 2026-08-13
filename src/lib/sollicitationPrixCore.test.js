// Chantier 95 Lot 11 — tests de la sollicitation « relève le prix ».
import { describe, it, expect } from 'vitest';
import {
  SEUIL_JOURS_PRIX_ANCIEN,
  diagnostiquerPrix,
  doitSolliciter,
  doitProposerSollicitation,
  marquerSollicitationPrix,
  fileACompleter,
} from './sollicitationPrixCore';

const MAINTENANT = new Date('2026-08-13T10:00:00Z').getTime();
const ilYaJours = (j) => new Date(MAINTENANT - j * 86400000).toISOString();
const prix = (sur) => ({ variante_produit_id: 'v1', observe_le: ilYaJours(5), statut_validation: 'valide', archive: false, ...sur });
const article = (sur) => ({ cle: 'lc-1', type: 'caddie', etat: 'au_caddie', produit_id: 'p1', variante_produit_id: 'v1', ...sur });

describe('diagnostiquerPrix', () => {
  const opts = { maintenantMs: MAINTENANT };

  it('prix absent -> sollicite (aucune ligne, lignes nulles, ou uniquement archivées/refusées)', () => {
    expect(diagnostiquerPrix(article(), [], opts)).toBe('absent');
    expect(diagnostiquerPrix(article(), null, opts)).toBe('absent');
    expect(diagnostiquerPrix(article(), [prix({ archive: true }), prix({ statut_validation: 'refuse' }), prix({ statut_validation: 'rejete' })], opts)).toBe('absent');
    expect(doitSolliciter('absent')).toBe(true);
  });

  it('prix récent -> ok, ne sollicite pas', () => {
    expect(diagnostiquerPrix(article(), [prix()], opts)).toBe('ok');
    expect(doitSolliciter('ok')).toBe(false);
  });

  it(`prix ancien (> ${SEUIL_JOURS_PRIX_ANCIEN} j) -> sollicite ; le PLUS RÉCENT fait foi`, () => {
    expect(diagnostiquerPrix(article(), [prix({ observe_le: ilYaJours(61) })], opts)).toBe('ancien');
    expect(diagnostiquerPrix(article(), [prix({ observe_le: ilYaJours(59) })], opts)).toBe('ok');
    // Un vieux + un frais : le frais gagne.
    expect(diagnostiquerPrix(article(), [prix({ observe_le: ilYaJours(200) }), prix({ observe_le: ilYaJours(3) })], opts)).toBe('ok');
    expect(doitSolliciter('ancien')).toBe(true);
  });

  it('seuil ajustable', () => {
    expect(diagnostiquerPrix(article(), [prix({ observe_le: ilYaJours(10) })], { maintenantMs: MAINTENANT, seuilJours: 7 })).toBe('ancien');
  });

  it('article avec FORMAT précis : seuls les prix de cette variante comptent', () => {
    const lignes = [prix({ variante_produit_id: 'v2' })]; // autre format, récent
    expect(diagnostiquerPrix(article(), lignes, opts)).toBe('absent');
    // Article sans variante (niveau produit) : tous les prix du produit comptent.
    expect(diagnostiquerPrix(article({ variante_produit_id: null }), lignes, opts)).toBe('ok');
  });

  it('dates illisibles ignorées ; aucune date lisible -> ancien (jamais de plantage)', () => {
    expect(diagnostiquerPrix(article(), [prix({ observe_le: 'n importe quoi' }), prix({ observe_le: null })], opts)).toBe('ancien');
    expect(diagnostiquerPrix(article(), [prix({ observe_le: 'invalide' }), prix()], opts)).toBe('ok');
  });
});

describe('état de sollicitation dans le doc de session', () => {
  const session = () => ({
    id: 's1', statut: 'active', modifie_le: 'T1',
    articles: [article(), article({ cle: 'lc-2', produit_id: 'p2' }), { cle: 'note:n1', type: 'note', etat: 'au_caddie' }],
  });

  it('anti-répétition : une seule sollicitation par produit et par session', () => {
    const s0 = session();
    expect(doitProposerSollicitation(s0, 'lc-1')).toBe(true);
    const s1 = marquerSollicitationPrix(s0, 'lc-1', 'proposee', 'T2');
    expect(doitProposerSollicitation(s1, 'lc-1')).toBe(false);   // déjà proposée
    expect(doitProposerSollicitation(s1, 'lc-2')).toBe(true);    // autre produit intact
    expect(s1.modifie_le).toBe('T2');
  });

  it('« Plus tard » -> file À compléter ; « Ignorer » -> plus jamais sollicité ni dans la file', () => {
    let s = marquerSollicitationPrix(session(), 'lc-1', 'plus_tard', 'T2');
    s = marquerSollicitationPrix(s, 'lc-2', 'ignoree', 'T3');
    expect(fileACompleter(s).map(a => a.cle)).toEqual(['lc-1']);
    expect(doitProposerSollicitation(s, 'lc-1')).toBe(false);
    expect(doitProposerSollicitation(s, 'lc-2')).toBe(false);
  });

  it('« Relever » (relevee) sort de la file ; un article décoché sort de la file', () => {
    let s = marquerSollicitationPrix(session(), 'lc-1', 'plus_tard', 'T2');
    s = marquerSollicitationPrix(s, 'lc-1', 'relevee', 'T3');
    expect(fileACompleter(s)).toEqual([]);
    // Décoché : l'article n'est plus au caddie, la file ne le montre plus.
    let s2 = marquerSollicitationPrix(session(), 'lc-1', 'plus_tard', 'T2');
    s2 = { ...s2, articles: s2.articles.map(a => a.cle === 'lc-1' ? { ...a, etat: 'a_prendre' } : a) };
    expect(fileACompleter(s2)).toEqual([]);
  });

  it('état inconnu, cle absente ou session nulle : même référence, jamais de plantage', () => {
    const s = session();
    expect(marquerSollicitationPrix(s, 'lc-1', 'nimporte', 'T2')).toBe(s);
    expect(marquerSollicitationPrix(null, 'lc-1', 'proposee', 'T2')).toBeNull();
    expect(marquerSollicitationPrix(s, null, 'proposee', 'T2')).toBe(s);
    const s1 = marquerSollicitationPrix(s, 'lc-1', 'ignoree', 'T2');
    expect(marquerSollicitationPrix(s1, 'lc-1', 'ignoree', 'T3')).toBe(s1); // idempotent
    expect(fileACompleter(null)).toEqual([]);
    expect(doitProposerSollicitation(null, 'lc-1')).toBe(true);
  });
});
