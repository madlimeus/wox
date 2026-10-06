// WOX 오프라인 캐시. 앱 파일을 고치면 VERSION을 올린다.
const VERSION = 'wox-v32';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'lib/pdf.min.js',
  'lib/pdf.worker.min.js',
  'lib/cmaps/78-EUC-H.bcmap',
  'lib/cmaps/78-EUC-V.bcmap',
  'lib/cmaps/78-H.bcmap',
  'lib/cmaps/78-RKSJ-H.bcmap',
  'lib/cmaps/78-RKSJ-V.bcmap',
  'lib/cmaps/78-V.bcmap',
  'lib/cmaps/78ms-RKSJ-H.bcmap',
  'lib/cmaps/78ms-RKSJ-V.bcmap',
  'lib/cmaps/83pv-RKSJ-H.bcmap',
  'lib/cmaps/90ms-RKSJ-H.bcmap',
  'lib/cmaps/90ms-RKSJ-V.bcmap',
  'lib/cmaps/90msp-RKSJ-H.bcmap',
  'lib/cmaps/90msp-RKSJ-V.bcmap',
  'lib/cmaps/90pv-RKSJ-H.bcmap',
  'lib/cmaps/90pv-RKSJ-V.bcmap',
  'lib/cmaps/Add-H.bcmap',
  'lib/cmaps/Add-RKSJ-H.bcmap',
  'lib/cmaps/Add-RKSJ-V.bcmap',
  'lib/cmaps/Add-V.bcmap',
  'lib/cmaps/Adobe-CNS1-0.bcmap',
  'lib/cmaps/Adobe-CNS1-1.bcmap',
  'lib/cmaps/Adobe-CNS1-2.bcmap',
  'lib/cmaps/Adobe-CNS1-3.bcmap',
  'lib/cmaps/Adobe-CNS1-4.bcmap',
  'lib/cmaps/Adobe-CNS1-5.bcmap',
  'lib/cmaps/Adobe-CNS1-6.bcmap',
  'lib/cmaps/Adobe-CNS1-UCS2.bcmap',
  'lib/cmaps/Adobe-GB1-0.bcmap',
  'lib/cmaps/Adobe-GB1-1.bcmap',
  'lib/cmaps/Adobe-GB1-2.bcmap',
  'lib/cmaps/Adobe-GB1-3.bcmap',
  'lib/cmaps/Adobe-GB1-4.bcmap',
  'lib/cmaps/Adobe-GB1-5.bcmap',
  'lib/cmaps/Adobe-GB1-UCS2.bcmap',
  'lib/cmaps/Adobe-Japan1-0.bcmap',
  'lib/cmaps/Adobe-Japan1-1.bcmap',
  'lib/cmaps/Adobe-Japan1-2.bcmap',
  'lib/cmaps/Adobe-Japan1-3.bcmap',
  'lib/cmaps/Adobe-Japan1-4.bcmap',
  'lib/cmaps/Adobe-Japan1-5.bcmap',
  'lib/cmaps/Adobe-Japan1-6.bcmap',
  'lib/cmaps/Adobe-Japan1-UCS2.bcmap',
  'lib/cmaps/Adobe-Korea1-0.bcmap',
  'lib/cmaps/Adobe-Korea1-1.bcmap',
  'lib/cmaps/Adobe-Korea1-2.bcmap',
  'lib/cmaps/Adobe-Korea1-UCS2.bcmap',
  'lib/cmaps/B5-H.bcmap',
  'lib/cmaps/B5-V.bcmap',
  'lib/cmaps/B5pc-H.bcmap',
  'lib/cmaps/B5pc-V.bcmap',
  'lib/cmaps/CNS-EUC-H.bcmap',
  'lib/cmaps/CNS-EUC-V.bcmap',
  'lib/cmaps/CNS1-H.bcmap',
  'lib/cmaps/CNS1-V.bcmap',
  'lib/cmaps/CNS2-H.bcmap',
  'lib/cmaps/CNS2-V.bcmap',
  'lib/cmaps/ETHK-B5-H.bcmap',
  'lib/cmaps/ETHK-B5-V.bcmap',
  'lib/cmaps/ETen-B5-H.bcmap',
  'lib/cmaps/ETen-B5-V.bcmap',
  'lib/cmaps/ETenms-B5-H.bcmap',
  'lib/cmaps/ETenms-B5-V.bcmap',
  'lib/cmaps/EUC-H.bcmap',
  'lib/cmaps/EUC-V.bcmap',
  'lib/cmaps/Ext-H.bcmap',
  'lib/cmaps/Ext-RKSJ-H.bcmap',
  'lib/cmaps/Ext-RKSJ-V.bcmap',
  'lib/cmaps/Ext-V.bcmap',
  'lib/cmaps/GB-EUC-H.bcmap',
  'lib/cmaps/GB-EUC-V.bcmap',
  'lib/cmaps/GB-H.bcmap',
  'lib/cmaps/GB-V.bcmap',
  'lib/cmaps/GBK-EUC-H.bcmap',
  'lib/cmaps/GBK-EUC-V.bcmap',
  'lib/cmaps/GBK2K-H.bcmap',
  'lib/cmaps/GBK2K-V.bcmap',
  'lib/cmaps/GBKp-EUC-H.bcmap',
  'lib/cmaps/GBKp-EUC-V.bcmap',
  'lib/cmaps/GBT-EUC-H.bcmap',
  'lib/cmaps/GBT-EUC-V.bcmap',
  'lib/cmaps/GBT-H.bcmap',
  'lib/cmaps/GBT-V.bcmap',
  'lib/cmaps/GBTpc-EUC-H.bcmap',
  'lib/cmaps/GBTpc-EUC-V.bcmap',
  'lib/cmaps/GBpc-EUC-H.bcmap',
  'lib/cmaps/GBpc-EUC-V.bcmap',
  'lib/cmaps/H.bcmap',
  'lib/cmaps/HKdla-B5-H.bcmap',
  'lib/cmaps/HKdla-B5-V.bcmap',
  'lib/cmaps/HKdlb-B5-H.bcmap',
  'lib/cmaps/HKdlb-B5-V.bcmap',
  'lib/cmaps/HKgccs-B5-H.bcmap',
  'lib/cmaps/HKgccs-B5-V.bcmap',
  'lib/cmaps/HKm314-B5-H.bcmap',
  'lib/cmaps/HKm314-B5-V.bcmap',
  'lib/cmaps/HKm471-B5-H.bcmap',
  'lib/cmaps/HKm471-B5-V.bcmap',
  'lib/cmaps/HKscs-B5-H.bcmap',
  'lib/cmaps/HKscs-B5-V.bcmap',
  'lib/cmaps/Hankaku.bcmap',
  'lib/cmaps/Hiragana.bcmap',
  'lib/cmaps/KSC-EUC-H.bcmap',
  'lib/cmaps/KSC-EUC-V.bcmap',
  'lib/cmaps/KSC-H.bcmap',
  'lib/cmaps/KSC-Johab-H.bcmap',
  'lib/cmaps/KSC-Johab-V.bcmap',
  'lib/cmaps/KSC-V.bcmap',
  'lib/cmaps/KSCms-UHC-H.bcmap',
  'lib/cmaps/KSCms-UHC-HW-H.bcmap',
  'lib/cmaps/KSCms-UHC-HW-V.bcmap',
  'lib/cmaps/KSCms-UHC-V.bcmap',
  'lib/cmaps/KSCpc-EUC-H.bcmap',
  'lib/cmaps/KSCpc-EUC-V.bcmap',
  'lib/cmaps/Katakana.bcmap',
  'lib/cmaps/LICENSE',
  'lib/cmaps/NWP-H.bcmap',
  'lib/cmaps/NWP-V.bcmap',
  'lib/cmaps/RKSJ-H.bcmap',
  'lib/cmaps/RKSJ-V.bcmap',
  'lib/cmaps/Roman.bcmap',
  'lib/cmaps/UniCNS-UCS2-H.bcmap',
  'lib/cmaps/UniCNS-UCS2-V.bcmap',
  'lib/cmaps/UniCNS-UTF16-H.bcmap',
  'lib/cmaps/UniCNS-UTF16-V.bcmap',
  'lib/cmaps/UniCNS-UTF32-H.bcmap',
  'lib/cmaps/UniCNS-UTF32-V.bcmap',
  'lib/cmaps/UniCNS-UTF8-H.bcmap',
  'lib/cmaps/UniCNS-UTF8-V.bcmap',
  'lib/cmaps/UniGB-UCS2-H.bcmap',
  'lib/cmaps/UniGB-UCS2-V.bcmap',
  'lib/cmaps/UniGB-UTF16-H.bcmap',
  'lib/cmaps/UniGB-UTF16-V.bcmap',
  'lib/cmaps/UniGB-UTF32-H.bcmap',
  'lib/cmaps/UniGB-UTF32-V.bcmap',
  'lib/cmaps/UniGB-UTF8-H.bcmap',
  'lib/cmaps/UniGB-UTF8-V.bcmap',
  'lib/cmaps/UniJIS-UCS2-H.bcmap',
  'lib/cmaps/UniJIS-UCS2-HW-H.bcmap',
  'lib/cmaps/UniJIS-UCS2-HW-V.bcmap',
  'lib/cmaps/UniJIS-UCS2-V.bcmap',
  'lib/cmaps/UniJIS-UTF16-H.bcmap',
  'lib/cmaps/UniJIS-UTF16-V.bcmap',
  'lib/cmaps/UniJIS-UTF32-H.bcmap',
  'lib/cmaps/UniJIS-UTF32-V.bcmap',
  'lib/cmaps/UniJIS-UTF8-H.bcmap',
  'lib/cmaps/UniJIS-UTF8-V.bcmap',
  'lib/cmaps/UniJIS2004-UTF16-H.bcmap',
  'lib/cmaps/UniJIS2004-UTF16-V.bcmap',
  'lib/cmaps/UniJIS2004-UTF32-H.bcmap',
  'lib/cmaps/UniJIS2004-UTF32-V.bcmap',
  'lib/cmaps/UniJIS2004-UTF8-H.bcmap',
  'lib/cmaps/UniJIS2004-UTF8-V.bcmap',
  'lib/cmaps/UniJISPro-UCS2-HW-V.bcmap',
  'lib/cmaps/UniJISPro-UCS2-V.bcmap',
  'lib/cmaps/UniJISPro-UTF8-V.bcmap',
  'lib/cmaps/UniJISX0213-UTF32-H.bcmap',
  'lib/cmaps/UniJISX0213-UTF32-V.bcmap',
  'lib/cmaps/UniJISX02132004-UTF32-H.bcmap',
  'lib/cmaps/UniJISX02132004-UTF32-V.bcmap',
  'lib/cmaps/UniKS-UCS2-H.bcmap',
  'lib/cmaps/UniKS-UCS2-V.bcmap',
  'lib/cmaps/UniKS-UTF16-H.bcmap',
  'lib/cmaps/UniKS-UTF16-V.bcmap',
  'lib/cmaps/UniKS-UTF32-H.bcmap',
  'lib/cmaps/UniKS-UTF32-V.bcmap',
  'lib/cmaps/UniKS-UTF8-H.bcmap',
  'lib/cmaps/UniKS-UTF8-V.bcmap',
  'lib/cmaps/V.bcmap',
  'lib/cmaps/WP-Symbol.bcmap',
  'lib/standard_fonts/FoxitDingbats.pfb',
  'lib/standard_fonts/FoxitFixed.pfb',
  'lib/standard_fonts/FoxitFixedBold.pfb',
  'lib/standard_fonts/FoxitFixedBoldItalic.pfb',
  'lib/standard_fonts/FoxitFixedItalic.pfb',
  'lib/standard_fonts/FoxitSerif.pfb',
  'lib/standard_fonts/FoxitSerifBold.pfb',
  'lib/standard_fonts/FoxitSerifBoldItalic.pfb',
  'lib/standard_fonts/FoxitSerifItalic.pfb',
  'lib/standard_fonts/FoxitSymbol.pfb',
  'lib/standard_fonts/LICENSE_FOXIT',
  'lib/standard_fonts/LiberationSans-Bold.ttf',
  'lib/standard_fonts/LiberationSans-BoldItalic.ttf',
  'lib/standard_fonts/LiberationSans-Italic.ttf',
  'lib/standard_fonts/LiberationSans-Regular.ttf',
];

// cache: 'reload' → 브라우저 HTTP 캐시에 남은 옛 파일 말고 서버의 최신 파일을 받는다
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 앱 본체(html/js/css/manifest): 인터넷 되면 최신 파일, 안 되면 저장본
// lib/·icons/ (PDF 엔진·글꼴·아이콘): 거의 안 바뀌니 저장본 먼저
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const isStatic = /\/(lib|icons)\//.test(url.pathname);

  if (isStatic) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
    return;
  }
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) =>
          hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())
        )
      )
  );
});
