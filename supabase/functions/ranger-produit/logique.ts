// Edge Function ranger-produit — chantier 151, lot 2.
//
// Quand un utilisateur scanne le code-barres d'un produit INCONNU, cette
// fonction propose comment le ranger dans le catalogue, comme le ferait un
// chef de rayon qui connaît le modèle PrixMalin :
//   1. le RAYON (parmi nos rayons, jamais inventé) ;
//   2. le NOM GÉNÉRIQUE de la fiche (« Tajine de bœuf aux légumes », pas « La
//      Tajine de Boeuf et ses Légumes du Soleil ») : sans marque ni quantité ;
//   3. la FICHE EXISTANTE à rejoindre, s'il y en a une (« 8.6 Extreme » rejoint
//      la fiche « Bière ») : une fiche = un produit comparable, la marque et le
//      format descendent en variantes, on ne sépare que sur le sous-type ;
//   4. la MARQUE la plus juste, si elle se lit dans les informations reçues.
//
// Ce fichier n'a AUCUNE dépendance (ni Deno, ni réseau) : il est importé par
// index.ts (en ligne) et par les tests (Node). Rien n'est écrit en base ici :
// la fonction PROPOSE, l'app affiche, la base vérifie tout ce qu'elle reçoit.
// Jamais bloquant : la moindre erreur rend une proposition vide.

export const MODELE = "anthropic/claude-haiku-4.5";
export const FOURNISSEUR = { order: ["anthropic"], allow_fallbacks: false };
export const VERSION = "ranger-produit-1";
export const MAX_FICHES = 250;

export type Rayon = { id: string; nom: string; categorie: string };
export type Fiche = { id: string; nom: string };
export type Produit = {
  nom: string; nomGenerique: string; marques: string; quantite: string; categories: string[]; libelleTicket: string;
};
export type Proposition = {
  rayon: { id: string; nom: string } | null;
  nom_generique: string | null;
  produit: { id: string; nom: string } | null;
  marque: string | null;
  certain: boolean;
};
export const PROPOSITION_VIDE: Proposition = { rayon: null, nom_generique: null, produit: null, marque: null, certain: false };

const texte = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

// Ce qu'on garde de la demande : uniquement des textes courts sur le PRODUIT.
// Rien sur l'utilisateur ne part au modèle.
export function lireProduit(corps: unknown): Produit {
  // deno-lint-ignore no-explicit-any
  const c: any = corps && typeof corps === "object" ? corps : {};
  const off = c.off && typeof c.off === "object" ? c.off : {};
  const tags = Array.isArray(off.categories_tags) ? off.categories_tags : [];
  return {
    nom: texte(off.product_name_fr) || texte(off.product_name),
    nomGenerique: texte(off.generic_name_fr),
    marques: texte(off.brands, 120),
    quantite: texte(off.quantity, 40),
    categories: tags.filter((t: unknown) => typeof t === "string").slice(-8).map((t: string) => t.slice(0, 60)),
    libelleTicket: texte(c.libelle_ticket, 60),
  };
}

// Y a-t-il de quoi ranger ? Sans nom ni texte de caisse, on ne demande rien.
export function produitExploitable(p: Produit): boolean {
  return !!(p.nom || p.nomGenerique || p.libelleTicket);
}

function ficheProduit(p: Produit): string {
  return [
    p.nom ? `- Nom sur l'emballage : ${p.nom}` : "",
    p.nomGenerique ? `- Dénomination légale : ${p.nomGenerique}` : "",
    p.marques ? `- Marque(s) : ${p.marques}` : "",
    p.quantite ? `- Contenance : ${p.quantite}` : "",
    p.categories.length ? `- Catégories : ${p.categories.join(", ")}` : "",
    p.libelleTicket ? `- Texte du ticket de caisse : ${p.libelleTicket}` : "",
  ].filter(Boolean).join("\n");
}

// ── Question 1 : le rayon, le nom générique, la marque ─────────────────────
export function consigneRangement(p: Produit, rayons: Rayon[]): string {
  const liste = rayons.map((r, i) => `${i + 1}. ${r.nom} (${r.categorie})`).join("\n");
  return `Tu ranges un produit dans le catalogue d'un comparateur de prix de supermarché français.

PRODUIT :
${ficheProduit(p)}

RAYONS POSSIBLES :
${liste}

Réponds UNIQUEMENT en JSON : {"rayon": <numéro du rayon ou null>, "nom_generique": "<nom ou vide>", "marque": "<marque ou vide>", "certain": true|false}

RÈGLES :
- "rayon" : le numéro du rayon où un client chercherait ce produit. Si aucun rayon ne convient vraiment, ou si les informations ne permettent pas de savoir ce qu'est le produit : null. Ne force jamais un rayon approximatif.
- "nom_generique" : le nom du TYPE de produit, comme sur l'étiquette d'un rayon. En français, 1 à 5 mots, première lettre en majuscule, sans point final.
  - JAMAIS de marque, de gamme ni de slogan ("La Laitière", "Fleury Michon", "8.6", "Le Petit Pot de", "et ses Légumes du Soleil").
  - JAMAIS de quantité ni de conditionnement ("350 g", "x36", "4 pots", "1,5 L").
  - Garde le SOUS-TYPE qui change vraiment le produit : parfum (vanille, chocolat), recette (bœuf, canard), type (nature, aromatisé, zéro, bio seulement si c'est le cœur du produit), forme (dosettes, capsules, moulu, en grains).
  - Exemples : "La Tajine de Boeuf et ses Légumes du Soleil" -> "Tajine de bœuf aux légumes" ; "Le Petit Pot de Crème Saveur Vanille" -> "Crème dessert vanille" ; "8.6 Extreme" (bière) -> "Bière" ; "Café n 5 doux subtile et délicat" avec le ticket "X36 DOSETTE DOUX" -> "Café en dosettes" ; "Chips Lay's saveur barbecue 120g" -> "Chips aromatisées" ; "Pepsi Zéro Sucres" -> "Cola zéro".
  - Si tu ne sais pas ce qu'est le produit : chaîne vide.
- "marque" : la marque COMMERCIALE imprimée en gros sur l'emballage, telle qu'un client la nomme (ex. marques "Nestlé, La Laitière" -> "La Laitière" ; nom "8.6 Extreme" avec marque "Bavaria" -> "8.6"). Seulement si elle figure dans les informations ci-dessus. Sinon chaîne vide. N'invente jamais une marque.
- "certain" : true seulement si le rayon ET le nom te paraissent sûrs.`;
}

// ── Question 2 : rejoindre une fiche existante du rayon ? ──────────────────
export function consigneFiche(p: Produit, nomGenerique: string, fiches: Fiche[]): string {
  const liste = fiches.map((f, i) => `${i + 1}. ${f.nom}`).join("\n");
  return `Dans le catalogue d'un comparateur de prix, une FICHE regroupe tous les produits comparables entre eux : la marque et le format sont des variantes de la fiche, pas des fiches séparées.

PRODUIT À RANGER :
${ficheProduit(p)}
- Type de produit : ${nomGenerique}

FICHES DÉJÀ PRÉSENTES DANS CE RAYON :
${liste}

Réponds UNIQUEMENT en JSON : {"fiche": <numéro de la fiche à rejoindre, ou null>}

RÈGLES :
- Choisis une fiche seulement si elle désigne EXACTEMENT le même type de produit, que l'on comparerait au kilo ou au litre : même produit, même sous-type (parfum, recette, nature/aromatisé, classique/zéro, dosettes/capsules/moulu).
- La marque et la contenance ne comptent PAS : une bière "8.6 Extreme" rejoint la fiche "Bière".
- Un sous-type différent = une autre fiche : une crème dessert à la vanille ne rejoint PAS "Crème dessert chocolat" ; un cola zéro ne rejoint PAS "Cola".
- Une fiche qui porte une marque ou un nom commercial dans son nom ne convient que si c'est précisément ce produit.
- Dans le doute : null. Créer une fiche en trop se corrige ; ranger un produit dans la mauvaise fiche fausse les comparaisons.`;
}

export function corpsModele(consigne: string, maxTokens = 200) {
  return { model: MODELE, provider: FOURNISSEUR, temperature: 0, max_tokens: maxTokens, messages: [{ role: "user", content: consigne }] };
}

// JSON du modèle -> objet, ou null. Jamais d'exception.
export function lireJson(contenu: unknown): Record<string, unknown> | null {
  try {
    const t = String(contenu || "");
    const d = t.indexOf("{"), f = t.lastIndexOf("}");
    if (d === -1 || f <= d) return null;
    const o = JSON.parse(t.slice(d, f + 1));
    return o && typeof o === "object" ? o : null;
  } catch (_e) {
    return null;
  }
}

const numero = (v: unknown, taille: number): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= taille ? n : null;
};

// Nom générique reçu du modèle -> nom acceptable, ou null. On refuse plutôt
// que d'écrire n'importe quoi : trop long, avec une quantité, ou vide.
export function nettoyerNomGenerique(v: unknown): string | null {
  let n = texte(v, 80).replace(/[.;:,]+$/, "").trim();
  if (!n || n.length < 3 || n.length > 60) return null;
  if (n.split(" ").length > 7) return null;
  if (/\d+\s*(kg|g|ml|cl|l|pi[eè]ces?|x)\b/i.test(n) || /\bx\s*\d+/i.test(n)) return null;
  n = n.charAt(0).toUpperCase() + n.slice(1);
  return n;
}

// La marque proposée n'est gardée que si elle se LIT dans ce qu'on a reçu
// (marques, nom, texte de caisse) : le modèle ne peut pas en inventer une.
export function nettoyerMarque(v: unknown, p: Produit): string | null {
  const m = texte(v, 60);
  if (!m || m.length < 2) return null;
  const sans = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const source = sans(`${p.marques} | ${p.nom} | ${p.libelleTicket}`);
  return source.includes(sans(m)) ? m : null;
}

export function interpreterRangement(json: Record<string, unknown> | null, p: Produit, rayons: Rayon[]): Proposition {
  if (!json) return { ...PROPOSITION_VIDE };
  const n = numero(json.rayon, rayons.length);
  const rayon = n ? { id: rayons[n - 1].id, nom: rayons[n - 1].nom } : null;
  return {
    rayon,
    nom_generique: nettoyerNomGenerique(json.nom_generique),
    produit: null,
    marque: nettoyerMarque(json.marque, p),
    certain: json.certain === true && !!rayon,
  };
}

export function interpreterFiche(json: Record<string, unknown> | null, fiches: Fiche[]): { id: string; nom: string } | null {
  if (!json) return null;
  const n = numero(json.fiche, fiches.length);
  return n ? { id: fiches[n - 1].id, nom: fiches[n - 1].nom } : null;
}

type Journal = { log: (...a: unknown[]) => void; error: (...a: unknown[]) => void };

// ── Le rangement complet ───────────────────────────────────────────────────
// acces.chargerRayons() -> Rayon[] ; acces.chargerFiches(rayonId) -> Fiche[].
// Tout échec (clé absente, modèle indisponible, réponse illisible, base en
// panne) rend une proposition vide ou partielle : jamais d'exception.
export async function rangerProduit({
  corps, apiKey, fetchFn, acces, journal = console,
}: {
  corps: unknown;
  apiKey: string | undefined;
  fetchFn: typeof fetch;
  acces: { chargerRayons: () => Promise<Rayon[]>; chargerFiches: (rayonId: string) => Promise<Fiche[]> };
  journal?: Journal;
}): Promise<Proposition> {
  const debut = Date.now();
  const p = lireProduit(corps);
  if (!produitExploitable(p) || !apiKey) return { ...PROPOSITION_VIDE };

  const demander = async (consigne: string, maxTokens: number) => {
    const r = await fetchFn("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(corpsModele(consigne, maxTokens)),
    });
    // deno-lint-ignore no-explicit-any
    const data: any = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || `Erreur HTTP ${r.status}`);
    return lireJson(data?.choices?.[0]?.message?.content);
  };

  let proposition: Proposition = { ...PROPOSITION_VIDE };
  let nbFiches = 0;
  try {
    const rayons = (await acces.chargerRayons()) || [];
    if (rayons.length === 0) return proposition;
    proposition = interpreterRangement(await demander(consigneRangement(p, rayons), 200), p, rayons);
    if (proposition.rayon && proposition.nom_generique) {
      const fiches = ((await acces.chargerFiches(proposition.rayon.id)) || []).slice(0, MAX_FICHES);
      nbFiches = fiches.length;
      // Une fiche du rayon porte déjà exactement ce nom : inutile de demander.
      const sans = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
      const meme = fiches.find((f) => sans(f.nom) === sans(proposition.nom_generique as string));
      if (meme) proposition.produit = { id: meme.id, nom: meme.nom };
      else if (fiches.length > 0) {
        try {
          proposition.produit = interpreterFiche(await demander(consigneFiche(p, proposition.nom_generique, fiches), 60), fiches);
        } catch (e) {
          journal.error("[ranger-produit] question fiche en échec", (e as Error)?.message);
        }
      }
    }
  } catch (e) {
    journal.error("[ranger-produit] echec", (e as Error)?.message);
    return proposition;
  }
  journal.log("[ranger-produit] ok", JSON.stringify({
    version: VERSION, rayon: proposition.rayon?.nom ?? null, nom_generique: proposition.nom_generique,
    fiche: proposition.produit?.nom ?? null, marque: proposition.marque, certain: proposition.certain,
    fiches_du_rayon: nbFiches, duree_ms: Date.now() - debut,
  }));
  return proposition;
}
