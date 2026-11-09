// v6.0.7 E2E: 更新バーを出しても scrollY は変わらない。末尾スクロール後にインフローの最後のボタンが帯の下にならない
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ck = (n, c, info) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (c || info === undefined ? '' : ' [' + info + ']')); };
const NOW = Date.parse('2026-11-04T12:00:00+09:00');
const P = (o) => Object.assign({ cardId: null, accountId: 'a1', memo: '', active: true, variable: false, fixDay: null, repeat: null, loan: null, createdAt: '2026-08-01' }, o);
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
  const S = 'screenshots/';
  const state = base({
    payments: [P({ id: 'p1', name: '動画', amount: 1000, day: 10 }), P({ id: 'p2', name: '電気', amount: 7000, day: 15, variable: true })],
  });
  const tabs = [
    { tab: 'home', name: '残高' },
    { tab: 'pay', name: '支払い' },
    { tab: 'data', name: '設定' },
  ];
  for (const w of [320, 375, 390]) {
    await load(state, w);
    for (const t of tabs) {
      await p.click('[data-tab=' + t.tab + ']'); await sleep(300);
      // 少しスクロールした位置でも、帯を出しても scrollY が変わらないこと
      await p.evaluate(() => scrollTo(0, 40)); await sleep(50);
      const y0 = await p.evaluate(() => scrollY);
      await p.evaluate(() => window.__showUpdateBar()); await sleep(200);
      const y1 = await p.evaluate(() => scrollY);
      ck(w + ' ' + t.name + ': 帯を出しても scrollY 不変 (' + y0 + '→' + y1 + ')', y0 === y1);

      // 固定ボタン（FAB）は帯より上
      if (t.tab === 'pay') {
        const fab = await p.evaluate(() => {
          const u = document.getElementById('updBar').getBoundingClientRect();
          const f = document.querySelector('.fab'); if (!f) return { miss: 1 };
          const q = f.getBoundingClientRect();
          return { above: q.bottom <= u.top + 1.5, hitBar: !!(document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2)?.closest('#updBar')) };
        });
        ck(w + ' ' + t.name + ': FABは帯より上 ' + JSON.stringify(fab), !fab.miss && fab.above && !fab.hitBar);
      }

      // インフローはスクロールしてから確認
      await p.evaluate(() => scrollTo(0, 1e9)); await sleep(150);
      const end = await p.evaluate(() => {
        const u = document.getElementById('updBar').getBoundingClientRect();
        const cands = [...document.querySelectorAll('#main button, #main [data-act], #main .lnk')].filter((e) => {
          if (e.closest('#updBar') || e.closest('.tabs') || e.classList.contains('fab')) return false;
          const cs = getComputedStyle(e); if (cs.position === 'fixed' || !e.getClientRects().length) return false;
          return e.getBoundingClientRect().height > 0;
        });
        const last = cands.sort((a, b) => a.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom).pop();
        if (!last) return { miss: 1 };
        const q = last.getBoundingClientRect();
        const hitMid = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
        return {
          act: last.dataset.act || last.tagName,
          above: q.bottom <= u.top + 1.5,
          hitBar: !!(hitMid && hitMid.closest('#updBar')),
          q: [Math.round(q.top), Math.round(q.bottom)],
          barTop: Math.round(u.top),
          padMain: getComputedStyle(document.getElementById('main')).paddingBottom,
          has: document.body.classList.contains('has-upd'),
        };
      });
      ck(w + ' ' + t.name + ': 末尾スクロール後、最後のボタンは帯より上・タップ先が帯でない ' + JSON.stringify(end), !end.miss && end.above && !end.hitBar && end.has);

      const clicked = await p.evaluate(() => {
        const u = document.getElementById('updBar').getBoundingClientRect();
        const cands = [...document.querySelectorAll('#main button, #main [data-act], #main .lnk')].filter((e) => {
          if (e.closest('#updBar') || e.classList.contains('fab')) return false;
          const cs = getComputedStyle(e); if (cs.position === 'fixed' || !e.getClientRects().length) return false;
          return e.getBoundingClientRect().height > 0;
        });
        const last = cands.sort((a, b) => a.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom).pop();
        if (!last) return { miss: 1 };
        const q = last.getBoundingClientRect();
        if (q.bottom > u.top + 1.5) return { covered: 1, act: last.dataset.act };
        if (document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2)?.closest('#updBar')) return { hitBar: 1 };
        last.click();
        return { act: last.dataset.act || last.tagName, ok: 1 };
      });
      ck(w + ' ' + t.name + ': 最後のボタンを押せる ' + JSON.stringify(clicked), clicked.ok === 1);
      await p.keyboard.press('Escape'); await sleep(80);
      await p.evaluate(() => { document.querySelector('#dlg[open]')?.close?.(); document.querySelector('dialog.cdlg[open]')?.close?.(); });
      await sleep(50);

      if (w === 390) await p.screenshot({ path: S + 'v607-banner-' + t.tab + '-390.png' });
      await p.evaluate(() => document.querySelector('#updBar .upd-x')?.click()); await sleep(80);
      await p.evaluate(() => scrollTo(0, 0));
    }
  }
  // トップ位置でも帯表示で scrollY が 0 のまま（ホームのヒーローが見える）
  await load(state, 390);
  const top = await p.evaluate(async () => {
    scrollTo(0, 0);
    const y0 = scrollY;
    window.__showUpdateBar();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { y0, y1: scrollY, hero: !!document.querySelector('.hero, .nextst') };
  });
  ck('ホーム先頭: 帯表示でも scrollY=0・次回が見える位置 ' + JSON.stringify(top), top.y0 === 0 && top.y1 === 0 && top.hero);
  ck('自動スクロール関数なし', !/clearUpdObscured/.test(require('fs').readFileSync(__dirname + '/../app.js', 'utf8')));
  ck('JSエラーなし', !errs.length, errs.join('|'));
  await b.close(); console.log(fails ? 'FAILS ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
})();
