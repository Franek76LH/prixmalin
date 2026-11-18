import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({ supabase: { from: vi.fn(), auth: { getSession: vi.fn() } } }));
import { supabase } from './supabase';
import { texteDeLecture, conserverLectureApresImport, TAILLE_MAX_LECTURE } from './lectureTicketConservee';

const lecture = () => ({
  store: 'Carrefour', address: '12 rue X, 13008 Marseille', date: '2026-11-18',
  total_ticket: 18.22, nombre_articles: 9, total_remises: 2.15,
  numero_carte_fidelite: '9250001234567', // ne doit JAMAIS partir en base
  products: [
    { brand: '', name: 'Concombre', libelle_ticket: 'CONCOMBRE PIECE', qty: 1, unit_price: 4.29, price: 4.29, total: 4.29, remise: 2.15, carte: '**** 4417' },
    { brand: 'Barilla', name: 'Penne rigate', libelle_ticket: 'BARILLA PENNE 1KG', format: '1 kg', qty: 2, unit_price: 1.85, price: 1.85, total: 3.7, remise: 0 },
  ],
});

describe('texteDeLecture', () => {
  it('garde le magasin, la date, les totaux, et chaque ligne avec son texte de caisse et sa remise', () => {
    const t = JSON.parse(texteDeLecture(lecture()));
    expect(t).toMatchObject({ store: 'Carrefour', date: '2026-11-18', total_ticket: 18.22, total_remises: 2.15 });
    expect(t.products[0]).toMatchObject({ libelle_ticket: 'CONCOMBRE PIECE', unit_price: 4.29, remise: 2.15 });
    expect(t.products).toHaveLength(2);
  });
  it('ne laisse passer que les champs prévus (rien de personnel)', () => {
    const texte = texteDeLecture(lecture());
    expect(texte).not.toContain('9250001234567');
    expect(texte).not.toContain('4417');
  });
  it('rien à garder : null (lecture absente, sans lignes, ou démesurée)', () => {
    expect(texteDeLecture(null)).toBeNull();
    expect(texteDeLecture({ store: 'Carrefour', products: [] })).toBeNull();
    const enorme = { products: Array.from({ length: 2000 }, () => ({ name: 'x'.repeat(40), libelle_ticket: 'y'.repeat(40) })) };
    expect(JSON.stringify(enorme).length).toBeGreaterThan(TAILLE_MAX_LECTURE);
    expect(texteDeLecture(enorme)).toBeNull();
  });
});

// Petit faux de la chaîne supabase.from('tickets')…
function fauxTickets({ dernier, erreurLecture = null, erreurEcriture = null }) {
  const ecritures = [];
  supabase.from.mockImplementation(() => {
    const lectureChaine = { eq: () => lectureChaine, order: () => lectureChaine, limit: () => lectureChaine,
      maybeSingle: async () => ({ data: dernier, error: erreurLecture }) };
    return {
      select: () => lectureChaine,
      update: (valeurs) => {
        const filtres = {};
        const chaine = { eq: (c, v) => { filtres[c] = v; return chaine; }, is: (c, v) => { filtres[c] = v; ecritures.push({ valeurs, filtres }); return Promise.resolve({ error: erreurEcriture }); } };
        return chaine;
      },
    };
  });
  return ecritures;
}

describe('conserverLectureApresImport', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}); });

  it('pose la lecture sur le ticket qui vient d’être créé, seulement s’il est encore vide', async () => {
    const ecritures = fauxTickets({ dernier: { id: 't1', texte_ocr_brut: null } });
    const r = await conserverLectureApresImport(Promise.resolve({ statut: 'ok' }), lecture(), { utilisateurId: 'u1' });
    expect(r).toBe('pose');
    expect(ecritures).toHaveLength(1);
    expect(ecritures[0].filtres).toEqual({ id: 't1', texte_ocr_brut: null });
    expect(JSON.parse(ecritures[0].valeurs.texte_ocr_brut).store).toBe('Carrefour');
  });
  it('n’écrase jamais une lecture déjà conservée', async () => {
    const ecritures = fauxTickets({ dernier: { id: 't1', texte_ocr_brut: '{"store":"Lidl"}' } });
    expect(await conserverLectureApresImport(Promise.resolve({ statut: 'ok' }), lecture(), { utilisateurId: 'u1' })).toBe('ignore');
    expect(ecritures).toHaveLength(0);
  });
  it('ticket refusé par la base : aucun ticket créé, donc rien à poser (sinon on marquerait un ancien ticket)', async () => {
    const ecritures = fauxTickets({ dernier: { id: 'ancien', texte_ocr_brut: null } });
    expect(await conserverLectureApresImport(Promise.resolve({ statut: 'rejet' }), lecture(), { utilisateurId: 'u1' })).toBe('ignore');
    expect(await conserverLectureApresImport(Promise.resolve(null), lecture(), { utilisateurId: 'u1' })).toBe('ignore');
    expect(ecritures).toHaveLength(0);
  });
  it('un échec ne remonte jamais (l’import ne doit pas en souffrir)', async () => {
    fauxTickets({ dernier: { id: 't1', texte_ocr_brut: null }, erreurEcriture: { message: 'panne' } });
    expect(await conserverLectureApresImport(Promise.resolve({ statut: 'ok' }), lecture(), { utilisateurId: 'u1' })).toBe('erreur');
    expect(await conserverLectureApresImport(Promise.reject(new Error('réseau')), lecture(), { utilisateurId: 'u1' })).toBe('erreur');
  });
});
