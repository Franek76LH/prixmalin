// Chantier 149 — conserver ce que le lecteur a lu sur un ticket.
//
// Pourquoi : pour régler le lecteur (promotions, libellés mal compris), il
// faut pouvoir relire ce qu'il a rendu. Au 18/11, rien n'était gardé :
// `tickets.texte_ocr_brut` vide sur les 21 tickets, aucune photo stockée.
//
// Ce qu'on garde : la LECTURE structurée (magasin, date, lignes, prix, remises,
// totaux), en texte, dans `tickets.texte_ocr_brut`. Pas la photo : un ticket
// peut porter un numéro de carte de fidélité ou la fin d'un numéro de carte
// bancaire, ce sont les données des utilisateurs (décision du 18/11).
//
// Comment : même mécanisme que l'empreinte (chantier 93) — on attend la fin de
// l'écriture Core, on retrouve le ticket qui vient d'être créé, on y pose le
// texte. On ne touche PAS à enregistrer_ticket_core. Jamais bloquant : un
// échec ici ne doit rien changer à l'import.
import { supabase } from './supabase';
import { doitRattacherTicketSession } from './sessionCoursesCore';

export const TAILLE_MAX_LECTURE = 60000;

// Champs de la lecture qu'on conserve. Liste fermée : rien d'autre ne part en
// base, même si le lecteur renvoie un jour autre chose.
const CHAMPS = ['store', 'address', 'date', 'total_ticket', 'nombre_articles', 'total_remises',
  'captures_peut_etre_incompletes'];
const CHAMPS_LIGNE = ['brand', 'name', 'libelle_ticket', 'confiance', 'format', 'quantite_nette', 'unite_quantite',
  'nombre_unites', 'qty', 'unit_price', 'price', 'total', 'remise', 'libelle_remise'];

const garder = (objet, champs) => Object.fromEntries(
  champs.filter(c => objet?.[c] !== undefined && objet[c] !== null && objet[c] !== '').map(c => [c, objet[c]]),
);

// La lecture, réduite aux champs utiles, en texte. Null s'il n'y a rien à garder.
export function texteDeLecture(lecture) {
  if (!lecture || typeof lecture !== 'object') return null;
  const lignes = (Array.isArray(lecture.products) ? lecture.products : [])
    .filter(l => l && typeof l === 'object')
    .map(l => garder(l, CHAMPS_LIGNE))
    .filter(l => Object.keys(l).length > 0);
  if (lignes.length === 0) return null;
  const texte = JSON.stringify({ ...garder(lecture, CHAMPS), products: lignes });
  return texte.length > TAILLE_MAX_LECTURE ? null : texte;
}

// Rend 'pose', 'ignore' ou 'erreur'. Ne lève jamais.
export async function conserverLectureApresImport(ecritureCorePromise, lecture, { utilisateurId = null } = {}) {
  try {
    const resultat = await ecritureCorePromise;
    if (!doitRattacherTicketSession(resultat)) return 'ignore';
    const texte = texteDeLecture(lecture);
    if (!texte) return 'ignore';
    let uid = utilisateurId;
    if (!uid) {
      const { data } = await supabase.auth.getSession();
      uid = data?.session?.user?.id ?? null;
    }
    if (!uid) return 'ignore';
    const { data: dernier, error: e1 } = await supabase.from('tickets')
      .select('id, texte_ocr_brut')
      .eq('utilisateur_id', uid)
      .order('cree_le', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (e1) throw e1;
    // Déjà renseigné : on n'écrase jamais une lecture existante.
    if (!dernier?.id || dernier.texte_ocr_brut != null) return 'ignore';
    const { error } = await supabase.from('tickets')
      .update({ texte_ocr_brut: texte })
      .eq('id', dernier.id)
      .is('texte_ocr_brut', null);
    if (error) throw error;
    return 'pose';
  } catch (e) {
    console.error('Conservation de la lecture du ticket (best effort) :', e);
    return 'erreur';
  }
}
