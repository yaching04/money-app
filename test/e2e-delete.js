// 削除まわりのE2E（headless Chrome / puppeteer-core）。ネイティブの confirm/prompt/alert が1回でも出たら失敗。
// 使い方: (cd money-app && python3 -m http.server 8765 --bind 127.0.0.1 &) && node test/e2e-delete.js [スクショ出力先]
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.argv[2] || '';
let fails = 0; const ck = (n, c) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); };
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
  const p = await b.newPage(); const errs = [], natives = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', async (d) => { natives.push(d.type() + ':' + d.message()); await d.dismiss(); });
  await p.setBypassServiceWorker(true);
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const URL = 'http://127.0.0.1:8765/index.html';
  const go = () => p.goto(URL, { waitUntil: 'networkidle0' });
  const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('money-app-v1')));
  const shot = async (n) => { if (OUT) await p.screenshot({ path: OUT + '/v51-' + n + '.png' }); };
  const tab = async (t) => { await p.click('[data-tab=' + t + ']'); await sleep(250); };
  const cnt = async (sel) => p.evaluate((s) => document.querySelectorAll(s).length, sel);
  const clickIn = async (sel) => { await p.waitForSelector(sel, { visible: true }); await p.click(sel); await sleep(250); };
  const confirmOpen = () => cnt('dialog.cdlg[open]');
  const okBtn = 'dialog.cdlg[open] [data-c="1"]', noBtn = 'dialog.cdlg[open] [data-c="0"]';
  const fresh = async () => { await go(); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('money-app-hint-pay', '1'); }); await go(); await p.click('[data-act=sample]'); await sleep(2700); };

  await fresh();
  let s = await st();
  ck('サンプル投入', s.payments.length > 0 && s.cards.length > 0);

  // 1) 支払い削除：キャンセル→残る / OK→消える
  await tab('pay');
  let before = (await st()).payments.length;
  await clickIn('[data-act=edit-pay]');
  await clickIn('#dlg [data-x=del]');
  ck('支払い: 確認ダイアログが出る', (await confirmOpen()) === 1);
  await shot('1-confirm-payment');
  await clickIn(noBtn);
  ck('支払い: キャンセルで残る', (await st()).payments.length === before && (await cnt('#dlg[open]')) === 1);
  await clickIn('#dlg [data-x=del]'); await clickIn(okBtn);
  ck('支払い: OKで1件減る', (await st()).payments.length === before - 1 && (await cnt('#dlg[open]')) === 0 && (await confirmOpen()) === 0);

  // 2) カード（支払い付き）削除
  await tab('acct');
  s = await st();
  const card = s.cards.find((c) => s.payments.some((x) => x.cardId === c.id)) || s.cards[0];
  const np = s.payments.filter((x) => x.cardId === card.id).length;
  await clickIn(`[data-act=edit-card][data-id="${card.id}"]`);
  await clickIn('#dlg [data-x=del]');
  const msg = await p.evaluate(() => document.querySelector('dialog.cdlg[open] p').textContent);
  ck('カード: 支払い件数が文面に出る (' + np + '件)', np === 0 || msg.includes(String(np)));
  await shot('2-confirm-card');
  await clickIn(okBtn);
  s = await st();
  ck('カード: カードと紐づく支払いが消える', !s.cards.some((c) => c.id === card.id) && !s.payments.some((x) => x.cardId === card.id));

  // 3) 使用中の口座削除
  await tab('acct');
  s = await st();
  const acc = s.accounts[0];
  await clickIn(`[data-act=edit-account][data-id="${acc.id}"]`);
  await clickIn('#dlg [data-x=del]');
  await shot('3-confirm-account');
  await clickIn(okBtn);
  s = await st();
  ck('口座: 削除される', !s.accounts.some((a) => a.id === acc.id));
  await tab('home'); await tab('pay'); await tab('sum');
  ck('口座削除後も描画エラーなし', errs.length === 0);

  // 4) 実績の削除（実績ダイアログの「削除」と、確定額フォームの「実績を取り消す」）
  await fresh();
  s = await st();
  const nAct = Object.keys(s.actuals).length;
  ck('サンプルに実績あり', nAct > 0);
  await tab('acct');
  const vc = s.cards.find((c) => c.variable !== false);
  await clickIn(`[data-act=actuals][data-id="${vc.id}"]`);
  const hasDel = await cnt('[data-act=act-del]');
  if (hasDel) {
    await shot('4-actuals-list');
    await clickIn('[data-act=act-del]');
    ck('実績: 確認ダイアログが出る', (await confirmOpen()) === 1);
    await shot('4-confirm-actual');
    const k0 = Object.values((await st()).actuals).reduce((a, m) => a + Object.keys(m || {}).length, 0);
    await clickIn(okBtn);
    const k1 = Object.values((await st()).actuals).reduce((a, m) => a + Object.keys(m || {}).length, 0);
    ck('実績: OKで消える', k1 < k0 || Object.keys((await st()).actuals).length < nAct);
  } else console.log('SKIP 実績一覧に削除ボタンなし');
  await p.evaluate(() => document.querySelector('#dlg').open && document.querySelector('#dlg').close()); await sleep(200);

  // 5) サンプルのみ削除（自分のデータは残る）
  await fresh();
  await tab('acct'); await clickIn('[data-act=add-account]');
  await p.type('#f [name=name]', 'マイ口座'); await p.evaluate(() => { document.querySelector('#f [name=balance]').value = '50000'; });
  await p.click('#f [type=submit]'); await sleep(300);
  await tab('data');
  await clickIn('[data-act=del-sample]');
  ck('サンプル削除: 確認ダイアログが出る', (await confirmOpen()) === 1);
  await shot('5-confirm-sample');
  await clickIn(noBtn);
  ck('サンプル削除: キャンセルで残る', (await st()).accounts.length > 1);
  await clickIn('[data-act=del-sample]'); await clickIn(okBtn);
  s = await st();
  ck('サンプル削除: 自分の口座だけ残る', s.accounts.length === 1 && s.accounts[0].name === 'マイ口座' && !s.cards.some((c) => c.sample));
  await shot('6-after-sample-delete');

  // 6) 全データ削除（2段階）
  await tab('data');
  await clickIn('[data-act=reset]');
  await shot('7-reset-step1');
  await clickIn(okBtn);
  ck('全削除: 2段階目が出て、まだ消えない', (await confirmOpen()) === 1 && (await st()).accounts.length === 1);
  await shot('8-reset-step2');
  await clickIn(noBtn);
  ck('全削除: 2段階目キャンセルで残る', (await st()).accounts.length === 1);
  await clickIn('[data-act=reset]'); await clickIn(okBtn); await clickIn(okBtn);
  s = await st();
  ck('全削除: 空になる', s.accounts.length === 0 && s.cards.length === 0 && s.payments.length === 0 && s.incomes.length === 0);
  await go(); s = await st();
  ck('全削除: リロード後も空', s.accounts.length === 0);
  await shot('9-after-reset');

  // 7) 復元（置換確認）と不正ファイル
  await fresh();
  const file = '/tmp/e2e-backup.json';
  require('fs').writeFileSync(file, JSON.stringify(await st()));
  require('fs').writeFileSync('/tmp/e2e-bad.json', '{"x":1}');
  await tab('data');
  const inp = await p.$('#file');
  await inp.uploadFile('/tmp/e2e-bad.json'); await sleep(400);
  ck('復元: 不正ファイルはアプリ内ダイアログで通知', (await confirmOpen()) === 1);
  await shot('10-import-error');
  await clickIn(okBtn);
  await inp.uploadFile(file); await sleep(100);
  await p.evaluate(() => { const f = document.querySelector('#file'); f.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(400);
  ck('復元: 置換確認が出る', (await confirmOpen()) === 1);
  await shot('11-import-confirm');
  await clickIn(okBtn);
  ck('復元: 実行後に閉じる', (await confirmOpen()) === 0);

  ck('ネイティブ confirm/prompt/alert は0回', natives.length === 0);
  ck('コンソールエラーなし ' + JSON.stringify(errs), errs.length === 0);
  if (natives.length) console.log(natives);
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL OK'); process.exit(fails ? 1 : 0);
})();
