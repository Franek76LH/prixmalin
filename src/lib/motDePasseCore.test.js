import { describe, it, expect } from 'vitest';
import { lireRetourLien, verifierNouveauMotDePasse, emailPlausible, messageErreurMotDePasse } from './motDePasseCore';

describe('chantier 161 — retour du lien « mot de passe oublié »', () => {
  it('lien valable : type=recovery', () => {
    expect(lireRetourLien('#access_token=x&expires_in=3600&refresh_token=y&token_type=bearer&type=recovery'))
      .toEqual({ recuperation: true, lienInvalide: false });
  });
  it('lien périmé', () => {
    expect(lireRetourLien('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'))
      .toEqual({ recuperation: false, lienInvalide: true });
  });
  it('adresse ordinaire, ou confirmation d\'inscription : rien', () => {
    expect(lireRetourLien('')).toEqual({ recuperation: false, lienInvalide: false });
    expect(lireRetourLien('#access_token=x&type=signup')).toEqual({ recuperation: false, lienInvalide: false });
    expect(lireRetourLien(null)).toEqual({ recuperation: false, lienInvalide: false });
  });
});

describe('chantier 161 — nouveau mot de passe', () => {
  it('vide, trop court, différent, correct', () => {
    expect(verifierNouveauMotDePasse('', '')).toMatch(/Choisis/);
    expect(verifierNouveauMotDePasse('abc', 'abc')).toMatch(/6 caractères/);
    expect(verifierNouveauMotDePasse('abcdef', 'abcdeg')).toMatch(/identiques/);
    expect(verifierNouveauMotDePasse('abcdef', 'abcdef')).toBeNull();
  });
  it('e-mail plausible', () => {
    expect(emailPlausible(' celia@exemple.fr ')).toBe(true);
    expect(emailPlausible('celia@')).toBe(false);
    expect(emailPlausible('')).toBe(false);
  });
  it('erreurs Supabase en français', () => {
    expect(messageErreurMotDePasse({ message: 'For security purposes, you can only request this after 42 seconds.' })).toMatch(/Trop de demandes/);
    expect(messageErreurMotDePasse({ message: 'New password should be different from the old password.' })).toMatch(/différent/);
    expect(messageErreurMotDePasse({ message: 'Auth session missing!' })).toMatch(/plus valable/);
    expect(messageErreurMotDePasse(null)).toBeNull();
  });
});
