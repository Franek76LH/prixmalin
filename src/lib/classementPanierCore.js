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

// #58.2.D — économie potentielle, décomposée par magasin : compare le coût
// réel du panier (principal + appoint, issus de classerMagasinsPourPanier)
// au coût du même panier si chaque article était payé au prix MOYEN de la
// zone (moyenne de ses prix chez tous les magasins de `magasins`, jamais la
// médiane ni le moins cher). Un article sans aucun prix dans `magasins` est
// exclu du calcul global (ni compté dans coutMoyenPanier, ni dans
// nbArticlesChiffres).
//
// L'économie de chaque magasin ne porte que sur les articles qu'IL fournit
// dans le classement retenu (principal.articlesTrouves / appoint.articlesTrouves) :
// c'est la somme, sur ces seuls articles, de (moyenne de zone − prix chez ce
// magasin), plancher à 0. economieTotale = economiePrincipal + economieAppoint
// (les deux magasins portent toujours sur des articles disjoints, jamais de
// double comptage). Ne mute rien.
export function calculerEconomiePotentielle(panier, magasins, classement) {
  const articlesPanier = Array.isArray(panier) ? panier : [];
  const listeMagasins = Array.isArray(magasins) ? magasins : [];

  const prixParArticle = new Map();
  for (const magasin of listeMagasins) {
    for (const ligne of magasin?.prix || []) {
      if (!prixParArticle.has(ligne.articleId)) prixParArticle.set(ligne.articleId, []);
      prixParArticle.get(ligne.articleId).push(Number(ligne.prix));
    }
  }

  const moyenneZone = (articleId) => {
    const prix = prixParArticle.get(articleId);
    if (!prix || prix.length === 0) return null;
    return prix.reduce((somme, p) => somme + p, 0) / prix.length;
  };

  let coutMoyenPanier = 0;
  let nbArticlesChiffres = 0;
  for (const article of articlesPanier) {
    const moyenne = moyenneZone(article.articleId);
    if (moyenne == null) continue;
    coutMoyenPanier += moyenne;
    nbArticlesChiffres += 1;
  }

  const magasinParId = new Map(listeMagasins.map(m => [m.magasinId, m]));

  const economieDuMagasin = (entreeClassement) => {
    if (!entreeClassement) return 0;
    const magasin = magasinParId.get(entreeClassement.magasinId);
    if (!magasin) return 0;

    const prixParArticleDuMagasin = new Map((magasin.prix || []).map(p => [p.articleId, Number(p.prix)]));

    let somme = 0;
    for (const articleId of entreeClassement.articlesTrouves || []) {
      const moyenne = moyenneZone(articleId);
      const prixMagasin = prixParArticleDuMagasin.get(articleId);
      if (moyenne == null || prixMagasin == null) continue;
      somme += moyenne - prixMagasin;
    }
    return Math.max(0, somme);
  };

  const economiePrincipal = economieDuMagasin(classement?.principal);
  const economieAppoint = economieDuMagasin(classement?.appoint);
  const economieTotale = economiePrincipal + economieAppoint;

  const coutReel = (classement?.principal?.total || 0) + (classement?.appoint?.total || 0);

  return { economieTotale, economiePrincipal, economieAppoint, coutMoyenPanier, coutReel, nbArticlesChiffres };
}
