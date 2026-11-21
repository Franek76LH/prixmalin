import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Chantier 166 — constat Auchan Aix (21/11) : « Continuer quand même » fermait
// la feuille du ticket (le clic remontait jusqu'au fond). Seul un appui sur le
// fond lui-même doit fermer la feuille.
describe('feuille « Importer un ticket » — fermeture par le fond', () => {
  const src = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  const debut = src.indexOf('function ImportTicketSheet(');
  const corps = src.slice(debut, src.indexOf('\nfunction ', debut + 30));
  it('ignore les clics venus d\'un écran posé par-dessus', () => {
    expect(corps).toContain('if (e.target !== e.currentTarget) return;');
    expect(corps).not.toContain('onClick={(status==="idle"||status==="camera")?onClose:undefined}');
  });
});

// Chantier 168 — ticket qui ne donne que la ville : champ de la rue proposé
// d'emblée sur la carte « Nouveau magasin détecté ».
describe('carte « Nouveau magasin détecté » — ville seule', () => {
  const src = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  it('propose la rue tout de suite quand le ticket ne donne que la ville', () => {
    expect(src).toContain("const villeSeuleLue = !sansAdresseLue && !/\\d/.test(String(result?.address ?? ''));");
    expect(src).toContain("Le ticket n'indique que la ville. Ajoute la rue si tu la connais");
  });
});
