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

// Chantier 162 — erreurs de connexion et d'inscription en français simple.
// `proposerOubli` : afficher un bouton « Mot de passe oublié ? » sous le
// message (compte déjà existant, ou e-mail / mot de passe refusés).
export function traduireErreurConnexion(erreur) {
  const m = String(erreur?.message || erreur || '').toLowerCase();
  if (!m) return { message: null, proposerOubli: false };
  if (m.includes('already registered') || m.includes('already been registered') || m.includes('already exists'))
    return { message: 'Tu as déjà un compte avec cet e-mail. Connecte-toi, ou choisis un nouveau mot de passe si tu l\'as oublié.', proposerOubli: true };
  if (m.includes('invalid login credentials') || m.includes('invalid credentials'))
    return { message: 'E-mail ou mot de passe incorrect.', proposerOubli: true };
  if (m.includes('email not confirmed'))
    return { message: 'Ton e-mail n\'est pas encore confirmé : clique sur le lien reçu à l\'inscription (pense à regarder dans les indésirables).', proposerOubli: false };
  if (m.includes('password should be at least') || m.includes('weak'))
    return { message: `Mot de passe trop court : au moins ${LONGUEUR_MIN_MOT_DE_PASSE} caractères.`, proposerOubli: false };
  if (m.includes('unable to validate email') || m.includes('invalid format') || m.includes('email address') && m.includes('invalid'))
    return { message: 'Cet e-mail n\'a pas l\'air valide. Vérifie-le.', proposerOubli: false };
  if (m.includes('rate limit') || m.includes('security purposes') || m.includes('too many'))
    return { message: 'Trop de tentatives d\'un coup. Attends quelques minutes puis réessaie.', proposerOubli: false };
  if (m.includes('fetch') || m.includes('network'))
    return { message: 'Pas de connexion internet ? Réessaie dans un instant.', proposerOubli: false };
  return { message: 'Ça n\'a pas marché. Réessaie dans un instant.', proposerOubli: false };
}
