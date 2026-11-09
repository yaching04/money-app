// v6.0 のE2E：はじめに（オンボーディング）、変動の新規登録（前回の金額・まだ分からない・実績の記録・二重計上なし）、
// 実績の上書き確認、残高の下の枠（最大2行）、これからの引き落とし（3件）、土日祝のずれの表示、CSVの列の割り当てと合計表示。
// 日付は 2026-11-04 12:00 JST に固定。使い方: node test/e2e-v60.js [スクショ出力先]
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.argv[2] || '';
const FX = (f) => path.join(__dirname, 'fixtures', f);
let fails = 0; const ck = (n, c) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); };
const NOW = Date.parse('2026-11-04T12:00:00+09:00');
const A = (o) => Object.assign({ id: 'a1', name: 'テスト銀行', balance: 100000, asOf: '2026-11-04' }, o);
const P = (o) => Object.assign({ cardId: null, accountId: 'a1', memo: '', active: true, variable: false, fixDay: null, repeat: null, loan: null, createdAt: '2026-08-01' }, o);
const base = (o) => Object.assign({ version: 2, accounts: [A()], cards: [], payments: [], incomes: [], actuals: {}, imports: {}, settings: { targetDate: null, projAccount: 'all', viewMonth: null } }, o);
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
  const p = await b.newPage(); p.setDefaultNavigationTimeout(90000); const errs = [], natives = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', async (d) => { natives.push(d.type() + ':' + d.message()); await d.dismiss(); });
  await p.setBypassServiceWorker(true);
  await p.emulateTimezone('Asia/Tokyo');
  await p.evaluateOnNewDocument((now) => {
    const R = Date; const off = now - R.now();
    class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } }
    window.Date = D;
  }, NOW);
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const URL = 'http://127.0.0.1:8765/index.html';
  const go = () => p.goto(URL, { waitUntil: 'networkidle0' });
  const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('money-app-v1')));
  const load = async (s) => { await p.evaluate((s) => { localStorage.setItem('money-app-v1', JSON.stringify(s)); localStorage.setItem('money-app-hint-pay', '1'); }, s); await go(); };
  const shot = async (n, full) => { if (OUT) await p.screenshot({ path: OUT + '/v60-' + n + '.png', fullPage: !!full }); };
  const tab = async (t) => { await p.click('[data-tab=' + t + ']'); await sleep(300); };
  const txt = (sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; }, sel);
  const cnt = async (sel) => p.evaluate((s) => document.querySelectorAll(s).length, sel);
  const clickIn = async (sel) => { await p.waitForSelector(sel, { visible: true }); await p.click(sel); await sleep(300); };
  const cfm = () => p.evaluate(() => { const d = document.querySelector('dialog.cdlg[open]'); return d ? d.innerText.replace(/\s+/g, ' ').trim() : ''; });
  const okBtn = 'dialog.cdlg[open] [data-c="1"]', noBtn = 'dialog.cdlg[open] [data-c="0"]';
  const label = () => txt('#amtLabel');
  const pick = async (file) => { const [fc] = await Promise.all([p.waitForFileChooser({ timeout: 5000 }), p.click('#dlg [data-act=csv-pick]')]); await fc.accept([FX(file)]); await sleep(700); };

  await go(); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('money-app-hint-pay', '1'); }); await go();
  ck('時計の固定（2026-11-04）', (await p.evaluate(() => Logic.today())) === '2026-11-04');

  // D) はじめに
  ck('はじめに: 3つの手順', (await cnt('#onboard .onb-step')) === 3 && (await txt('#onboard h2')) === 'はじめに');
  ck('はじめに: 何も済んでいない・①が今', (await cnt('#onboard .onb-step.done')) === 0 && (await p.$eval('#onboard .onb-step.now', (e) => e.dataset.act)) === 'add-account');
  ck('はじめに: ①口座 ②カード ③支払い', /①.*口座.*②.*カード.*③.*支払い/.test(await txt('#onboard')));
  await clickIn('#onboard [data-act=add-account]');
  ck('①タップで口座の登録画面', (await txt('#dlg[open] h2')) === '口座を追加');
  await p.type('#name', 'テスト銀行'); await p.type('#balance', '100000'); await p.click('#dlg button[type=submit]'); await sleep(400);
  ck('口座の登録後: ①に✓・②が今', (await cnt('#onboard .onb-step.done')) === 1 && (await p.$eval('#onboard .onb-step.done', (e) => e.dataset.act)) === 'add-account' && (await p.$eval('#onboard .onb-step.done .n', (e) => e.textContent)) === '✓' && (await p.$eval('#onboard .onb-step.now', (e) => e.dataset.act)) === 'add-card');
  ck('はじめに: ホームのいちばん上', await p.evaluate(() => document.querySelector('#main').firstElementChild.id === 'onboard'));
  await shot('onboarding');
  await clickIn('#onboard [data-act=add-card]');
  ck('②タップでカードの登録画面', (await txt('#dlg[open] h2')) === 'カードを追加'); await p.click('#dlg [data-x=cancel]'); await sleep(300);

  // B) 新規の変動（口座直接）
  await clickIn('#onboard [data-act=add-pay]');
  ck('③タップで支払いの登録画面', (await txt('#dlg[open] h2')) === '支払いを追加');
  await p.type('#name', '電気代'); await p.click('#variable'); await sleep(100);
  await p.select('#day', '27'); await sleep(150);
  ck('変動: 「前回の引き落とし（10/27）の金額」 [' + await label() + ']', (await label()) === '前回の引き落とし（10/27）の金額');
  await p.select('#day', '25'); await sleep(150);
  ck('変動: 前回が日曜なら翌営業日（10/25→10/26） [' + await label() + ']', (await label()) === '前回の引き落とし（10/26）の金額');
  await p.select('#day', '3'); await sleep(150);
  ck('変動: 11/3 文化の日 → 11/4（今日）が前回 [' + await label() + ']', (await label()) === '前回の引き落とし（11/4）の金額');
  await p.select('#day', '25'); await sleep(150);
  ck('「まだ分からない」が出る', await p.$eval('#unkWrap', (e) => !e.hidden));
  await p.click('#unknown'); await sleep(100);
  ck('まだ分からない → 目安の金額', (await label()) === '目安の金額（先月の金額でOK・円）');
  await p.click('#unknown'); await sleep(100);
  ck('戻す → 前回の金額', (await label()).startsWith('前回の引き落とし'));
  await p.type('#amount', '8000');
  await shot('variable-form');
  await p.click('#dlg button[type=submit]'); await sleep(500);
  let s = await st(); const ep = s.payments.find((x) => x.name === '電気代');
  ck('保存: 目安の金額 8000', ep && ep.amount === 8000 && ep.variable === true);
  ck('保存: 10月分の実績 8000 を記録', ep && s.actuals['pay:' + ep.id + ':2026-10'] && s.actuals['pay:' + ep.id + ':2026-10'].amount === 8000);
  const pr = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('money-app-v1')); return Logic.project(s, '2026-11-30', 'all'); });
  ck('二重計上なし: 11/30 の見込み 92,000（10/26分は残高に反映済み） [' + pr.endBalance + ']', pr.endBalance === 92000);
  ck('支払い1件で はじめに は消える', (await cnt('#onboard')) === 0);
  ck('案内「過去の金額も入れると予測が正確になります」', (await txt('.pasthint')).includes('過去の金額も入れると予測が正確になります'));
  await clickIn('.pasthint [data-act=actuals]');
  ck('案内タップ → 実績の記録', await p.evaluate(() => document.querySelector('#dlg').open && /実績/.test(document.querySelector('#dlg h2').textContent)));

  // 実績の上書きは確認
  // v6.0.9: 月はステッパー。既定（次回の仮＝11月）から‹で10月へ
  await p.click('#dlg [data-act=am-prev]'); await sleep(150);
  ck('実績の月ステッパー: 10月分', await p.evaluate(() => document.querySelector('#am').value === '2026-10' && /10月分/.test(document.querySelector('#amLbl').textContent)));
  await p.type('#aa', '9000'); await p.click('#dlg [data-act=act-add]'); await sleep(300);
  ck('上書き: 確認が出る [' + await cfm() + ']', /上書き/.test(await cfm()) && /8,000/.test(await cfm()) && /9,000/.test(await cfm()));
  await p.click(noBtn); await sleep(300);
  s = await st(); ck('上書き: キャンセルなら変わらない', s.actuals['pay:' + ep.id + ':2026-10'].amount === 8000);
  await p.click('#dlg [data-act=act-add]'); await sleep(300); await p.click(okBtn); await sleep(300);
  s = await st(); ck('上書き: OKで置き換わる', s.actuals['pay:' + ep.id + ':2026-10'].amount === 9000);
  await p.keyboard.press('Escape'); await sleep(300);
  ck('案内は実績を開いたら消える', (await cnt('.pasthint')) === 0);

  // 収入
  await tab('acct'); await clickIn('[data-act=add-income]');
  await p.type('#name', '給与'); await p.click('#variable'); await p.select('#day', '25'); await sleep(150);
  ck('収入: 「前回の入金（10/26）の金額」 [' + await label() + ']', (await label()) === '前回の入金（10/26）の金額');
  await p.type('#amount', '250000'); await p.click('#dlg button[type=submit]'); await sleep(500);
  s = await st(); const inc = s.incomes.find((x) => x.name === '給与');
  ck('収入: 10月分の実績を記録', inc && s.actuals['inc:' + inc.id + ':2026-10'] && s.actuals['inc:' + inc.id + ':2026-10'].amount === 250000);
  ck('収入: 案内が収入の下に', (await cnt('.pasthint [data-id="' + inc.id + '"]')) === 1);

  // 編集は今まで通り（実績を書かない）
  await clickIn(`[data-act=edit-income][data-id="${inc.id}"]`);
  ck('編集: ラベルは目安のまま', (await label()) === '目安の金額（先月の金額でOK・円）' && (await cnt('#unknown')) === 0);
  await p.$eval('#amount', (e) => { e.value = ''; }); await p.type('#amount', '260000'); await p.click('#dlg button[type=submit]'); await sleep(400);
  s = await st(); ck('編集: 実績は変わらない', s.actuals['inc:' + inc.id + ':2026-10'].amount === 250000 && s.incomes[0].amount === 260000);

  // 二重計上：残高の日付が前回より前なら、その回は予測に入る（確定 7000）
  await load(base({ accounts: [A({ asOf: '2026-10-20' })] }));
  await clickIn('[data-act=add-pay]'); await p.type('#name', '水道'); await p.click('#variable'); await p.select('#day', '27'); await sleep(100);
  await p.type('#amount', '7000'); await p.click('#dlg button[type=submit]'); await sleep(500);
  const pr2 = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('money-app-v1')); return { e: Logic.project(s, '2026-11-30', 'all'), ev: Logic.genEvents(s, '2026-10-20', '2026-11-30').map((e) => e.date + ':' + e.amount + ':' + e.confirmed) }; });
  ck('残高日 10/20: 10/27 確定7000 + 11/27 仮7000 = 86,000 [' + pr2.ev.join(',') + ']', pr2.e.endBalance === 86000 && pr2.ev.join(',') === '2026-10-27:7000:true,2026-11-27:7000:false');

  // C) 残高の下の枠・これからの引き落とし・A) ずれの表示
  const seed = base({ accounts: [A({ balance: 200000 })], payments: [P({ id: 'p1', name: '家賃', amount: 50000, day: 23 }), P({ id: 'p2', name: '動画', amount: 1000, day: 10 }), P({ id: 'p3', name: '携帯', amount: 3000, day: 15 }), P({ id: 'p4', name: 'ジム', amount: 5000, day: 28 })] });
  await load(seed);
  ck('枠: 1行だけ（マイナスでない）', (await cnt('.hero .status > *')) === 1 && (await cnt('.hero .status > .nextst')) === 1);
  const n1 = await txt('.hero .nextst');
  ck('枠1行目: 次の引き落とし 11/10 動画 → 残り [' + n1 + ']', /^次の引き落とし/.test(n1) && n1.includes('11/10(火)') && n1.includes('動画') && n1.includes('→ 残り') && n1.includes('199,000'));
  ck('枠1行目: 2行（v6.0.4: 日付と名前／金額）', (await p.$eval('.hero .nextst', (e) => e.getBoundingClientRect().height)) <= 72);
  ck('見出し「これからの引き落とし」', await p.evaluate(() => [...document.querySelectorAll('#main h2')].some((h) => h.textContent.trim() === 'これからの引き落とし')));
  await p.evaluate(() => { const t = document.querySelector('#target'); t.value = Logic.today(); t.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(300);
  ck('指定日=今日でも3件出る', (await cnt('.hrow[data-ref]')) === 3 && (await txt('.hsub')).includes('より後'));
  await p.evaluate(() => { const t = document.querySelector('#target'); t.value = '2027-01-31'; t.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(300);
  ck('件数が多いときは3件＋すべて見る', (await cnt('.hrow[data-ref]')) === 3 && (await txt('[data-act=toggle-all]')).includes('すべて見る'));
  ck('祝日のずれの注記（11/23 勤労感謝の日 → 11/24） ', await p.evaluate(() => [...document.querySelectorAll('.hrow')].some((r) => r.dataset.date === '2026-11-24' && /※23日が祝日のため/.test(r.textContent))));
  ck('土日のずれの注記（2027/1/10 日曜 → 1/12？振替なし→1/11 成人の日 → 1/12）', await p.evaluate(() => { document.querySelector('[data-act=toggle-all]').click(); return [...document.querySelectorAll('.hrow')].some((r) => r.dataset.date === '2027-01-12' && /※10日が日曜のため/.test(r.textContent)); }));
  await tab('pay');
  ck('支払いタブ: 家賃に「次回 11/24(火)※23日が祝日のため」', (await txt('#main')).includes('次回 11/24(火)※23日が祝日のため'));
  await tab('home');
  // 2行目（マイナス）
  await load(Object.assign(seed, { accounts: [A({ balance: 30000 })] }));
  ck('枠: 2行（1行目=次の引き落とし・2行目=警告）', (await cnt('.hero .status > *')) === 2 && (await cnt('.hero .status > .nextst:first-child')) === 1 && (await cnt('.hero .status > .warnst:nth-child(2)')) === 1);
  const w = await txt('.hero .warnst');
  ck('枠2行目: ⚠・11/24・−¥24,000 [' + w + ']', w.includes('⚠') && w.includes('11/24(火)') && w.includes('−¥24,000'));
  ck('枠2行目: 薄い赤の背景・赤い文字', (await p.$eval('.warnst', (e) => getComputedStyle(e).backgroundColor + '|' + getComputedStyle(e).color)) === 'rgb(254, 242, 242)|rgb(220, 38, 38)');
  await shot('home');
  for (const wd of [320, 375, 390]) {
    await p.setViewport({ width: wd, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }); await sleep(250);
    const fit = await p.evaluate(() => { const l = document.querySelector('.hero .nextst'), r = l.querySelector('.st-r').getBoundingClientRect(), b = l.getBoundingClientRect(); return { ok: r.right <= b.right + 0.5 && r.left >= b.left && b.height <= 72, h: b.height }; });
    ck(wd + 'px: 「→ 残り」まで見える（v6.0.4: いつも2行） [' + fit.h + ']', fit.ok);
  }
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }); await sleep(200);
  // 設定でずらさない
  await tab('data'); await p.click('#holidayShift'); await sleep(300);
  ck('設定: ずらさない を保存', (await st()).settings.holidayShift === false);
  await tab('home');
  ck('ずらさないなら 11/23 のまま', (await txt('.hero .warnst')).includes('11/23(月)'));
  await tab('data'); await p.click('#holidayShift'); await sleep(300); await tab('home');

  // E) CSV
  await load(base({ cards: [{ id: 'c1', name: 'テストカード', fixDay: 10, withdrawDay: 27, accountId: 'a1', variable: true, createdAt: '2026-08-01' }] }));
  await tab('pay'); await clickIn('[data-act=csv-open]');
  ck('手順の表示 1', (await txt('#dlg .csv-step')) === '1 ファイル選択・2 中身の確認・3 登録する内容' && (await txt('#dlg .csv-step b')) === '1 ファイル選択');
  await pick('rakuten-like.csv');
  const sum2 = await txt('#dlg .csv-sum p');
  ck('手順2の合計 [' + sum2 + ']', sum2 === '7件・合計 −¥23,990（返金1件を含む）' && (await txt('#dlg .csv-step b')) === '2 中身の確認');
  await clickIn('#dlg [data-act=csv-next]');
  const sum3 = await txt('#dlg .csv-sum p');
  ck('手順3も同じ形 [' + sum3 + ']', sum3 === '7件・合計 −¥23,990（返金1件を含む）' && (await txt('#dlg .csv-step b')) === '3 登録する内容');
  await clickIn('#dlg [data-act=csv-back]');
  await clickIn('#dlg [data-act=csv-map]');
  const o1 = await p.$eval('#mDate option', (e) => e.textContent);
  ck('割り当て: 選択肢に例「列1：2026/10/02」 [' + o1 + ']', o1 === '列1：2026/10/02');
  const sts = await p.$$eval('#dlg .csv-colst', (a) => a.map((e) => e.textContent));
  ck('割り当て: 各列の下に状態 [' + sts.join('|') + ']', sts.length === 3 && sts[0] === '✓ 日付として読めます' && sts[2] === '✓ 金額として読めます');
  ck('割り当て: 進めるときは理由なし', (await cnt('#dlg .csv-why')) === 0);
  await shot('csv-mapping');
  await p.select('#mAmt', '1'); await sleep(250);
  ck('割り当て: 金額の列が読めない → ✕', (await p.$$eval('#dlg .csv-colst', (a) => a.map((e) => e.textContent)))[2] === '✕ 金額として読めません');
  ck('割り当て: ボタン無効＋理由1行', await p.$eval('#dlg [data-act=csv-map-ok]', (e) => e.disabled) && (await txt('#dlg .csv-why')) === '金額の列を選び直してください');
  await p.select('#mAmt', '4'); await p.select('#mDate', '1'); await sleep(250);
  ck('割り当て: 日付も読めない → 理由は日付', (await txt('#dlg .csv-why')) === '日付の列を選び直してください');
  await shot('csv-mapping-ng');
  await p.keyboard.press('Escape'); await sleep(300);

  ck('ネイティブ confirm/prompt/alert は0回', natives.length === 0);
  ck('コンソールエラーなし ' + JSON.stringify(errs), errs.length === 0);
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL OK'); process.exit(fails ? 1 : 0);
})();
