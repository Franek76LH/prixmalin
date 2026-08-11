// Chantier Analytics — PostHog en SHADOW : mesure d'usage, ZÉRO élément visible,
// aucune régression UX. Ce module initialise PostHog UNE SEULE FOIS, avec une
// config minimale et respectueuse de la vie privée (pas d'enregistrement d'écran).
//
// Garde-fou absolu : l'analytics ne doit JAMAIS impacter l'app. Si la clé est
// absente, on n'initialise pas et on ne plante pas. Toute erreur est avalée.
import posthog from 'posthog-js';
import { supabase } from './supabase';

const KEY  = import.meta.env.VITE_POSTHOG_KEY;
const HOST = import.meta.env.VITE_POSTHOG_HOST;

let initialise = false;

// Identifie l'utilisateur par son id Supabase (JAMAIS l'email en clair comme
// identifiant). Le pseudo (table profiles) est ajouté en simple propriété.
async function identifier(userId) {
  if (!initialise || !userId) return;
  try {
    posthog.identify(userId);
    const { data } = await supabase.from('profiles').select('pseudo').eq('id', userId).maybeSingle();
    if (data?.pseudo) posthog.setPersonProperties({ pseudo: data.pseudo });
  } catch {
    /* silencieux : l'analytics ne doit jamais casser l'app */
  }
}

// Chantier Micro, Lot 6 — capture d'un événement métier nommé. Même garde-fou
// absolu que le reste du module : sans init (clé absente) on ne fait rien, et
// aucune erreur d'analytics ne doit jamais remonter dans l'app.
export function capturerEvenement(nom, proprietes = {}) {
  if (!initialise || !nom) return;
  try { posthog.capture(nom, proprietes); } catch { /* silencieux */ }
}

// Initialise PostHog une seule fois. À appeler tôt (main.jsx), avant le rendu.
export function initPostHog() {
  if (initialise || !KEY) return;   // pas de clé -> pas d'init, pas de crash
  initialise = true;

  try {
    posthog.init(KEY, {
      api_host: HOST,
      capture_pageview: true,          // suit les écrans/pages
      autocapture: true,               // clics/boutons
      capture_exceptions: true,        // erreurs non gérées + rejets de promesses -> $exception (Error Tracking)
      disable_session_recording: true, // RGPD : jamais d'enregistrement d'écran
      person_profiles: 'identified_only',
    });

    // Branchement sur l'auth Supabase déjà en place (écoute additive : n'interfère
    // pas avec le onAuthStateChange d'App.jsx). onAuthStateChange émet aussi la
    // session courante au chargement (INITIAL_SESSION), donc pas besoin de getSession.
    supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) identifier(session.user.id);
      else if (event === 'SIGNED_OUT') posthog.reset();
    });
  } catch {
    /* silencieux */
  }
}
