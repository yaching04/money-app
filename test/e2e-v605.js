// v6.0.5 E2E: 同じ日の入金（3行目）・2行目は1行・更新バー中のFAB/本文・文言
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ck = (n, c, info) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (c || info === undefined ? '' : ' [' + info + ']')); };
const NOW = Date.parse('2026-11-04T12:00:00+09:00');
const P = (o) => Object.assign({ cardId: null, accountId: 'a1', memo: '', active: true, variable: false, fixDay: null, repeat: null, loan: null, createdAt: '2026-08-01' }, o);
const I = (o) => Object.assign({ accountId: 'a1', memo: '', active: true, variable: false, fixDay: null, repeat: null, createdAt: '2026-08-01' }, o);
const base = (o) => Object.assign({ version: 2, accounts: [{ id: 'a1', name: '銀行', balance: 300000, asOf: '2026-11-04' }], cards: [], payments: [], incomes: [], actuals: {}, imports: {}, settings: { targetDate: null, projAccount: 'all', viewMonth: null } }, o);
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
  const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setBypassServiceWorker(true); await p.emulateTimezone('Asia/Tokyo');
  await p.evaluateOnNewDocument((now) => { const R = Date; const off = now - R.now();
    class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } } window.Date = D; }, NOW);
  const URL = process.env.APPURL || 'http://127.0.0.1:8765/index.html';
  const load = async (s, w) => { await p.setViewport({ width: w, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await p.goto(URL, { waitUntil: 'networkidle0' });
    await p.evaluate((s) => { localStorage.setItem('money-app-v1', JSON.stringify(s)); localStorage.setItem('money-app-hint-pay', '1'); }, s); await p.goto(URL, { waitUntil: 'networkidle0' }); await sleep(300); };
  const lines = (sel) => p.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return -1; const lh = parseFloat(getComputedStyle(e).lineHeight) || 20; return Math.round(e.getBoundingClientRect().height / lh); }, sel);
  const S = 'screenshots/';
  for (const w of [320, 375, 390]) {
    await load(base({ payments: [P({ id: 'p1', name: '動画', amount: 3000, day: 10 })], incomes: [I({ id: 'i1', name: '給料', amount: 200000, day: 10 })] }), w);
    const t2 = await p.evaluate(() => document.querySelector('.nextst .st-l2').innerText.replace(/\s+/g, ' ')), t3 = await p.evaluate(() => (document.querySelector('.nextst .st-l3') || {}).innerText || '');
    ck(w + ' 1: 2行目は「−¥3,000 → 残り ¥497,000」 [' + t2 + ']', /−¥3,000/.test(t2) && /残り ¥497,000/.test(t2) && !/件/.test(t2));
    ck(w + ' 1: 3行目「同じ日の入金 +¥200,000 を含む」 [' + t3 + ']', /同じ日の入金 \+¥200,000 を含む/.test(t3.replace(/\s+/g, ' ')));
    ck(w + ' 1: 2行目は1行', (await lines('.nextst .st-l2')) === 1);
    ck(w + ' 1: 3行目は13px', await p.evaluate(() => getComputedStyle(document.querySelector('.nextst .st-l3')).fontSize === '13px'));
    if (w === 375) await p.screenshot({ path: S + 'v605-home-sameinc-375.png', clip: { x: 0, y: 0, width: w, height: 420 } });
    // 4: 仮・複数件
    await load(base({ payments: [P({ id: 'p1', name: '動画', amount: 1000, day: 10 }), P({ id: 'p2', name: '電気', amount: 7000, day: 10, variable: true })] }), w);
    const u2 = await p.evaluate(() => document.querySelector('.nextst .st-l2').innerText.replace(/\s+/g, ' '));
    ck(w + ' 4: 仮・2件でも2行目は1行・件数なし [' + u2 + ']', (await lines('.nextst .st-l2')) === 1 && !/件/.test(u2) && !(await p.$('.nextst .st-l3')));
    if (w === 320) await p.screenshot({ path: S + 'v605-home-320.png', clip: { x: 0, y: 0, width: w, height: 420 } });
    // 2: 更新バー（全タブ）
    const tabs = await p.$$eval('.tabs button', (bs) => bs.length);
    for (let k = 0; k < tabs; k++) {
      await p.evaluate((k) => document.querySelectorAll('.tabs button')[k].click(), k); await sleep(250);
      await p.evaluate(() => window.__showUpdateBar()); await sleep(100);
      const r = await p.evaluate(() => { const u = document.getElementById('updBar').getBoundingClientRect(); const bad = [...document.querySelectorAll('.fab, button')].filter((e) => getComputedStyle(e).position === 'fixed' || e.closest('.fab')).filter((e) => !e.closest('.tabs') && !e.closest('#updBar')).filter((e) => { const q = e.getBoundingClientRect(); return q.height && q.bottom > u.top + 0.5; }).length;
        scrollTo(0, 1e9); const last = [...document.querySelectorAll('main > *, #app > *')].filter((e) => e.offsetHeight && getComputedStyle(e).position !== 'fixed').pop(); const lb = last ? last.getBoundingClientRect().bottom : 0; return { bad, lastOk: lb <= u.top + 1, tab: document.querySelector('.tabs button.on').innerText }; });
      ck(w + ' 2: [' + r.tab + '] バーに重なるボタンなし・本文の最後がバーより上 ' + JSON.stringify(r), r.bad === 0 && r.lastOk);
      if (w === 375 && /支払/.test(r.tab)) await p.screenshot({ path: S + 'v605-banner-pay-375.png' });
      await p.evaluate(() => document.querySelector('#updBar .upd-x').click()); await sleep(50);
      ck(w + ' 2: [' + r.tab + '] 閉じるとFABが元の位置', await p.evaluate(() => !document.body.classList.contains('has-upd')));
      await p.evaluate(() => scrollTo(0, 0));
    }
  }
  // 3: 文言
  const src = require('fs').readFileSync(__dirname + '/../app.js', 'utf8') + require('fs').readFileSync(__dirname + '/../logic.js', 'utf8');
  ck('3: 古い文言なし', !/金額がわかる日|請求額がわかる日|明細で明細/.test(src));
  ck('JSエラーなし', !errs.length, errs.join('|'));
  await b.close(); console.log(fails ? 'FAILS ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
})();
