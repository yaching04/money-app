// v6.0.3 E2E: 320/375/390幅で 次回の行・マイナス警告・大きい残高の縦軸・長いカード名の「変動」タグ・CSV見出し
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ck = (n, c, info) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (c || info === undefined ? '' : ' [' + info + ']')); };
const NOW = Date.parse('2026-11-04T12:00:00+09:00');
const P = (o) => Object.assign({ cardId: null, accountId: 'a1', memo: '', active: true, variable: false, fixDay: null, repeat: null, loan: null, createdAt: '2026-08-01' }, o);
const base = (o) => Object.assign({ version: 2, accounts: [{ id: 'a1', name: '銀行', balance: 300000, asOf: '2026-11-04' }], cards: [], payments: [], incomes: [], actuals: {}, imports: {}, settings: { targetDate: null, projAccount: 'all', viewMonth: null } }, o);
const LONG = 'とても長い名前のクレジットカードプレミアムゴールドファミリー会員向けカード';
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
  const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setBypassServiceWorker(true); await p.emulateTimezone('Asia/Tokyo');
  await p.evaluateOnNewDocument((now) => { const R = Date; const off = now - R.now();
    class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } } window.Date = D; }, NOW);
  const URL = process.env.APPURL || 'http://127.0.0.1:8765/index.html';
  const load = async (s, w) => { await p.setViewport({ width: w, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await p.goto(URL, { waitUntil: 'networkidle0' });
    await p.evaluate((s) => { localStorage.setItem('money-app-v1', JSON.stringify(s)); localStorage.setItem('money-app-hint-pay', '1'); }, s); await p.goto(URL, { waitUntil: 'networkidle0' }); await sleep(300); };
  const full = (sel) => p.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().right <= innerWidth + 0.5));
  const S = 'screenshots/';
  for (const w of [320, 375, 390]) {
    // 1. 次回の行
    await load(base({ payments: [P({ id: 'p1', name: '動画', amount: 1000, day: 10 })] }), w);
    const nx = await p.evaluate(() => { const n = document.querySelector('.nextst .st-n'); const a = document.querySelector('.nextst .st-ar'); return { n: n.innerText, nOk: n.scrollWidth <= n.clientWidth + 1, aOk: a.scrollWidth <= a.clientWidth + 1 && a.getBoundingClientRect().right <= innerWidth, nl: n.getBoundingClientRect().top, al: a.getBoundingClientRect().top }; });
    ck(w + ' 次回: 名前「動画」が全部見える', nx.n.includes('動画') && nx.nOk, JSON.stringify(nx));
    ck(w + ' 次回: 金額と残りが1行で見える', nx.aOk);
    ck(w + ' 次回: 320だけ2行／広い幅は1行', w <= 360 ? nx.al > nx.nl + 4 : Math.abs(nx.al - nx.nl) < 6, JSON.stringify(nx));
    if (w === 320) await p.screenshot({ path: S + 'v603-home-320.png' });
    // 5. マイナス警告
    await load(base({ accounts: [{ id: 'a1', name: '三井住友銀行 生活費口座', balance: 5000, asOf: '2026-11-04' }, { id: 'a2', name: '貯金', balance: 5000000, asOf: '2026-11-04' }], payments: [P({ id: 'p1', name: '家賃', amount: 1234567, day: 10 })] }), w);
    const wn = await p.evaluate(() => { const n = document.querySelector('.warnst .st-w'), a = document.querySelector('.warnst .st-wa'); return { n: n.innerText, nOk: n.scrollWidth <= n.clientWidth + 1, aOk: a.scrollWidth <= a.clientWidth + 1 && a.getBoundingClientRect().right <= innerWidth, a: a.innerText }; });
    ck(w + ' 警告: 口座名が読める', wn.n.includes('三井住友銀行') && wn.nOk, JSON.stringify(wn));
    ck(w + ' 警告: 金額が全部見える', wn.aOk && /1,2\d\d,\d\d\d/.test(wn.a), JSON.stringify(wn));
    if (w === 320) await p.screenshot({ path: S + 'v603-warning-320.png' });
    // 2. 大きい残高の縦軸
    await load(base({ accounts: [{ id: 'a1', name: '銀行', balance: 1234567890, asOf: '2026-11-04' }], payments: [P({ id: 'p1', name: '税', amount: 3000000, day: 20 })] }), w);
    const ax = await p.evaluate(() => { const sv = document.querySelector('svg.chart'); const r = sv.getBoundingClientRect(); return [...sv.querySelectorAll('text.cs-t')].filter((t) => !t.closest('.grip') && t.getAttribute('text-anchor') === 'end').map((t) => { const q = t.getBoundingClientRect(); return { s: t.textContent, ok: q.left >= r.left - 0.5 }; }); });
    ck(w + ' 縦軸: ラベルがグラフ内に収まる', ax.length >= 2 && ax.every((t) => t.ok), JSON.stringify(ax));
    ck(w + ' 縦軸: 12億台の表示', ax.every((t) => /^12(\.\d+)?億$/.test(t.s)), JSON.stringify(ax));
    if (w === 375) { const el = await p.$('svg.chart'); await el.screenshot({ path: S + 'v603-axis-large.png' }); }
    // 6. 横ばい
    await load(base({ payments: [P({ id: 'p1', name: '小', amount: 30, day: 20 })] }), w);
    const n6 = await p.evaluate(() => [...document.querySelectorAll('svg.chart text.cs-t')].filter((t) => !t.closest('.grip') && t.getAttribute('text-anchor') === 'end').length);
    ck(w + ' 横ばい: 目盛り2本以上', n6 >= 2, n6);
    // 3. 長いカード名
    await load(base({ cards: [{ id: 'c1', name: LONG, fixDay: 15, withdrawDay: 27, accountId: 'a1', variable: true }] }), w);
    await p.click('[data-tab=acct]').catch(() => {}); await sleep(400);
    const tg = await p.evaluate(() => { const t = [...document.querySelectorAll('.nmw .tag.var')][0]; if (!t) return null; const r = t.getBoundingClientRect(), row = t.closest('.l').getBoundingClientRect(); return { vis: r.width > 0 && r.right <= row.right + 0.5 && r.left >= row.left }; });
    ck(w + ' カード: 長い名前でも「変動」が見える', tg && tg.vis, JSON.stringify(tg));
    if (w === 320) await p.screenshot({ path: S + 'v603-accounts-longname.png' });
  }
  const src = require('fs').readFileSync(__dirname + '/../app.js', 'utf8');
  ck('CSV 2段目の見出しが「中身の確認」', src.includes('<h2>中身の確認</h2>') && !src.includes('<h2>明細の確認</h2>'));
  ck('JSエラーなし', !errs.length, errs.join(' / '));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL OK'); process.exit(fails ? 1 : 0);
})();
