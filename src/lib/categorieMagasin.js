// Chantier 223 — catégorie d'un NOUVEAU magasin, devinée à partir du nom lu
// sur le ticket (et de l'enseigne reconnue). Décision de François (26/11) :
//   « Grandes surfaces »               = hypermarchés seulement ;
//   « Petites et moyennes surfaces »   = supermarchés + supérettes (tout le reste).
// Valeurs en base inchangées : 'grande_surface' / 'proximite'.
// Dans le doute → petite et moyenne (le cas le plus fréquent) ; la personne
// peut corriger d'un appui à la création, et Claude vérifie les nouveaux
// magasins à chaque reprise.

const GRANDE = 'grande_surface';
const PETITE_MOYENNE = 'proximite';

function aplatir(t) {
  return String(t || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Formats « petits ou moyens » d'enseignes qui ont aussi des hypers.
const FORMAT_PETIT_MOYEN = /\b(city|express|contact|market|proxi|proximite|super|supermarche|my auchan|auchan piéton|auchan pieton|piéton|pieton|drive pieton|relais|local|shop|bio|go)\b/;

export function devinerCategorieMagasin(nom, enseigne = null) {
  const t = aplatir(`${nom || ''} ${enseigne || ''}`);
  if (!t) return PETITE_MOYENNE;

  // 1. Le ticket le dit : hyper.
  if (/\bhyper\b|\bhypermarche\b|\bhyper u\b/.test(t)) return GRANDE;

  // 2. Enseignes d'hypers, sauf si un format petit ou moyen est écrit.
  const formatPetit = FORMAT_PETIT_MOYEN.test(t);
  if (/\bleclerc\b/.test(t)) return /\b(express|relais|proxi|drive pieton)\b/.test(t) ? PETITE_MOYENNE : GRANDE;
  if (/\b(geant|cora)\b/.test(t)) return GRANDE;
  if (/\bcarrefour\b/.test(t)) return formatPetit ? PETITE_MOYENNE : GRANDE;
  if (/\bauchan\b/.test(t)) return formatPetit ? PETITE_MOYENNE : GRANDE;

  // 3. Tout le reste : supermarchés et supérettes (Lidl, Aldi, Netto,
  //    Intermarché, Super U, U Express, Monoprix, Franprix, Vival, Utile, Spar…).
  return PETITE_MOYENNE;
}
