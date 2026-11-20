// Chantier 161 — « Mot de passe oublié ». Règles pures, testées seules.
// Le lien envoyé par Supabase rouvre l'app avec, dans l'adresse (après #) :
//   - type=recovery (+ jetons) : lien valable → écran « nouveau mot de passe » ;
//   - error=access_denied / error_code=otp_expired : lien périmé ou déjà servi.

export const LONGUEUR_MIN_MOT_DE_PASSE = 6; // minimum par défaut de Supabase

export function lireRetourLien(hash) {
  const h = String(hash || '').replace(/^#/, '');
  const p = new URLSearchParams(h);
  const recuperation = p.get('type') === 'recovery' && !p.get('error');
  const lienInvalide = !!(p.get('error') || p.get('error_code'));
  return { recuperation, lienInvalide };
}

// Message d'erreur à afficher, ou null si le nouveau mot de passe convient.
export function verifierNouveauMotDePasse(motDePasse, confirmation) {
  const a = String(motDePasse || '');
  if (a.trim().length === 0) return 'Choisis un nouveau mot de passe.';
  if (a.length < LONGUEUR_MIN_MOT_DE_PASSE) return `Au moins ${LONGUEUR_MIN_MOT_DE_PASSE} caractères.`;
  if (a !== String(confirmation || '')) return 'Les deux mots de passe ne sont pas identiques.';
  return null;
}

// E-mail plausible (contrôle léger avant l'envoi du lien).
export function emailPlausible(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

// Traduit les erreurs Supabase les plus courantes en français simple.
export function messageErreurMotDePasse(erreur) {
  const m = String(erreur?.message || erreur || '').toLowerCase();
  if (!m) return null;
  if (m.includes('rate limit') || m.includes('security purposes') || m.includes('too many'))
    return 'Trop de demandes d\'un coup. Attends quelques minutes puis réessaie.';
  if (m.includes('different from the old') || (m.includes('same') && m.includes('password')))
    return 'Choisis un mot de passe différent de l\'ancien.';
  if (m.includes('weak') || m.includes('at least'))
    return `Mot de passe trop faible : au moins ${LONGUEUR_MIN_MOT_DE_PASSE} caractères.`;
  if (m.includes('session') || m.includes('jwt') || m.includes('expired'))
    return 'Ce lien n\'est plus valable. Redemande un lien depuis « Mot de passe oublié ? ».';
  return 'Ça n\'a pas marché. Réessaie dans un instant.';
}
