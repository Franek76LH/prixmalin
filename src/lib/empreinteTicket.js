// ============================================================================
// Chantier 93 Lot 7 — Anti-doublon de ticket (prérequis des Points Malin).
// Empreinte déterministe d'un ticket au moment de l'import : même magasin +
// même date + même total + même nombre de lignes + mêmes libellés (normalisés,
// TRIÉS — l'ordre des lignes ne compte pas) => même empreinte => doublon
// bloqué AVANT toute écriture. La colonne tickets.empreinte + l'index unique
// (utilisateur_id, empreinte, version_empreinte) existent déjà — aucune
// migration ici, et enregistrer_ticket_core n'est pas modifiée : l'empreinte
// est posée APRÈS coup par un update propriétaire (RLS
// tickets_modification_propre).
// SHA-256 en JS PUR : crypto.subtle n'existe pas en contexte non sécurisé
// (tests iPhone en http LAN — incident 2026-08-11), on ne s'y adosse jamais.
// ============================================================================
import { supabase } from './supabase';
import { normaliserLibelleLocal } from './rapprochementCoursesCore';
import { doitRattacherTicketSession } from './sessionCoursesCore';

// ── SHA-256 pur JS (FIPS 180-4), vérifié contre des vecteurs connus ─────────
const K_SHA256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

export function sha256Hex(message) {
  const donnees = new TextEncoder().encode(String(message ?? ''));
  const lg = donnees.length;
  // Bourrage : 0x80, zéros, longueur en bits sur 64 bits big-endian.
  const lgTotale = (((lg + 8) >> 6) + 1) << 6;
  const bloc = new Uint8Array(lgTotale);
  bloc.set(donnees);
  bloc[lg] = 0x80;
  const bits = lg * 8;
  const vue = new DataView(bloc.buffer);
  vue.setUint32(lgTotale - 8, Math.floor(bits / 0x100000000), false);
  vue.setUint32(lgTotale - 4, bits >>> 0, false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let debut = 0; debut < lgTotale; debut += 64) {
    for (let i = 0; i < 16; i++) w[i] = vue.getUint32(debut + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K_SHA256[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(x => x.toString(16).padStart(8, '0')).join('');
}

// ── Empreinte déterministe (PURE) ───────────────────────────────────────────
// Entrées = les données déjà revues à l'écran au moment de confirmer :
//   magasinId (fiche stores retenue) sinon nom du magasin normalisé ;
//   dateTicket (jour, YYYY-MM-DD, '' si absente — jamais « aujourd'hui » qui
//   changerait à chaque rescan) ; total recalculé depuis les lignes (même
//   règle d'arrondi que l'import) ; nombre de lignes ; libellés BRUTS du
//   ticket (libelle_ticket, repli sur le nom revu) normalisés via
//   normaliserLibelleLocal puis TRIÉS — l'ordre d'arrivée ne compte pas.
// Mêmes entrées => même empreinte, toujours.
export function calculerEmpreinteTicket({ magasinId = null, magasinNom = null, dateTicket = null, lignes = [] } = {}, { normaliser = normaliserLibelleLocal } = {}) {
  const liste = lignes || [];
  const libelles = liste.map(l => normaliser(l?.libelle ?? '') ?? '').sort();
  const total = liste.reduce((s, l) => s + (Number(l?.prix) || 0) * (Number(l?.quantite) || 1), 0);
  const totalStr = (Math.round(total * 100) / 100).toFixed(2);
  const magasin = magasinId ? `id:${magasinId}` : `nom:${normaliser(magasinNom ?? '') ?? ''}`;
  const jour = dateTicket ? String(dateTicket).slice(0, 10) : '';
  const canonique = ['v1', `m:${magasin}`, `d:${jour}`, `t:${totalStr}`, `n:${liste.length}`, ...libelles].join('\n');
  return sha256Hex(canonique);
}

// ── Vérification avant import (best effort, jamais bloquante à tort) ────────
// { existe: true, ticket } si un ticket du compte porte déjà cette empreinte,
// { existe: false } sinon, null si la vérification est IMPOSSIBLE (réseau…) —
// dans ce cas l'appelant laisse passer l'import : l'index unique reste le
// filet, on ne bloque jamais abusivement et on ne crashe jamais.
export async function chercherTicketParEmpreinte(empreinte, utilisateurId = null) {
  try {
    let uid = utilisateurId;
    if (!uid) {
      const { data } = await supabase.auth.getSession();
      uid = data?.session?.user?.id ?? null;
    }
    if (!uid || !empreinte) return { existe: false };
    const { data, error } = await supabase.from('tickets')
      .select('id, date_ticket, cree_le')
      .eq('utilisateur_id', uid)
      .eq('empreinte', empreinte)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? { existe: true, ticket: data } : { existe: false };
  } catch (e) {
    console.error("Vérification d'empreinte de ticket impossible (import laissé passer) :", e);
    return null;
  }
}

// ── Pose de l'empreinte APRÈS import (best effort) ──────────────────────────
// Attend l'écriture Core ; ne pose que si un ticket a bien été créé (même
// contrat que le rattachement du chantier 90 : statut 'rejet' = aucun ticket,
// on ne toucherait alors qu'un ANCIEN ticket). Le « dernier ticket » est le
// mécanisme #56.5.B ; garde supplémentaire : on n'écrase JAMAIS une empreinte
// déjà posée. Une violation d'unicité (23505 — deux scans quasi simultanés du
// même ticket) est traitée comme doublon : onDoublonTardif est prévenu, rien
// ne plante. Renvoie 'pose' | 'conflit' | 'ignore' | 'erreur'.
export async function poserEmpreinteApresImport(ecritureCorePromise, empreinte, { utilisateurId = null, onDoublonTardif = null } = {}) {
  try {
    const resultat = await ecritureCorePromise;
    if (!doitRattacherTicketSession(resultat)) return 'ignore';
    let uid = utilisateurId;
    if (!uid) {
      const { data } = await supabase.auth.getSession();
      uid = data?.session?.user?.id ?? null;
    }
    if (!uid || !empreinte) return 'ignore';
    const { data: dernier, error: e1 } = await supabase.from('tickets')
      .select('id, empreinte')
      .eq('utilisateur_id', uid)
      .order('cree_le', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (e1) throw e1;
    if (!dernier?.id || dernier.empreinte != null) return 'ignore';
    const { error } = await supabase.from('tickets')
      .update({ empreinte })
      .eq('id', dernier.id)
      .is('empreinte', null);
    if (error) {
      if (error.code === '23505') {
        try { onDoublonTardif?.(); } catch { /* jamais bloquant */ }
        return 'conflit';
      }
      throw error;
    }
    return 'pose';
  } catch (e) {
    console.error("Pose d'empreinte de ticket (best effort) :", e);
    return 'erreur';
  }
}
