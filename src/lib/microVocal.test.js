import { describe, it, expect } from "vitest";
import { formatDepuisMime, normaliserResultatTranscription, normaliserNomElement, comptesParNom, fusionnerParNom } from "./microVocal";

describe("formatDepuisMime", () => {
  it("mappe l'audio Safari iOS (mp4/AAC) vers m4a", () => {
    expect(formatDepuisMime("audio/mp4")).toBe("m4a");
    expect(formatDepuisMime("audio/mp4;codecs=mp4a.40.2")).toBe("m4a");
    expect(formatDepuisMime("audio/aac")).toBe("m4a");
  });
  it("mappe l'audio Chrome/Android vers webm", () => {
    expect(formatDepuisMime("audio/webm")).toBe("webm");
    expect(formatDepuisMime("audio/webm;codecs=opus")).toBe("webm");
  });
  it("reconnaît ogg, wav et mp3", () => {
    expect(formatDepuisMime("audio/ogg")).toBe("ogg");
    expect(formatDepuisMime("audio/wav")).toBe("wav");
    expect(formatDepuisMime("audio/mpeg")).toBe("mp3");
  });
  it("retombe sur m4a (cas iOS) si mime vide ou inconnu", () => {
    expect(formatDepuisMime("")).toBe("m4a");
    expect(formatDepuisMime(undefined)).toBe("m4a");
    expect(formatDepuisMime("audio/x-bidule")).toBe("m4a");
  });
});

describe("normaliserResultatTranscription", () => {
  it("normalise un résultat complet", () => {
    const r = normaliserResultatTranscription({
      transcription: " il me faut du beurre et six yaourts nature ",
      elements: [
        { texte_entendu: "du beurre", nom: "beurre", quantite: null, unite: null, qualificatifs: null, confiance: "haute" },
        { texte_entendu: "six yaourts nature", nom: "yaourts nature", quantite: 6, unite: null, qualificatifs: null, confiance: "haute" },
      ],
      elements_ignores: [{ texte_entendu: "pas besoin de sucre", raison: "négation" }],
    });
    expect(r.transcription).toBe("il me faut du beurre et six yaourts nature");
    expect(r.elements).toHaveLength(2);
    expect(r.elements[1]).toEqual({
      texte_entendu: "six yaourts nature", nom: "yaourts nature",
      quantite: 6, unite: null, qualificatifs: null, confiance: "haute",
    });
    expect(r.elements_ignores).toEqual([{ texte_entendu: "pas besoin de sucre", raison: "négation" }]);
  });

  it("écarte les éléments sans nom exploitable", () => {
    const r = normaliserResultatTranscription({
      elements: [{ nom: "  " }, { texte_entendu: "brouhaha" }, { nom: "lait" }],
    });
    expect(r.elements.map(e => e.nom)).toEqual(["lait"]);
  });

  it("neutralise une quantité non numérique ou négative", () => {
    const r = normaliserResultatTranscription({
      elements: [
        { nom: "eau", quantite: "deux" },
        { nom: "riz", quantite: -3 },
        { nom: "lait", quantite: "2" },
      ],
    });
    expect(r.elements[0].quantite).toBeNull();
    expect(r.elements[1].quantite).toBeNull();
    expect(r.elements[2].quantite).toBe(2);
  });

  it("force une confiance inconnue à faible (prudence, jamais l'inverse)", () => {
    const r = normaliserResultatTranscription({
      elements: [{ nom: "beurre", confiance: "moyenne" }, { nom: "lait" }],
    });
    expect(r.elements.every(e => e.confiance === "faible")).toBe(true);
  });

  it("ne plante jamais sur une réponse difforme", () => {
    expect(normaliserResultatTranscription(null)).toEqual({ transcription: "", elements: [], elements_ignores: [] });
    expect(normaliserResultatTranscription({ elements: "oui", elements_ignores: 42 }))
      .toEqual({ transcription: "", elements: [], elements_ignores: [] });
  });
});

describe("normaliserNomElement", () => {
  it("ignore casse, accents et espaces multiples", () => {
    expect(normaliserNomElement("  Yaourts  Natures ")).toBe("yaourts natures");
    expect(normaliserNomElement("Pâtes Complètes")).toBe("pates completes");
  });
});

describe("comptesParNom", () => {
  it("compte les occurrences par nom normalisé", () => {
    const m = comptesParNom([
      { nom: "Lait" }, { nom: "lait " }, { nom: "beurre" }, { nom: "" },
    ]);
    expect(m.get("lait")).toBe(2);
    expect(m.get("beurre")).toBe(1);
    expect(m.has("")).toBe(false);
  });
});

describe("fusionnerParNom", () => {
  const base = [
    { id: 1, nom: "lait", quantite: 2, unite: "bouteilles", qualificatifs: null, confiance: "haute", texte_entendu: "deux bouteilles de lait" },
    { id: 2, nom: "beurre", quantite: null, unite: null, qualificatifs: null, confiance: "haute", texte_entendu: "du beurre" },
    { id: 3, nom: "Lait", quantite: null, unite: null, qualificatifs: "demi-écrémé", confiance: "faible", texte_entendu: "du lait" },
  ];

  it("fusionne à la place de la première occurrence, en gardant les autres lignes", () => {
    const r = fusionnerParNom(base, "lait");
    expect(r).toHaveLength(2);
    expect(r[0].id).toBe(1);
    expect(r[1].id).toBe(2);
  });

  it("additionne les quantités (null vaut 1 dès qu'une quantité existe)", () => {
    const r = fusionnerParNom(base, "lait");
    expect(r[0].quantite).toBe(3);
    expect(r[0].unite).toBe("bouteilles");
  });

  it("garde null si aucune ligne n'était quantifiée", () => {
    const r = fusionnerParNom([
      { id: 1, nom: "beurre", quantite: null, confiance: "haute" },
      { id: 2, nom: "beurre", quantite: null, confiance: "haute" },
    ], "beurre");
    expect(r).toHaveLength(1);
    expect(r[0].quantite).toBeNull();
  });

  it("propage la prudence : une seule confiance faible suffit", () => {
    const r = fusionnerParNom(base, "lait");
    expect(r[0].confiance).toBe("faible");
    expect(r[0].qualificatifs).toBe("demi-écrémé");
    expect(r[0].texte_entendu).toBe("deux bouteilles de lait + du lait");
  });

  it("ne touche à rien s'il n'y a pas de doublon", () => {
    const r = fusionnerParNom(base, "beurre");
    expect(r).toEqual(base);
  });
});
