// QAの端ケースE2E（headless Chrome / puppeteer-core）。日付は 2026-11-04 12:00 JST に固定して実行する。
// FAIL = 現状のバグ（または仕様の確認が必要な点）。項目名の【】は QA報告の該当番号。
// 使い方: (cd money-app && python3 -m http.server 8765 --bind 127.0.0.1 &) && node test/e2e-qa-edge.js [スクショ出力先]
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const fs = require('fs'); const os = require('os'); const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.argv[2] || '';
let fails = 0; const ck = (n, c) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); };
const NOW = Date.parse('2026-11-04T12:00:00+09:00');
const A = (o) => Object.assign({ id: 'a1', name: '銀行', balance: 100000, asOf: '2026-11-04' }, o);
const P = (o) => Object.assign({ cardId: null, accountId: 'a1', memo: '', active: true, variable: false, fixDay: null, repeat: null, loan: null, createdAt: '2026-08-01' }, o);
const base = (o) => Object.assign({ version: 2, accounts: [A()], cards: [], payments: [], incomes: [], actuals: {}, imports: {}, settings: { targetDate: null, projAccount: 'all', viewMonth: null } }, o);
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
  const p = await b.newPage(); const errs = [], natives = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', async (d) => { natives.push(d.type() + ':' + d.message()); await d.dismiss(); });
  await p.setBypassServiceWorker(true);
  await p.emulateTimezone('Asia/Tokyo');
  await p.evaluateOnNewDocument((now) => {
    const R = Date; const off = now - R.now();
    class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } }
    window.Date = D;
  }, NOW);
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const URL = 'http://127.0.0.1:8765/index.html';
  const go = () => p.goto(URL, { waitUntil: 'networkidle0' });
  const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('money-app-v1')));
  const load = async (s) => { await p.evaluate((s) => { localStorage.setItem('money-app-v1', JSON.stringify(s)); localStorage.setItem('money-app-hint-pay', '1'); }, s); await go(); };
  const shot = async (n) => { if (OUT) await p.screenshot({ path: OUT + '/qa-' + n + '.png', fullPage: true }); };
  const tab = async (t) => { await p.click('[data-tab=' + t + ']'); await sleep(300); };
  const txt = (sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : ''; }, sel);
  const cnt = async (sel) => p.evaluate((s) => document.querySelectorAll(s).length, sel);
  const cfm = () => p.evaluate(() => { const d = document.querySelector('dialog.cdlg[open]'); return d ? d.innerText.replace(/\s+/g, ' ').trim() : ''; });
  const okBtn = 'dialog.cdlg[open] [data-c="1"]';
  const ev = (f, t) => p.evaluate((f, t) => Logic.genEvents(JSON.parse(localStorage.getItem('money-app-v1')), f, t), f, t);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-edge-'));
  const restore = async (name, obj, accept) => {
    const f = path.join(tmp, name); fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj));
    await tab('data'); const inp = await p.$('#file'); await inp.uploadFile(f);
    await inp.evaluate((e) => e.dispatchEvent(new Event('change', { bubbles: true }))); await sleep(600);
    const msg = await cfm(); if (msg) { await p.click(okBtn); await sleep(400); } if (accept === false && (await cnt('dialog.cdlg[open]'))) { await p.click(okBtn); await sleep(300); }
    return msg;
  };
  await go(); await p.evaluate(() => localStorage.clear()); await go();
  ck('時計の固定（Logic.today = 2026-11-04）', (await p.evaluate(() => Logic.today())) === '2026-11-04');

  // 1) 月末の丸め（現状OK）
  await load(base({ payments: [P({ id: 'p31', name: 'D31', amount: 1000, day: 31 })] }));
  const d31 = (await ev('2026-11-05', '2028-03-31')).filter((e) => e.label === 'D31' || /D31/.test(e.name || e.label)).map((e) => e.date);
  ck('31日払い: 11月は11/30', d31.includes('2026-11-30'));
  ck('31日払い: 2027年2月は2/28', d31.includes('2027-02-28'));
  ck('31日払い: 2028年2月（うるう年）は2/29', d31.includes('2028-02-29'));

  // 2) 【B1】ホームの赤字警告の金額＝その日の終わりの残高
  await load(base({ accounts: [A({ balance: 50000 })], payments: [P({ id: 'q1', name: 'A支払', amount: 60000, day: 27 }), P({ id: 'q2', name: 'B支払', amount: 10000, day: 27 })] }));
  const status = await txt('.status'); await shot('warning-vs-dayend');
  ck('赤字警告の金額がその日の終わりの残高(−¥20,000)と一致 [' + status + ']', /20,000/.test(status));

  // 3) 【B2】土日・祝日の引き落としは翌営業日（仕様確認：現状は未対応）
  await load(base({ payments: [P({ id: 'w', name: '家賃', amount: 80000, day: 27 })] }));
  const w = (await ev('2026-12-01', '2026-12-31')).map((e) => e.date);
  ck('2026/12/27(日)の引き落としは12/28(月)に表示 [' + w.join(',') + ']', w.includes('2026-12-28') && !w.includes('2026-12-27'));
  await load(base({ payments: [P({ id: 'h', name: '祝日', amount: 1000, day: 23 })] }));
  const hd = (await ev('2026-11-05', '2026-11-30')).map((e) => e.date);
  ck('2026/11/23(勤労感謝の日)の引き落としは11/24に表示 [' + hd.join(',') + ']', hd.includes('2026-11-24'));

  // 4) 【B3】口座の残高日付が45日より前：仮の金額で計算している項目は全部「入力待ち」に出る
  await load(base({ accounts: [A({ asOf: '2026-09-01' })], cards: [{ id: 'cv', name: '変動カード', fixDay: 1, withdrawDay: 3, accountId: 'a1', variable: true, createdAt: '2026-08-01' }],
    payments: [P({ id: 'pc', name: 'カード利用', amount: 20000, cardId: 'cv', day: 1 }), P({ id: 'el', name: '電気代', amount: 7000, day: 10, variable: true, fixDay: 5 })] }));
  const prov = (await ev('2026-09-02', '2026-11-04')).filter((e) => !e.confirmed).length;
  const pend = await p.evaluate(() => Logic.computePending(JSON.parse(localStorage.getItem('money-app-v1')), Logic.today()).filter((e) => e.date <= Logic.today()).length);
  await shot('pending-gap');
  ck('仮の金額のまま過ぎた項目(' + prov + '件)が入力待ち(' + pend + '件)に全部出る', prov === pend);

  // 5) 【B8】毎年2月31日 のような存在しない日付の表示
  await load(base({ payments: [P({ id: 'y', name: '年払い', amount: 5000, day: 31, repeat: { type: 'yearly', month: 2 } })] }));
  await tab('pay'); const payTxt = await txt('#main');
  ck('支払い一覧に「2月31日」と表示しない [' + (payTxt.match(/毎年[^ ]*/) || [''])[0] + ']', !/2月31日/.test(payTxt));

  // 6) 【B10】入力待ちにマイナスの金額 → メッセージが「金額を入力してください」ではない
  await load(base({ accounts: [A({ asOf: '2026-11-01' })], cards: [{ id: 'cv', name: '変動カード', fixDay: 1, withdrawDay: 3, accountId: 'a1', variable: true, createdAt: '2026-08-01' }], payments: [P({ id: 'pc', name: 'カード利用', amount: 20000, cardId: 'cv', day: 1 })] }));
  if (await cnt('[data-act=toggle-inbox]')) { await p.click('[data-act=toggle-inbox]'); await sleep(300); }
  let negToast = '';
  if (await cnt('.inb-row input')) { await p.type('.inb-row input', '-500'); await p.click('[data-act=confirm-actual]'); await sleep(300); negToast = await txt('#toast'); }
  ck('入力待ち: マイナスの金額で入力済みの金額を求める誤解のない案内 [' + negToast + ']', negToast !== '' && negToast !== '金額を入力してください');

  // 7) バックアップ復元の異常系
  const seed = base({ cards: [{ id: 'c1', name: 'カード', fixDay: 12, withdrawDay: 27, accountId: 'a1', variable: true, createdAt: '2026-08-01' }], payments: [P({ id: 'p1', name: 'Netflix', amount: 1490, cardId: 'c1', day: 1 })] });
  await load(seed);
  let m = await restore('broken.json', '{"app":"money-app", "accounts": [');
  ck('復元: 壊れたJSONはエラー表示しデータを残す [' + m.slice(0, 30) + ']', /読み込めません/.test(m) && (await st()).payments.length === 1);
  await load(seed);
  m = await restore('empty-accounts.json', { accounts: [] });
  ck('復元【B7】: 中身が空のバックアップ {"accounts":[]} は受け付けない（全データ消去にならない） [' + m.slice(0, 40) + ']', /読み込めません/.test(m) || (await st()).payments.length === 1);

  // 【B4】asOf の無い口座を含むバックアップ → どのタブもエラーにならない
  await load(seed); errs.length = 0;
  m = await restore('no-asof.json', { app: 'money-app', version: 2, accounts: [{ id: 'a1', name: '旧口座', balance: 30000 }], cards: [], payments: [P({ id: 'x', name: '家賃', amount: 50000, day: 27 })], incomes: [], actuals: {}, settings: {} });
  for (const t of ['home', 'pay', 'acct', 'sum']) { if (await cnt('[data-tab=' + t + ']')) await tab(t); }
  await shot('restore-no-asof');
  ck('復元【B4】: asOfの無い口座でもページエラーが出ない ' + JSON.stringify(errs.slice(0, 2)), errs.length === 0 || /読み込めません/.test(m));
  errs.length = 0;

  // 【B5】asOf の形式が違う → undefined を表示しない
  await load(seed);
  m = await restore('bad-asof.json', { app: 'money-app', version: 2, accounts: [{ id: 'a1', name: '口座', balance: 30000, asOf: '2026/11/04' }], cards: [], payments: [P({ id: 'x', name: '家賃', amount: 50000, day: 'abc' })], incomes: [], actuals: {}, settings: {} });
  let all = ''; for (const t of ['home', 'pay', 'acct']) { await tab(t); all += await txt('#main'); }
  await shot('restore-bad-asof');
  ck('復元【B5】: 日付の形式違いで「undefined」を表示しない', !/undefined/.test(all) || /読み込めません/.test(m));

  // 【B6】金額が数字でない → ¥NaN を表示しない
  await load(seed);
  m = await restore('nan.json', { app: 'money-app', version: 2, accounts: [A()], cards: [], payments: [P({ id: 'x', name: '家賃', amount: 'abc', day: 27 })], incomes: [], actuals: {}, settings: {} });
  all = ''; for (const t of ['home', 'pay']) { await tab(t); all += await txt('#main'); }
  await shot('restore-nan');
  ck('復元【B6】: 数字でない金額で「NaN」を表示しない', !/NaN/.test(all) || /読み込めません/.test(m));

  // 8) 【B9】全データ削除のあと「最終バックアップ」の表示が残らない
  await load(seed); await p.evaluate(() => localStorage.setItem('money-app-last-backup', '2026-11-04T10:00:00')); await go();
  await tab('data');
  const resetSel = '[data-act=reset]';
  if (await cnt(resetSel)) {
    await p.click(resetSel); await sleep(300);
    for (let i = 0; i < 3 && (await cnt('dialog.cdlg[open]')); i++) { await p.click(okBtn); await sleep(400); }
    await go(); await tab('data').catch(() => {});
    const bk = await txt('#backup');
    ck('全データ削除後に「最終バックアップ 今日」が残らない [' + bk.slice(0, 40) + ']', !/今日/.test(bk));
  } else ck('全データ削除ボタンが見つかる', false);

  ck('ネイティブ confirm/prompt/alert は0回', natives.length === 0);
  if (natives.length) console.log(natives);
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL OK'); process.exit(fails ? 1 : 0);
})();
