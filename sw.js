/* Service worker de Mediterrània: l'app funciona sense connexió.

   - La pàgina (index.html): primer la xarxa, sense la memòria HTTP de GitHub Pages
     (que pot servir una versió antiga durant 10 minuts); si no hi ha xarxa (o triga
     més de 4 s), la darrera còpia desada. Per això NO cal canviar VERSIO cada cop
     que es puja un index.html nou.
   - Fitxers propis (manifest, icones): còpia desada i renovació per darrere.
   - hls.js (jsDelivr, per a algunes ràdios) i tipografies de Google: igual.
   - Dades (temps, mar, aire, festius, ubicació, avisos): primer la xarxa; si no,
     l'última resposta desada. Només dels servidors de la llista API, i com a molt
     MAX_DADES respostes (les més velles s'esborren).
   - Tota la resta va sempre directa a la xarxa i no es desa mai: ràdios, podcasts,
     notícies i qualsevol altre servidor. (Abans es desava tot el que no semblava
     àudio: també fluxos de ràdio sense extensió i adreces que canvien a cada
     petició, i la memòria del mòbil anava creixent sense límit.)

   VERSIO només s'ha de canviar si es canvia aquest fitxer i es vol llençar tot el
   que hi havia desat. El nom porta el prefix del projecte perquè la memòria
   (Cache Storage) és compartida per totes les apps del mateix domini: cada app
   només ha d'esborrar les seves pròpies versions velles, mai les de les altres
   (abans, en activar-se, esborrava també les de Kasio, Antaviana, República, etc.). */
const VERSIO = 'mediterrania-v23';
const DADES = VERSIO + '-api';
const BASE = ['./', './index.html', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];
const CDN = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];
const API = ['api.open-meteo.com', 'marine-api.open-meteo.com', 'air-quality-api.open-meteo.com',
  'api.bigdatacloud.net', 'analisi.transparenciacatalunya.cat', 'feeds.meteoalarm.org'];
const MAX_DADES = 80;
const ESPERA_PAGINA_MS = 4000;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSIO)
      // un fitxer que falti no ha d'impedir la instal·lació (amb addAll, un sol 404 ho feia fallar tot)
      .then(c => Promise.all(BASE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

// Només les versions velles d'aquesta app
const esVella = k => k.startsWith('mediterrania-') && k !== VERSIO && k !== DADES;

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(esVella).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Només es desen respostes bones (o opaques, com el full d'estil de les tipografies)
const desable = r => r && (r.ok || r.type === 'opaque');
const desa = (req, r) => desable(r) ? caches.open(VERSIO).then(c => c.put(req, r)).catch(() => {}) : Promise.resolve();

// Pàgina: xarxa primer (revalidant amb el servidor), amb temps límit; si falla, la còpia desada
function pagina(e){
  const req = e.request;
  const copia = () => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html')).then(r => r || caches.match('./'));
  let fresca = req;
  try { fresca = new Request(req, { cache: 'no-cache' }); } catch (err) {}
  const xarxa = fetch(fresca).then(r => {
    // la versió nova es desa amb els dos noms de la pàgina («./» i «./index.html»): sense connexió surt sempre
    // la darrera que s'ha vist. Una pàgina d'error (404, 500) no substitueix mai la bona.
    if (desable(r)) e.waitUntil(Promise.all([desa('./', r.clone()), desa('./index.html', r.clone())]));
    return r;
  });
  const lenta = new Promise(res => setTimeout(res, ESPERA_PAGINA_MS)).then(copia);
  return Promise.race([xarxa.catch(() => null), lenta]).then(r => r || copia()).then(r => r || xarxa);
}

// Fitxers estàtics: còpia desada de seguida i renovació per darrere
function copiaIRenova(e){
  const req = e.request;
  return caches.match(req).then(hit => {
    const nova = fetch(req).then(r => desable(r) ? desa(req, r.clone()).then(() => r) : r);
    if (hit){ e.waitUntil(nova.catch(() => {})); return hit; }
    return nova;
  });
}

// Dades: xarxa primer; si falla, l'última resposta desada d'aquella mateixa adreça
const retalla = c => c.keys().then(ks => ks.length > MAX_DADES ? Promise.all(ks.slice(0, ks.length - MAX_DADES).map(k => c.delete(k))) : null);
function dades(e){
  const req = e.request;
  return fetch(req).then(r => {
    if (r && r.ok){
      const copia = r.clone();
      e.waitUntil(caches.open(DADES).then(c => c.put(req, copia).then(() => retalla(c))).catch(() => {}));
    }
    return r;
  }).catch(() => caches.open(DADES).then(c => c.match(req)).then(hit => hit || Response.error()));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

  if (url.origin === self.location.origin){
    const esPagina = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
    e.respondWith(esPagina ? pagina(e) : copiaIRenova(e));
    return;
  }
  if (CDN.includes(url.hostname)){ e.respondWith(copiaIRenova(e)); return; }
  if (API.includes(url.hostname)) e.respondWith(dades(e));
  // qualsevol altre servidor (ràdios, podcasts, notícies…): no s'intercepta
});
