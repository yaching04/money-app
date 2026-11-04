// v5.8 のE2E：明細CSVの読み込み（カード選択 → 確認 → 確定額・毎月の支払いの登録）、二重取り込みなし、Shift_JIS、列の割り当て
// 使い方: (cd money-app && python3 -m http.server 8765 --bind 127.0.0.1 &) && node test/e2e-v58.js [スクショ出力先]
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.argv[2] || '';
const FX = (f) => path.join(__dirname, 'fixtures', f);
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
  const shot = async (n) => { if (OUT) await p.screenshot({ path: OUT + '/v58-' + n + '.png' }); };
  const tab = async (t) => { await p.click('[data-tab=' + t + ']'); await sleep(250); };
  const txt = (sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
  const cnt = async (sel) => p.evaluate((s) => document.querySelectorAll(s).length, sel);
  const clickIn = async (sel) => { await p.waitForSelector(sel, { visible: true }); await p.click(sel); await sleep(300); };
  const okBtn = 'dialog.cdlg[open] [data-c="1"]', noBtn = 'dialog.cdlg[open] [data-c="0"]';
  const pick = async (file) => { const [fc] = await Promise.all([p.waitForFileChooser({ timeout: 5000 }), p.click('#dlg [data-act=csv-pick]')]); await fc.accept([FX(file)]); await sleep(600); };
  const step = () => p.evaluate(() => { const h = document.querySelector('#dlg[open] h2'); return h ? h.textContent : null; });
  await go(); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('money-app-hint-pay', '1'); }); await go();
  await p.click('[data-act=sample]'); await sleep(2700);
  const s0 = await st();
  const cardA = s0.cards.find((c) => c.name.includes('Aカード')), cardB = s0.cards.find((c) => c.name.includes('Bカード'));
  const nPay0 = s0.payments.length;

  // 1) 支払いタブのボタン → カード選択 → ファイル
  await tab('pay');
  ck('支払いタブに「明細CSVを読み込む」', (await txt('[data-act=csv-open]')) === '明細CSVを読み込む');
  await clickIn('[data-act=csv-open]');
  ck('ステップ1: カードとファイル', (await step()) === '明細CSVを読み込む' && (await cnt('#csvCard option')) === 2);
  await p.select('#csvCard', cardA.id);
  ck('iPhoneでの用意のしかた（折りたたみ）', (await cnt('#dlg details.csv-help')) === 1);
  await pick('rakuten-like.csv');
  ck('ステップ2: 明細の確認', (await step()) === '明細の確認');
  ck('7件を一覧', (await cnt('#dlg .csv-rows .row')) === 7);
  const sum = await txt('#dlg .csv-sum');
  ck('合計 ¥23,990（返金1件を含む） ' + sum, sum.includes('−¥23,990') && sum.includes('返金1件') && sum.includes('7件'));
  const guess = await p.evaluate((id) => CsvImport.guessBillMonth(JSON.parse(localStorage.getItem('money-app-v1')).cards.find((c) => c.id === id), [{ date: '2026-10-31' }], Logic.today()), cardA.id);
  ck('請求月の推定が選ばれている ' + guess, (await p.$eval('#csvMonth', (e) => e.value)) === guess && (await txt('#csvMonth option:checked')).includes('推定'));
  ck('支出は赤い −¥、返金は緑の +¥', await p.evaluate(() => { const r = [...document.querySelectorAll('#dlg .csv-rows .row')]; const neg = r[0].querySelector('.neg-t'), pos = r.find((x) => x.textContent.includes('+¥500')); return !!neg && neg.textContent.startsWith('−¥') && !!pos && !!pos.querySelector('.pos-t'); }));
  ck('列の割り当てを変更できる', (await cnt('#dlg [data-act=csv-map]')) === 1);
  await p.evaluate(() => { const s = document.querySelector('#dlg .sheet'); s.scrollTop = 0; });
  await shot('1-import-preview');

  // 2) 登録する内容
  await clickIn('#dlg [data-act=csv-next]');
  ck('ステップ3: 登録する内容', (await step()) === '登録する内容');
  ck('確定額にする: チェック済み・合計と月', await p.$eval('#caActual', (e) => e.checked) && (await txt('#dlg .csv-act')).includes('¥23,990'));
  const cmp = await txt('#dlg .csv-act .cmp');
  ck('先月との比較 ' + cmp, !!cmp && cmp.includes('先月'));
  const sg = await p.evaluate(() => [...document.querySelectorAll('#dlg .caSug')].map((x) => ({ name: x.closest('.csv-act').querySelector('b').textContent, on: x.checked })));
  ck('候補: Netflix（チェック）・電気代（チェックなし） ' + JSON.stringify(sg), sg.length === 2 && sg[0].name === 'Netflix' && sg[0].on && sg[1].name === '電気代' && !sg[1].on);
  await shot('2-import-actions');
  await clickIn('#dlg [data-act=csv-apply]');
  ck('閉じる・確認なし（新しい確定額）', !(await p.$eval('#dlg', (e) => e.open)) && (await cnt('dialog.cdlg[open]')) === 0);
  const s1 = await st();
  ck('確定額 = ¥23,990', s1.actuals['card:' + cardA.id + ':' + guess] && s1.actuals['card:' + cardA.id + ':' + guess].amount === 23990);
  const nf = s1.payments.filter((x) => x.name === 'Netflix');
  ck('毎月の支払い「Netflix」を登録（Aカード・毎月）', nf.length === 1 && nf[0].cardId === cardA.id && nf[0].amount === 1490 && !nf[0].repeat && !nf[0].loan && s1.payments.length === nPay0 + 1);
  ck('電気代は登録しない（チェックなし）', !s1.payments.some((x) => x.name === '電気代' && x.cardId === cardA.id));
  ck('明細を保存（7行）', s1.imports[cardA.id][guess].rows.length === 7);
  ck('支払いタブに Netflix が出る', (await txt('#main')).includes('Netflix'));

  // 3) 同じファイルをもう一度 → 増えない・候補は登録済みで出ない
  await clickIn('[data-act=csv-open]');
  await p.select('#csvCard', cardA.id);
  await pick('rakuten-like.csv');
  await clickIn('#dlg [data-act=csv-next]');
  ck('2回目: Netflix は候補に出ない', !(await p.evaluate(() => [...document.querySelectorAll('#dlg .caSug')].some((x) => x.closest('.csv-act').textContent.includes('Netflix')))));
  ck('2回目: 合計は同じ ¥23,990', (await txt('#dlg .csv-act')).includes('¥23,990'));
  await clickIn('#dlg [data-act=csv-apply]');
  ck('2回目: 確認なし（金額が同じ）', (await cnt('dialog.cdlg[open]')) === 0);
  const s2 = await st();
  ck('2回目: 明細も確定額も支払いも増えない', s2.imports[cardA.id][guess].rows.length === 7 && s2.actuals['card:' + cardA.id + ':' + guess].amount === 23990 && s2.payments.length === s1.payments.length);

  // 4) 別の明細を同じ月に足す → 確定額の置き換えは askConfirm（キャンセル → OK）
  await clickIn('[data-act=csv-open]');
  await p.select('#csvCard', cardA.id);
  await pick('jcb-like.csv');
  await p.select('#csvMonth', guess); await sleep(200);
  await clickIn('#dlg [data-act=csv-next]');
  ck('足した後の合計 ¥33,920', (await txt('#dlg .csv-act')).includes('¥33,920'));
  await clickIn('#dlg [data-act=csv-apply]');
  ck('置き換えの確認（アプリ内）', (await cnt('dialog.cdlg[open]')) === 1 && (await txt('dialog.cdlg[open] h2')) === '確定額を置き換えますか？');
  await clickIn(noBtn);
  ck('キャンセル → 変わらない・画面はそのまま', (await st()).actuals['card:' + cardA.id + ':' + guess].amount === 23990 && (await step()) === '登録する内容');
  await clickIn('#dlg [data-act=csv-apply]'); await clickIn(okBtn);
  const s3 = await st();
  ck('OK → 確定額 ¥33,920・明細 11行・Disney+ を登録', s3.actuals['card:' + cardA.id + ':' + guess].amount === 33920 && s3.imports[cardA.id][guess].rows.length === 11 && s3.payments.some((x) => x.name === 'Disney+' && x.cardId === cardA.id));

  // 5) カードの編集画面から（Shift_JIS・見出しなし）
  await tab('acct');
  await clickIn(`.l[data-act=edit-card][data-id="${cardB.id}"]`);
  await clickIn('#dlg [data-act=csv-open]');
  ck('カードから開くとそのカードが選ばれている', (await p.$eval('#csvCard', (e) => e.value)) === cardB.id);
  await pick('vpass-like-sjis.csv');
  ck('Shift_JIS を読める（5件・¥13,262）', (await txt('#dlg .hint')).includes('Shift_JIS') && (await cnt('#dlg .csv-rows .row')) === 5 && (await txt('#dlg .csv-sum')).includes('¥13,262'));
  ck('全角の店名もそのまま', (await txt('#dlg .csv-rows')).includes('テスト食堂'));
  await clickIn('#dlg [data-act=csv-back]');
  ck('戻る → ステップ1', (await step()) === '明細CSVを読み込む');
  await clickIn('#dlg [data-act=close-dlg]');

  // 6) 判定できない → 列の割り当て
  await tab('pay');
  await clickIn('[data-act=csv-open]');
  await pick('unknown.csv');
  ck('列の割り当ての画面', (await step()) === '列の割り当て' && (await cnt('#mDate')) === 1 && (await cnt('#mMer')) === 1 && (await cnt('#mAmt')) === 1);
  ck('読めない割り当てでは進めない', await p.$eval('#dlg [data-act=csv-map-ok]', (e) => e.disabled));
  await clickIn('#dlg [data-act=csv-back]'); await clickIn('#dlg [data-act=close-dlg]');

  // 7) 列の割り当てを手で直す（汎用の形式で、わざと金額の列を変えてから戻す）
  await clickIn('[data-act=csv-open]');
  await p.select('#csvCard', cardB.id);
  await pick('generic-yy.csv');
  await clickIn('#dlg [data-act=csv-map]');
  await p.select('#mAmt', '1'); await sleep(200);
  ck('割り当ての変更でプレビューが変わる（読めない）', await p.$eval('#dlg [data-act=csv-map-ok]', (e) => e.disabled));
  await p.select('#mAmt', '2'); await sleep(200);
  ck('1件目のプレビュー', (await txt('#dlg .csv-prev')).includes('テスト水道局'));
  await clickIn('#dlg [data-act=csv-map-ok]');
  ck('割り当て → 確認へ（4件）', (await step()) === '明細の確認' && (await cnt('#dlg .csv-rows .row')) === 4);
  await clickIn('#dlg [data-act=csv-back]'); await clickIn('#dlg [data-act=close-dlg]');
  ck('閉じると何も保存しない', !((await st()).imports[cardB.id]));

  // 8) 集計タブの店別・設定のバックアップ
  await tab('sum');
  const sumTxt = await txt('#main');
  ck('集計: 明細（CSV）の店別 ' + (sumTxt.includes('明細（CSV）の店別') ? '' : '(この月の表示に無い)'), sumTxt.includes('明細（CSV）の店別') || guess !== (await p.evaluate(() => Logic.monthKey(Logic.today()))));
  await tab('data');
  ck('設定: 明細の件数を表示', (await txt('#main')).includes('明細'));
  const vb = await p.evaluate(() => Logic.validateBackup(JSON.parse(localStorage.getItem('money-app-v1'))));
  ck('バックアップの検査に imports', vb.ok && vb.counts.imports >= 1);
  await go(); await sleep(300);
  ck('再読み込み後も明細が残る', (await st()).imports[cardA.id][guess].rows.length === 11);

  ck('ネイティブのダイアログなし ' + natives.join('|'), natives.length === 0);
  ck('コンソールエラーなし ' + errs.join('|'), errs.length === 0);
  await b.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
