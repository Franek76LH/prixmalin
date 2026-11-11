// Correctif 9h58 — adresse du magasin lue sur le ticket, NETTOYÉE avant toute
// comparaison et avant l'envoi à la base.
//
// Constat : le lecteur a rendu « MAGASIN CAPSUD N°1617, 68, BD DU ROY RENE,
// 13100 AIX-EN-PROVENCE ». Le texte en trop faisait tomber la ressemblance
// avec la fiche « 68, BD DU ROY RENE » de 1,00 à 0,65 (seuil 0,70) : carte
// « Nouveau magasin détecté », et la base aurait pu créer un DOUBLON. Le même
// ticket imprime aussi l'adresse de la société exploitante (CAP SUD
// EXPLOITATION, ZAC Les Ferrieres, 50 RUE DU LIEGE, 83490 LE MUY).
//
// Règle : on ne garde que « numéro, rue, code postal ville » du PREMIER bloc
// adresse (celui du magasin, imprimé sous son nom). Sans code postal, on ne
// sait pas nettoyer sans risque : l'adresse est rendue telle quelle.
// Pure, ne throw jamais, idempotente (une adresse propre ressort identique).

const VOIE = /\b(rue|r|bd|bld|boulevard|av|ave|avenue|ch|che|chem|chemin|rte|route|pl|place|all|allees?|quai|imp|impasse|cours|crs|zac|za|zi|zone|cc|centre|c\.c\.|rond[- ]?point|rd[- ]?pt|lieu[- ]?dit|ld|parc|chaussee|fbg|faubourg|prom|promenade|sq|square|voie|passage|pass|cite|residence|res|hameau|ham|domaine|dom|lotissement|lot|espace|esplanade|galerie|mail|montee|sentier|traverse|parvis|port|zup|rn|rd|n\d+|d\d+)\b/i;
const NUMERO_SEUL = /^\d{1,4}\s*(bis|ter|quater|[a-d])?$/i;
const COMMENCE_PAR_NUMERO = /^\d{1,4}\s*(bis|ter|quater|[a-d])?\b[\s,]/i;
// Segments à ne jamais garder : désignation du magasin, mentions légales.
const PARASITE = /\b(magasin|n°|nø|no\s?\d|siret|siren|tva|naf|ape|rcs|sas|sarl|sa|eurl|snc|exploitation|tel|tél|telephone|téléphone|fax|www\.|@|france)\b/i;

const sansAccents = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');

function estRue(segment) {
  const s = sansAccents(segment).trim();
  if (!s || PARASITE.test(s)) return false;
  return NUMERO_SEUL.test(s) || COMMENCE_PAR_NUMERO.test(`${s} `) || VOIE.test(s);
}

// Dans un morceau mêlant désignation et rue (« SUPER U N°45 - 68 BD DU ROY
// RENE »), on garde à partir du numéro qui précède le premier type de voie.
function extraireRue(texte) {
  const t = String(texte).normalize('NFC');
  const sa = sansAccents(t);
  const m = sa.match(new RegExp(VOIE.source, 'i'));
  if (!m) return null;
  const avant = sa.slice(0, m.index).match(/(\d{1,4}\s*(?:bis|ter|quater)?\s*,?\s*)$/i);
  const debut = avant ? m.index - avant[1].length : m.index;
  const rue = t.slice(debut).trim();
  return rue && !PARASITE.test(sansAccents(rue)) ? rue : null;
}

export function nettoyerAdresseMagasin(adresse) {
  try {
    const brute = String(adresse ?? '').trim();
    if (!brute) return '';
    const segments = brute.split(/\s*[,;\n]\s*|\s{3,}/).map((x) => x.trim()).filter(Boolean);
    const k = segments.findIndex((x) => /\b\d{5}\b/.test(x));
    if (k === -1) return brute;

    // Segment du code postal : « [rue ] CP VILLE[ suite] ». Ce qui précède le
    // CP dans le même segment peut être la rue (« 68 BD DU ROY RENE 13100 »).
    const seg = segments[k];
    const m = seg.match(/\b\d{5}\b/);
    const avantCp = seg.slice(0, m.index).trim();
    const cpVille = seg.slice(m.index).trim();

    const rue = [];
    let remonter = !avantCp;
    if (avantCp && estRue(avantCp)) { rue.push(avantCp); remonter = true; }
    else if (avantCp) { const r = extraireRue(avantCp); if (r) rue.push(r); }
    if (remonter) {
      // On remonte les segments précédents tant qu'ils ressemblent à une rue
      // (ou à un numéro seul, « 68 » détaché de « BD DU ROY RENE »).
      for (let i = k - 1; i >= 0; i--) {
        if (!estRue(segments[i])) break;
        rue.unshift(segments[i]);
      }
    }
    return [...rue, cpVille].join(', ');
  } catch {
    return String(adresse ?? '').trim();
  }
}

// Correctif 10h38 — « cœur » du nom de rue : sans numéro, sans type de voie,
// sans code postal ni ville. Le lecteur a pris « 68, BD DU ROY RENE » pour
// « ZAC RD DU ROY RENE » : seul « du roy rene » est fiable. Minuscules, sans
// accents ni ponctuation. Vide si rien de distinctif ne reste. Pure.
export function coeurDeRue(adresse) {
  try {
    const t = sansAccents(String(adresse ?? '')).toLowerCase();
    const m = t.match(/\b\d{5}\b/);
    const rue = m ? t.slice(0, m.index) : t;
    return rue
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((mot) => mot && !/^\d+[a-z]?$/.test(mot) && !/^(bis|ter|quater)$/.test(mot) && !new RegExp(`^(?:${VOIE.source.slice(3, -3)})$`, 'i').test(mot))
      .join(' ');
  } catch {
    return '';
  }
}
