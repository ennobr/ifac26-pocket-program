const CACHE = "ifac26-pocket-v3";
const OFFLINE_ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "icon.svg",
  "data/program.json",
  "data/version.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(OFFLINE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function canonicalRequest(request) {
  const url = new URL(request.url);
  return new Request(`${url.origin}${url.pathname}`, { method: "GET" });
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const key = canonicalRequest(request);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(key, response.clone());
    return response;
  } catch {
    const cached = await cache.match(key);
    if (cached) return cached;
    if (request.mode === "navigate") return cache.match(new Request(new URL("index.html", self.location).href));
    throw new Error("Offline and no cached response is available");
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(event.request));
});
