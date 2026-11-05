// v6.0.6 E2E: 更新バー表示中、末尾のボタンが帯の下に隠れない（ホーム／支払い／設定 × 320/375/390）
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
  // ホームに「変更」、支払いに行、設定に通知ボタンが並ぶデータ
  const state = base({
    payments: [P({ id: 'p1', name: '動画', amount: 1000, day: 10 }), P({ id: 'p2', name: '電気', amount: 7000, day: 15, variable: true })],
  });
  const tabs = [
    { tab: 'home', name: '残高', prefer: '[data-act=edit-balance]', must: 'edit-balance' },
    { tab: 'pay', name: '支払い', prefer: '[data-act=actuals]', must: 'actuals' },
    { tab: 'data', name: '設定', prefer: '[data-act=notif-test]', must: 'notif-test' },
  ];
  for (const w of [320, 375, 390]) {
    await load(state, w);
    for (const t of tabs) {
      await p.click('[data-tab=' + t.tab + ']'); await sleep(300);
      await p.evaluate(() => window.__showUpdateBar()); await sleep(200);
      // 表示直後（自動でずらした後）: 優先ボタンが帯の下にいない
      const mid = await p.evaluate((sel) => {
        const u = document.getElementById('updBar').getBoundingClientRect();
        const el = document.querySelector(sel);
        if (!el) return { miss: 1 };
        const q = el.getBoundingClientRect();
        const x = q.left + q.width / 2, y = Math.min(q.top + q.height / 2, u.top - 2);
        const hit = document.elementFromPoint(x, Math.max(0, y));
        const hit2 = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
        return {
          above: q.bottom <= u.top + 1.5,
          under: q.bottom > u.top + 0.5 && q.top < u.bottom,
          hitBar: !!(hit2 && hit2.closest('#updBar')),
          act: el.dataset.act || el.className,
          q: [Math.round(q.top), Math.round(q.bottom)], bar: [Math.round(u.top), Math.round(u.bottom)],
        };
      }, t.prefer);
      ck(w + ' ' + t.name + ': 表示直後に優先ボタンが帯の下でない ' + JSON.stringify(mid), !mid.miss && !mid.hitBar && (mid.above || !mid.under));

      // 末尾までスクロール → 最後のボタンのタップ先が帯ではない
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
        // ボタン中心。帯より下なら帯の直前を試す
        const y = Math.min(q.top + q.height / 2, u.top - 2);
        const hit = document.elementFromPoint(q.left + q.width / 2, Math.max(1, y));
        const hitMid = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
        return {
          act: last.dataset.act || last.tagName,
          above: q.bottom <= u.top + 1.5,
          hitBar: !!(hitMid && hitMid.closest('#updBar')),
          hitAct: hit && (hit.closest('[data-act]')?.dataset.act || hit.closest('button')?.dataset.act || hit.id || ''),
          q: [Math.round(q.top), Math.round(q.bottom)], barTop: Math.round(u.top),
          padMain: getComputedStyle(document.getElementById('main')).paddingBottom,
          has: document.body.classList.contains('has-upd'),
        };
      });
      ck(w + ' ' + t.name + ': 末尾スクロール後、最後のボタンは帯より上・タップ先が帯でない ' + JSON.stringify(end), !end.miss && end.above && !end.hitBar && end.has);

      // 実際に最後のボタンを押してダイアログか反応がある（帯が食わない）
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
        const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
        if (hit && hit.closest('#updBar')) return { hitBar: 1 };
        last.click();
        return { act: last.dataset.act || last.tagName, ok: 1 };
      });
      ck(w + ' ' + t.name + ': 最後のボタンを押せる ' + JSON.stringify(clicked), clicked.ok === 1);
      // 開いたダイアログ等を閉じる
      await p.keyboard.press('Escape'); await sleep(80);
      await p.evaluate(() => { document.querySelector('#dlg[open]')?.close?.(); document.querySelector('dialog.cdlg[open]')?.close?.(); });
      await sleep(50);

      if (w === 390) await p.screenshot({ path: S + 'v606-banner-' + t.tab + '-390.png' });
      await p.evaluate(() => document.querySelector('#updBar .upd-x')?.click()); await sleep(80);
      await p.evaluate(() => scrollTo(0, 0));
    }
  }
  ck('キャッシュ名 v606', require('fs').readFileSync(__dirname + '/../sw.js', 'utf8').includes("CACHE = 'money-app-v606'"));
  ck('JSエラーなし', !errs.length, errs.join('|'));
  await b.close(); console.log(fails ? 'FAILS ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
})();
