// QA: v6.0 / v6.0.1 の追加機能のE2E（headless Chrome / puppeteer-core）。日付は 2026-11-04 12:00 JST に固定。
// FAIL = 現状のバグ（または仕様の確認が必要な点）。項目名の【】は QA報告の該当番号。
// 使い方: (cd money-app && python3 -m http.server 8765 --bind 127.0.0.1 &) && node test/e2e-qa-v60.js [スクショ出力先]
//   別ポートで動かすときは APPURL=http://127.0.0.1:XXXX/index.html
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.argv[2] || '';
let fails = 0; const ck = (n, c, info) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (c || info === undefined ? '' : ' [' + info + ']')); };
const NOW = Date.parse('2026-11-04T12:00:00+09:00');
const A = (o) => Object.assign({ id: 'a1', name: '銀行', balance: 100000, asOf: '2026-11-04' }, o);
const P = (o) => Object.assign({ cardId: null, accountId: 'a1', memo: '', active: true, variable: false, fixDay: null, repeat: null, loan: null, createdAt: '2026-08-01' }, o);
const base = (o) => Object.assign({ version: 2, accounts: [A()], cards: [], payments: [], incomes: [], actuals: {}, imports: {}, settings: { targetDate: null, projAccount: 'all', viewMonth: null } }, o);
const LONG = 'とても長い名前のサブスクリプションサービスプレミアムファミリープラン年額コース';
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
  const p = await b.newPage(); p.setDefaultNavigationTimeout(90000); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', async (d) => { await d.dismiss(); });
  await p.setBypassServiceWorker(true); await p.emulateTimezone('Asia/Tokyo');
  await p.evaluateOnNewDocument((now) => { const R = Date; const off = now - R.now();
    class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } } window.Date = D; }, NOW);
  const vp = (w, h = 844) => p.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await vp(390);
  const URL = process.env.APPURL || 'http://127.0.0.1:8765/index.html';
  const go = () => p.goto(URL, { waitUntil: 'networkidle0' });
  const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('money-app-v1')));
  const load = async (s) => { await p.evaluate((s) => { localStorage.setItem('money-app-v1', JSON.stringify(s)); localStorage.setItem('money-app-hint-pay', '1'); }, s); await go(); };
  const tab = async (t) => { await p.click('[data-tab=' + t + ']'); await sleep(350); };
  const click = async (s) => { await p.waitForSelector(s, { visible: true, timeout: 5000 }); await p.click(s); await sleep(400); };
  const txt = (s) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; }, s);
  const setVal = (s, v) => p.$eval(s, (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const shot = async (n, full) => { if (OUT) await p.screenshot({ path: OUT + '/qav60-' + n + '.png', fullPage: !!full }); };
  await go();

  // ---- 変動の新規登録（口座引き落とし）: 前回の日付・実績の月・二重に引かない
  async function reg(st0, f) {
    await load(st0); await tab('pay'); await click('[data-act=add-pay]');
    await p.type('#f [name=name]', '電気代');
    if (await p.$('#f [name=cardId]')) await setVal('#f [name=cardId]', '');
    await p.click('#f [name=variable]'); await sleep(150); await f(); await sleep(250);
    const label = await txt('#amtLabel'); const unkHidden = await p.$eval('#unkWrap', (e) => e.hidden);
    await p.type('#f [name=amount]', '8500'); await p.click('#f button[type=submit]'); await sleep(500);
    const s = await st(); const act = Object.entries(s.actuals).map(([k, v]) => k.slice(-7) + '=' + v.amount);
    const pr = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('money-app-v1')); const r = Logic.project(s, '2026-12-31', 'all'); return { end: r.endBalance, ev: r.events.map((e) => e.date + ':' + e.delta) }; });
    return { label, unkHidden, act, pr };
  }
  const day = (d) => () => setVal('#f [name=day]', d);
  let r = await reg(base(), day('26'));
  ck('【v60-1】26日: 見出しが「前回の引き落とし（10/26）」', /10\/26/.test(r.label), r.label);
  ck('【v60-1】26日: 2026-10 の実績 8500 として記録', r.act.join() === '2026-10=8500', r.act.join());
  ck('【v60-1】26日: 前回分は残高から二重に引かない（12/31残高 = 100000 − 11/26 − 12/28）', r.pr.end === 100000 - 8500 * 2, r.pr.end);
  ck('【v60-1】26日: 12/26(土) → 12/28 にずれる', r.pr.ev.some((e) => e.startsWith('2026-12-28')), r.pr.ev.join(' '));
  r = await reg(base(), day('3'));
  ck('【v60-2】3日: 11/3(祝) → 前回は 11/4・2026-11 分', /11\/4/.test(r.label) && r.act.join() === '2026-11=8500', r.label + ' ' + r.act);
  r = await reg(base(), day('31'));
  ck('【v60-3】31日: 10/31(土) → 前回は 11/2・2026-10 分', /11\/2/.test(r.label) && r.act.join() === '2026-10=8500', r.label + ' ' + r.act);
  r = await reg(base({ settings: { targetDate: null, projAccount: 'all', viewMonth: null, holidayShift: false } }), day('31'));
  ck('【v60-4】ずらし無効: 前回は 10/31', /10\/31/.test(r.label), r.label);
  r = await reg(base(), async () => { await setVal('#f [name=repeat]', 'yearly'); await setVal('#f [name=repMonth]', '12'); await setVal('#f [name=day]', '31'); });
  ck('【v60-5】毎年12/31: 前回は 1/5・2025-12 分', /1\/5/.test(r.label) && r.act.join() === '2025-12=8500', r.label + ' ' + r.act);
  r = await reg(base(), async () => { await setVal('#f [name=day]', '10'); await sleep(150); await p.click('#f [name=unknown]'); });
  ck('【v60-6】まだ分からない: 実績は記録しない', r.act.length === 0, r.act.join());
  // 日付未選択のときの見出し（デザイン指摘a）
  await load(base()); await tab('pay'); await click('[data-act=add-pay]'); if (await p.$('#f [name=cardId]')) await setVal('#f [name=cardId]', '');
  await p.click('#f [name=variable]'); await sleep(200);
  ck('【デザインa】日付未選択でも「まだ分からない」を出す（目安のままにしない）', !(await p.$eval('#unkWrap', (e) => e.hidden)), await txt('#amtLabel'));
  await p.keyboard.press('Escape'); await sleep(300);

  // ---- 実績の上書き確認
  await load(base({ payments: [P({ id: 'p1', name: '電気代', amount: 8000, day: 26, variable: true })], actuals: {} }));
  // ---- ホーム「次回」行: 320/375/390 で名前が潰れない・金額が全部見える
  for (const w of [320, 375, 390]) { await vp(w);
    await load(base({ accounts: [A({ balance: 300000 })], payments: [P({ id: 'p1', name: '動画', amount: 1000, day: 10 })] }));
    const n = await p.evaluate(() => { const l = document.querySelector('.hero .nextst'); const g = (s) => { const e = l && l.querySelector(s); return e ? { w: e.getBoundingClientRect().width, clip: e.scrollWidth > e.clientWidth + 1 } : null; }; return { n: g('.st-n'), ar: g('.st-ar'), t: l ? l.innerText.replace(/\s+/g, ' ') : '' }; });
    ck('【v601-1】' + w + ': 次回行に −¥1,000 と 残り ¥299,000 が全部出る', /−¥1,000/.test(n.t) && /¥299,000/.test(n.t) && n.ar && !n.ar.clip, n.t);
    ck('【v601-1】' + w + ': 短い名前「動画」が省略されない', n.n && !n.n.clip && n.n.w >= 20, JSON.stringify(n.n));
    await shot('next-' + w);
    // デザイン指摘b: 30万が2回続かない
    const ticks = await p.evaluate(() => [...document.querySelectorAll('svg text')].map((e) => e.textContent).filter((t) => /万$/.test(t)));
    ck('【デザインb】' + w + ': 縦軸ラベルが重複しない', ticks.every((t, i) => !i || t !== ticks[i - 1]), ticks.join(','));
  }
  // ---- 長い名前: 2行で省略・変動タグが消えない
  await vp(390);
  const S4 = base({ accounts: [A({ name: '口座' + LONG })], cards: [{ id: 'c1', name: 'カード' + LONG, fixDay: 12, withdrawDay: 27, accountId: 'a1', variable: true }],
    payments: [P({ id: 'p1', name: LONG, amount: 5000, day: 26, variable: true })],
    incomes: [{ id: 'i1', name: '給与' + LONG, amount: 250000, day: 25, accountId: 'a1', active: true, variable: true, createdAt: '2026-08-01' }] });
  await load(S4);
  for (const t of ['pay', 'acct', 'sum']) { await tab(t);
    const r2 = await p.evaluate(() => [...document.querySelectorAll('#main .nm')].filter((e) => e.offsetParent).map((e) => { const lh = parseFloat(getComputedStyle(e).lineHeight) || 20; const tag = e.querySelector('.tag'); return { lines: Math.round(e.clientHeight / lh), tagHidden: !!tag && tag.getBoundingClientRect().bottom > e.getBoundingClientRect().bottom + 1 }; }));
    ck('【v601-3】' + t + ': 長い名前は2行まで', r2.length && r2.every((x) => x.lines <= 2), JSON.stringify(r2));
    ck('【v601-3】' + t + ': 「変動」タグが省略で隠れない', r2.every((x) => !x.tagHidden), JSON.stringify(r2));
  }
  await load(S4); await tab('sum'); const xp = await p.evaluate(() => { const e = [...document.querySelectorAll('#main .nm.xp')].find((x) => x.offsetParent && x.scrollHeight > x.clientHeight + 1); if (!e) return null; e.scrollIntoView({ block: 'center' }); e.setAttribute('data-qa', '1'); return e.clientHeight; });
  if (xp !== null) await p.click('[data-qa="1"]'); await sleep(300);
  ck('【v601-3】集計: タップで全文表示', await p.evaluate(() => { const e = document.querySelector('#main .nm.xp.open'); return !!e && e.scrollHeight <= e.clientHeight + 1; }), xp);
  // ---- タブバー位置・横スクロール（320）
  await vp(320, 568); await load(S4); const pos = [];
  for (const t of ['home', 'pay', 'acct', 'sum', 'data']) { await tab(t); pos.push(await p.evaluate(() => { const n = document.querySelector('#tabs').getBoundingClientRect(); const de = document.documentElement; return Math.round(n.top) + (de.scrollWidth > de.clientWidth ? 'H' : ''); })); }
  ck('【v60-tab】320: 全タブでタブバー位置が同じ・横スクロールなし', pos.every((x) => x === pos[0]) && !/H/.test(pos.join()), pos.join());
  // ---- グラフ縦軸: 巨大な残高でもラベルが左で切れない（第1回からの残件）
  for (const w of [320, 390]) { await vp(w); await load(base({ accounts: [A({ balance: 1234567890 })], payments: [P({ id: 'p1', name: '動画', amount: 1000, day: 10 })] }));
    const cl = await p.evaluate(() => { const svg = [...document.querySelectorAll('svg')].find((s) => s.querySelector('text.cs-t')); if (!svg) return 'nosvg'; const l = svg.getBoundingClientRect().left;
      return [...svg.querySelectorAll('text.cs-t[text-anchor=end]')].filter((t) => t.getBoundingClientRect().left < l - 0.5).map((t) => t.textContent).join(','); });
    ck('【v60-axis】' + w + ': 残高12億台・差1000円で縦軸ラベルが切れない', cl === '', cl); await shot('axis-huge-' + w); }
  // ---- CSV: 見出しとステップ表示の一致
  await vp(390); await load(base({ cards: [{ id: 'c1', name: 'テストカード', fixDay: 10, withdrawDay: 27, accountId: 'a1', variable: true }] }));
  await tab('pay'); await click('[data-act=csv-open]');
  const [fc] = await Promise.all([p.waitForFileChooser({ timeout: 5000 }), p.click('#dlg [data-act=csv-pick]')]);
  await fc.accept([__dirname + '/fixtures/rakuten-like.csv']); await sleep(900);
  const h2 = await txt('#dlg h2'), sb = await txt('#dlg .csv-step b');
  ck('【v601-4】CSV 2段目: 見出しがステップ表示（' + sb + '）と同じ言葉', !!sb && h2.includes(sb.replace(/^\d\s*/, '')), h2 + ' / ' + sb);
  await shot('csv-step2', true);
  ck('ページエラーなし', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL OK'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
