// #58.2.C — classement des magasins pour un panier entier (principal +
// appoint), mode shadow. Module isolé, pur, non branché à l'UI ni à Supabase.

function calculerCouverture(magasin, idsACouvrir) {
  const prixParArticle = new Map((magasin?.prix || []).map(p => [p.articleId, p.prix]));
  const articlesTrouves = [];
  let total = 0;

  for (const articleId of idsACouvrir) {
    if (prixParArticle.has(articleId)) {
      articlesTrouves.push(articleId);
      total += Number(prixParArticle.get(articleId));
    }
  }

  return { articlesTrouves, total };
}

// Sélectionne, parmi les magasins, celui qui couvre le plus d'articles de
// idsACouvrir ; en cas d'égalité, le total le plus bas sur ces articles ;
// sinon l'ordre d'entrée (jamais remplacé sur une égalité stricte, donc le
// premier candidat vu à couverture/total égaux reste en tête — déterministe).
function meilleurCandidat(magasins, idsACouvrir, magasinIdExclu) {
  let meilleur = null;

  for (const magasin of magasins) {
    if (magasinIdExclu != null && magasin.magasinId === magasinIdExclu) continue;

    const { articlesTrouves, total } = calculerCouverture(magasin, idsACouvrir);
    if (articlesTrouves.length === 0) continue;

    const candidat = { magasin, articlesTrouves, total, nbTrouves: articlesTrouves.length };

    if (!meilleur) {
      meilleur = candidat;
    } else if (candidat.nbTrouves > meilleur.nbTrouves) {
      meilleur = candidat;
    } else if (candidat.nbTrouves === meilleur.nbTrouves && candidat.total < meilleur.total) {
      meilleur = candidat;
    }
  }

  return meilleur;
}

// Classe les magasins pour un panier entier : un magasin "principal" (la
// meilleure couverture globale), un magasin "appoint" qui complète au mieux
// les articles manquants du principal, et les articles introuvables chez les
// deux. Ne mute jamais panier ni magasins — retourne toujours de nouveaux
// objets/tableaux.
export function classerMagasinsPourPanier(panier, magasins) {
  const articlesPanier = Array.isArray(panier) ? panier : [];
  const listeMagasins = Array.isArray(magasins) ? magasins : [];
  const idsPanier = articlesPanier.map(a => a.articleId);

  if (idsPanier.length === 0) {
    return { principal: null, appoint: null, nonTrouves: [] };
  }

  const libelleParArticleId = new Map(articlesPanier.map(a => [a.articleId, a.libelle]));

  const candidatPrincipal = meilleurCandidat(listeMagasins, idsPanier, null);
  const principal = candidatPrincipal
    ? {
        magasinId: candidatPrincipal.magasin.magasinId,
        magasinNom: candidatPrincipal.magasin.magasinNom,
        nbTrouves: candidatPrincipal.nbTrouves,
        nbManquants: idsPanier.length - candidatPrincipal.nbTrouves,
        total: candidatPrincipal.total,
        articlesTrouves: [...candidatPrincipal.articlesTrouves],
      }
    : null;

  const idsManquants = principal
    ? idsPanier.filter(id => !principal.articlesTrouves.includes(id))
    : [...idsPanier];

  const candidatAppoint = idsManquants.length > 0
    ? meilleurCandidat(listeMagasins, idsManquants, principal?.magasinId ?? null)
    : null;

  const appoint = candidatAppoint
    ? {
        magasinId: candidatAppoint.magasin.magasinId,
        magasinNom: candidatAppoint.magasin.magasinNom,
        nbTrouves: candidatAppoint.nbTrouves,
        total: candidatAppoint.total,
        articlesTrouves: [...candidatAppoint.articlesTrouves],
      }
    : null;

  const idsNonTrouves = appoint
    ? idsManquants.filter(id => !appoint.articlesTrouves.includes(id))
    : idsManquants;

  const nonTrouves = idsNonTrouves.map(articleId => ({ articleId, libelle: libelleParArticleId.get(articleId) }));

  return { principal, appoint, nonTrouves };
}
