// Chantier 106 Lot A (retouche) — mise en forme d'une ligne de résultat de
// recherche du catalogue.
//
// Pourquoi ce fichier existe : le test terrain a montré qu'une fiche
// « Boisson énergisante » ne dit rien à quelqu'un qui tient une canette de Red
// Bull. La RPC rechercher_produits_catalogue sait maintenant trouver la fiche
// par sa marque, mais si l'écran n'affiche que le nom de fiche, l'utilisateur
// ne reconnaît pas son produit et n'ose pas cliquer. La marque et les formats
// sont donc devenus une partie de l'identification, pas une décoration.
//
// Logique pure (ni React, ni Supabase) pour que le contenu réellement affiché
// sur une ligne soit vérifiable en test.
import { formatFormatStructure } from './catalogueCore';

// La RPC agrège les formats en UNE chaîne, avec la valeur brute de la base :
// « 0.085 kg, 0.25 kg ». Illisible sur un écran de courses. On redécoupe pour
// repasser chaque format par le formateur maison (kg < 1 -> grammes,
// l < 1 -> millilitres), celui-là même qui sert déjà sur les fiches produit.
//
// Un morceau qu'on ne sait pas relire est conservé TEL QUEL : mieux vaut un
// format affiché bizarrement qu'un format disparu de l'écran.
export function formaterFormats(formats) {
  const brut = typeof formats === 'string' ? formats.trim() : '';
  if (!brut) return null;

  const vus = new Set();
  const sortie = [];
  for (const morceau of brut.split(',')) {
    const piece = morceau.trim();
    if (!piece) continue;

    const m = piece.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
    const unite = m ? m[2].trim() : '';
    const lisible = (m && unite)
      ? (formatFormatStructure({ quantite_nette: Number(m[1].replace(',', '.')), unite_quantite: unite }) || piece)
      : piece;

    if (vus.has(lisible)) continue; // « 0.25 l » et « 0.250 l » donnent le même texte
    vus.add(lisible);
    sortie.push(lisible);
  }
  return sortie.length > 0 ? sortie.join(', ') : null;
}

// La ligne grise sous le nom de fiche : « Red Bull · 250 ml, 355 ml ».
//
// null veut dire « n'affiche RIEN à cet endroit » — pas de ligne vide, et
// surtout aucun texte de remplissage. « Sans marque » ou « Marque à compléter »
// sur un écran de recherche ne renseignerait personne et donnerait à une fiche
// incomplète l'air d'un choix délibéré.
export function sousTitreResultat(resultat) {
  const marque = typeof resultat?.marques === 'string' && resultat.marques.trim()
    ? resultat.marques.trim()
    : null;
  const formats = formaterFormats(resultat?.formats);

  if (marque && formats) return `${marque} · ${formats}`;
  return marque || formats || null;
}

// Prix indicatif affiché à droite d'une ligne. null = on n'affiche RIEN : ni
// « — », ni « 0,00 € ». Une fiche sans prix relevé est un cas normal (fiche
// neuve, produit jamais scanné) ; y mettre un tiret ou un zéro donnerait à
// lire une information qui n'existe pas, et un zéro laisserait croire à un
// prix réel. Un prix négatif ou nul en base est une anomalie, pas un prix :
// on le tait pour la même raison.
export function formatPrixIndicatif(dernierPrix) {
  const n = Number(dernierPrix);
  if (dernierPrix == null || !Number.isFinite(n) || n <= 0) return null;
  return `${n.toFixed(2).replace('.', ',')} €`;
}
