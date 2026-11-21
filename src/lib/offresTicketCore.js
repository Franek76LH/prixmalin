// Chantier 148 — après l'enregistrement d'un ticket, ranger dans le carnet
// des offres (table offres_promotion) les promotions constatées sur ses lignes.
//
// Principe (décidé avec François le 18/11) : une offre n'est JAMAIS un prix.
// Le prix normal reste dans `prix` ; ici on note seulement la règle comprise
// (« 2 achetés, le 3e offert »), pour la faire entrer plus tard dans le calcul
// du panier et la rappeler une fois le magasin choisi. Pas de vitrine.
//
// Même mécanisme que l'empreinte (chantier 93) et la lecture conservée (149) :
// on attend la fin de l'écriture Core, on retrouve le dernier ticket de
// l'utilisateur, on lit ses lignes remisées, et on appelle la fonction de la
// base `enregistrer_offres_ticket`. C'est la base qui fournit le magasin, le
// produit, le prix normal, la quantité et la remise : l'app n'envoie que la
// règle. Jamais bloquant pour l'import, ne lève jamais.

import { supabase } from './supabase';
import { doitRattacherTicketSession } from './sessionCoursesCore';
import {
  comprendreRemiseDeLigne,
  OFFRE_LOT_GRATUIT, OFFRE_NIEME_REMISE, OFFRE_POURCENTAGE, OFFRE_MONTANT,
} from './promotionsCore';

export const ORIGINE_TEXTE = 'ticket_texte';
export const ORIGINE_CHIFFRES = 'ticket_chiffres';

const centimes = (n) => Math.round(Number(n) * 100);
const propre = (t) => String(t ?? '').trim().toLowerCase();

// Les paramètres de la règle, sans rien d'autre (ni type, ni drapeau).
export function parametresOffre(offre) {
  switch (offre?.type) {
    case OFFRE_LOT_GRATUIT: return { achetes: offre.achetes, offerts: offre.offerts };
    case OFFRE_NIEME_REMISE: return { rang: offre.rang, pourcentage: offre.pourcentage };
    case OFFRE_POURCENTAGE: return { pourcentage: offre.pourcentage };
    case OFFRE_MONTANT: return { montant: offre.montant };
    default: return offre?.montant != null ? { montant: offre.montant } : {};
  }
}

// Le texte imprimé de la remise, retrouvé dans la lecture du ticket : même
// libellé d'article ET même montant de remise. Rien de sûr -> chaîne vide.
export function libelleRemisePourLigne(ligne, lecture) {
  const produits = Array.isArray(lecture?.products) ? lecture.products : [];
  const trouves = produits.filter(p =>
    p && propre(p.libelle_ticket) === propre(ligne?.libelle_ticket) && propre(p.libelle_ticket) !== ''
    && centimes(p.remise) === centimes(ligne?.montant_remise));
  const textes = [...new Set(trouves.map(p => String(p.libelle_remise ?? '').trim()).filter(Boolean))];
  return textes.length === 1 ? textes[0] : '';
}

// Chantier 167 — nombre d'articles portant ce libellé sur tout le ticket lu
// (somme des quantités), remisés ou non. null si la lecture ne dit rien.
export function unitesDuLibelle(ligne, lecture) {
  const produits = Array.isArray(lecture?.products) ? lecture.products : [];
  const cle = propre(ligne?.libelle_ticket);
  if (!cle) return null;
  const memes = produits.filter(p => p && propre(p.libelle_ticket) === cle);
  if (memes.length === 0) return null;
  return memes.reduce((n, p) => n + (Number(p.qty ?? p.quantite) || 1), 0);
}

// Lignes remisées du ticket (lues en base) -> offres à envoyer. Pure.
export function construireOffresDuTicket(lignes, lecture) {
  return (Array.isArray(lignes) ? lignes : [])
    .filter(l => l?.id && Number(l.montant_remise) > 0)
    .map(l => {
      const texte = libelleRemisePourLigne(l, lecture);
      const offre = comprendreRemiseDeLigne({
        libelleRemise: texte,
        prixNormal: Number(l.prix_unitaire),
        quantite: Number(l.quantite) || 1,
        montantRemise: Number(l.montant_remise),
        unitesTicket: unitesDuLibelle(l, lecture),
      });
      if (!offre) return null;
      return {
        ligne_ticket_id: l.id,
        mecanique: offre.type,
        parametres: parametresOffre(offre),
        origine: offre.deduite ? ORIGINE_CHIFFRES : ORIGINE_TEXTE,
        ...(texte ? { texte_imprime: texte } : {}),
      };
    })
    .filter(Boolean);
}

// Rend 'pose', 'ignore' ou 'erreur'. Ne lève jamais.
export async function enregistrerOffresApresImport(ecritureCorePromise, lecture, { utilisateurId = null } = {}) {
  try {
    const resultat = await ecritureCorePromise;
    if (!doitRattacherTicketSession(resultat)) return 'ignore';
    // Aucune remise lue sur ce ticket : rien à chercher en base.
    const produits = Array.isArray(lecture?.products) ? lecture.products : [];
    if (!produits.some(p => Number(p?.remise) > 0)) return 'ignore';
    let uid = utilisateurId;
    if (!uid) {
      const { data } = await supabase.auth.getSession();
      uid = data?.session?.user?.id ?? null;
    }
    if (!uid) return 'ignore';
    const { data: dernier, error: e1 } = await supabase.from('tickets')
      .select('id')
      .eq('utilisateur_id', uid)
      .order('cree_le', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (e1) throw e1;
    if (!dernier?.id) return 'ignore';
    const { data: lignes, error: e2 } = await supabase.from('lignes_ticket')
      .select('id, libelle_ticket, quantite, prix_unitaire, montant_remise')
      .eq('ticket_id', dernier.id)
      .gt('montant_remise', 0);
    if (e2) throw e2;
    const offres = construireOffresDuTicket(lignes, lecture);
    if (offres.length === 0) return 'ignore';
    const { data, error } = await supabase.rpc('enregistrer_offres_ticket', { p_ticket_id: dernier.id, p_offres: offres });
    if (error) throw error;
    return data?.statut === 'ok' && Number(data.offres_ecrites) > 0 ? 'pose' : 'ignore';
  } catch (e) {
    console.error('Enregistrement des offres du ticket (best effort) :', e);
    return 'erreur';
  }
}
