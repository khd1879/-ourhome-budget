/* 우리집 재무관리 v2.0: 앱 파일은 네트워크 우선, API/인증 응답은 캐시하지 않음. */
'use strict';
const CACHE = 'ourhome-v2.0-shell-20260926-strategies250-tosslink';
const BASE = new URL('./', self.location.href);
const FILES = ['./','index.html','app.js','styles.css','supabase-config.js','manifest.webmanifest','icon-192.png','icon-512.png'];
const URLS = FILES.map(p => new URL(p, BASE).href);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(URLS.map(async url => {
      try { const response = await fetch(url, {cache:'reload'}); if(response.ok) await cache.put(url,response); } catch {}
    }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // 다른 GitHub Pages 앱의 캐시는 보존합니다.
    for(const name of await caches.keys()) {
      if(name === CACHE) continue;
      const cache = await caches.open(name);
      const keys = await cache.keys();
      const owned = keys.filter(r => {const u=new URL(r.url);return u.origin===BASE.origin&&u.pathname.startsWith(BASE.pathname);});
      if(!owned.length) continue;
      for(const request of owned) await cache.delete(request);
      if(!(await cache.keys()).length) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request=event.request, url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==BASE.origin) return;
  const clean=new URL(url); clean.search=''; clean.hash='';
  if(!URLS.includes(clean.href)) return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try {
      const response=await fetch(request,{cache:'no-cache'});
      if(response.ok) await cache.put(clean.href,response.clone());
      return response;
    } catch {
      const cached=await cache.match(clean.href);
      return cached||new Response('인터넷 연결 후 다시 열어 주세요.',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});
    }
  })());
});
