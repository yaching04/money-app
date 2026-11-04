// 明細CSV読み込み（3ステップ）の崩れたCSVのE2E（headless Chrome / puppeteer-core）。日付は 2026-11-04 12:00 JST に固定。
// fixtures/qa-*.csv を使う。5MB超のファイルは実行時に一時フォルダへ作る。FAIL = 現状のバグ／分かりにくさ（QA報告参照）。
// 使い方: (cd money-app && python3 -m http.server 8765 --bind 127.0.0.1 &) && node test/e2e-qa-csv.js [スクショ出力先]
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const fs = require('fs'); const os = require('os'); const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.argv[2] || '';
const FX = (f) => path.join(__dirname, 'fixtures', f);
let fails = 0; const ck = (n, c) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); };
const NOW = Date.parse('2026-11-04T12:00:00+09:00');
const seed = { version: 2, accounts: [{ id: 'a1', name: '銀行', balance: 200000, asOf: '2026-11-04' }], cards: [{ id: 'c1', name: 'テストカード', fixDay: 12, withdrawDay: 27, accountId: 'a1', variable: true, createdAt: '2026-08-01' }],
  payments: [], incomes: [], actuals: {}, imports: {}, settings: { targetDate: null, projAccount: 'all', viewMonth: null } };
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
  const txt = (sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : ''; }, sel);
  const all = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.innerText.replace(/\s+/g, ' ').trim()), sel);
  const head = () => txt('#dlg[open] h2');
  const cfm = () => p.evaluate(() => { const d = document.querySelector('dialog.cdlg[open]'); return d ? d.innerText.replace(/\s+/g, ' ').trim() : ''; });
  const shot = async (n) => { if (OUT) await p.screenshot({ path: OUT + '/qacsv-' + n + '.png' }); };
  const openCsv = async (file, keep) => {
    if (!keep) { await p.evaluate((s) => { localStorage.setItem('money-app-v1', JSON.stringify(s)); localStorage.setItem('money-app-hint-pay', '1'); }, seed); await go(); }
    await p.click('[data-tab=pay]'); await sleep(300);
    await p.click('[data-act=csv-open]'); await sleep(300);
    const [fc] = await Promise.all([p.waitForFileChooser({ timeout: 5000 }), p.click('#dlg [data-act=csv-pick]')]);
    await fc.accept([file]); await sleep(800);
    return { h: await head(), err: await cfm(), sum: await txt('#dlg .csv-sum'), rows: await all('#dlg .csv-rows .row'), month: await txt('#csvMonth option:checked'), sheet: await txt('#dlg .sheet') };
  };
  const closeAll = async () => { if (await cfm()) { await p.click('dialog.cdlg[open] [data-c="1"]'); await sleep(300); } await p.keyboard.press('Escape'); await sleep(300); };
  await go();

  let r = await openCsv(FX('qa-empty.csv')); await shot('empty');
  ck('空ファイル: 「中身が見つかりませんでした」を表示', /中身が見つかりませんでした/.test(r.err)); await closeAll();

  const big = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-csv-')), 'over5mb.csv');
  { let s = '利用日,利用店名,利用金額\n', i = 0; while (s.length < 5.5 * 1024 * 1024) { s += '2026/10/' + String(i % 28 + 1).padStart(2, '0') + ',店' + i + ',' + (100 + i % 900) + '\n'; i++; } fs.writeFileSync(big, s); }
  r = await openCsv(big); ck('5MB超: 「大きすぎます」を表示', /大きすぎます/.test(r.err)); await closeAll();

  r = await openCsv(FX('qa-bom-crlf.csv')); ck('BOM付き・CRLF: 2件読める [' + r.sum + ']', r.h === '明細の確認' && r.rows.length === 2 && !/\uFEFF/.test(r.sheet)); await closeAll();
  r = await openCsv(FX('qa-sjis.csv')); ck('Shift_JIS: 文字化けせず2件・（Shift_JIS）表示', r.rows.length === 2 && /テスト店舗/.test(r.rows[0]) && /Shift_JIS/.test(r.sheet)); await closeAll();
  r = await openCsv(FX('qa-ragged.csv')); ck('列数が不揃い: 正しい3行だけ読む [' + r.sum + ']', r.rows.length === 3); await closeAll();
  r = await openCsv(FX('qa-with-total.csv')); ck('「合計」行は明細に含めない', r.rows.length === 1); await closeAll();

  r = await openCsv(FX('qa-amounts.csv')); await shot('amounts');
  const row = (name) => r.rows.find((x) => x.startsWith(name)) || '';
  ck('金額: "1,234"（引用符つきカンマ）→ −¥1,234', /−¥1,234$/.test(row('カンマ引用')));
  ck('金額: ¥2,500 / 1000円 / 全角１，２３４ を読める', /¥2,500$/.test(row('円記号カンマ')) && /¥1,000$/.test(row('円付き')) && /¥1,234$/.test(row('全角')));
  ck('金額: −500・▲300・(200) は返金(+)', /\+¥500$/.test(row('マイナス')) && /\+¥300$/.test(row('三角')) && /\+¥200$/.test(row('括弧')));
  ck('金額【C1】: 引用符なしの 1,234 を黙って ¥1 にしない [' + row('引用なしカンマ') + ']', !/¥1$/.test(row('引用なしカンマ')));
  ck('金額【C3】: 読み取れなかった行（空欄・abc）があることを知らせる', /読み取れ|読めな|除外|スキップ/.test(r.sheet)); await closeAll();

  r = await openCsv(FX('qa-dates-mixed.csv')); await shot('dates');
  ck('日付: 2026/10/1・2026-10-02・2026.10.03・26/10/04・2026年10月5日・20261006・時刻付き を読める', ['スラッシュ1桁', 'ハイフン', 'ドット', '2桁年', '漢字', '8桁', '時刻付き'].every((n) => r.rows.some((x) => x.startsWith(n))));
  ck('日付: 2026/10/32・2026/02/29・13月 は明細にしない', !r.rows.some((x) => /存在しない日|非うるう年|13月/.test(x)));
  ck('日付【C2】: 1行だけ離れた日付(2028/2/29)があっても請求月を2028年にしない [' + r.month + ']', !/2028年/.test(r.month));
  ck('日付【C3】: 読み取れなかった行（年なし・英語表記など5行）があることを知らせる', /読み取れ|読めな|除外|スキップ/.test(r.sheet)); await closeAll();

  r = await openCsv(FX('qa-header-only.csv')); await shot('header-only');
  ck('見出しだけ【C4】: 「明細が0件」と分かる案内（列の割り当てに進ませない） [' + r.h + ']', r.h !== '列の割り当て' && /明細|0件|見つかりません/.test(r.err + r.sheet)); await closeAll();

  r = await openCsv(FX('qa-badquote.csv')); await shot('badquote');
  ck('閉じていない引用符【C5】: 残りの行(店B・店C)が読める、または原因を案内 [' + r.h + ']', r.rows.length >= 2 || /引用符|"/.test(r.err + r.sheet)); await closeAll();

  r = await openCsv(FX('qa-all-refund.csv'));
  const prevSum = r.sum; await p.click('#dlg [data-act=csv-next]'); await sleep(300); const s3 = await txt('#dlg .sheet'); await shot('all-refund-step3');
  ck('返金だけ【C6】: 確認画面で +¥4,000 と出たのに次で「合計がマイナス」と言わない [' + prevSum + ']', !(/\+¥4,000/.test(prevSum) && /合計がマイナス/.test(s3)));
  ck('返金だけ: 確定額のチェックは無効', await p.evaluate(() => { const c = document.querySelector('#caActual'); return !!c && c.disabled && !c.checked; }));
  await closeAll();

  // 同じファイルを2回 → 2回目は重複として0件
  await openCsv(FX('rakuten-like.csv')); await p.click('#dlg [data-act=csv-next]'); await sleep(300); await p.click('#caApply'); await sleep(500); if (await cfm()) await closeAll();
  await openCsv(FX('rakuten-like.csv'), true); await p.click('#dlg [data-act=csv-next]'); await sleep(300); await p.click('#caApply'); await sleep(400);
  const t2 = await txt('#toast'); ck('同じCSVを2回: 重複は保存しない [' + t2 + ']', /明細0件/.test(t2) && /重複7件/.test(t2));
  const imp = await p.evaluate(() => JSON.parse(localStorage.getItem('money-app-v1')).imports);
  const nrows = Object.values(imp.c1 || {}).reduce((n, m) => n + (m.rows || []).length, 0);
  ck('同じCSVを2回: 保存された明細は7件のまま [' + nrows + ']', nrows === 7);

  ck('ネイティブ confirm/prompt/alert は0回', natives.length === 0);
  ck('コンソールエラーなし ' + JSON.stringify(errs.slice(0, 2)), errs.length === 0);
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL OK'); process.exit(fails ? 1 : 0);
})();
