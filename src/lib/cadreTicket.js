// Correctif « recadrage » (11/11) — où est le ticket dans la photo ?
//
// Constat : sur la photo de 9h58 (ticket posé sur une nappe), le ticket
// n'occupe qu'environ la moitié de la largeur ; le service du lecteur réduit
// l'image à ~1,1 Mpx et le texte devient trop petit (« 2X 3.53€ » non lu,
// Leffe inventée). Recadrée sur le ticket : 3 lectures justes sur 3.
//
// Méthode, sans réseau et sans IA : sur une miniature de la photo, on marque
// les pixels « papier » (clairs ET peu colorés), on prend la plus grande zone
// de papier d'un seul tenant, et son rectangle, élargi d'une marge. Le modèle
// rapide localisait mal le ticket au banc d'essai (cadre qui COUPAIT le
// Carrefour) : il ne sert ici qu'à confirmer, après coup, qu'aucun texte n'est
// coupé (voir lecture.ts). Toute hésitation -> null -> photo ENTIÈRE.
//
// Fonctions pures, aucune ne throw.

// Un pixel est « papier » s'il est clair et presque gris. Le seuil de clarté
// s'adapte à la photo (ticket à l'ombre, lumière jaune) : on le place sous la
// clarté typique du papier, mesurée sur les pixels peu colorés de la photo.
export const SATURATION_MAX_PAPIER = 48;
export const CLARTE_MIN_ABSOLUE = 120;
// La zone retenue doit peser au moins ça dans l'image, sinon ce n'est pas le
// ticket (reflet, assiette, bout de papier).
export const PART_MIN_ZONE = 0.06;
// Remplissage minimal du rectangle par la zone (un ticket est un rectangle
// plein de papier, troué par le texte ; une nappe à pois ne l'est pas).
export const REMPLISSAGE_MIN = 0.45;
// Marge ajoutée tout autour, en part de la largeur / hauteur de l'image : on
// préfère garder un peu de fond que risquer de couper le bord du ticket.
export const MARGE = 0.04;
// Érosion : on « amincit » le masque de ce nombre de pixels avant de chercher
// la zone, pour couper les ponts minces entre le ticket et un objet clair qui
// le touche (photo de 9h58 : un plateau métallique au coin). Le rectangle
// trouvé est ensuite regonflé d'autant, puis de la marge.
export const EROSION = 2;
// Garde-fou « ne jamais couper » : juste au-delà du cadre trouvé, on regarde
// s'il reste du « presque papier » (critères assouplis : un bout de ticket à
// l'ombre, un papier moins blanc). Si une bande de marge en contient plus que
// cette part, le papier continue peut-être : on renonce, photo entière.
export const CONTINUATION_MAX = 0.3;
const SATURATION_MAX_LACHE = 60;
const ECART_CLARTE_LACHE = 50;
// Recadrer ne vaut la peine que si l'on gagne vraiment en finesse.
export const GAIN_MIN = 0.8; // le cadre doit faire moins de 80 % de la surface

function clarte(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }

// Seuil d'Otsu d'un histogramme de 256 niveaux : la valeur qui sépare le mieux
// deux groupes (variance inter-classes maximale). Pure.
export function seuilOtsu(histo, total) {
  let somme = 0;
  for (let t = 0; t < 256; t++) somme += t * histo[t];
  let sommeB = 0, poidsB = 0, meilleur = 0, seuil = 0;
  for (let t = 0; t < 256; t++) {
    poidsB += histo[t];
    if (poidsB === 0) continue;
    const poidsF = total - poidsB;
    if (poidsF === 0) break;
    sommeB += t * histo[t];
    const moyB = sommeB / poidsB, moyF = (somme - sommeB) / poidsF;
    const v = poidsB * poidsF * (moyB - moyF) * (moyB - moyF);
    if (v > meilleur) { meilleur = v; seuil = t; }
  }
  return seuil;
}

// data : RGBA (Uint8ClampedArray ou tableau), largeur × hauteur pixels.
// -> { gauche, haut, droite, bas } en fractions (0 à 1) de l'image, marge
// comprise, ou null (pas de ticket net, ou rien à gagner).
export function detecterCadreTicket({ data, largeur, hauteur } = {}) {
  try {
    const n = largeur * hauteur;
    if (!data || !largeur || !hauteur || data.length < n * 4) return null;

    // 1) seuil de clarté adaptatif (méthode d'Otsu) sur les pixels peu
    //    colorés : il sépare au mieux le « clair » (papier) du « foncé » (fond,
    //    ombres, texte), que le ticket occupe peu ou beaucoup de la photo.
    const histo = new Array(256).fill(0);
    let nGris = 0;
    for (let i = 0; i < n; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) <= SATURATION_MAX_PAPIER) { histo[Math.round(clarte(r, g, b))]++; nGris++; }
    }
    if (nGris < n * PART_MIN_ZONE) return null;
    const seuil = Math.max(CLARTE_MIN_ABSOLUE, seuilOtsu(histo, nGris));

    // 2) masque papier
    const papier = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      papier[i] = (Math.max(r, g, b) - Math.min(r, g, b) <= SATURATION_MAX_PAPIER && clarte(r, g, b) >= seuil) ? 1 : 0;
    }

    // 2 bis) érosion : un pixel reste papier seulement si tout son voisinage
    //    (carré de côté 2 × EROSION + 1) l'est aussi.
    const papierAvantErosion = papier.slice();
    for (let passe = 0; passe < EROSION; passe++) {
      const avant = papier.slice();
      for (let y = 0; y < hauteur; y++) {
        for (let x = 0; x < largeur; x++) {
          const i = y * largeur + x;
          if (!avant[i]) continue;
          if (x === 0 || y === 0 || x === largeur - 1 || y === hauteur - 1
            || !avant[i - 1] || !avant[i + 1] || !avant[i - largeur] || !avant[i + largeur]) papier[i] = 0;
        }
      }
    }

    // 3) plus grande zone d'un seul tenant (voisins haut/bas/gauche/droite)
    const zone = new Int32Array(n).fill(-1);
    const pile = new Int32Array(n);
    let meilleure = null;
    let idZone = 0;
    for (let depart = 0; depart < n; depart++) {
      if (!papier[depart] || zone[depart] !== -1) continue;
      let haut = 0, taille = 0;
      let x0 = largeur, y0 = hauteur, x1 = -1, y1 = -1;
      pile[haut++] = depart; zone[depart] = idZone;
      while (haut > 0) {
        const p = pile[--haut];
        taille++;
        const x = p % largeur, y = (p - x) / largeur;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        const voisins = [x > 0 ? p - 1 : -1, x < largeur - 1 ? p + 1 : -1, y > 0 ? p - largeur : -1, y < hauteur - 1 ? p + largeur : -1];
        for (const v of voisins) {
          if (v >= 0 && papier[v] && zone[v] === -1) { zone[v] = idZone; pile[haut++] = v; }
        }
      }
      if (!meilleure || taille > meilleure.taille) meilleure = { taille, x0, y0, x1, y1 };
      idZone++;
    }
    if (!meilleure) return null;

    // 4) plausibilité : assez grande, rectangle bien rempli
    const { taille, x0, y0, x1, y1 } = meilleure;
    if (taille < n * PART_MIN_ZONE) return null;
    const aire = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (taille / aire < REMPLISSAGE_MIN) return null;

    // 4 ter) l'érosion a pu ronger une marge fine du ticket : on regonfle le
    //    rectangle, côté par côté, tant que la colonne (ou la ligne) voisine
    //    est en majorité du papier dans le masque d'origine. Un pont mince
    //    vers un autre objet reste minoritaire et ne fait pas grossir.
    let gx0 = x0, gx1 = x1, gy0 = y0, gy1 = y1;
    const partPapierColonne = (x, ya, yb) => { let k = 0; for (let y = ya; y <= yb; y++) k += papierAvantErosion[y * largeur + x]; return k / (yb - ya + 1); };
    const partPapierLigne = (y, xa, xb) => { let k = 0; for (let x = xa; x <= xb; x++) k += papierAvantErosion[y * largeur + x]; return k / (xb - xa + 1); };
    for (let encore = true; encore;) {
      encore = false;
      if (gx0 > 0 && partPapierColonne(gx0 - 1, gy0, gy1) > 0.5) { gx0--; encore = true; }
      if (gx1 < largeur - 1 && partPapierColonne(gx1 + 1, gy0, gy1) > 0.5) { gx1++; encore = true; }
      if (gy0 > 0 && partPapierLigne(gy0 - 1, gx0, gx1) > 0.5) { gy0--; encore = true; }
      if (gy1 < hauteur - 1 && partPapierLigne(gy1 + 1, gx0, gx1) > 0.5) { gy1++; encore = true; }
    }

    // 4 bis) le papier continue-t-il au-delà du rectangle ? On examine, de
    //    chaque côté, la bande que la marge va ajouter.
    //    « Presque papier » = peu coloré ET nettement plus clair que le fond
    //    gris typique hors du rectangle (75e centile), sans descendre sous
    //    seuil − ECART_CLARTE_LACHE : un bout de ticket à l'ombre est plus
    //    clair que le fond, le fond lui-même ne compte pas.
    const fondGris = [];
    for (let y = 0; y < hauteur; y++) for (let x = 0; x < largeur; x++) {
      if (x >= gx0 && x <= gx1 && y >= gy0 && y <= gy1) continue;
      const i = y * largeur + x;
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) <= SATURATION_MAX_LACHE) fondGris.push(clarte(r, g, b));
    }
    fondGris.sort((a, b) => a - b);
    const fondTypique = fondGris.length ? fondGris[Math.floor(fondGris.length * 0.75)] : 0;
    const seuilLache = Math.max(seuil - ECART_CLARTE_LACHE, fondTypique + 10);
    const presquePapier = (i) => {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      return Math.max(r, g, b) - Math.min(r, g, b) <= SATURATION_MAX_LACHE && clarte(r, g, b) >= seuilLache;
    };
    const ex0 = Math.max(0, gx0 - EROSION), ex1 = Math.min(largeur - 1, gx1 + EROSION);
    const ey0 = Math.max(0, gy0 - EROSION), ey1 = Math.min(hauteur - 1, gy1 + EROSION);
    const mx = Math.max(1, Math.round(MARGE * largeur)), my = Math.max(1, Math.round(MARGE * hauteur));
    const bandes = [
      [Math.max(0, ex0 - mx), ex0 - 1, ey0, ey1], // gauche
      [ex1 + 1, Math.min(largeur - 1, ex1 + mx), ey0, ey1], // droite
      [ex0, ex1, Math.max(0, ey0 - my), ey0 - 1], // haut
      [ex0, ex1, ey1 + 1, Math.min(hauteur - 1, ey1 + my)], // bas
    ];
    for (const [bx0, bx1, by0, by1] of bandes) {
      if (bx1 < bx0 || by1 < by0) continue; // le ticket touche ce bord de la photo
      let total = 0, proches = 0;
      for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) { total++; if (presquePapier(y * largeur + x)) proches++; }
      if (total > 0 && proches / total > CONTINUATION_MAX) return null;
    }

    // 5) marge, bornage, et gain réel
    const cadre = {
      gauche: Math.max(0, ex0 / largeur - MARGE),
      haut: Math.max(0, ey0 / hauteur - MARGE),
      droite: Math.min(1, (ex1 + 1) / largeur + MARGE),
      bas: Math.min(1, (ey1 + 1) / hauteur + MARGE),
    };
    if ((cadre.droite - cadre.gauche) * (cadre.bas - cadre.haut) >= GAIN_MIN) return null;
    return cadre;
  } catch {
    return null;
  }
}
