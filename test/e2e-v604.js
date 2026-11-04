// v6.0.4 E2E: 320/375/390幅で 次回の行・マイナス警告・大きい残高の縦軸・長いカード名の「変動」タグ・CSV見出し
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
  const vis = (sel) => p.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => { const r = e.getBoundingClientRect(), h = e.closest('.st-line').getBoundingClientRect(); return { t: e.innerText, ok: e.scrollWidth <= e.clientWidth + 1 && r.right <= h.right + 0.5 && r.left >= h.left - 0.5, top: r.top }; }), sel);
  for (const w of [320, 375, 390]) {
    // A: 同じ日に3件
    await load(base({ payments: [P({ id: 'p1', name: '動画', amount: 1000, day: 10 }), P({ id: 'p2', name: '音楽', amount: 3000, day: 10 }), P({ id: 'p3', name: '保険', amount: 4000, day: 10 })] }), w);
    const l1 = await p.evaluate(() => document.querySelector('.nextst .st-l1').innerText.replace(/\s+/g, ' '));
    const o = await vis('.nextst .st-o'), a = await vis('.nextst .st-a'), r = await vis('.nextst .st-r');
    ck(w + ' A: 「ほか2件」が見える [' + l1 + ']', o.length && o[0].ok && o[0].t.includes('ほか2件'));
    ck(w + ' A: 金額はその日の合計（件数なし）と残りが合う [' + a[0].t + ' ' + r[0].t + ']', a[0].t.includes('−¥8,000') && !a[0].t.includes('件') && r[0].t.includes('¥292,000') && a[0].ok && r[0].ok);
    ck(w + ' A: 2行（金額は2行目）', a[0].top > (await vis('.nextst .st-d'))[0].top + 4);
    if (w === 375) await p.screenshot({ path: S + 'v604-home-multi-375.png', clip: { x: 0, y: 0, width: w, height: 420 } });
    // B: 9億
    await load(base({ accounts: [{ id: 'a1', name: '銀行', balance: 1234567890, asOf: '2026-11-04' }], payments: [P({ id: 'p1', name: '投資', amount: 987654321, day: 10 })] }), w);
    const b1 = await vis('.nextst .st-a'), b2 = await vis('.nextst .st-r');
    ck(w + ' B: 大きな金額も切れない [' + b1[0].t + ' ' + b2[0].t + ']', b1[0].ok && b2[0].ok && /¥246,913,569/.test(b2[0].t));
    // C/D: 長い口座名のマイナス
    await load(base({ accounts: [{ id: 'a1', name: 'とても長い名前の三井住友銀行 生活費用メイン口座', balance: 5000, asOf: '2026-11-04' }, { id: 'a2', name: '貯金', balance: 5000000, asOf: '2026-11-04' }], payments: [P({ id: 'p1', name: '家賃', amount: 1234567, day: 10 })] }), w);
    const c = await p.evaluate(() => { const g = (s) => document.querySelector('.warnst ' + s).getBoundingClientRect(); return { ic: g('.st-ic').top, w: g('.st-w').top, wa: g('.st-wa').top, wt: g('.st-wt').top, h: document.querySelector('.warnst').getBoundingClientRect().height }; });
    ck(w + ' C: ⚠と日付・名前が同じ行 ' + JSON.stringify(c), Math.abs(c.ic - c.w) < 6);
    ck(w + ' D: 金額と「になる見込み」が同じ行', Math.abs(c.wa - c.wt) < 6 && c.wa > c.w + 4);
    ck(w + ' C/D: 2行に収まる', c.h <= 72);
    ck(w + ' D: 金額が全部見える', (await vis('.warnst .st-wa'))[0].ok);
    if (w === 375) await p.screenshot({ path: S + 'v604-warning-375.png', clip: { x: 0, y: 0, width: w, height: 480 } });
    // 6: 平らな残高
    for (const bal of [0, -45, 25, 100000000000, 10000000000000]) {
      await load(base({ accounts: [{ id: 'a1', name: '銀行', balance: bal, asOf: '2026-11-04' }] }), w);
      const t = await p.evaluate(() => { const sv = document.querySelector('svg.chart'); const ln = [...sv.querySelectorAll('line')].filter((l) => l.getAttribute('stroke') === '#e2e8f0'); const top = 24, bot = 174; return { n: ln.length, ok: ln.every((l) => +l.getAttribute('y1') >= top - 0.5 && +l.getAttribute('y1') <= bot + 0.5), labels: [...sv.querySelectorAll('text.cs-t')].filter((x) => x.getAttribute('text-anchor') === 'end').map((x) => x.textContent) }; });
      ck(w + ' 平ら ' + bal + ': 目盛り2本以上が枠内 ' + JSON.stringify(t), t.n >= 2 && t.ok && new Set(t.labels).size === t.labels.length && t.labels.every((l) => !/\.\d{3,}/.test(l)));
      if (w === 320 && bal === -45) { const el = await p.$('svg.chart'); await el.screenshot({ path: S + 'v604-axis-tiny.png' }); }
    }
  }
  // (1) 支払いフォームの順番: 名前 → 支払い方法 → 変動 → 繰り返し → 日付 → 金額
  await load(base({ cards: [{ id: 'c1', name: 'Aカード', fixDay: 15, withdrawDay: 27, accountId: 'a1', variable: true }] }), 375);
  await p.click('[data-tab=pay]'); await sleep(350); await p.click('[data-act=add-pay]'); await sleep(400);
  const ord = () => p.evaluate(() => ['#name', '#cardId', '#variable', '#repeat', '#day', '#amount'].map((q) => { const e = document.querySelector('#dlg ' + q.split(',').join(',#dlg ')); return e ? e.getBoundingClientRect().top : null; }));
  const vVis = () => p.evaluate(() => { const e = document.querySelector('#varWrap'); return !!e && !e.hidden && e.getBoundingClientRect().height > 0; });
  ck('支払い: カード払いでは変動が隠れる', !(await vVis()));
  await p.$eval('#cardId', (e) => { e.value = ''; e.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(250);
  ck('支払い: 口座から直接で変動が出る', await vVis());
  const o1 = await ord(); ck('支払い: 名前→支払い方法→変動→繰り返し→日付→金額 ' + JSON.stringify(o1), o1.filter((x) => x !== null).every((v, i, a) => !i || v > a[i - 1]) && o1.every((x) => x !== null) && o1[2] !== null && o1[5] !== null);
  await p.screenshot({ path: S + 'v604-payment-form.png' });
  // (2) 「明細が確定する日」
  await load(base({ cards: [{ id: 'c1', name: 'Aカード', fixDay: 15, withdrawDay: 27, accountId: 'a1', variable: true }] }), 375);
  await p.click('[data-tab=acct]'); await sleep(350);
  const at = await p.evaluate(() => document.body.innerText);
  ck('カード: 「明細が確定する日」表記', at.includes('明細が確定する日') && !at.includes('請求額がわかる日'));
  // (3) 更新バー（本物のService Workerで確認）
  {
    const { execSync, spawn } = require('child_process');
    execSync('rm -rf /tmp/swtest && mkdir /tmp/swtest && cp -r ' + __dirname + '/../{index.html,style.css,app.js,logic.js,csvimport.js,notify.js,manifest.json,sw.js,icons} /tmp/swtest/', { shell: '/bin/bash' });
    const srv = spawn('python3', ['-m', 'http.server', '8766', '--bind', '127.0.0.1'], { cwd: '/tmp/swtest', stdio: 'ignore' }); await sleep(800);
    const q = await b.newPage(); await q.setViewport({ width: 375, height: 760, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await q.goto('http://127.0.0.1:8766/index.html', { waitUntil: 'networkidle0' });
    await q.waitForFunction(() => navigator.serviceWorker.controller, { timeout: 15000 }).catch(() => {}); await sleep(800);
    ck('更新バー: 最初のインストールでは出ない', !(await q.$('#updBar')));
    await q.reload({ waitUntil: 'networkidle0' }); await sleep(500);
    require('fs').appendFileSync('/tmp/swtest/sw.js', '\n// bump ' + Date.now() + '\n');
    await q.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
    const got = await q.waitForSelector('#updBar', { timeout: 15000 }).then(() => true).catch(() => false);
    ck('更新バー: 新しい版が入ると出る', got);
    if (got) {
      const g = await q.evaluate(() => { const u = document.querySelector('#updBar').getBoundingClientRect(), t = document.querySelector('#tabs').getBoundingClientRect(), cs = getComputedStyle(document.querySelector('#updBar')); return { above: u.bottom <= t.top + 0.5, txt: document.querySelector('#updBar').innerText, fs: cs.fontSize, sh: cs.boxShadow }; });
      ck('更新バー: タブバーの上・13px・影なし ' + JSON.stringify(g), g.above && g.txt.includes('新しい版があります') && g.txt.includes('更新する') && g.fs === '13px' && g.sh === 'none');
      await q.screenshot({ path: S + 'v604-update-banner.png' });
      await q.click('#updBar .upd-x'); await sleep(200);
      ck('更新バー: ✕で閉じられる', !(await q.$('#updBar')));
      await q.evaluate(() => window.__showUpdateBar()); await sleep(100);
      await Promise.all([q.waitForNavigation({ waitUntil: 'networkidle0' }), q.click('#updBar .upd-go')]);
      ck('更新バー: 「更新する」で再読み込み', !(await q.$('#updBar')));
    }
    await q.close(); srv.kill();
  }
  ck('JSエラーなし', !errs.length, errs.join(' / '));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL OK'); process.exit(fails ? 1 : 0);
})();
