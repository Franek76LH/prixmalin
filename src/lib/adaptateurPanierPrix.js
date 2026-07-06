// #58.2.B (étape 1) — adaptateur pur : transforme les données déjà utilisées
// par CompareTab (items, priceDB, magasinsGeo) au format attendu par
// classerMagasinsPourPanier (classementPanierCore.js). Module isolé, pur,
// non branché à l'UI ni à Supabase, mode shadow strict.
//
// Ne réimplémente JAMAIS le matching produit/prix, le filtre de fraîcheur ni
// le filtre de distance : ces trois décisions sont déléguées aux prédicats
// injectés (itemMatchesPrice, estRecent, estDansRayon), exactement ceux
// utilisés par l'écran actuel, pour garantir zéro divergence avec l'existant.
//
// Identité magasin retenue (regroupement par MAGASIN PHYSIQUE, jamais par
// enseigne) :
//   1. `store_id` (clé de la table `stores` géolocalisée) si présent — c'est
//      la seule identité qui distingue deux magasins réels d'une même
//      enseigne (ex. Carrefour Rennes vs Carrefour Nantes) ;
//   2. à défaut, une clé composite normalisée `store_name` + `store_address`
//      (les deux doivent être renseignés — un nom seul est trop ambigu) ;
//   3. sinon, la ligne de prix n'a aucune identité magasin exploitable : elle
//      est ignorée silencieusement et comptée dans
//      `diagnostics.lignesPrixIgnoreesSansIdentite`.

function normaliserCle(texte) {
  return String(texte)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function resoudreIdentiteMagasin(prix, geo) {
  if (prix.store_id != null) {
    return {
      magasinId: `store_id:${prix.store_id}`,
      magasinNom: geo?.name || prix.store_name || prix.storeId || 'Magasin',
    };
  }

  const nom = String(prix.store_name || '').trim();
  const adresse = String(prix.store_address || '').trim();
  if (nom && adresse) {
    return {
      magasinId: `nom_adresse:${normaliserCle(nom)}::${normaliserCle(adresse)}`,
      magasinNom: nom,
    };
  }

  return null;
}

function construireLibelle(item) {
  const marque = item.brand ? `${item.brand} · ` : '';
  const format = item.format ? ` ${item.format}` : '';
  return `${marque}${item.product}${format}`;
}

// Construit { panier, magasins } au format de classerMagasinsPourPanier, à
// partir des données brutes de CompareTab. Ne mute ni items, ni priceDB, ni
// magasinsGeo.
export function construirePanierEtMagasins({ items, priceDB, magasinsGeo, itemMatchesPrice, estRecent, estDansRayon }) {
  const listeItems = Array.isArray(items) ? items : [];
  const listePrix = Array.isArray(priceDB) ? priceDB : [];
  const listeMagasinsGeo = Array.isArray(magasinsGeo) ? magasinsGeo : [];

  const geoParStoreId = new Map(listeMagasinsGeo.map(g => [g.id, g]));

  const panier = listeItems.map(item => ({
    articleId: item.id,
    libelle: construireLibelle(item),
  }));

  let lignesPrixIgnoreesSansIdentite = 0;
  const parMagasin = new Map();

  for (const item of listeItems) {
    for (const prix of listePrix) {
      if (!itemMatchesPrice(item, prix)) continue;
      if (!estRecent(prix)) continue;

      const geo = prix.store_id != null ? geoParStoreId.get(prix.store_id) : undefined;
      if (!estDansRayon(prix, geo)) continue;

      const identite = resoudreIdentiteMagasin(prix, geo);
      if (!identite) {
        lignesPrixIgnoreesSansIdentite += 1;
        continue;
      }

      if (!parMagasin.has(identite.magasinId)) {
        parMagasin.set(identite.magasinId, { magasinNom: identite.magasinNom, prixParArticle: new Map() });
      }
      const entreeMagasin = parMagasin.get(identite.magasinId);
      const prixCourant = Number(prix.price);
      const prixExistant = entreeMagasin.prixParArticle.get(item.id);
      if (prixExistant == null || prixCourant < prixExistant) {
        entreeMagasin.prixParArticle.set(item.id, prixCourant);
      }
    }
  }

  const magasins = Array.from(parMagasin.entries()).map(([magasinId, { magasinNom, prixParArticle }]) => ({
    magasinId,
    magasinNom,
    prix: Array.from(prixParArticle.entries()).map(([articleId, prixUnitaire]) => {
      const item = listeItems.find(i => i.id === articleId);
      const qty = Number(item?.qty) || 1;
      return { articleId, prix: prixUnitaire * qty };
    }),
  }));

  return { panier, magasins, diagnostics: { lignesPrixIgnoreesSansIdentite } };
}
