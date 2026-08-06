import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'
import { setUpdateSW, notifyNeedRefresh } from './lib/swUpdate'
import { initPostHog } from './lib/posthog'

// Analytics produit (PostHog) en shadow : initialisé tôt, avant le rendu.
// Invisible pour l'utilisateur ; no-op si VITE_POSTHOG_KEY est absente.
initPostHog()

// #65 — enregistrement contrôlé du service worker (registerType:'prompt',
// injectRegister:false dans vite.config.js). onNeedRefresh prévient App.jsx
// via le petit pont swUpdate.js ; la mise à jour n'est jamais appliquée
// silencieusement, seulement au clic sur "Mettre à jour" (updateSW(true)).
const updateSW = registerSW({
  onNeedRefresh() {
    notifyNeedRefresh()
  },
  onRegisteredSW(swUrl, registration) {
    if (!registration) return
    registration.update()
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update()
    })
    setInterval(() => registration.update(), 30 * 60 * 1000)
  },
})
setUpdateSW(updateSW)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
