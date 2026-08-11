import { describe, it, expect } from "vitest";
import { formatDepuisMime, normaliserResultatTranscription } from "./microVocal";

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
