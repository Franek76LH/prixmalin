import { describe, it, expect } from 'vitest';
import {
  decouperImageLongue, octetsBase64, verifierBornesImport, deplacer, retirer,
  normaliserResultatImport, verifierDateImport, dateLimiteIso, affichageRemise, totalLigneLue,
  MAX_IMAGES, MESSAGE_TICKET_TROP_ANCIEN, MESSAGE_PDF_ILLISIBLE,
} from './importTicketFichier';

// Aujourd'hui = 09/11/2026 (jour des tests terrain).
const AUJ = new Date(2026, 10, 9, 10, 0, 0);

describe('date du ticket importé (6 mois)', () => {
  it('limite = il y a 6 mois jour pour jour', () => {
    expect(dateLimiteIso(AUJ)).toBe('2026-05-09');
    expect(dateLimiteIso(new Date(2026, 7, 31))).toBe('2026-02-28'); // 31/08 -> fin février
    expect(dateLimiteIso(new Date(2027, 1, 15))).toBe('2026-08-15'); // passage d'année
  });
  it('Leclerc Drive du 19/06/2026 -> accepté', () => {
    expect(verifierDateImport('2026-06-19', AUJ)).toMatchObject({ statut: 'ok', date: '2026-06-19' });
  });
  it('limite incluse : pile 6 mois passe, la veille non', () => {
    expect(verifierDateImport('2026-05-09', AUJ).statut).toBe('ok');
    expect(verifierDateImport('2026-05-08', AUJ).statut).toBe('trop_ancienne');
  });
  it('ticket de plus de 6 mois (Carrefour) -> refusé', () => {
    expect(verifierDateImport('2026-03-14', AUJ)).toMatchObject({ statut: 'trop_ancienne', limite: '2026-05-09' });
  });
  it('date non lue ou invalide -> demander la date', () => {
    expect(verifierDateImport(null, AUJ).statut).toBe('manquante');
    expect(verifierDateImport('', AUJ).statut).toBe('manquante');
    expect(verifierDateImport('2026-02-30', AUJ).statut).toBe('manquante');
    expect(verifierDateImport('14/03/2026', AUJ).statut).toBe('manquante');
  });
  it('messages exacts', () => {
    expect(MESSAGE_TICKET_TROP_ANCIEN).toBe('Ce ticket a plus de 6 mois, ses prix ne sont plus comparables');
    expect(MESSAGE_PDF_ILLISIBLE).toBe("Impossible de lire ce PDF, essaie une capture d'écran");
  });
});

describe('image longue découpée en morceaux qui se recouvrent', () => {
  it('image normale -> un seul morceau, intact', () => {
    expect(decouperImageLongue(1500, 2000)).toEqual([{ y: 0, h: 2000 }]);
    expect(decouperImageLongue(1000, 3000)).toEqual([{ y: 0, h: 3000 }]); // ratio 3 pile
  });
  it('capture Lidl Plus 1170 × 9000 -> morceaux consécutifs qui couvrent tout, avec recouvrement', () => {
    const b = decouperImageLongue(1170, 9000);
    expect(b.length).toBeGreaterThan(4);
    expect(b[0].y).toBe(0);
    expect(b[b.length - 1].y + b[b.length - 1].h).toBe(9000);
    for (let i = 1; i < b.length; i++) expect(b[i].y).toBeLessThan(b[i - 1].y + b[i - 1].h); // chevauchement
    for (const x of b) expect(x.h / 1170).toBeLessThanOrEqual(1.6 * 1.25 + 0.01);
  });
  it('pas de bande finale minuscule', () => {
    const b = decouperImageLongue(1000, 3700);
    expect(b[b.length - 1].h).toBeGreaterThan(400);
  });
  it('dimensions invalides -> aucune bande', () => {
    expect(decouperImageLongue(0, 100)).toEqual([]);
  });
});

describe('bornes', () => {
  const img = (ko) => ({ base64: 'A'.repeat(Math.ceil(ko * 1024 * 4 / 3)) });
  it('taille réelle d\'un base64', () => {
    expect(octetsBase64('QUJD')).toBe(3);
    expect(octetsBase64('QUI=')).toBe(2);
  });
  it('vide, trop d\'images, image > 6 Mo -> message ; sinon null', () => {
    expect(verifierBornesImport([])).toMatch(/au moins une/);
    expect(verifierBornesImport(Array(MAX_IMAGES + 1).fill(img(10)))).toMatch(/15 maximum/);
    expect(verifierBornesImport([img(10), img(6.5 * 1024)])).toMatch(/L'image 2 dépasse 6 Mo/);
    expect(verifierBornesImport(Array(MAX_IMAGES).fill(img(500)))).toBeNull();
  });
});

describe('vignettes : réordonner, retirer', () => {
  it('▲▼ et ✕', () => {
    expect(deplacer(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(deplacer(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(deplacer(['a', 'b'], 0, -1)).toEqual(['a', 'b']); // bord : rien
    expect(retirer(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });
});

describe('réponse v13 encore déployée -> valeurs par défaut, aucune erreur', () => {
  it('sans remise ni captures_peut_etre_incompletes', () => {
    const r = normaliserResultatImport({ store: 'Lidl', products: [{ name: 'X', price: 1 }] });
    expect(r.products[0].remise).toBe(0);
    expect(r.captures_peut_etre_incompletes).toBe(false);
  });
  it('v14 : remise négative ou en texte -> positive', () => {
    const r = normaliserResultatImport({ products: [{ remise: -2.15 }, { remise: '1,5' }, { remise: 'x' }], captures_peut_etre_incompletes: true });
    expect(r.products.map(p => p.remise)).toEqual([2.15, 1.5, 0]);
    expect(r.captures_peut_etre_incompletes).toBe(true);
  });
  it('robuste', () => {
    expect(normaliserResultatImport(null)).toBeNull();
    expect(normaliserResultatImport({ products: null }).products).toBeNull();
  });
});

describe('affichage d\'une remise de ligne', () => {
  it('« 4,29 € → 2,14 € (−2,15 €) »', () => {
    expect(affichageRemise(4.29, 2.15)).toBe('4,29 € → 2,14 € (−2,15 €)');
  });
  it('pas de remise -> null', () => {
    expect(affichageRemise(4.29, 0)).toBeNull();
    expect(affichageRemise(4.29, null)).toBeNull();
  });
  it('total de ligne : total, sinon prix × quantité (quantité Leclerc 2 × 8,09)', () => {
    expect(totalLigneLue({ total: 16.18, price: 8.09, qty: 2 })).toBe(16.18);
    expect(totalLigneLue({ price: 8.09, qty: 2 })).toBeCloseTo(16.18, 10);
    expect(totalLigneLue({ price: 0 })).toBe(0);
  });
});
