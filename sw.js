// ========== 记账本 Service Worker v2.0 ==========
// 更新本文件版本号即可触发 App 更新
const CACHE_NAME = 'simpledge-v1';
const STATIC_CACHE = 'simpledge-static-v1';

const urlsToCache = [
  './',
  './index.html',
  './css/style.css',
  './js/db.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './js/dexie.js',
  './js/chart.js'
];

// 安装：缓存核心文件
self.addEventListener('install', event => {
  self.skipWaiting(); // 立即激活新版 SW
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      return cache.addAll(urlsToCache);
    })
  );
});

// 拦截请求策略：
//   - 静态资源（css/js/icon）：缓存优先
//   - HTML/index：网络优先，兜底缓存（保证每次打开都是最新版）
//   - 外部 CDN：缓存优先
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // HTML 页面：网络优先 → 每次打开都是最新版
  if (url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 其他资源：缓存优先 + 后台更新
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// 激活：接管页面 + 清理旧缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(), // 立即接管所有页面
      caches.keys().then(names => {
        return Promise.all(
          names.filter(n => n !== CACHE_NAME && n !== STATIC_CACHE)
            .map(n => caches.delete(n))
        );
      })
    ]).then(() => {
      // 通知所有页面：新版已激活，建议刷新
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'NEW_VERSION_ACTIVATED' });
        });
      });
    })
  );
});
