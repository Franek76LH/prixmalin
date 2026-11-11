import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'
import { traiterRequeteScan, lireImagesRequete, lireCandidatsOrientation, infosImages } from './supabase/functions/scan-ticket/lecture.ts'

// Correctif « scan anti-invention » — FONCTION DE TEST LOCALE, servie
// UNIQUEMENT par le serveur de dev (npm run dev). Elle exécute le MÊME code de
// lecture que l'Edge Function (supabase/functions/scan-ticket/lecture.ts) :
// consignes, hébergeur unique, journaux. Ainsi on teste la nouvelle version
// sur iPhone sans rien déployer : la fonction scan-ticket en ligne (v13) n'est
// pas touchée. Les journaux s'affichent dans le terminal du serveur de dev.
//
// Sécurité : même exigence que l'Edge Function (verify_jwt) — il faut une
// session PrixMalin valide, vérifiée auprès de Supabase. La clé OpenRouter est
// lue dans .env.local (OPENROUTER_API_KEY, SANS préfixe VITE_ : elle n'est
// jamais envoyée au navigateur). Absente du build de production : le plugin
// n'existe qu'en mode 'serve', et l'app ne l'appelle qu'en mode développement.
const ROUTE_SCAN_TICKET_TEST = '/__scan-ticket-test'

// Diagnostic (11/11) — chaque image reçue par la fonction de test est
// enregistrée sur le Mac, TELLE QU'ELLE PART au modèle (après la compression
// faite par l'iPhone), avec ce que chaque lecture a rendu. Dossier
// « scans-test.local » à la racine du dépôt : ignoré par git (règle *.local
// déjà présente) — ce sont des tickets réels, jamais commités.
//   AAAA-MM-JJ_HH-MM-SS_<empreinte>.jpg            l'image (une seule fois :
//                                                  les 2 lectures parallèles
//                                                  d'un scan partagent l'empreinte)
//   AAAA-MM-JJ_HH-MM-SS_<empreinte>_lecture-<heure>.json   une par lecture
// Vérification du sens (correctif orientation) : la miniature TELLE QU'ELLE
// EST ARRIVÉE de l'iPhone (avant redressement) et le verdict :
//   AAAA-MM-JJ_HH-MM-SS_<empreinte>_sens-avant-redressement.jpg
//   AAAA-MM-JJ_HH-MM-SS_<empreinte>_sens.json      { rotation, certain }
// L'image de lecture qui suit est, elle, la photo redressée.
const DOSSIER_SCANS_TEST = join(fileURLToPath(new URL('.', import.meta.url)), 'scans-test.local')

const deuxChiffres = (n) => String(n).padStart(2, '0')
function horodatage(d = new Date()) {
  return `${d.getFullYear()}-${deuxChiffres(d.getMonth() + 1)}-${deuxChiffres(d.getDate())}_${deuxChiffres(d.getHours())}-${deuxChiffres(d.getMinutes())}-${deuxChiffres(d.getSeconds())}`
}

// Enregistre les images d'une requête ; renvoie la base de nom commune
// (pour le fichier de résultat). Ne lève jamais : un diagnostic qui casse le
// scan serait pire que pas de diagnostic.
function enregistrerImagesScan(corps) {
  try {
    const candidats = lireCandidatsOrientation(corps)
    if (candidats) {
      mkdirSync(DOSSIER_SCANS_TEST, { recursive: true })
      const brute = candidats.find(c => c.rotation === 0).image
      const base = `${horodatage()}_${createHash('sha1').update(brute).digest('hex').slice(0, 8)}_sens`
      writeFileSync(join(DOSSIER_SCANS_TEST, `${base}-avant-redressement.jpg`), Buffer.from(brute, 'base64'))
      return base
    }
    const { images } = lireImagesRequete(corps)
    if (images.length === 0) return null
    mkdirSync(DOSSIER_SCANS_TEST, { recursive: true })
    const empreinte = createHash('sha1').update(images.join('|')).digest('hex').slice(0, 8)
    const existant = readdirSync(DOSSIER_SCANS_TEST).find(f => f.includes(`_${empreinte}`) && f.endsWith('.jpg'))
    const base = existant ? existant.replace(/(_p\d+)?\.jpg$/, '') : `${horodatage()}_${empreinte}`
    if (!existant) {
      images.forEach((b64, i) => {
        const nom = images.length > 1 ? `${base}_p${i + 1}.jpg` : `${base}.jpg`
        writeFileSync(join(DOSSIER_SCANS_TEST, nom), Buffer.from(b64, 'base64'))
      })
    }
    return base
  } catch (e) {
    console.error('[scan-ticket-test] image non enregistrée :', e?.message)
    return null
  }
}

function enregistrerLectureScan(base, contenu) {
  if (!base) return
  try {
    const d = new Date()
    const heure = `${deuxChiffres(d.getHours())}-${deuxChiffres(d.getMinutes())}-${deuxChiffres(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, '0')}`
    const nom = base.endsWith('_sens') ? `${base}.json` : `${base}_lecture-${heure}.json`
    writeFileSync(join(DOSSIER_SCANS_TEST, nom), JSON.stringify(contenu, null, 2))
    console.log(`[scan-ticket-test] enregistré : scans-test.local/${nom}`)
  } catch (e) {
    console.error('[scan-ticket-test] résultat non enregistré :', e?.message)
  }
}

function scanTicketTestLocal(env) {
  const repondre = (res, statut, objet) => {
    res.statusCode = statut
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(objet))
  }
  return {
    name: 'scan-ticket-test-local',
    configureServer(server) {
      server.middlewares.use(ROUTE_SCAN_TICKET_TEST, async (req, res) => {
        if (req.method !== 'POST') return repondre(res, 405, { error: 'POST uniquement' })
        let base = null
        let tailles = null
        try {
          const auth = req.headers.authorization
          const verif = auth ? await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/user`, {
            headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: auth },
          }) : null
          if (!verif?.ok) return repondre(res, 401, { error: 'Non autorisé' })

          const decodeur = new TextDecoder()
          let texte = ''
          for await (const m of req) texte += decodeur.decode(m, { stream: true })
          texte += decodeur.decode()
          const corps = JSON.parse(texte || 'null')
          base = enregistrerImagesScan(corps)
          tailles = infosImages(lireImagesRequete(corps).images)

          const parsed = await traiterRequeteScan({
            corps,
            apiKey: env.OPENROUTER_API_KEY,
            fetchFn: fetch,
            prefixe: '[scan-ticket-test]',
          })
          enregistrerLectureScan(base, { recu_a: new Date().toISOString(), tailles_images: tailles, recadrage: corps?.orientation?.recadrage, resultat: parsed })
          repondre(res, 200, parsed)
        } catch (err) {
          console.error('[scan-ticket-test] echec', err?.message)
          enregistrerLectureScan(base, { recu_a: new Date().toISOString(), tailles_images: tailles, erreur: err?.message || 'Erreur' })
          repondre(res, 400, { error: err?.message || 'Erreur' })
        }
      })
    },
  }
}

// command === 'serve' -> serveur de dev ; 'build' -> production. Le certificat
// auto-signé (basicSsl) n'est activé QUE sur le serveur de dev : la caméra iOS
// (getUserMedia) exige un contexte sécurisé, donc un test du scan code-barres
// depuis l'iPhone sur le réseau local impose https. La configuration de build
// (prod, Vercel) est strictement inchangée.
export default defineConfig(({ command, mode }) => ({
  server: { port: 5174 },
  // Source unique de la version : package.json. Jamais dupliquée en dur.
  // npm_package_version n'est renseigné que via un script npm (npm run dev /
  // npm run build) — c'est déjà l'usage réel du projet (Vercel appelle
  // "npm run build").
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version) },
  plugins: [
    react(),
    ...(command === 'serve' ? [basicSsl(), scanTicketTestLocal(loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), ''))] : []),
    VitePWA({
      registerType: 'prompt',
      // #65 — on enregistre le SW nous-mêmes (main.jsx, virtual:pwa-register)
      // pour contrôler onNeedRefresh/onRegisteredSW ; pas d'injection auto.
      injectRegister: false,
      manifest: {
        name: 'PrixMalin',
        short_name: 'PrixMalin',
        description: 'Comparez les prix de vos courses et faites des économies',
        theme_color: '#CC0000',
        background_color: '#F8F8F8',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
}))
