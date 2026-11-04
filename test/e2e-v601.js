// v6.0.1 のE2E：ホーム1行目に引き落とし額（名前だけ…）、変動チェックの位置（名前のすぐ下）、
// 長い名前の2行クランプ（集計はタップで全文）、320pxの積み重ね表示、CSVの見出し「中身の確認：列の割り当て」。
// 使い方: node test/e2e-v601.js [スクショ出力先]
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.argv[2] || '';
let fails = 0; const ck = (n, c) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); };
const NOW = Date.parse('2026-11-04T12:00:00+09:00');
const LONG = 'とても長い名前のサービス・サブスクリプション月額プレミアムプラン家族向けお得パック';
const P = (o) => Object.assign({ cardId: null, accountId: 'a1', memo: '', active: true, variable: false, fixDay: null, repeat: null, loan: null, createdAt: '2026-08-01' }, o);
const base = (o) => Object.assign({ version: 2, accounts: [{ id: 'a1', name: 'テスト銀行', balance: 300000, asOf: '2026-11-04' }], cards: [], payments: [], incomes: [], actuals: {}, imports: {}, settings: { targetDate: null, projAccount: 'all', viewMonth: null } }, o);
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
  const p = await b.newPage(); p.setDefaultNavigationTimeout(90000); p.setDefaultTimeout(60000);
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', async (d) => { errs.push('native dialog'); await d.dismiss(); });
  await p.setBypassServiceWorker(true); await p.emulateTimezone('Asia/Tokyo');
  await p.evaluateOnNewDocument((now) => { const R = Date; const off = now - R.now(); class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } } window.Date = D; }, NOW);
  const URL = 'http://127.0.0.1:8765/index.html';
  const vp = (w) => p.setViewport({ width: w, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const go = () => p.goto(URL, { waitUntil: 'networkidle0' });
  const load = async (s) => { await p.evaluate((s) => { localStorage.setItem('money-app-v1', JSON.stringify(s)); localStorage.setItem('money-app-hint-pay', '1'); }, s); await go(); };
  const shot = async (n) => { if (OUT) await p.screenshot({ path: OUT + '/v601-' + n + '.png' }); };
  const tab = async (t) => { await p.click('[data-tab=' + t + ']'); await sleep(300); };
  const txt = (sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; }, sel);
  const clickIn = async (sel) => { await p.waitForSelector(sel, { visible: true }); await p.click(sel); await sleep(300); };
  await vp(390); await go();

  // 1) ホーム1行目
  const small = base({ payments: [P({ id: 'p1', name: '動画', amount: 1000, day: 10 })] });
  const longp = base({ payments: [P({ id: 'p1', name: LONG, amount: 1000, day: 10 })] });
  const big = base({ accounts: [{ id: 'a1', name: 'テスト銀行', balance: 13456789, asOf: '2026-11-04' }], payments: [P({ id: 'p1', name: LONG, amount: 1234567, day: 10, variable: true })] });
  const line = () => p.evaluate(() => {
    const l = document.querySelector('.hero .nextst'), B = l.getBoundingClientRect();
    const box = (s) => l.querySelector(s).getBoundingClientRect();
    const inside = (r) => r.left >= B.left - 0.5 && r.right <= B.right + 0.5;
    const a = l.querySelector('.st-a'), r = l.querySelector('.st-r'), n = l.querySelector('.st-n');
    return { t: l.textContent.replace(/\s+/g, ' ').trim(), a: a.textContent.trim(), r: r.textContent.trim(), aIn: inside(box('.st-a')) && a.scrollWidth <= a.clientWidth + 1, rIn: inside(box('.st-r')) && r.scrollWidth <= r.clientWidth + 1, aR: box('.st-a').right <= box('.st-r').left, h: B.height, nEll: getComputedStyle(n).textOverflow === 'ellipsis', nCut: n.scrollWidth > n.clientWidth + 1, kCut: (() => { const k = l.querySelector('.st-k'); return k.scrollWidth > k.clientWidth + 1; })() };
  });
  for (const w of [320, 375, 390]) {
    await vp(w);
    await load(small); let L = await line();
    ck(`${w}px 1行目: 名前・引き落とし額・残り [${L.t}]`, L.t.includes('動画') && L.a === '−¥1,000' && L.r === '→ 残り ¥299,000' && L.aIn && L.rIn && L.aR && L.h <= 48 && !L.kCut);
    if (w === 390) await shot('home');
    await load(longp); L = await line();
    ck(`${w}px 長い名前: 名前だけ…・金額と残りは全部見える`, L.nEll && L.nCut && L.aIn && L.rIn && L.a === '−¥1,000' && L.h <= 48 && !L.kCut);
    await load(big); L = await line();
    ck(`${w}px 大きな金額・仮: 金額と残りは全部見える [${L.a} ${L.r}]`, L.a === '仮 −¥1,234,567' && L.rIn && L.aIn && L.r === '→ 残り ¥12,222,222' && !L.kCut);
  }
  await vp(390);

  // 2) 変動チェックは名前のすぐ下（金額より前）
  await load(small);
  const order = () => p.evaluate(() => { const f = document.querySelector('#dlg form') || document.querySelector('#dlg'); const els = [...f.querySelectorAll('#name, #variable, #amount')]; return els.map((e) => e.id).join(','); });
  await tab('pay'); await clickIn('[data-act=add-pay]');
  ck('支払いの追加: 名前 → 変動 → 金額の順 [' + (await order()) + ']', (await order()) === 'name,variable,amount');
  await p.type('#name', '電気代'); await p.click('#variable'); await sleep(150);
  { const lb = await txt('#amtLabel'); ck('変動にすると直下の金額欄の見出しが変わる [' + lb + ']', /^(前回の引き落とし(（\d+\/\d+）)?の金額|目安の金額)/.test(lb)); }
  await shot('payment-form');
  await p.click('#dlg [data-x=cancel]'); await sleep(300);
  await tab('acct'); await clickIn('[data-act=add-income]');
  ck('収入の追加: 名前 → 変動 → 金額の順 [' + (await order()) + ']', (await order()) === 'name,variable,amount');
  await p.click('#dlg [data-x=cancel]'); await sleep(300);

  // 3) 長い名前は2行で…
  const longs = base({
    accounts: [{ id: 'a1', name: LONG + '銀行', balance: 3000000, asOf: '2026-11-04' }],
    cards: [{ id: 'c1', name: LONG + 'カード', fixDay: 12, withdrawDay: 27, accountId: 'a1', variable: true, createdAt: '2026-08-01' }],
    payments: [P({ id: 'p1', name: LONG, amount: 123456, day: 10, variable: true }), P({ id: 'p2', name: LONG + '固定', amount: 2345, day: 20 }), P({ id: 'p3', name: LONG + '（カード）', amount: 12345, day: 1, cardId: 'c1', accountId: null })],
    incomes: [{ id: 'i1', name: LONG + '給与', amount: 1234567, day: 25, accountId: 'a1', active: true }],
  });
  const clampInfo = () => p.evaluate(() => [...document.querySelectorAll('#main .nm')].filter((e) => e.offsetParent).map((e) => { const lh = parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.5; const row = e.closest('.row,.srow'); return { lines: Math.round(e.getBoundingClientRect().height / lh), cut: e.scrollHeight > e.clientHeight + 1, w: e.getBoundingClientRect().width, rw: row ? row.getBoundingClientRect().width : 0 }; }));
  for (const w of [320, 390]) {
    await vp(w); await load(longs);
    for (const t of ['sum', 'pay', 'acct']) {
      await tab(t); const c = await clampInfo();
      ck(`${w}px ${t}: 長い名前は最大2行（${c.length}件・行数 ${c.map((x) => x.lines).join('/')}）`, c.length >= 2 && c.every((x) => x.lines <= 2) && c.some((x) => x.cut));
      if (w === 320 && t !== 'sum') ck(`320px ${t}: 名前は行の幅いっぱい（積み重ね）`, c.every((x) => x.w >= x.rw * 0.6));
    }
  }
  await vp(390); await load(longs); await tab('sum');
  const sel = '#main .srow .nm.xp';
  const h0 = await p.$eval(sel, (e) => e.getBoundingClientRect().height);
  await p.click(sel); await sleep(200);
  const st1 = await p.$eval(sel, (e) => ({ open: e.classList.contains('open'), h: e.getBoundingClientRect().height, ar: e.getAttribute('aria-expanded'), cut: e.scrollHeight > e.clientHeight + 1 }));
  ck('集計: タップで全文 [' + Math.round(h0) + '→' + Math.round(st1.h) + ']', st1.open && st1.h > h0 && st1.ar === 'true' && !st1.cut);
  ck('集計: タップしても画面は変わらない（編集などが開かない）', !(await p.$('#dlg[open]')) && (await txt('#title, header h1')).includes('集計'));
  await p.click(sel); await sleep(200);
  ck('集計: もう一度タップで2行に戻る', (await p.$eval(sel, (e) => !e.classList.contains('open') && Math.abs(e.getBoundingClientRect().height - 0) > 0)) && Math.abs((await p.$eval(sel, (e) => e.getBoundingClientRect().height)) - h0) < 1);
  await p.evaluate(() => scrollTo(0, document.querySelector('#main .srow').getBoundingClientRect().top + scrollY - 120)); await sleep(200);
  await shot('summary-longname');
  await tab('pay'); await p.click('#main .row .nm'); await sleep(400);
  ck('支払い: 名前のタップは今まで通り編集を開く', (await txt('#dlg[open] h2')) === '支払いを編集'); await p.click('#dlg [data-x=cancel]'); await sleep(300);

  // 4) CSV の見出し
  await load(base({ cards: [{ id: 'c1', name: 'テストカード', fixDay: 10, withdrawDay: 27, accountId: 'a1', variable: true, createdAt: '2026-08-01' }] }));
  await tab('pay'); await clickIn('[data-act=csv-open]');
  const [fc] = await Promise.all([p.waitForFileChooser({ timeout: 5000 }), p.click('#dlg [data-act=csv-pick]')]); await fc.accept([path.join(__dirname, 'fixtures', 'rakuten-like.csv')]); await sleep(700);
  await clickIn('#dlg [data-act=csv-map]');
  ck('CSV: 見出し「中身の確認：列の割り当て」と太字の手順が一致', (await txt('#dlg h2')) === '中身の確認：列の割り当て' && (await txt('#dlg .csv-step b')) === '2 中身の確認');
  await shot('csv-mapping');
  ck('コンソールエラー・ネイティブダイアログなし ' + errs.join(' | '), !errs.length);
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL OK'); process.exit(fails ? 1 : 0);
})();
