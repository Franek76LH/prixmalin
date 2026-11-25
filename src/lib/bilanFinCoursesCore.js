// Chantier 163 — Bilan de fin de courses : un seul écran à la clôture.
// Fonctions PURES (aucun accès réseau), testées dans bilanFinCoursesCore.test.js.
//
// Décisions de François (21/11) :
//   1. Ce qui reste à acheter revient dans « À acheter » (même ligne de Ma
//      liste, quantité mise à jour), case « Garder dans Ma liste » cochée par
//      défaut ; décocher = retirer.
//   2. Un article coché en rayon mais absent du ticket est ACHETÉ par défaut
//      (la coche fait foi) ; il apparaît dans « À vérifier » avec « Pas pris ».
//
// Règle de quantité : restant = quantité ACTUELLE de la ligne dans Ma liste
// − quantité achetée (jamais < 0). La quantité prévue est figée dans la
// session au choix du magasin : l'écart avec la quantité actuelle =
// « ajouté depuis » (autre repas…). Les lignes de Ma liste qui ne font pas
// partie des courses ne sont jamais touchées.
//
// L'absence d'un produit sur le ticket ne prouve PAS une rupture : on ne dit
// « introuvable » que si l'utilisateur l'a marqué 🚫 en rayon.

const cleGroupe = (produitId, varianteId) => `p:${produitId}|v:${varianteId ?? ''}`;

// Regroupe les lignes du ticket AVANT tout rapprochement : même produit et
// même format → une seule entrée (quantités et montants additionnés). Les
// lignes sans produit reconnu restent une par une.
export function regrouperLignesTicket(lignes) {
  const groupes = new Map();
  const nonReconnues = [];
  for (const l of lignes || []) {
    if (!l || typeof l !== 'object') continue;
    const quantite = Number(l.quantite) > 0 ? Number(l.quantite) : 1;
    const pu = l.prix_unitaire != null && Number.isFinite(Number(l.prix_unitaire)) ? Number(l.prix_unitaire) : null;
    const montant = pu != null ? Math.round(pu * quantite * 100) / 100 : null;
    if (l.produit_id == null) {
      nonReconnues.push({ libelle: l.libelle || l.libelle_ticket || l.libelle_brut || 'Ligne du ticket', quantite, montant });
      continue;
    }
    const k = cleGroupe(l.produit_id, l.variante_produit_id);
    const g = groupes.get(k);
    if (g) {
      g.quantite += quantite;
      g.montant = g.montant != null && montant != null ? Math.round((g.montant + montant) * 100) / 100 : (g.montant ?? montant);
      g.nbLignes += 1;
    } else {
      groupes.set(k, {
        produit_id: l.produit_id, variante_produit_id: l.variante_produit_id ?? null,
        libelle: l.libelle || l.libelle_ticket || l.libelle_brut || 'Article du ticket',
        quantite, montant, nbLignes: 1,
      });
    }
  }
  return { groupes: [...groupes.values()], nonReconnues };
}

const prixParUnite = (g) => (g.montant != null && g.quantite > 0 ? g.montant / g.quantite : null);
const arrondi = (n) => (n == null ? null : Math.round(n * 100) / 100);

// Construit le bilan. `quantitesListe` : Map ou objet { idLigneListe: quantité
// actuelle } des lignes « à acheter » de Ma liste ; une ligne absente = retirée
// de la liste pendant les courses (on n'y touche plus).
// `decisions` : { [cle]: 'pas_pris' } pour les articles « à vérifier ».
export function construireBilanFin({ articles, lignesTicket = null, quantitesListe = {}, decisions = {} }) {
  const qListe = quantitesListe instanceof Map ? quantitesListe : new Map(Object.entries(quantitesListe || {}));
  const caddie = (articles || []).filter(a => a && a.type === 'caddie' && !a.hors_liste);
  const avecTicket = Array.isArray(lignesTicket) && lignesTicket.length > 0;
  const { groupes, nonReconnues } = avecTicket ? regrouperLignesTicket(lignesTicket) : { groupes: [], nonReconnues: [] };
  const restants = groupes.map(g => ({ ...g, restant: g.quantite }));

  // Allocation des quantités du ticket aux articles prévus : d'abord le
  // format demandé dans la liste (ou celui du prix retenu), puis n'importe
  // quel format du même produit.
  const achete = new Map();
  const formatsAchetes = new Map(); // cle -> variantes effectivement prises
  if (avecTicket) {
    const prendre = (a, filtre) => {
      const prevu = Number(a.quantite) > 0 ? Number(a.quantite) : 1;
      for (const g of restants) {
        const deja = achete.get(a.cle) || 0;
        if (deja >= prevu) return;
        if (g.restant <= 0 || !filtre(g)) continue;
        const pris = Math.min(prevu - deja, g.restant);
        g.restant -= pris;
        achete.set(a.cle, deja + pris);
        const f = formatsAchetes.get(a.cle) || [];
        f.push({ variante_produit_id: g.variante_produit_id, quantite: pris, montant: prixParUnite(g) != null ? arrondi(prixParUnite(g) * pris) : null });
        formatsAchetes.set(a.cle, f);
      }
    };
    for (const a of caddie) {
      if (a.produit_id == null) continue;
      const voulue = a.variante_liste ?? a.variante_produit_id ?? null;
      if (voulue != null) prendre(a, g => g.produit_id === a.produit_id && g.variante_produit_id === voulue);
    }
    for (const a of caddie) {
      if (a.produit_id == null) continue;
      prendre(a, g => g.produit_id === a.produit_id);
    }
  }

  const retrouves = [], reste = [], aVerifier = [];
  for (const a of caddie) {
    const prevu = Number(a.quantite) > 0 ? Number(a.quantite) : 1;
    const nom = a.nom_affiche || a.nom_reference || 'Article';
    const coche = a.etat === 'au_caddie';
    let qAchetee;
    let incertain = false;
    if (avecTicket) {
      qAchetee = achete.get(a.cle) || 0;
      if (qAchetee === 0) {
        if (a.achat === 'confirme') qAchetee = prevu;               // relié par le libellé, ou confirmé par l'utilisateur
        else if (a.achat === 'non_achete' && coche) qAchetee = 0;   // l'utilisateur a dit « pas pris »
        else if (coche) {                                            // décision 2 : acheté par défaut
          incertain = true;
          qAchetee = decisions[a.cle] === 'pas_pris' ? 0 : prevu;
        }
      }
    } else {
      qAchetee = coche ? prevu : 0;
    }

    const formats = formatsAchetes.get(a.cle) || [];
    const autreFormat = a.variante_liste != null && formats.some(f => f.variante_produit_id != null && f.variante_produit_id !== a.variante_liste);
    const montant = formats.length ? arrondi(formats.reduce((s, f) => s + (f.montant ?? 0), 0)) : null;

    if (incertain) aVerifier.push({ cle: a.cle, nom, quantite: prevu, pasPris: decisions[a.cle] === 'pas_pris' });
    if (qAchetee > 0) retrouves.push({ cle: a.cle, nom, prevu, achete: qAchetee, autreFormat, montant, incertain, sansTicket: !avecTicket });

    // Reste à acheter, sur la ligne actuelle de Ma liste.
    const ligneExiste = qListe.has(String(a.cle));
    if (!ligneExiste) continue;
    const qActuelle = Number(qListe.get(String(a.cle))) > 0 ? Number(qListe.get(String(a.cle))) : 1;
    const restant = Math.max(0, qActuelle - qAchetee);
    if (restant > 0) {
      const ajouteDepuis = Math.max(0, qActuelle - prevu);
      let raison = 'pas_pris';
      if (a.etat === 'introuvable') raison = a.remplace_par ? 'remplace' : 'introuvable';
      else if (qAchetee > 0 && restant > ajouteDepuis) raison = 'partiel';
      else if (qAchetee >= prevu && ajouteDepuis > 0) raison = 'ajoute_depuis';
      reste.push({ cle: a.cle, nom, quantite: restant, quantiteActuelle: qActuelle, ajouteDepuis, raison, ...(a.remplace_par ? { remplacePar: a.remplace_par } : {}) });
    }
  }

  const enPlus = restants.filter(g => g.restant > 0).map(g => ({
    produit_id: g.produit_id, variante_produit_id: g.variante_produit_id, nom: g.libelle,
    quantite: g.restant, montant: prixParUnite(g) != null ? arrondi(prixParUnite(g) * g.restant) : null,
  }));

  // Chantier 182 — remplacements décidés en rayon (« Remplacé par… »).
  const remplacements = caddie.filter(a => a.remplace_par).map(a => ({ cle: a.cle, nom: a.nom_affiche || a.nom_reference || 'Article', par: a.remplace_par }));

  return {
    avecTicket,
    retrouves, enPlus, reste, aVerifier, nonReconnues, remplacements,
    totalEnPlus: arrondi(enPlus.reduce((s, e) => s + (e.montant ?? 0), 0)),
  };
}

// Ce que la clôture écrit dans Ma liste, d'après le bilan et les choix.
// `garder` : { [cle]: false } pour les articles décochés (défaut : gardé).
// Renvoie { majQuantite: [{ id, quantite }], supprimer: [id] } — uniquement
// des lignes des courses ; une ligne gardée garde son id (pas de doublon).
export function planClotureListe({ articles, bilan, quantitesListe = {}, garder = {} }) {
  const qListe = quantitesListe instanceof Map ? quantitesListe : new Map(Object.entries(quantitesListe || {}));
  const restePar = new Map((bilan?.reste || []).map(r => [String(r.cle), r]));
  const majQuantite = [], supprimer = [];
  for (const a of articles || []) {
    if (!a || a.type !== 'caddie' || a.hors_liste) continue;
    const id = String(a.cle);
    if (!qListe.has(id)) continue; // retirée de Ma liste pendant les courses
    const r = restePar.get(id);
    if (r && garder[id] !== false) {
      if (r.quantite !== Number(qListe.get(id))) majQuantite.push({ id, quantite: r.quantite });
    } else {
      supprimer.push(id);
    }
  }
  return { majQuantite, supprimer };
}
