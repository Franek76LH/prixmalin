import { describe, it, expect } from 'vitest';
import { detecterCadreTicket, seuilOtsu, MARGE } from './cadreTicket';

// Image de synthèse RGBA : fond uni + ticket clair (avec « texte » gris).
function image({ largeur = 120, hauteur = 160, fond = [107, 92, 77], ticket = null, ombreBas = 0, texte = true } = {}) {
  const data = new Uint8ClampedArray(largeur * hauteur * 4);
  for (let y = 0; y < hauteur; y++) for (let x = 0; x < largeur; x++) {
    let c = fond;
    if (ticket && x >= ticket[0] && x < ticket[2] && y >= ticket[1] && y < ticket[3]) {
      c = [237, 237, 237];
      // texte : 1 ligne sur 6, gris moyen, comme une miniature réelle où il se fond
      if (texte && (y - ticket[1]) % 6 === 3 && x > ticket[0] + 4 && x < ticket[2] - 6) c = [140, 140, 140];
    }
    if (ombreBas && y > hauteur * (1 - ombreBas)) c = c.map((v) => Math.round(v * 0.5));
    const i = (y * largeur + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return { data, largeur, hauteur };
}
const contient = (cadre, t, img) => cadre.gauche * img.largeur <= t[0] && cadre.haut * img.hauteur <= t[1] && cadre.droite * img.largeur >= t[2] && cadre.bas * img.hauteur >= t[3];

describe('detecterCadreTicket', () => {
  it('ticket net sur fond sombre : cadre qui contient TOUT le ticket, marge comprise', () => {
    const t = [40, 20, 80, 140];
    const img = image({ ticket: t });
    const c = detecterCadreTicket(img);
    expect(c).not.toBeNull();
    expect(contient(c, t, img)).toBe(true);
    expect(c.gauche).toBeLessThanOrEqual(40 / 120 - MARGE + 0.02);
  });

  it('ticket qui remplit la photo (capture d\'écran) : null, photo entière', () => {
    expect(detecterCadreTicket(image({ ticket: [0, 0, 120, 160] }))).toBeNull();
  });

  it('ticket sur table blanche : on ne sait pas où il finit -> null', () => {
    expect(detecterCadreTicket(image({ fond: [230, 230, 228], ticket: [40, 20, 80, 140] }))).toBeNull();
  });

  it('ombre sur le bas du ticket : jamais un cadre qui coupe — soit tout le ticket, soit null', () => {
    const t = [40, 20, 80, 140];
    const img = image({ ticket: t, ombreBas: 0.4 });
    const c = detecterCadreTicket(img);
    if (c) expect(contient(c, t, img)).toBe(true);
  });

  it('ticket coupé par le bas de la photo : le cadre va jusqu\'au bord', () => {
    const t = [40, 40, 80, 160];
    const img = image({ ticket: t });
    const c = detecterCadreTicket(img);
    expect(c).not.toBeNull();
    expect(c.bas).toBe(1);
    expect(contient(c, t, img)).toBe(true);
  });

  it('entrées absurdes : null, jamais d\'exception', () => {
    expect(detecterCadreTicket()).toBeNull();
    expect(detecterCadreTicket({ data: [], largeur: 10, hauteur: 10 })).toBeNull();
    expect(detecterCadreTicket(image({ fond: [200, 40, 40] }))).toBeNull(); // rien de gris
  });

  it('seuil d\'Otsu : sépare deux groupes nets', () => {
    const h = new Array(256).fill(0); h[90] = 500; h[235] = 100;
    const s = seuilOtsu(h, 600);
    expect(s).toBeGreaterThanOrEqual(90);
    expect(s).toBeLessThan(235);
  });
});
