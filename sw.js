// O app abre do aparelho, sem esperar a rede; a versão nova chega por trás e
// vale na próxima abertura. A planilha (script.google.com) nunca passa por aqui.
const CACHE = "chamada-16";
const ARQUIVOS = ["./", "./index.html", "./estilo.css?v=16", "./app.js?v=16", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (evento) => {
  evento.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARQUIVOS)));
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(caches.keys().then((chaves) => Promise.all(chaves.filter((c) => c !== CACHE).map((c) => caches.delete(c)))));
  self.clients.claim();
});

self.addEventListener("fetch", (evento) => {
  const pedido = evento.request;
  if (pedido.method !== "GET" || new URL(pedido.url).origin !== location.origin) return;
  evento.respondWith(caches.open(CACHE).then(async (cache) => {
    const guardada = await cache.match(pedido, { ignoreSearch: pedido.mode === "navigate" });
    const daRede = fetch(pedido).then((resposta) => {
      if (resposta.ok) cache.put(pedido, resposta.clone());
      return resposta;
    });
    if (guardada) {
      evento.waitUntil(daRede.catch(() => {}));
      return guardada;
    }
    return daRede.catch(() => cache.match("./index.html"));
  }));
});
