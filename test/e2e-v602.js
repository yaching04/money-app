// v6.0.2 のE2E：変動の追加フォームは日付→金額の順・日付未選択でも「前回の引き落としの金額」、
// ホームのグラフ縦軸ラベルが重複しない。使い方: node test/e2e-v602.js [スクショ出力先]
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.argv[2] || '';
let fails = 0; const ck = (n, c) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); };
const NOW = Date.parse('2026-11-04T12:00:00+09:00');
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
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const go = () => p.goto(URL, { waitUntil: 'networkidle0' });
  const load = async (s) => { await p.evaluate((s) => { localStorage.setItem('money-app-v1', JSON.stringify(s)); localStorage.setItem('money-app-hint-pay', '1'); }, s); await go(); };
  const shot = async (n) => { if (OUT) await p.screenshot({ path: OUT + '/v602-' + n + '.png' }); };
  const tab = async (t) => { await p.click('[data-tab=' + t + ']'); await sleep(300); };
  const txt = (sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; }, sel);
  const vis = (sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !!e.offsetParent; }, sel);
  const clickIn = async (sel) => { await p.waitForSelector(sel, { visible: true }); await p.click(sel); await sleep(300); };
  const order = (ids) => p.evaluate((ids) => [...document.querySelectorAll('#dlg ' + ids.map((i) => '#' + i).join(',#dlg '))].map((e) => e.id).join(','), ids);
  await go();

  // 1) 支払いの追加（変動・口座直接）
  await load(base({ payments: [P({ id: 'p1', name: '動画', amount: 1000, day: 10 })] }));
  await tab('pay'); await clickIn('[data-act=add-pay]');
  const ids = ['name', 'variable', 'cardId', 'accountId', 'repeat', 'day', 'amount'];
  ck('支払い: 名前→変動→支払い方法→口座→繰り返し→日→金額 [' + (await order(ids)) + ']', (await order(ids)) === ids.join(','));
  await p.type('#name', '電気代'); await p.click('#variable'); await sleep(200);
  ck('支払い: 日付未選択でも「前回の引き落としの金額」 [' + (await txt('#amtLabel')) + ']', (await txt('#amtLabel')) === '前回の引き落としの金額');
  ck('支払い: ヒント「引き落とし日を選ぶと日付が入ります」', (await txt('#amtHint')) === '引き落とし日を選ぶと日付が入ります' && (await vis('#amtHint')));
  ck('支払い: 「まだ分からない」が見える', await vis('#unkWrap'));
  await p.evaluate(() => { const a = document.querySelector('#dlg #amount'); a.closest('.f').scrollIntoView({ block: 'center' }); }); await sleep(200);
  await shot('payment-form-nodate');
  await p.select('#day', '20'); await sleep(200);
  ck('支払い: 日を選ぶと「前回の引き落とし（10/20）の金額」 [' + (await txt('#amtLabel')) + ']', (await txt('#amtLabel')) === '前回の引き落とし（10/20）の金額' && (await vis('#unkWrap')));
  ck('支払い: ヒントが実績の説明に変わる [' + (await txt('#amtHint')) + ']', (await txt('#amtHint')) === '2026年10月分の実績として記録し、これからの目安にも使います。');
  await shot('payment-form');
  await p.select('#day', '5'); await sleep(200);
  ck('支払い: 日を変えるとすぐ更新（11/5は未来→前回10/5）[' + (await txt('#amtLabel')) + ']', (await txt('#amtLabel')) === '前回の引き落とし（10/5）の金額');
  await p.click('#unknown'); await sleep(200);
  ck('支払い: 「まだ分からない」で目安に戻る', (await txt('#amtLabel')).startsWith('目安の金額'));
  await p.click('#unknown'); await sleep(100);
  await p.type('#amount', '8000'); await p.click('#dlg [type=submit]'); await sleep(500);
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem('money-app-v1')));
  const np = st.payments.find((x) => x.name === '電気代');
  ck('支払い: 保存すると前回の実績として記録', !!np && np.day === 5 && np.variable && JSON.stringify(st.actuals).includes('8000'));
  // 繰り返し「1回だけ」も日付→金額
  await clickIn('[data-act=add-pay]');
  await p.click('#variable'); await p.select('#repeat', 'once'); await sleep(200);
  ck('支払い（1回だけ）: 日付未選択は「前回の引き落としの金額」', (await txt('#amtLabel')) === '前回の引き落としの金額' && (await vis('#unkWrap')));
  ck('支払い（1回だけ）: 日付欄が金額より上', await p.evaluate(() => { const d = document.querySelector('#dlg #repDate'), a = document.querySelector('#dlg #amount'); return !!d && !!(d.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  await p.click('#dlg [data-x=cancel]'); await sleep(300);
  // 変動でないときも同じ並び・ラベルは従来どおり
  await clickIn('[data-act=add-pay]');
  ck('支払い（変動なし）: ラベルは「金額（円／毎月…）」', /^金額（円／毎月/.test(await txt('#amtLabel')) && !(await vis('#unkWrap')));
  await p.click('#dlg [data-x=cancel]'); await sleep(300);

  // 2) 収入の追加
  await tab('acct'); await clickIn('[data-act=add-income]');
  const ids2 = ['name', 'variable', 'accountId', 'repeat', 'day', 'amount'];
  ck('収入: 名前→変動→口座→繰り返し→日→金額 [' + (await order(ids2)) + ']', (await order(ids2)) === ids2.join(','));
  await p.click('#variable'); await sleep(200);
  ck('収入: 日付未選択でも「前回の入金の金額」・ヒント・まだ分からない', (await txt('#amtLabel')) === '前回の入金の金額' && (await txt('#amtHint')) === '入金日を選ぶと日付が入ります' && (await vis('#unkWrap')));
  await p.select('#day', '25'); await sleep(200);
  ck('収入: 日を選ぶと「前回の入金（10/26）の金額」など [' + (await txt('#amtLabel')) + ']', /^前回の入金（10\/2\d）の金額$/.test(await txt('#amtLabel')));
  await p.click('#dlg [data-x=cancel]'); await sleep(300);

  // 3) ホームの縦軸
  await load(base({ payments: [P({ id: 'p1', name: '動画', amount: 1000, day: 10 })] }));
  const labs = await p.$$eval('#main svg.chart text.cs-t[text-anchor=end]', (a) => a.map((e) => e.textContent));
  ck('縦軸: 隣り合うラベルが重複しない [' + labs.join('/') + ']', labs.length >= 2 && labs.every((x, i) => !i || x !== labs[i - 1]));
  await p.evaluate(() => { const c = document.querySelector('#main svg.chart'); scrollTo(0, c.getBoundingClientRect().top + scrollY - 120); }); await sleep(200);
  await shot('home-axis');
  for (const [bal, amt] of [[300000, 50], [300000, 0], [-20000, 1000], [123456789, 5000000], [5000, 100]]) {
    await load(base({ accounts: [{ id: 'a1', name: 'テスト銀行', balance: bal, asOf: '2026-11-04' }], payments: amt ? [P({ id: 'p1', name: 'x', amount: amt, day: 10 })] : [] }));
    const l = await p.$$eval('#main svg.chart text.cs-t[text-anchor=end]', (a) => a.map((e) => e.textContent));
    ck(`縦軸 残高${bal}・支払い${amt}: 重複なし [${l.join('/')}]`, l.length >= 2 && l.every((x, i) => !i || x !== l[i - 1]));
  }
  ck('コンソールエラー・ネイティブダイアログなし ' + errs.join(' | '), !errs.length);
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL OK'); process.exit(fails ? 1 : 0);
})();
