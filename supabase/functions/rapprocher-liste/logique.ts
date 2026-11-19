// Chantier 157 — rapprocher une liste dictée des fiches du catalogue.
//
// Constat de François (19/11) : le micro comprend très bien ce qu'on dit, mais
// le rapprochement avec les produits de la base est faible. Il comparait des
// lettres : « sopalin » n'a rien en commun avec « Essuie-tout », « coca » rien
// avec « Cola ». Ici, un modèle qui comprend le sens choisit, pour chaque
// produit dit, la ou les fiches du catalogue qui lui correspondent.
//
// Garde-fous :
// - le modèle ne rend que des NUMÉROS de fiches pris dans la liste fournie ;
//   tout autre numéro est ignoré (il ne peut ni inventer ni créer une fiche) ;
// - cette fonction ne lit que le catalogue et n'écrit rien ;
// - c'est l'application qui décide quoi faire d'une proposition, et
//   l'utilisateur qui la confirme ;
// - toute panne rend une réponse vide : l'app garde alors ses propositions
//   habituelles.

export const MODELE = "anthropic/claude-haiku-4.5";
export const FOURNISSEUR = { order: ["anthropic"], allow_fallbacks: false };
export const VERSION = "rapprocher-liste-1";
export const MAX_ELEMENTS = 40;
export const MAX_PROPOSITIONS = 3;
export const MAX_FICHES = 2000;

export type Fiche = { id: string; nom: string; rayon?: string | null };
export type Element = { id: string; nom: string };
export type Resultat = { id: string; propositions: { produit_id: string; produit_nom: string }[]; sur: boolean };
type Journal = { log: (...a: unknown[]) => void; error: (...a: unknown[]) => void };

const propre = (v: unknown, max: number): string =>
  String(v ?? "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

// Corps de la requête -> éléments exploitables. Jamais d'exception.
export function lireElements(corps: unknown): Element[] {
  // deno-lint-ignore no-explicit-any
  const brut = (corps as any)?.elements;
  if (!Array.isArray(brut)) return [];
  const vus = new Set<string>();
  const elements: Element[] = [];
  for (const e of brut) {
    const id = propre(e?.id, 80);
    const nom = propre(e?.nom, 80);
    if (!id || nom.length < 2 || vus.has(id)) continue;
    vus.add(id);
    elements.push({ id, nom });
    if (elements.length >= MAX_ELEMENTS) break;
  }
  return elements;
}

// La consigne est en deux morceaux. Le premier (règles + catalogue) est le même
// d'un appel à l'autre : il est marqué pour être gardé en mémoire quelques
// minutes par le fournisseur, ce qui divise le coût des appels rapprochés
// (plusieurs prises de suite). Le second ne contient que les produits dits.
export function consigneCatalogue(fiches: Fiche[]): string {
  const catalogue = fiches.map((f, i) => `${i + 1}. ${f.nom}${f.rayon ? ` (${f.rayon})` : ""}`).join("\n");
  return `Tu aides une application française de comparaison de prix de courses.
Une personne a dicté sa liste de courses. Pour chaque produit dit, trouve dans le CATALOGUE la ou les fiches qui désignent ce produit.

Règles :
- Raisonne sur le SENS, pas sur les lettres. Une marque employée comme nom commun désigne le produit générique : « sopalin » = essuie-tout, « coca » = cola, « PQ » = papier toilette, « kleenex » = mouchoirs.
- Ne propose une fiche que si c'est bien le produit demandé ou une de ses variétés courantes. « pâtes » n'est pas « pâté » ; « lait » n'est pas « chocolat au lait ».
- Produit précis avec une seule fiche évidente : cette seule fiche, et "sur": true.
- Produit vague (« yaourts », « fromage », « bière ») avec plusieurs variétés possibles : jusqu'à ${MAX_PROPOSITIONS} fiches, la plus générale ou la plus courante d'abord, et "sur": false.
- Une fiche dont le nom porte une marque ou un nom commercial ne convient que si la personne a dit cette marque.
- Rien ne convient : liste vide. Ne force jamais un rapprochement.
- N'utilise que des numéros du CATALOGUE.

CATALOGUE (numéro. nom de la fiche (rayon)) :
${catalogue}`;
}

export function consigneProduits(elements: Element[]): string {
  const dits = elements.map((e, i) => `${i + 1}. ${e.nom}`).join("\n");
  return `PRODUITS DITS :
${dits}

Réponds en JSON UNIQUEMENT, une entrée par produit dit, dans l'ordre :
{"r":[{"e":1,"f":[12],"sur":true},{"e":2,"f":[40,41],"sur":false},{"e":3,"f":[],"sur":false}]}`;
}

export function corpsModele(elements: Element[], fiches: Fiche[], maxTokens: number) {
  return {
    model: MODELE, provider: FOURNISSEUR, temperature: 0, max_tokens: maxTokens,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: consigneCatalogue(fiches), cache_control: { type: "ephemeral" } },
        { type: "text", text: consigneProduits(elements) },
      ],
    }],
  };
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

// Réponse du modèle -> résultats sûrs : uniquement des fiches de la liste
// fournie, sans doublon, 3 au plus ; « sûr » seulement s'il n'y en a qu'une.
export function interpreter(json: Record<string, unknown> | null, elements: Element[], fiches: Fiche[]): Resultat[] {
  // deno-lint-ignore no-explicit-any
  const lignes = Array.isArray((json as any)?.r) ? (json as any).r : [];
  const parElement = new Map<number, Resultat>();
  for (const l of lignes) {
    const e = numero(l?.e, elements.length);
    if (e === null || parElement.has(e)) continue;
    const propositions: Resultat["propositions"] = [];
    for (const v of Array.isArray(l?.f) ? l.f : []) {
      const n = numero(v, fiches.length);
      if (n === null) continue;
      const fiche = fiches[n - 1];
      if (propositions.some((p) => p.produit_id === fiche.id)) continue;
      propositions.push({ produit_id: fiche.id, produit_nom: fiche.nom });
      if (propositions.length >= MAX_PROPOSITIONS) break;
    }
    parElement.set(e, { id: elements[e - 1].id, propositions, sur: l?.sur === true && propositions.length === 1 });
  }
  return elements.map((el, i) => parElement.get(i + 1) ?? { id: el.id, propositions: [], sur: false });
}

// Tout échec (clé absente, modèle indisponible, réponse illisible, base en
// panne) rend une liste vide : jamais d'exception.
export async function rapprocherListe({
  corps, apiKey, fetchFn, acces, journal = console,
}: {
  corps: unknown;
  apiKey: string | undefined;
  fetchFn: typeof fetch;
  acces: { chargerFiches: () => Promise<Fiche[]> };
  journal?: Journal;
}): Promise<{ resultats: Resultat[] }> {
  const debut = Date.now();
  const elements = lireElements(corps);
  if (elements.length === 0 || !apiKey) return { resultats: [] };
  try {
    const fiches = ((await acces.chargerFiches()) || []).filter((f) => f?.id && f?.nom).slice(0, MAX_FICHES);
    if (fiches.length === 0) return { resultats: [] };
    const r = await fetchFn("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(corpsModele(elements, fiches, 200 + 40 * elements.length)),
    });
    // deno-lint-ignore no-explicit-any
    const data: any = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || `Erreur HTTP ${r.status}`);
    const resultats = interpreter(lireJson(data?.choices?.[0]?.message?.content), elements, fiches);
    // Journal : des comptes seulement, jamais ce qui a été dit.
    journal.log("[rapprocher-liste] ok", JSON.stringify({
      version: VERSION, elements: elements.length, fiches: fiches.length,
      avec_proposition: resultats.filter((x) => x.propositions.length > 0).length,
      surs: resultats.filter((x) => x.sur).length,
      jetons_entree: data?.usage?.prompt_tokens ?? null, jetons_sortie: data?.usage?.completion_tokens ?? null,
      jetons_en_memoire: data?.usage?.prompt_tokens_details?.cached_tokens ?? null,
      duree_ms: Date.now() - debut,
    }));
    return { resultats };
  } catch (e) {
    journal.error("[rapprocher-liste] echec", (e as Error)?.message);
    return { resultats: [] };
  }
}
