import { describe, it, expect } from 'vitest';
import {
  creerParcoursContribution,
  libelleEnvoyerQuandMeme,
  SORTIE_AVERTIR,
  SORTIE_ENVOI,
  SORTIE_REFUS_FICHE,
  SORTIE_RIEN,
} from './parcoursContributionCodesBarres';
import { OFF_TROUVE, OFF_INCONNU, OFF_INDISPONIBLE } from './coherenceCodeBarres';

// Fiche « Cônes glacés » et code de boulgour : l'incident du 17/08, celui qui a
// motivé le garde-fou du 105. C'est le cas qui doit déclencher l'avertissement.
const FICHE_CONES = {
  nomProduit: 'Cônes glacés',
  marque: 'Trium',
  libelleVariante: null,
  quantite_nette: 432,
  unite_quantite: 'g',
  nombre_unites: null,
};
const FICHE_BOULGOUR = {
  nomProduit: 'Boulgour',
  marque: 'Priméal',
  libelleVariante: null,
  quantite_nette: 500,
  unite_quantite: 'g',
  nombre_unites: null,
};
const OFF_BOULGOUR = {
  nom: 'Boulgour Petit Épeautre',
  marque: 'Priméal',
  quantite: '500 g',
  imageLarge: 'https://off/l.jpg',
};

// Espion : chaque appel = une proposition réellement créée en base. Compter ce
// tableau est la seule façon honnête de vérifier « aucune proposition ».
function creerEspion(retour = { ok: true }) {
  const envois = [];
  const parcours = creerParcoursContribution({
    envoyerProposition: async (p) => { envois.push(p); return retour; },
  });
  return { parcours, envois };
}

const choixDivergent = { code: '3380380055393', off: OFF_BOULGOUR, statutOff: OFF_TROUVE, varianteId: 'v-cones', nomProduit: 'Cônes glacés', fiche: FICHE_CONES };
const choixCoherent = { code: '3380380055393', off: OFF_BOULGOUR, statutOff: OFF_TROUVE, varianteId: 'v-boulgour', nomProduit: 'Boulgour', fiche: FICHE_BOULGOUR };

describe('choix de la fiche', () => {
  it('fiche cohérente : la proposition part sans écran intermédiaire', async () => {
    const { parcours, envois } = creerEspion();
    const res = await parcours.choisirFiche(choixCoherent);
    expect(res.sortie).toBe(SORTIE_ENVOI);
    expect(envois).toHaveLength(1);
    expect(envois[0]).toMatchObject({ code: '3380380055393', varianteId: 'v-boulgour' });
    expect(envois[0].verdict).toBeUndefined(); // rien à signaler
  });

  it('fiche divergente : on avertit, et RIEN n\'est envoyé à ce stade', async () => {
    const { parcours, envois } = creerEspion();
    const res = await parcours.choisirFiche(choixDivergent);
    expect(res.sortie).toBe(SORTIE_AVERTIR);
    expect(res.avertissement.verdict.signaux).toContain('aucun_mot_commun');
    expect(envois).toHaveLength(0);
    expect(parcours.avertissementEnCours()).not.toBeNull();
  });

  it('fiche sans format : refus local, aucune proposition invalidable envoyée', async () => {
    const { parcours, envois } = creerEspion();
    const res = await parcours.choisirFiche({ ...choixCoherent, varianteId: null });
    expect(res.sortie).toBe(SORTIE_REFUS_FICHE);
    expect(res.message).toMatch(/aucun format/);
    expect(envois).toHaveLength(0);
  });

  it('OFF muet ou injoignable : aucun faux avertissement, la proposition part', async () => {
    for (const statut of [OFF_INCONNU, OFF_INDISPONIBLE]) {
      const { parcours, envois } = creerEspion();
      const res = await parcours.choisirFiche({ ...choixDivergent, off: null, statutOff: statut });
      expect(res.sortie).toBe(SORTIE_ENVOI);
      expect(envois).toHaveLength(1);
    }
  });
});

// ── LE point du chantier : « Je vérifie l'emballage » n'écrit rien, pour
// personne. Le parcours ne connaît même pas le rôle de l'utilisateur — c'est
// exactement ce qui garantit que les deux cas se comportent pareil.
describe('« Je vérifie l\'emballage » — aucune proposition créée', () => {
  it('un NON-administrateur qui renonce ne crée AUCUNE proposition', async () => {
    const { parcours, envois } = creerEspion();

    const avertissement = await parcours.choisirFiche(choixDivergent);
    expect(avertissement.sortie).toBe(SORTIE_AVERTIR);
    expect(envois).toHaveLength(0);

    const res = parcours.renoncer();
    expect(res.sortie).toBe(SORTIE_RIEN);
    expect(res.avaitUnAvertissement).toBe(true);

    // LA vérification : rien n'est parti, ni avant ni après le renoncement.
    expect(envois).toHaveLength(0);
    expect(parcours.avertissementEnCours()).toBeNull();
  });

  it('renoncer désarme l\'écriture : un « envoyer quand même » tardif ne rejoue rien', async () => {
    const { parcours, envois } = creerEspion();
    await parcours.choisirFiche(choixDivergent);
    parcours.renoncer();

    const res = await parcours.envoyerQuandMeme();
    expect(res.sortie).toBe(SORTIE_RIEN);
    expect(envois).toHaveLength(0);
  });

  it('un administrateur qui renonce ne crée AUCUNE proposition non plus', async () => {
    const { parcours, envois } = creerEspion();
    await parcours.choisirFiche(choixDivergent);
    parcours.renoncer();
    expect(envois).toHaveLength(0);
  });
});

describe('« Envoyer quand même »', () => {
  it('envoie la proposition mise en pause, une seule fois, avec le verdict', async () => {
    const { parcours, envois } = creerEspion();
    await parcours.choisirFiche(choixDivergent);

    const res = await parcours.envoyerQuandMeme();
    expect(res.sortie).toBe(SORTIE_ENVOI);
    expect(envois).toHaveLength(1);
    expect(envois[0].varianteId).toBe('v-cones');
    // Le désaccord voyage avec l'envoi : l'écran de retour doit pouvoir le
    // rappeler au lieu de le faire disparaître.
    expect(envois[0].verdict.signaux).toContain('aucun_mot_commun');

    // Deuxième clic (double tap) : rien n'est renvoyé.
    const encore = await parcours.envoyerQuandMeme();
    expect(encore.sortie).toBe(SORTIE_RIEN);
    expect(envois).toHaveLength(1);
  });

  it('un échec d\'envoi remonte tel quel, sans prétendre au succès', async () => {
    const { parcours, envois } = creerEspion({ ok: false, message: 'boom' });
    await parcours.choisirFiche(choixDivergent);
    const res = await parcours.envoyerQuandMeme();
    expect(res.retour).toEqual({ ok: false, message: 'boom' });
    expect(envois).toHaveLength(1);
  });

  it('le lien discret existe pour les deux rôles, seuls les mots changent', () => {
    expect(libelleEnvoyerQuandMeme(false)).toBe('Envoyer quand même, François tranchera');
    expect(libelleEnvoyerQuandMeme(true)).toBe("C'est bien ça, proposer quand même");
  });
});
