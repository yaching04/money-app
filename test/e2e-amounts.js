// v6.0: 金額は必ず1行。320/375/390px で大きな金額（−¥1,234,567・「仮」つき）を入れ、
// 集計・ホームの内訳・支払い・カード・口座の各タブで、金額の要素が1行に収まり画面からはみ出さないことを確かめる。
// 使い方: node test/e2e-amounts.js [スクショ出力先]
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.argv[2] || '';
let fails = 0; const ck = (n, c) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); };
const NOW = Date.parse('2026-11-04T12:00:00+09:00');
const LONG = 'とても長い名前のサービス・サブスクリプション月額プレミアムプラン';
const P = (o) => Object.assign({ cardId: null, accountId: 'a1', memo: '', active: true, variable: false, fixDay: null, repeat: null, loan: null, createdAt: '2026-08-01' }, o);
const seed = {
  version: 2,
  accounts: [{ id: 'a1', name: LONG + '銀行', balance: 1234567, asOf: '2026-11-04' }, { id: 'a2', name: '第二銀行', balance: 12345678, asOf: '2026-11-04' }],
  cards: [{ id: 'c1', name: LONG + 'カード', fixDay: 12, withdrawDay: 27, accountId: 'a1', variable: true, createdAt: '2026-08-01' }],
  payments: [
    P({ id: 'p1', name: LONG, amount: 1234567, day: 10, variable: true }),
    P({ id: 'p2', name: '家賃', amount: 2345678, day: 20 }),
    P({ id: 'p3', name: LONG + '（カード）', amount: 1234567, day: 1, cardId: 'c1', accountId: null }),
    P({ id: 'p4', name: 'ローン', amount: 123456, day: 5, loan: { count: 120, startMonth: '2026-01' } }),
  ],
  incomes: [{ id: 'i1', name: LONG + '給与', amount: 1234567, day: 25, accountId: 'a1', active: true }],
  actuals: {}, imports: {}, settings: { targetDate: null, projAccount: 'all', viewMonth: null },
};
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
  const p = await b.newPage(); p.setDefaultNavigationTimeout(90000); const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', async (d) => { errs.push('native dialog'); await d.dismiss(); });
  await p.setBypassServiceWorker(true); await p.emulateTimezone('Asia/Tokyo');
  await p.evaluateOnNewDocument((now) => { const R = Date; const off = now - R.now(); class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } } window.Date = D; }, NOW);
  const URL = 'http://127.0.0.1:8765/index.html';
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await p.goto(URL, { waitUntil: 'networkidle0' });
  await p.evaluate((s) => { localStorage.setItem('money-app-v1', JSON.stringify(s)); localStorage.setItem('money-app-hint-pay', '1'); }, seed);
  // 金額（¥と数字、前の −/+）の部分ごとに、行の数（縦に重ならない矩形のかたまり）を数える。「仮」つきの .sg は全体で1行
  const measure = () => p.evaluate(() => {
    const out = { n: 0, bad: [] };
    const lines = (rg) => { const rs = [...rg.getClientRects()].filter((r) => r.width > 0 && r.height > 0).sort((a, b) => a.top - b.top); let n = 0, bot = -1e9; for (const r of rs) { if (r.top >= bot - 2) { n++; bot = r.bottom; } else bot = Math.max(bot, r.bottom); } return { n, right: Math.max(0, ...rs.map((r) => r.right)) }; };
    // overflow で切れて（…で）見えなくなっていないか
    const clipped = (el, rg) => { const r = rg.getBoundingClientRect(); for (let e = el; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis') { const b = e.getBoundingClientRect(); if (r.right > b.right + 0.5 || r.left < b.left - 0.5) return true; } } return false; };
    const vis = (el) => el.offsetParent && !el.closest('details:not([open])');
    const tw = document.createTreeWalker(document.querySelector('#main'), NodeFilter.SHOW_TEXT); let t;
    while ((t = tw.nextNode())) {
      if (!vis(t.parentElement)) continue;
      for (const m of t.data.matchAll(/[−+\-]?¥[\d,]+/g)) {
        out.n++; const rg = document.createRange(); rg.setStart(t, m.index); rg.setEnd(t, m.index + m[0].length);
        const L = lines(rg); if (L.n !== 1 || L.right > innerWidth + 0.5 || clipped(t.parentElement, rg)) out.bad.push(((e) => { const a = []; for (let k = 0; e && k < 4; k++, e = e.parentElement) a.push(e.tagName + '.' + e.className); return a.join('<'); })(t.parentElement) + ' "' + m[0] + '" lines=' + L.n + ' right=' + Math.round(L.right));
      }
    }
    for (const el of document.querySelectorAll('#main .sg')) {
      if (!vis(el)) continue; const rg = document.createRange(); rg.selectNodeContents(el); const L = lines(rg);
      if (L.n !== 1) out.bad.push('sg "' + el.textContent.trim() + '" lines=' + L.n);
    }
    return out;
  });
  for (const w of [320, 375, 390]) {
    await p.setViewport({ width: w, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await p.goto(URL, { waitUntil: 'networkidle0' }); await sleep(300);
    for (const t of ['home', 'pay', 'acct', 'sum']) {
      await p.click('[data-tab=' + t + ']'); await sleep(300);
      if (t === 'home') { const ta = await p.$('[data-act=toggle-all]'); if (ta) { await ta.click(); await sleep(300); } }
      await p.evaluate(() => document.querySelectorAll('#main details').forEach((d) => { d.open = true; }));
      const m = await measure();
      ck(`${w}px ${t}: 金額 ${m.n}個がすべて1行` + (m.bad.length ? ' → ' + m.bad.slice(0, 4).join(' / ') : ''), m.n >= 3 && !m.bad.length);
      if (process.env.SHOTALL) await p.screenshot({ path: process.env.SHOTALL + '/amt-' + w + '-' + t + '.png', fullPage: true });
      if (t === 'sum' && w === 390 && OUT) { await p.evaluate(() => scrollTo(0, 0)); await p.screenshot({ path: OUT + '/v60-summary.png' }); }
    }
  }
  const big = await p.evaluate(() => [...document.querySelectorAll('#main .rcpt .v')].map((e) => e.textContent.trim()));
  ck('集計の3行に大きな金額と「仮」 [' + big.join(' | ') + ']', big.length === 3 && big.every((t) => /¥[\d,]{9,}/.test(t)) && big.some((t) => t.includes('仮')));
  ck('集計: 収入合計・支出合計・差引（区切り線の下）', (await p.evaluate(() => [...document.querySelectorAll('.rcpt .rk')].map((e) => e.textContent).join(','))) === '収入合計,支出合計,差引' && (await p.$eval('.rcpt .tot', (e) => getComputedStyle(e).borderTopStyle)) === 'solid');
  ck('集計: word-break:break-all なし', (await p.$eval('.rcpt .v', (e) => getComputedStyle(e).wordBreak)) !== 'break-all');
  ck('コンソールエラー・ネイティブダイアログなし ' + errs.join(' | '), !errs.length);
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL OK'); process.exit(fails ? 1 : 0);
})();
