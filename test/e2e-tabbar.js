// タブバーの位置: 長い名前・項目が多い「支払い」「カード・口座」タブでも、ホームと同じ x/y/幅のまま・横スクロールなし（375/390幅）
// 使い方: (cd money-app && python3 -m http.server 8765 --bind 127.0.0.1 &) && node test/e2e-tabbar.js
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ck = (n, c) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); };
const LONG = 'とても長い名前の支払いサンプル株式会社ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
function seed() {
  const accounts = [{ id: 'a1', name: '口座' + LONG, balance: 123456789, asOf: '2026-11-04' }, { id: 'a2', name: 'サブ口座', balance: 5000, asOf: '2026-11-04' }];
  const cards = [{ id: 'c1', name: 'カード' + LONG, withdrawDay: 27, fixDay: 15, accountId: 'a1', variable: true, active: true }];
  const payments = [], incomes = [];
  for (let i = 0; i < 30; i++) payments.push({ id: 'p' + i, name: (i % 3 ? '支払い' + i : LONG + i), amount: 1234567 + i, accountId: i % 2 ? 'a1' : 'a2', cardId: i % 4 === 0 ? 'c1' : null, day: (i % 31) + 1, active: true, variable: i % 5 === 0, fixDay: i % 5 === 0 ? 5 : null, memo: i % 7 === 0 ? LONG : '', createdAt: '2026-08-01' });
  incomes.push({ id: 'i1', name: '給与' + LONG, amount: 300000, accountId: 'a1', day: 25, active: true, createdAt: '2026-08-01' });
  return { version: 2, accounts, cards, payments, incomes, actuals: {}, settings: {}, imports: {} };
}
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
  const p = await b.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.setBypassServiceWorker(true);
  const URL = 'http://127.0.0.1:8765/index.html';
  for (const w of [320, 375, 390]) {
    await p.setViewport({ width: w, height: w === 390 ? 844 : w === 375 ? 667 : 568, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await p.goto(URL, { waitUntil: 'networkidle0' });
    await p.evaluate((s) => { localStorage.clear(); localStorage.setItem('money-app-v1', JSON.stringify(s)); for (const k of ['pay', 'acct', 'home', 'sum']) localStorage.setItem('money-app-hint-' + k, '1'); }, seed());
    await p.goto(URL, { waitUntil: 'networkidle0' });
    const meas = () => p.evaluate(() => { const r = document.querySelector('#tabs').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: window.innerWidth, sx: window.scrollX }; });
    const home = await meas();
    ck(`${w}px ホーム: タブバーが画面幅いっぱい ${JSON.stringify(home)}`, home.x === 0 && home.w === w && home.sw <= w && home.bw <= w);
    for (const t of ['pay', 'acct', 'sum', 'data']) {
      await p.click('[data-tab=' + t + ']'); await sleep(250);
      await p.evaluate(() => window.scrollTo(10000, document.body.scrollHeight)); await sleep(150);   // 横にも下にもスクロールを試す
      const m = await meas();
      ck(`${w}px ${t}: 横スクロールなし・タブバーがホームと同じ位置 ${JSON.stringify(m)}`, m.sw <= w && m.bw <= w && m.sx === 0 && m.x === home.x && m.y === home.y && m.w === home.w);
    }
  }
  ck('ページエラーなし ' + JSON.stringify(errs), !errs.length);
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL OK'); process.exit(fails ? 1 : 0);
})();
