// v5.8 明細CSVの読み込み（ロジック）のテスト。フィクスチャはすべて架空のデータ
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const L = require('../logic.js');
const C = require('../csvimport.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const fx = (f) => C.decodeBytes(new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', f))));
const load = (f) => C.analyze(fx(f).text);

/* ---------- 文字コード・CSV ---------- */
t('decodeBytes: UTF-8 BOM を外す / Shift_JIS にフォールバック', () => {
  const a = fx('rakuten-like.csv');
  assert.strictEqual(a.encoding, 'utf-8');
  assert.ok(a.text.startsWith('"利用日"'));
  const b = fx('vpass-like-sjis.csv');
  assert.strictEqual(b.encoding, 'shift_jis');
  assert.ok(b.text.includes('テスト食堂'));
  assert.ok(b.text.includes('ｓｐｏｔｉｆｙ'));
});
t('parseCsv: 引用符・引用符内のカンマ・"" ・CRLF・空行', () => {
  const rows = C.parseCsv('a,"b,c","d ""e"""\r\n\r\n1,2,3\r\n"改\n行",x,\n');
  assert.deepStrictEqual(rows, [['a', 'b,c', 'd "e"'], ['1', '2', '3'], ['改\n行', 'x', '']]);
});
t('parseCsv: タブ区切り', () => {
  assert.deepStrictEqual(C.parseCsv('日付\t内容\t金額\n2026/10/01\tテスト\t100'), [['日付', '内容', '金額'], ['2026/10/01', 'テスト', '100']]);
});

/* ---------- 日付・金額 ---------- */
t('parseDate: いろいろな書き方', () => {
  assert.strictEqual(C.parseDate('2026/10/03'), '2026-10-03');
  assert.strictEqual(C.parseDate('2026-1-5'), '2026-01-05');
  assert.strictEqual(C.parseDate('26/10/03'), '2026-10-03');
  assert.strictEqual(C.parseDate('2026年10月3日'), '2026-10-03');
  assert.strictEqual(C.parseDate('２０２６／１０／０３'), '2026-10-03');
  assert.strictEqual(C.parseDate('20261003'), '2026-10-03');
  assert.strictEqual(C.parseDate('2026/02/30'), null);
  assert.strictEqual(C.parseDate('ご利用日'), null);
  assert.strictEqual(C.parseDate('1490'), null);
});
t('parseAmount: ¥・カンマ・全角・マイナス', () => {
  assert.strictEqual(C.parseAmount('1,490'), 1490);
  assert.strictEqual(C.parseAmount('￥2,480'), 2480);
  assert.strictEqual(C.parseAmount('¥1,000円'), 1000);
  assert.strictEqual(C.parseAmount('３，２１０'), 3210);
  assert.strictEqual(C.parseAmount('-500'), -500);
  assert.strictEqual(C.parseAmount('△300'), -300);
  assert.strictEqual(C.parseAmount('▲300'), -300);
  assert.strictEqual(C.parseAmount('(1,000)'), -1000);
  assert.strictEqual(C.parseAmount('500-'), -500);
  assert.strictEqual(C.parseAmount('−700'), -700);
  assert.strictEqual(C.parseAmount(''), null);
  assert.strictEqual(C.parseAmount('テスト'), null);
});

/* ---------- 列の判定 ---------- */
t('楽天カード風: 見出しから。今月の支払金額の列を使う・注記行は除く・返金はマイナス', () => {
  const a = load('rakuten-like.csv');
  assert.strictEqual(a.map.method, 'header');
  assert.strictEqual(a.map.headers[a.map.date], '利用日');
  assert.strictEqual(a.map.headers[a.map.merchant], '利用店名・商品名');
  assert.strictEqual(a.map.headers[a.map.amount], '11月支払金額');
  assert.strictEqual(a.rows.length, 7);
  assert.strictEqual(a.rows[2].merchant, 'サンプル書店, 架空駅前店');
  assert.strictEqual(a.rows[5].amount, -500);
  assert.strictEqual(a.rows[6].amount, 10200);         // 分割は今回の支払分
  assert.strictEqual(a.total, 23990);
});
t('Vpass風（Shift_JIS・見出しなし）: 中身から推定。会員情報と合計の行は除く', () => {
  const a = load('vpass-like-sjis.csv');
  assert.strictEqual(a.map.method, 'data');
  assert.strictEqual(a.map.date, 0); assert.strictEqual(a.map.merchant, 1); assert.strictEqual(a.map.amount, 5);
  assert.strictEqual(a.rows.length, 5);
  assert.strictEqual(a.rows[4].amount, 10000);
  assert.strictEqual(a.total, 13262);
});
t('JCB風: 前置きの行のあとの見出し。お支払い金額・￥とカンマ・合計の行は除く', () => {
  const a = load('jcb-like.csv');
  assert.strictEqual(a.map.header, 3);
  assert.strictEqual(a.map.headers[a.map.merchant], 'ご利用先など');
  assert.strictEqual(a.map.headers[a.map.amount], 'お支払い金額(￥)');
  assert.strictEqual(a.rows.length, 4);
  assert.strictEqual(a.rows[2].merchant, '架空ガス, テスト支店');
  assert.strictEqual(a.total, 9930);
});
t('エポス風: 年月日・ご利用場所', () => {
  const a = load('epos-like.csv');
  assert.strictEqual(a.map.headers[a.map.date], 'ご利用年月日');
  assert.strictEqual(a.map.headers[a.map.merchant], 'ご利用場所');
  assert.deepStrictEqual(a.rows.map((r) => r.date), ['2026-10-03', '2026-10-11', '2026-10-21']);
  assert.strictEqual(a.total, 7630);
});
t('汎用（日付,摘要,金額）: YY/MM/DD・全角数字・△・小計の行は除く', () => {
  const a = load('generic-yy.csv');
  assert.deepStrictEqual(a.rows.map((r) => r.amount), [3210, -500, -300, 2189]);
  assert.strictEqual(a.rows[0].date, '2026-10-01');
});
t('判定できないときは ok=false → 手動の割り当てで読める', () => {
  const a = load('unknown.csv');
  assert.strictEqual(a.ok, false);
  const b = C.analyze('説明,X,Y\nテスト,2026/10/01,100\nダミー,2026/10/02,"1,200"\n', { header: 0, date: 1, merchant: 0, amount: 2 });
  assert.strictEqual(b.ok, true);
  assert.strictEqual(b.total, 1300);
  assert.strictEqual(b.map.method, 'manual');
});
t('matchHead: 除外する見出し（手数料・支払総額・残高）', () => {
  assert.ok(C.matchHead('amount', '利用金額') >= 0);
  assert.ok(C.matchHead('amount', '今回ご請求額') >= 0);
  assert.ok(C.matchHead('amount', '支払手数料') < 0);
  assert.ok(C.matchHead('amount', '支払総額') < 0);
  assert.ok(C.matchHead('amount', '12月繰越残高') < 0);
  assert.ok(C.matchHead('date', 'ご利用日') >= 0);
  assert.ok(C.matchHead('merchant', 'ご利用店名・商品名') >= 0);
  assert.ok(C.matchHead('merchant', '摘要') >= 0);
});

/* ---------- 請求月 ---------- */
const card = { id: 'c1', name: 'Aカード', withdrawDay: 27, fixDay: 15, accountId: 'a1' };
t('guessBillMonth: 最後の利用日の後に確定する最初の引き落とし', () => {
  assert.strictEqual(C.guessBillMonth(card, [{ date: '2026-10-14' }], '2026-11-04'), '2026-10');
  assert.strictEqual(C.guessBillMonth(card, [{ date: '2026-10-02' }, { date: '2026-10-31' }], '2026-11-04'), '2026-11');
  assert.strictEqual(C.guessBillMonth(card, [{ date: '2026-12-20' }], '2026-11-04'), '2027-01');   // 年またぎ
  const noFix = { id: 'c2', withdrawDay: 10, fixDay: null };                                         // 確定日なし=引き落とし日
  assert.strictEqual(C.guessBillMonth(noFix, [{ date: '2026-10-14' }], '2026-11-04'), '2026-11');
});
t('guessBillMonth: 明細に日付が無ければ今日から（確定済みで未引き落とし → 次）', () => {
  assert.strictEqual(C.guessBillMonth(card, [], '2026-11-04'), '2026-11');
  assert.strictEqual(C.guessBillMonth(card, [], '2026-11-20'), '2026-11');
  assert.strictEqual(C.guessBillMonth(card, [], '2026-11-28'), '2026-12');
});
t('billMonthOptions: 推定月の前後', () => {
  assert.deepStrictEqual(C.billMonthOptions('2026-01', 2, 1), ['2025-11', '2025-12', '2026-01', '2026-02']);
});

/* ---------- 取り込み（何度やっても同じ） ---------- */
t('mergeImport: 同じ明細を2回読み込んでも増えない・同じ日同じ店の2件は残る', () => {
  const s = { cards: [card], imports: {} };
  const rows = load('rakuten-like.csv').rows;
  const r1 = C.mergeImport(s, 'c1', '2026-11', rows, '2026-11-04T00:00:00Z');
  assert.deepStrictEqual([r1.added, r1.dup, r1.count, r1.total], [7, 0, 7, 23990]);
  const r2 = C.mergeImport(s, 'c1', '2026-11', rows, '2026-11-04T00:00:01Z');
  assert.deepStrictEqual([r2.added, r2.dup, r2.count, r2.total], [0, 7, 7, 23990]);
  // 一部が重なる（速報 → 確定）: 新しい行だけ増える
  const more = rows.concat([{ date: '2026-11-01', merchant: 'テスト追加店', amount: 100 }]);
  const r3 = C.mergeImport(s, 'c1', '2026-11', more);
  assert.deepStrictEqual([r3.added, r3.count, r3.total], [1, 8, 24090]);
  // 同じ日・同じ店・同じ金額の2件
  const twice = [{ date: '2026-10-01', merchant: 'テスト自販機', amount: 150 }, { date: '2026-10-01', merchant: 'テスト自販機', amount: 150 }];
  assert.strictEqual(C.mergeImport(s, 'c1', '2026-10', twice).count, 2);
  assert.strictEqual(C.mergeImport(s, 'c1', '2026-10', twice).count, 2);
  assert.strictEqual(C.mergeImport(s, 'c1', '2026-10', twice.slice(0, 1)).count, 2);
  // 表記ゆれ（全角・空白）も同じ行
  assert.strictEqual(C.mergeImport(s, 'c1', '2026-10', [{ date: '2026-10-01', merchant: 'テスト 自販機', amount: 150 }]).added, 0);
  assert.ok(Array.isArray(s.imports.c1['2026-11'].rows[0]) && s.imports.c1['2026-11'].rows[0].length === 3);
});
t('previewMerge は state を変えない / merchantTotals / cleanImports', () => {
  const s = { cards: [card], imports: {} };
  const rows = load('rakuten-like.csv').rows;
  assert.strictEqual(C.previewMerge(s, 'c1', '2026-11', rows).total, 23990);
  assert.deepStrictEqual(s.imports, {});
  C.mergeImport(s, 'c1', '2026-11', rows);
  const mt = C.merchantTotals(s, 'c1', '2026-11');
  assert.strictEqual(mt[0].name, 'ダミー家具（分割）');
  const sup = mt.find((x) => x.name === 'テストスーパー架空店');
  assert.deepStrictEqual([sup.amount, sup.count], [2780, 2]);
  s.imports.gone = { '2026-11': { at: null, rows: [] } };
  C.cleanImports(s);
  assert.deepStrictEqual(Object.keys(s.imports), ['c1']);
});

/* ---------- 毎月の支払いの候補 ---------- */
t('knownSub / similarName', () => {
  assert.strictEqual(C.knownSub('NETFLIX.COM').name, 'Netflix');
  assert.strictEqual(C.knownSub('ｓｐｏｔｉｆｙ').name, 'Spotify');
  assert.strictEqual(C.knownSub('ＡＭＡＺＯＮ　ＰＲＩＭＥ　架空').name, 'Amazonプライム');
  assert.strictEqual(C.knownSub('DISNEY PLUS (FAKE)').name, 'Disney+');
  assert.strictEqual(C.knownSub('U-NEXT（架空）').name, 'U-NEXT');
  assert.strictEqual(C.knownSub('テスト電力（架空）').strong, false);
  assert.strictEqual(C.knownSub('テスト食堂'), null);
  assert.ok(C.similarName('Netflix', 'NETFLIX.COM'));
  assert.ok(C.similarName('ネットフリックス', 'NETFLIX.COM'));
  assert.ok(!C.similarName('テスト', 'ダミー'));
});
t('suggestRecurring: 定額サービスの名前（強い候補だけチェック）・返金や同月複数回は除く', () => {
  const s = { cards: [card], payments: [], imports: {} };
  const rows = load('rakuten-like.csv').rows;
  const sg = C.suggestRecurring(s, 'c1', '2026-11', rows);
  assert.deepStrictEqual(sg.map((x) => [x.name, x.strong, x.reason]), [['Netflix', true, 'known'], ['電気代', false, 'known']]);
  assert.ok(!sg.some((x) => /スーパー/.test(x.merchant)));   // 返金のある店は出ない
});
t('suggestRecurring: 前の月にも同じ店・近い金額 → history（強い）', () => {
  const s = { cards: [card], payments: [], imports: {} };
  C.mergeImport(s, 'c1', '2026-10', [{ date: '2026-09-10', merchant: 'テストジム（架空）', amount: 7700 }, { date: '2026-09-11', merchant: 'ダミー書店', amount: 900 }]);
  const rows = [{ date: '2026-10-10', merchant: 'テストジム（架空）', amount: 7700 }, { date: '2026-10-11', merchant: 'ダミー書店', amount: 3000 }];
  const sg = C.suggestRecurring(s, 'c1', '2026-11', rows);
  assert.deepStrictEqual(sg.map((x) => [x.name, x.reason, x.strong, x.months]), [['テストジム（架空）', 'history', true, ['2026-10']]]);
});
t('suggestRecurring: 登録済み（名前が似ている・明細から登録済み）は出さない。別のカードの登録は関係ない', () => {
  const rows = load('rakuten-like.csv').rows;
  const s = { cards: [card], payments: [{ id: 'p1', name: 'ネットフリックス', amount: 1490, cardId: 'c1' }], imports: {} };
  assert.ok(!C.suggestRecurring(s, 'c1', '2026-11', rows).some((x) => x.name === 'Netflix'));
  s.payments = [{ id: 'p1', name: 'テスト電力', amount: 6000, cardId: 'c1' }];
  assert.ok(!C.suggestRecurring(s, 'c1', '2026-11', rows).some((x) => x.name === '電気代'));
  s.payments = [{ id: 'p1', name: 'なんでも', amount: 1, cardId: 'c1', importKey: C.merchantKey('NETFLIX.COM') }];
  assert.ok(!C.suggestRecurring(s, 'c1', '2026-11', rows).some((x) => x.name === 'Netflix'));
  s.payments = [{ id: 'p1', name: 'Netflix', amount: 1490, cardId: 'other' }];
  assert.ok(C.suggestRecurring(s, 'c1', '2026-11', rows).some((x) => x.name === 'Netflix'));
});
t('paymentFromSuggestion: 毎月・カード払い・importKey 付き → 2回目は候補に出ない', () => {
  const s = { cards: [card], payments: [], imports: {} };
  const rows = load('rakuten-like.csv').rows;
  const sg = C.suggestRecurring(s, 'c1', '2026-11', rows)[0];
  const p = C.paymentFromSuggestion(sg, card, 'pX', '2026-11-04');
  assert.strictEqual(p.cardId, 'c1'); assert.strictEqual(p.accountId, 'a1');
  assert.strictEqual(p.amount, 1490); assert.strictEqual(p.repeat, null); assert.strictEqual(p.loan, null);
  assert.strictEqual(L.repType ? L.repType(p) : 'monthly', 'monthly');
  s.payments.push(p);
  assert.ok(!C.suggestRecurring(s, 'c1', '2026-11', rows).some((x) => x.name === 'Netflix'));
});

/* ---------- 保存・バックアップ ---------- */
t('migrate: imports を検査して残す / 壊れた行は捨てる', () => {
  const m = L.migrate({ version: 2, accounts: [], cards: [], payments: [], incomes: [], actuals: {},
    imports: { c1: { '2026-11': { at: 'x', rows: [['2026-10-01', 'テスト', 100], ['bad'], ['2026-10-02', 'テスト', 'x']] }, 'bad-month': { rows: [] } } } });
  assert.deepStrictEqual(Object.keys(m.imports.c1), ['2026-11']);
  assert.strictEqual(m.imports.c1['2026-11'].rows.length, 1);
  assert.deepStrictEqual(L.migrate({ version: 2 }).imports, {});
});
t('validateBackup: imports の件数 / 壊れた imports は拒否', () => {
  const ok = L.validateBackup({ version: 2, accounts: [], cards: [], payments: [], incomes: [], actuals: {}, imports: { c1: { '2026-11': { at: null, rows: [] }, '2026-10': { at: null, rows: [] } } } });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.counts.imports, 2);
  const bad = L.validateBackup({ version: 2, accounts: [], cards: [], payments: [], incomes: [], actuals: {}, imports: 'x' });
  assert.strictEqual(bad.ok, false);
});

console.log(`\n${n} tests passed`);
