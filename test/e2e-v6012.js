// v6.0.12 E2E: ？の44pxヒット・予定なしでも？・矢印disabled時のフォーカス移動
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ck = (n, c, info) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (c || info === undefined ? '' : ' [' + info + ']')); };
const NOW = Date.parse('2026-11-04T12:00:00+09:00');
const P = (o) => Object.assign({ cardId: null, accountId: 'a1', memo: '', active: true, variable: false, fixDay: null, repeat: null, loan: null, createdAt: '2026-08-01' }, o);
const base = (o) => Object.assign({ version: 2, accounts: [{ id: 'a1', name: '銀行', balance: 300000, asOf: '2026-11-04' }], cards: [{ id: 'c1', name: 'Aカード', fixDay: 15, withdrawDay: 27, accountId: 'a1', variable: true, createdAt: '2026-08-01' }], payments: [P({ id: 'p1', name: '動画', amount: 1490, day: 27, cardId: 'c1' })], incomes: [], actuals: {}, imports: {}, settings: { targetDate: null, projAccount: 'all', viewMonth: null } }, o);
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
  const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setBypassServiceWorker(true); await p.emulateTimezone('Asia/Tokyo');
  await p.evaluateOnNewDocument((now) => { const R = Date; const off = now - R.now();
    class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } } window.Date = D; }, NOW);
  const URL = process.env.APPURL || 'http://127.0.0.1:8765/index.html';
  await p.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  // (a) ？ hit ≥44 and visual ring ~24
  await p.goto(URL, { waitUntil: 'networkidle0' });
  await p.evaluate((s) => { localStorage.setItem('money-app-v1', JSON.stringify(s)); localStorage.setItem('money-app-hint-pay', '1'); }, base({}));
  await p.goto(URL, { waitUntil: 'networkidle0' }); await sleep(300);
  await p.click('[data-tab=pay]'); await sleep(250);
  await p.click('[data-act=actuals][data-kind=card][data-id=c1]'); await sleep(400);
  const qHit = await p.evaluate(() => {
    const q = document.querySelector('#dlg [data-act=act-avg-help]');
    const r = q.getBoundingClientRect();
    const before = getComputedStyle(q, '::before');
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      ring: before && before.width, // e.g. "24px"
      border: before && before.borderTopWidth,
      hasQ: !!q && q.textContent.includes('？'),
    };
  });
  ck('(a) ？のヒット領域 ≥44×44 ' + JSON.stringify(qHit), qHit.w >= 44 && qHit.h >= 44);
  ck('(a) 見た目の円は約24px [' + qHit.ring + ']', qHit.ring === '24px' || qHit.ring === '24.0px');
  await p.click('#dlg [data-act=act-avg-help]'); await sleep(150);
  ck('(a) ？で説明が開く', await p.evaluate(() => !document.querySelector('#dlg .act-avg-help').hidden));
  await p.keyboard.press('Escape'); await sleep(200);

  // (b) no provisional → still ？
  // Make card inactive / no future events: use empty payments so card has 0 amount events skipped... 
  // Better: set withdraw far and actuals for all near months, OR use a payment with no upcoming by ending it.
  // Simplest: card with no payments and variable - genEvents may skip zero amount. 
  // Use income that's once in the past, or card with payments empty → no nextProv.
  const noProv = base({
    payments: [], // no items on card → sum 0 → events skipped when no actual
    cards: [{ id: 'c1', name: 'Aカード', fixDay: 15, withdrawDay: 27, accountId: 'a1', variable: true, createdAt: '2026-08-01' }],
  });
  // Card with no payments won't show 実績 button easily. Use pay variable account-direct with once date in past.
  const noProv2 = base({
    cards: [],
    payments: [P({ id: 'p2', name: '終了済み', amount: 1000, day: 10, accountId: 'a1', variable: true, repeat: { type: 'once', date: '2026-01-10' } })],
  });
  await p.evaluate((s) => localStorage.setItem('money-app-v1', JSON.stringify(s)), noProv2);
  await p.goto(URL, { waitUntil: 'networkidle0' }); await sleep(300);
  await p.click('[data-tab=pay]'); await sleep(250);
  // variable direct shows 実績
  const hasAct = await p.$('[data-act=actuals][data-id=p2]');
  ck('(b) 実績ボタンがある', !!hasAct);
  if (hasAct) {
    await hasAct.click(); await sleep(400);
    const bInfo = await p.evaluate(() => {
      const top = document.querySelector('#dlg .act-top');
      const q = document.querySelector('#dlg [data-act=act-avg-help]');
      return {
        top: top && top.innerText.replace(/\s+/g, ' ').trim(),
        hasQ: !!q,
        help: document.querySelector('#dlg .act-avg-help') && document.querySelector('#dlg .act-avg-help').textContent,
      };
    });
    ck('(b) 「次回の予定はありません」でも？がある [' + bInfo.top + ']', /次回の予定はありません/.test(bInfo.top || '') && bInfo.hasQ);
    await p.click('#dlg [data-act=act-avg-help]'); await sleep(150);
    ck('(b) 予定なしでも？で平均の説明が開く', await p.evaluate(() => !document.querySelector('#dlg .act-avg-help').hidden) && /直近/.test(bInfo.help || ''));
    await p.keyboard.press('Escape'); await sleep(200);
  }

  // (c) focus moves when arrow disables
  await p.evaluate((s) => localStorage.setItem('money-app-v1', JSON.stringify(s)), base({}));
  await p.goto(URL, { waitUntil: 'networkidle0' }); await sleep(300);
  await p.click('[data-tab=pay]'); await sleep(250);
  await p.click('[data-act=actuals][data-kind=card][data-id=c1]'); await sleep(400);
  // go to max then press › → should focus ‹ or label, not BODY
  await p.evaluate(() => { for (let i = 0; i < 5; i++) { const b = document.querySelector('[data-act=am-next]'); if (!b || b.disabled) break; b.click(); } });
  await sleep(150);
  // ensure at max with next disabled; focus next then... it's already disabled. Go one back then press next.
  const atMax = await p.evaluate(() => document.getElementById('am').value);
  await p.click('#dlg [data-act=am-prev]'); await sleep(100);
  await p.click('#dlg [data-act=am-next]'); await sleep(150); // lands on max, next becomes disabled
  const afterNext = await p.evaluate(() => {
    const ae = document.activeElement;
    return {
      tag: ae && ae.tagName,
      id: ae && ae.id,
      act: ae && ae.getAttribute && ae.getAttribute('data-act'),
      nextDis: document.querySelector('[data-act=am-next]').disabled,
      am: document.getElementById('am').value,
    };
  });
  ck('(c) ›無効化直後のフォーカスが BODY でない ' + JSON.stringify(afterNext), afterNext.tag !== 'BODY' && afterNext.nextDis === true && (afterNext.act === 'am-prev' || afterNext.id === 'amLbl'));

  // same for ‹ at min
  await p.evaluate(() => { for (let i = 0; i < 20; i++) { const b = document.querySelector('[data-act=am-prev]'); if (!b || b.disabled) break; b.click(); } });
  await sleep(150);
  await p.click('#dlg [data-act=am-next]'); await sleep(100);
  await p.click('#dlg [data-act=am-prev]'); await sleep(150);
  const afterPrev = await p.evaluate(() => {
    const ae = document.activeElement;
    return {
      tag: ae && ae.tagName,
      id: ae && ae.id,
      act: ae && ae.getAttribute && ae.getAttribute('data-act'),
      prevDis: document.querySelector('[data-act=am-prev]').disabled,
    };
  });
  ck('(c) ‹無効化直後のフォーカスが BODY でない ' + JSON.stringify(afterPrev), afterPrev.tag !== 'BODY' && afterPrev.prevDis === true && (afterPrev.act === 'am-next' || afterPrev.id === 'amLbl'));

  ck('キャッシュ名 v6012', require('fs').readFileSync(__dirname + '/../sw.js', 'utf8').includes("CACHE = 'money-app-v6012'"));
  ck('JSエラーなし', errs.length === 0); if (errs.length) console.log(errs);
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
