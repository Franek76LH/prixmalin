// Chantier 214 (143-C et 143-E, côté app) — calculs purs des écrans
// « À vérifier » (membres de confiance) et « Suspendre ce compte » (François).
// La base fait tout le travail (chantiers 211 et 212) ; ici on ne fait que
// mettre en mots ce qu'elle renvoie.

const nombre = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pluriel = (n, un, plusieurs = `${un}s`) => `${n} ${n > 1 ? plusieurs : un}`;

function formatQuantite(q, u) {
  const n = Number(q);
  if (!Number.isFinite(n) || n <= 0 || !u) return null;
  const unite = String(u).toLowerCase();
  if (unite === 'g' && n >= 1000) return `${String(n / 1000).replace('.', ',')} kg`;
  if (unite === 'ml' && n >= 1000) return `${String(n / 1000).replace('.', ',')} L`;
  if (unite === 'ml' && n % 10 === 0 && n < 1000) return `${n / 10} cl`;
  return `${String(n).replace('.', ',')} ${unite}`;
}

// Ligne de lister_propositions_scan_a_verifier → ce qu'on montre.
//   { titre, produit, inconnu, code, monAvis, oui }
export function carteProposition(p) {
  const x = p && typeof p === 'object' ? p : {};
  const inconnu = !x.produit_id;
  const morceaux = inconnu
    ? [x.nom_off || null]
    : [x.nom_produit || x.libelle_variante || null, x.marque || null, formatQuantite(x.quantite_nette, x.unite_quantite)];
  const produit = morceaux.filter(Boolean).join(' · ') || null;
  return {
    id: x.proposition_id ?? null,
    titre: String(x.libelle_ticket || '').trim() || 'Article sans libellé',
    produit,
    inconnu,
    code: x.code_barres || null,
    monAvis: x.mon_avis === 'confirme' || x.mon_avis === 'refuse' ? x.mon_avis : null,
    oui: nombre(x.nb_confirmations),
  };
}

// Ordre d'affichage : celles où je n'ai pas encore donné mon avis d'abord,
// puis les plus anciennes d'abord (elles attendent depuis plus longtemps).
export function trierPropositions(liste) {
  const l = Array.isArray(liste) ? liste.filter(p => p && p.proposition_id) : [];
  return [...l].sort((a, b) => {
    const da = a.mon_avis ? 1 : 0;
    const db = b.mon_avis ? 1 : 0;
    if (da !== db) return da - db;
    return String(a.cree_le || '').localeCompare(String(b.cree_le || ''));
  });
}

// Combien attendent encore MON avis (pastille de l'écran Moi).
export function nbAvisAttendus(liste) {
  return (Array.isArray(liste) ? liste : []).filter(p => p && p.proposition_id && !p.mon_avis).length;
}

// Réponse de donner_avis_proposition_scan → message court.
export function messageApresAvis(retour, avis) {
  const r = retour && typeof retour === 'object' ? retour : {};
  if (r.validee === true) return '✓ Validé grâce à toi, merci !';
  if (avis === 'refuse') return 'Merci, François va regarder ce produit.';
  const oui = nombre(r.confirmations);
  const seuil = nombre(r.seuil) || 2;
  const reste = Math.max(0, seuil - oui);
  return reste > 0 ? `Merci ! Encore ${pluriel(reste, 'avis', 'avis')} et c'est validé.` : 'Merci pour ton avis !';
}

// Erreurs de la base (raise exception) → phrase lisible.
export function messageErreurAvis(error) {
  const t = [error?.message, error?.details].filter(Boolean).join(' ');
  if (/PROPRE_PROPOSITION/.test(t)) return 'C\'est ta propre proposition : un autre membre doit la vérifier.';
  if (/NON_AUTORISE/.test(t)) return 'La vérification est réservée aux membres de confiance.';
  if (/déjà traitée|deja traitee/i.test(t)) return 'Déjà traitée entre-temps, merci quand même !';
  if (/introuvable/i.test(t)) return 'Cette proposition n\'existe plus.';
  return 'Avis non enregistré, réessaie.';
}

// Aperçu de annuler_contributions_compte (p_appliquer = false) → lignes de
// texte pour la confirmation. Les zéros sont tus ; rien du tout → une phrase.
export function resumeApercuSuspension(apercu) {
  const a = apercu && typeof apercu === 'object' ? apercu : {};
  const lignes = [];
  const n = (k) => nombre(a[k]);
  if (n('prix')) {
    const dans = n('prix_dans_le_comparateur');
    lignes.push(`${pluriel(n('prix'), 'prix', 'prix')} retiré${n('prix') > 1 ? 's' : ''} du comparateur${dans && dans !== n('prix') ? ` (dont ${dans} affiché${dans > 1 ? 's' : ''} aujourd'hui)` : ''}`);
  }
  if (n('points') || n('mouvements_points')) lignes.push(`${pluriel(n('points'), 'point')} annulé${n('points') > 1 ? 's' : ''}`);
  if (n('propositions_en_attente')) lignes.push(`${pluriel(n('propositions_en_attente'), 'proposition')} en attente refusée${n('propositions_en_attente') > 1 ? 's' : ''}`);
  if (n('avis_en_cours')) lignes.push(`${pluriel(n('avis_en_cours'), 'avis', 'avis')} en cours retiré${n('avis_en_cours') > 1 ? 's' : ''}`);
  if (n('alias')) lignes.push(`${pluriel(n('alias'), 'libellé appris', 'libellés appris')} écarté${n('alias') > 1 ? 's' : ''}`);
  if (n('fiches_creees_a_revoir')) lignes.push(`${pluriel(n('fiches_creees_a_revoir'), 'fiche créée', 'fiches créées')} à revoir (jamais supprimée${n('fiches_creees_a_revoir') > 1 ? 's' : ''})`);
  if (n('codes_barres_appris_a_revoir')) lignes.push(`${pluriel(n('codes_barres_appris_a_revoir'), 'code-barres appris', 'codes-barres appris')} à revoir (gardé${n('codes_barres_appris_a_revoir') > 1 ? 's' : ''})`);
  return {
    dejaSuspendu: a.deja_suspendu === true,
    lignes,
    vide: lignes.length === 0,
    phrase: lignes.length === 0 ? 'Ce compte n\'a rien apporté à annuler : il sera seulement mis en pause.' : null,
  };
}

// Erreurs de annuler_contributions_compte / lever_suspension_compte.
export function messageErreurSuspension(error) {
  const t = [error?.message, error?.details].filter(Boolean).join(' ');
  if (/admin/i.test(t) && /réservé|reserve/i.test(t)) return 'Réservé à l\'administrateur.';
  if (/soi|toi-même|vous-même|propre compte/i.test(t)) return 'Impossible de suspendre ton propre compte.';
  if (/admin/i.test(t)) return 'Un compte administrateur ne peut pas être suspendu.';
  if (/non suspendu/i.test(t)) return 'Ce compte n\'est plus suspendu.';
  if (/introuvable/i.test(t)) return 'Compte introuvable.';
  return 'Action impossible, réessaie.';
}
