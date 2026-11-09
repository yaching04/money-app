// v6.0.11 E2E: 実績の上限＝max(既定,来月)・下限12か月・保存後も開いたまま前月へ・CSV select変更でフォーカス維持
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
  const S = 'screenshots/';
  await p.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  // --- 1) 既定が来月より先（11・12月に実績あり → 既定は2027-01）でも範囲内・›無効・‹で戻れて›で戻れる ---
  const stateBeyond = base({
    actuals: {
      'card:c1:2026-11': { amount: 1490, at: '2026-11-01' },
      'card:c1:2026-12': { amount: 1500, at: '2026-12-01' },
    },
  });
  await p.goto(URL, { waitUntil: 'networkidle0' });
  await p.evaluate((s) => { localStorage.setItem('money-app-v1', JSON.stringify(s)); localStorage.setItem('money-app-hint-pay', '1'); }, stateBeyond);
  await p.goto(URL, { waitUntil: 'networkidle0' }); await sleep(300);
  await p.click('[data-tab=pay]'); await sleep(250);
  await p.click('[data-act=actuals][data-kind=card][data-id=c1]'); await sleep(400);
  const beyond = await p.evaluate(() => {
    const prev = document.querySelector('[data-act=am-prev]'), next = document.querySelector('[data-act=am-next]');
    const pr = prev.getBoundingClientRect(), nr = next.getBoundingClientRect();
    return {
      am: document.getElementById('am').value,
      lbl: document.getElementById('amLbl').textContent,
      nextDis: next.disabled, prevDis: prev.disabled,
      focus: document.activeElement && document.activeElement.id,
      hit: { pw: Math.round(pr.width), ph: Math.round(pr.height), nw: Math.round(nr.width), nh: Math.round(nr.height) },
      div: (() => { const hr = document.querySelector('.act-div'); if (!hr) return null; const cs = getComputedStyle(hr); const r = hr.getBoundingClientRect(); const btn = document.querySelector('[data-act=act-add]').getBoundingClientRect(); const h3 = document.querySelector('.act-hist').getBoundingClientRect(); return { gapTop: Math.round(r.top - btn.bottom), gapBot: Math.round(h3.top - r.bottom), bt: cs.borderTopWidth }; })(),
    };
  });
  ck('既定が来月より先でも開いた月はその既定 [' + beyond.am + ']', beyond.am === '2027-01');
  ck('そのとき › は無効・‹ は有効', beyond.nextDis === true && beyond.prevDis === false);
  ck('‹ › のヒット領域 44×44 ' + JSON.stringify(beyond.hit), beyond.hit.pw >= 44 && beyond.hit.ph >= 44 && beyond.hit.nw >= 44 && beyond.hit.nh >= 44);
  ck('保存ボタンと履歴のあいだに区切り（上≥20px・線1px・下≥20px） ' + JSON.stringify(beyond.div), beyond.div && beyond.div.gapTop >= 20 && beyond.div.gapBot >= 20 && beyond.div.bt === '1px');
  await p.click('#dlg [data-act=am-prev]'); await sleep(150);
  const back = await p.evaluate(() => ({ am: document.getElementById('am').value, nextDis: document.querySelector('[data-act=am-next]').disabled }));
  ck('‹ で2026-12へ・› が再び有効', back.am === '2026-12' && back.nextDis === false);
  await p.click('#dlg [data-act=am-next]'); await sleep(100);
  ck('› で既定月へ戻れる', await p.evaluate(() => document.getElementById('am').value) === '2027-01');
  await p.keyboard.press('Escape'); await sleep(250);

  // --- 下限12か月 ---
  await p.click('[data-act=actuals][data-kind=card][data-id=c1]'); await sleep(350);
  await p.evaluate(() => { for (let i = 0; i < 20; i++) { const b = document.querySelector('[data-act=am-prev]'); if (!b || b.disabled) break; b.click(); } });
  await sleep(200);
  const mined = await p.evaluate(() => ({ am: document.getElementById('am').value, dis: document.querySelector('[data-act=am-prev]').disabled, color: getComputedStyle(document.querySelector('[data-act=am-prev]')).color }));
  ck('下限は12か月前 [' + mined.am + ']', mined.am === '2025-11' && mined.dis === true);
  ck('下限の ‹ は薄いグレー', /148|163|184/.test(mined.color));
  await p.keyboard.press('Escape'); await sleep(200);

  // --- 保存後も開いたまま・前月へ・トースト・履歴更新・閉じたらホーム更新 ---
  const stateSave = base({ actuals: {} });
  await p.evaluate((s) => localStorage.setItem('money-app-v1', JSON.stringify(s)), stateSave);
  await p.goto(URL, { waitUntil: 'networkidle0' }); await sleep(300);
  await p.click('[data-tab=pay]'); await sleep(250);
  await p.click('[data-act=actuals][data-kind=card][data-id=c1]'); await sleep(400);
  // 既定は11月（実績なし）。10月を保存したいので‹してから金額
  // 実際は11月を保存 → 10月へ移る
  await p.type('#aa', '1490'); await p.click('#dlg [data-act=act-add]'); await sleep(500);
  const afterSave = await p.evaluate(() => {
    const toast = document.querySelector('.toast');
    const hist = [...document.querySelectorAll('#dlg .row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim());
    return {
      open: document.getElementById('dlg').open,
      am: document.getElementById('am').value,
      aa: document.getElementById('aa').value,
      focus: document.activeElement && document.activeElement.id,
      toast: toast ? toast.textContent : '',
      hist,
    };
  });
  ck('保存後もダイアログが開いている', afterSave.open === true);
  ck('保存トースト [' + afterSave.toast + ']', /11月分を保存しました/.test(afterSave.toast));
  ck('ステッパーが前月へ [' + afterSave.am + ']', afterSave.am === '2026-10');
  ck('金額がクリアされ #aa フォーカス', afterSave.aa === '' && afterSave.focus === 'aa');
  ck('履歴に11月分が出る', afterSave.hist.some((h) => /2026年11月/.test(h) && /1,490/.test(h)));
  await p.screenshot({ path: S + 'v6011-actuals-open.png' });
  await p.click('#dlg [data-act=close-dlg]'); await sleep(400);
  const home = await p.evaluate(() => {
    const t = document.body.innerText;
    return { hasCard: /Aカード/.test(t), noDlg: !document.getElementById('dlg').open };
  });
  ck('閉じたあとホームが描画されている', home.noDlg && home.hasCard);

  // 再開すると既定は次の未入力（12月＝次の仮）で、11月は履歴のみ
  await p.click('[data-act=actuals][data-kind=card][data-id=c1]'); await sleep(400);
  const reopen = await p.evaluate(() => ({ am: document.getElementById('am').value, hist: document.body.innerText.includes('2026年11月') }));
  ck('再開の既定は次の未入力月（12月） [' + reopen.am + ']', reopen.am === '2026-12');
  await p.keyboard.press('Escape'); await sleep(200);

  // --- 保存後は入力済み月を飛ばして直前の未入力月へ。全部埋まっていれば留まって案内 ---
  const stateSkip = base({
    actuals: {
      'card:c1:2026-10': { amount: 1400, at: '2026-10-01' },
      'card:c1:2026-09': { amount: 1300, at: '2026-09-01' },
    },
  });
  await p.evaluate((s) => localStorage.setItem('money-app-v1', JSON.stringify(s)), stateSkip);
  await p.goto(URL, { waitUntil: 'networkidle0' }); await sleep(300);
  await p.click('[data-tab=pay]'); await sleep(250);
  await p.click('[data-act=actuals][data-kind=card][data-id=c1]'); await sleep(400);
  // 既定11月を保存 → 10・9は入力済みなので 8月へ
  await p.type('#aa', '1490'); await p.click('#dlg [data-act=act-add]'); await sleep(500);
  const skipped = await p.evaluate(() => ({
    am: document.getElementById('am').value,
    toast: (document.querySelector('.toast') || {}).textContent || '',
    open: document.getElementById('dlg').open,
  }));
  ck('保存後、入力済みの10・9月を飛ばして8月へ [' + skipped.am + ']', skipped.open && skipped.am === '2026-08');
  ck('飛ばし保存のトーストは案内なし [' + skipped.toast + ']', /11月分を保存しました/.test(skipped.toast) && !/これより前はすべて入力済み/.test(skipped.toast));

  // 8月〜下限まで全部埋めてから8月を再保存相当：いったん全部埋めた状態で開いて保存
  await p.keyboard.press('Escape'); await sleep(200);
  const filled = {};
  // 2025-11 .. 2026-11 all filled except we'll save 2026-11 again... better: fill 2025-11..2026-10, open on 2026-11, save → stay with message
  for (let i = 0; i <= 12; i++) {
    const d = new Date(2026, 10 - i, 1); // month 10 = Nov 2026
    const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    if (ym < '2025-11') break;
    if (ym === '2026-11') continue; // leave Nov empty to save
    filled['card:c1:' + ym] = { amount: 1000 + i, at: ym + '-01' };
  }
  const stateFull = base({ actuals: filled });
  await p.evaluate((s) => localStorage.setItem('money-app-v1', JSON.stringify(s)), stateFull);
  await p.goto(URL, { waitUntil: 'networkidle0' }); await sleep(300);
  await p.click('[data-tab=pay]'); await sleep(250);
  await p.click('[data-act=actuals][data-kind=card][data-id=c1]'); await sleep(400);
  const beforeFull = await p.evaluate(() => document.getElementById('am').value);
  await p.type('#aa', '1600'); await p.click('#dlg [data-act=act-add]'); await sleep(500);
  const allFilled = await p.evaluate(() => ({
    am: document.getElementById('am').value,
    toast: (document.querySelector('.toast') || {}).textContent || '',
  }));
  ck('直前が全部入力済みなら保存月のまま [' + beforeFull + '→' + allFilled.am + ']', allFilled.am === beforeFull && beforeFull === '2026-11');
  ck('そのとき「これより前はすべて入力済みです」 [' + allFilled.toast + ']', /11月分を保存しました/.test(allFilled.toast) && /これより前はすべて入力済みです/.test(allFilled.toast));
  await p.keyboard.press('Escape'); await sleep(200);

  // --- 3) CSV 列割り当て: select 変更後もその select にフォーカス ---
  const path = require('path');
  const fs = require('fs');
  const csvPath = '/workspace/money-app/test/fixtures';
  const files = fs.existsSync(csvPath) ? fs.readdirSync(csvPath).filter((f) => f.endsWith('.csv')) : [];
  // synthesize a tiny CSV that needs mapping
  const tmpCsv = '/tmp/v6011-map.csv';
  fs.writeFileSync(tmpCsv, 'colA,colB,colC\n2026/10/01,店A,1000\n2026/10/02,店B,2000\n');
  await p.evaluate((s) => localStorage.setItem('money-app-v1', JSON.stringify(s)), base({}));
  await p.goto(URL, { waitUntil: 'networkidle0' }); await sleep(300);
  await p.click('[data-tab=pay]'); await sleep(200);
  await p.click('[data-act=csv-open]'); await sleep(300);
  // force map step via evaluate by feeding analyze-fail path: open file that has no recognizable headers
  const [chooser] = await Promise.all([
    p.waitForFileChooser({ timeout: 5000 }).catch(() => null),
    p.click('#dlg [data-act=csv-pick]'),
  ]);
  if (chooser) {
    await chooser.accept([tmpCsv]);
  } else {
    const input = await p.$('#csvfile');
    if (input) await input.uploadFile(tmpCsv);
  }
  await sleep(800);
  // If auto-ok went to preview, go to map via button; else already on map
  const onMap = await p.evaluate(() => !!document.getElementById('mDate'));
  if (!onMap) {
    const mapBtn = await p.$('#dlg [data-act=csv-map]');
    if (mapBtn) { await mapBtn.click(); await sleep(400); }
  }
  const hasMap = await p.evaluate(() => !!document.getElementById('mDate'));
  ck('CSV 列割り当て画面がある', hasMap);
  if (hasMap) {
    await p.focus('#mAmt'); await sleep(100);
    await p.select('#mAmt', '0'); await sleep(400);
    const afterSel = await p.evaluate(() => ({ id: document.activeElement && document.activeElement.id, tag: document.activeElement && document.activeElement.tagName, h2: document.activeElement && document.activeElement.tagName === 'H2' }));
    ck('select 変更後も #mAmt にフォーカス（見出しへ戻らない） ' + JSON.stringify(afterSel), afterSel.id === 'mAmt' && !afterSel.h2);
  }
  await p.keyboard.press('Escape'); await sleep(200);

  ck('キャッシュ名 v6011', require('fs').readFileSync(__dirname + '/../sw.js', 'utf8').includes("CACHE = 'money-app-v6011'"));
  ck('JSエラーなし', errs.length === 0); if (errs.length) console.log(errs);
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
