const assert = require('assert');
const L = require('../logic.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('clampDay: 31日指定は短い月で月末に丸める', () => {
  assert.strictEqual(L.clampDay(2025, 1, 31), 31);
  assert.strictEqual(L.clampDay(2025, 2, 31), 28);
  assert.strictEqual(L.clampDay(2028, 2, 31), 29);   // うるう年
  assert.strictEqual(L.clampDay(2100, 2, 30), 28);   // 100年は平年
  assert.strictEqual(L.clampDay(2000, 2, 30), 29);   // 400年はうるう
  assert.strictEqual(L.clampDay(2025, 4, 31), 30);
  assert.strictEqual(L.clampDay(2025, 6, 31), 30);
});
t('monthlyDates: 31日を1月〜5月で生成', () => {
  assert.deepStrictEqual(L.monthlyDates(31, '2025-01-01', '2025-05-31'),
    ['2025-01-31', '2025-02-28', '2025-03-31', '2025-04-30', '2025-05-31']);
});
t('monthlyDates: うるう年2月', () => {
  assert.deepStrictEqual(L.monthlyDates(30, '2028-02-01', '2028-03-01'), ['2028-02-29']);
});
t('monthlyDates: 基準日は含まず、終了日は含む', () => {
  assert.deepStrictEqual(L.monthlyDates(10, '2025-03-10', '2025-05-10'), ['2025-04-10', '2025-05-10']);
});
t('monthlyDates: 年またぎ', () => {
  assert.deepStrictEqual(L.monthlyDates(15, '2025-11-20', '2026-02-15'), ['2025-12-15', '2026-01-15', '2026-02-15']);
});
t('monthlyDates: 基準日が月末で翌月の短い月に丸め', () => {
  // 1/30 基準、30日払い: 2/28 に発生、1/30 は含まない
  assert.deepStrictEqual(L.monthlyDates(30, '2025-01-30', '2025-03-01'), ['2025-02-28']);
});
t('addDays / endOfMonth / addMonthsEnd', () => {
  assert.strictEqual(L.addDays('2025-12-31', 1), '2026-01-01');
  assert.strictEqual(L.addDays('2028-02-28', 1), '2028-02-29');
  assert.strictEqual(L.addDays('2025-03-01', -1), '2025-02-28');
  assert.strictEqual(L.endOfMonth('2025-02-10'), '2025-02-28');
  assert.strictEqual(L.addMonthsEnd('2025-11-15', 3), '2026-02-28');
  assert.strictEqual(L.addMonthsEnd('2025-12-15', 1), '2026-01-31');
});

const base = () => ({
  accounts: [{ id: 'a1', name: 'メイン', balance: 100000, asOf: '2025-01-15' }],
  cards: [{ id: 'c1', name: 'Aカード', withdrawDay: 27, fixDay: 15, variable: false, accountId: 'a1' }],
  actuals: {},
  payments: [
    { id: 'p1', name: '動画', amount: 1500, cardId: 'c1', day: 5, active: true },
    { id: 'p2', name: '音楽', amount: 500, cardId: 'c1', day: 10, active: true },
    { id: 'p3', name: '家賃', amount: 50000, cardId: null, accountId: 'a1', day: 31, active: true },
    { id: 'p4', name: '停止中', amount: 9999, cardId: 'c1', day: 1, active: false },
  ],
  incomes: [{ id: 'i1', name: '給与', amount: 200000, day: 25, accountId: 'a1', active: true }],
});

t('project: カードは引落日に1件へ集約、停止中は除外', () => {
  const r = L.project(base(), '2025-01-31', 'all');
  assert.deepStrictEqual(r.events.map((e) => [e.date, e.kind, e.delta]),
    [['2025-01-25', 'income', 200000], ['2025-01-27', 'card', -2000], ['2025-01-31', 'direct', -50000]]);
  assert.strictEqual(r.endBalance, 100000 + 200000 - 2000 - 50000);
});
t('project: 基準日当日のイベントは含めない（基準日の残高に反映済みとみなす）', () => {
  const s = base(); s.accounts[0].asOf = '2025-01-27';
  const r = L.project(s, '2025-01-31', 'all');
  assert.deepStrictEqual(r.events.map((e) => e.date), ['2025-01-31']);
});
t('project: 指定日当日のイベントは含める / 前日までなら含めない', () => {
  assert.strictEqual(L.project(base(), '2025-01-27', 'all').events.length, 2);
  assert.strictEqual(L.project(base(), '2025-01-26', 'all').events.length, 1);
});
t('project: 月末(31日)の家賃が2月は28日', () => {
  const r = L.project(base(), '2025-02-28', 'all');
  const rent = r.events.filter((e) => e.label === '家賃').map((e) => e.date);
  assert.deepStrictEqual(rent, ['2025-01-31', '2025-02-28']);
});
t('project: マイナス検出と最初のマイナス日', () => {
  const s = base(); s.accounts[0].balance = 20000; s.incomes = [];
  const r = L.project(s, '2025-02-28', 'all');
  assert.strictEqual(r.negative, true);
  assert.strictEqual(r.firstNegative.date, '2025-01-31'); // 1/27: 18000, 1/31: -32000 で初めて負
  assert.ok(r.firstNegative.balance < 0);
  assert.strictEqual(r.firstNegative.balance, -32000);
});
t('project: 同日は支出が先（給与日と引落日が同じでも安全側）', () => {
  const s = base(); s.accounts[0].balance = 1000; s.cards[0].withdrawDay = 25; s.payments = s.payments.filter((p) => p.cardId === 'c1');
  const r = L.project(s, '2025-01-25', 'all');
  assert.deepStrictEqual(r.events.map((e) => e.kind), ['card', 'income']);
  assert.strictEqual(r.negative, true);
});
t('project: 基準日より前の日付', () => {
  const r = L.project(base(), '2025-01-01', 'all');
  assert.strictEqual(r.beforeAsOf, true);
  assert.strictEqual(r.endBalance, 100000);
  assert.strictEqual(r.events.length, 0);
});
t('project: 複数口座・口座別', () => {
  const s = base();
  s.accounts.push({ id: 'a2', name: 'サブ', balance: 5000, asOf: '2025-01-15' });
  s.cards.push({ id: 'c2', name: 'Bカード', withdrawDay: 20, fixDay: 10, variable: false, accountId: 'a2' });
  s.payments.push({ id: 'p5', name: 'クラウド', amount: 8000, cardId: 'c2', day: 3, active: true });
  const all = L.project(s, '2025-01-31', 'all');
  assert.strictEqual(all.startBalance, 105000);
  assert.strictEqual(all.endBalance, 105000 + 200000 - 2000 - 50000 - 8000);
  assert.strictEqual(all.negative, true); // サブ口座単体が -3000
  const sub = L.project(s, '2025-01-31', 'a2');
  assert.strictEqual(sub.endBalance, -3000);
  const main = L.project(s, '2025-01-31', 'a1');
  assert.strictEqual(main.negative, false);
});
t('monthlySummary / upcoming', () => {
  const m = L.monthlySummary(base());
  assert.strictEqual(m.cards[0].total, 2000);
  assert.strictEqual(m.direct.total, 50000);
  assert.strictEqual(m.paymentsTotal, 52000);
  assert.strictEqual(m.incomeTotal, 200000);
  const u = L.genEvents(base(), '2025-01-26', '2025-02-26');
  assert.strictEqual(u[0].date, '2025-01-27'); // 今日を含む
  assert.ok(u.every((e) => e.date <= '2025-02-26'));
});


/* ================= v2: 変動額・実績・平均・確定日・通知 ================= */
const v2 = () => {
  const s = base();
  s.accounts[0].asOf = '2025-01-01';
  s.cards[0].variable = true;                        // Aカードは請求額が変動
  s.payments.push({ id: 'p6', name: '電気代', amount: 6000, cardId: null, accountId: 'a1', day: 20, fixDay: 15, variable: true, active: true });
  s.incomes[0].variable = true; s.incomes[0].fixDay = 20; s.incomes[0].amount = 250000;
  return s;
};
const sumItems = 2000;

t('confirmDate: 確定日が引落日より前なら同月、後なら前月（月末丸めあり）', () => {
  assert.strictEqual(L.confirmDate(15, '2025-01-27'), '2025-01-15');
  assert.strictEqual(L.confirmDate(31, '2025-03-10'), '2025-02-28');   // 前月末（短い月は月末に丸め）
  assert.strictEqual(L.confirmDate(31, '2025-02-27'), '2025-01-31');
  assert.strictEqual(L.confirmDate(27, '2025-01-27'), '2025-01-27');   // 同日なら当日
  assert.strictEqual(L.confirmDate(5, '2025-01-03'), '2024-12-05');    // 年またぎ
  assert.strictEqual(L.confirmDate(null, '2025-01-03'), '2025-01-03'); // 未設定は当日
});
t('average-of-last-3: 実績なし → 初期見込み額', () => {
  const s = v2();
  const p = L.provisional(s, 'pay', 'p6', '2025-02', 6000);
  assert.deepStrictEqual([p.amount, p.source, p.n], [6000, 'initial', 0]);
});
t('average-of-last-3: 実績1件/2件/3件 → あるだけで平均', () => {
  const s = v2();
  L.setActual(s, 'pay', 'p6', '2024-11', 5000);
  assert.deepStrictEqual([L.provisional(s, 'pay', 'p6', '2025-02', 6000).amount, L.provisional(s, 'pay', 'p6', '2025-02', 6000).n], [5000, 1]);
  L.setActual(s, 'pay', 'p6', '2024-12', 7000);
  assert.strictEqual(L.provisional(s, 'pay', 'p6', '2025-02', 6000).amount, 6000);
  L.setActual(s, 'pay', 'p6', '2025-01', 9000);
  const p = L.provisional(s, 'pay', 'p6', '2025-02', 6000);
  assert.deepStrictEqual([p.amount, p.n, p.source], [7000, 3, 'average']);
});
t('average-of-last-3: 4件以上は直近3件のみ（入力順に依存しない）', () => {
  const s = v2();
  L.setActual(s, 'pay', 'p6', '2025-01', 9000);   // 古い順でなく入力
  L.setActual(s, 'pay', 'p6', '2024-09', 1000);   // 古いので無視される
  L.setActual(s, 'pay', 'p6', '2024-12', 6000);
  L.setActual(s, 'pay', 'p6', '2024-11', 3000);
  const p = L.provisional(s, 'pay', 'p6', '2025-02', 6000);
  assert.strictEqual(p.amount, Math.round((9000 + 6000 + 3000) / 3));
  assert.strictEqual(p.n, 3);
});
t('average-of-last-3: 四捨五入 / 対象月より後の実績は含めない', () => {
  const s = v2();
  L.setActual(s, 'pay', 'p6', '2024-11', 1000); L.setActual(s, 'pay', 'p6', '2024-12', 1000); L.setActual(s, 'pay', 'p6', '2025-01', 1001);
  assert.strictEqual(L.provisional(s, 'pay', 'p6', '2025-02', 0).amount, 1000);   // 1000.33 → 1000
  L.setActual(s, 'pay', 'p6', '2025-03', 99999);
  assert.strictEqual(L.provisional(s, 'pay', 'p6', '2025-02', 0).amount, 1000);   // 3月の実績は2月の仮に影響しない
  assert.strictEqual(L.provisional(s, 'pay', 'p6', '2025-04', 0).amount, Math.round((1001 + 99999 + 1000) / 3)); // 4月の仮には入る（直近3件=12,1,3月）
});
t('実績入力: その月は確定額に置き換わり、以降の平均にも反映される', () => {
  const s = v2();
  let e = L.genEvents(s, '2025-01-01', '2025-01-31').find((x) => x.label === '電気代');
  assert.deepStrictEqual([e.amount, e.confirmed, e.source], [6000, false, 'initial']);
  L.setActual(s, 'pay', 'p6', '2025-01', 8000);
  e = L.genEvents(s, '2025-01-01', '2025-01-31').find((x) => x.label === '電気代');
  assert.deepStrictEqual([e.amount, e.confirmed, e.source], [8000, true, 'actual']);
  const feb = L.genEvents(s, '2025-02-01', '2025-02-28').find((x) => x.label === '電気代');
  assert.deepStrictEqual([feb.amount, feb.confirmed, feb.source, feb.n], [8000, false, 'average', 1]);
  L.removeActual(s, 'pay', 'p6', '2025-01');
  assert.strictEqual(L.genEvents(s, '2025-01-01', '2025-01-31').find((x) => x.label === '電気代').amount, 6000);
});
t('固定項目は常に確定扱い / 変動カードは実績で確定、それまで仮(登録額合計が初期値)', () => {
  const s = v2();
  const fixed = L.genEvents(s, '2025-01-01', '2025-01-31').find((x) => x.label === '家賃');
  assert.strictEqual(fixed.confirmed, true);
  let c = L.genEvents(s, '2025-01-01', '2025-01-31').find((x) => x.kind === 'card');
  assert.deepStrictEqual([c.amount, c.confirmed, c.fixDate, c.variable], [sumItems, false, '2025-01-15', true]);
  L.setActual(s, 'card', 'c1', '2025-01', 3456);
  c = L.genEvents(s, '2025-01-01', '2025-01-31').find((x) => x.kind === 'card');
  assert.deepStrictEqual([c.amount, c.confirmed], [3456, true]);
  s.cards[0].variable = false; L.removeActual(s, 'card', 'c1', '2025-01');
  c = L.genEvents(s, '2025-01-01', '2025-01-31').find((x) => x.kind === 'card');
  assert.deepStrictEqual([c.amount, c.confirmed], [sumItems, true]);
});
t('project: confirmedThrough = 最初の仮イベントの前日 / 全部確定なら null', () => {
  const s = v2();
  let r = L.project(s, '2025-02-28', 'all');
  // 1/20 電気代(仮) 1/25 給与(仮) 1/27 カード(仮) 1/31 家賃(確定)
  assert.strictEqual(r.confirmedThrough, '2025-01-19');
  assert.strictEqual(r.firstProvisional.label, '電気代');
  assert.strictEqual(r.events[0].uncertain, true);
  L.setActual(s, 'pay', 'p6', '2025-01', 6500); L.setActual(s, 'inc', 'i1', '2025-01', 260000); L.setActual(s, 'card', 'c1', '2025-01', 2100);
  r = L.project(s, '2025-01-31', 'all');
  assert.strictEqual(r.confirmedThrough, null);
  assert.strictEqual(r.endBalance, 100000 - 6500 + 260000 - 2100 - 50000);
  r = L.project(s, '2025-02-28', 'all');
  assert.strictEqual(r.confirmedThrough, '2025-02-19'); // 2月分は仮
});
t('project: 確定済みの期間だけを見るなら仮なし', () => {
  const s = v2();
  const r = L.project(s, '2025-01-15', 'all');
  assert.strictEqual(r.confirmedThrough, null);
  assert.strictEqual(r.events.length, 0);
});
t('computePending: 確定日が今日以前で未入力のもの / 入力済みは出ない', () => {
  const s = v2();
  const pend = (d) => L.computePending(s, d).filter((e) => e.month === '2025-01');
  assert.ok(L.computePending(s, '2025-01-21').every((e) => e.fixDate > '2025-01-01')); // 基準日以前の確定日は出さない
  let p = pend('2025-01-21');           // 電気代(確定日15)・カード(確定日15)・給与(確定日20)
  assert.deepStrictEqual(p.map((e) => e.label).sort(), ['Aカード', '給与', '電気代'].sort());
  assert.ok(L.computePending(s, '2025-01-14').filter((e) => e.month === '2025-01').length === 0); // 1月分はまだ
  L.setActual(s, 'pay', 'p6', '2025-01', 6500);
  p = pend('2025-01-21');
  assert.deepStrictEqual(p.map((e) => e.label).sort(), ['Aカード', '給与'].sort());
  assert.ok(p.every((e) => e.confirmed === false && e.variable));
});
t('computeReminders: 確定日ごとにまとめ、朝8:00 JST(=前日23:00 UTC)', () => {
  const s = v2();
  const r = L.computeReminders(s, '2025-01-10', 10);
  const d15 = r.find((x) => x.date === '2025-01-15');
  assert.deepStrictEqual(d15.names.sort(), ['Aカード', '電気代'].sort());
  assert.strictEqual(d15.at.toISOString(), '2025-01-14T23:00:00.000Z');
  assert.ok(d15.keys.includes('pay:p6:2025-01'));
  assert.strictEqual(r.find((x) => x.date === '2025-01-20').names[0], '給与');
  assert.ok(r.every((x) => x.date >= '2025-01-10' && x.date <= '2025-01-20'));
  assert.ok(r.every((x) => x.at.getTime() === new Date(x.date + 'T08:00:00+09:00').getTime()));
});
t('dailySeries: 日次残高・支出/収入・仮フラグ・マイナス', () => {
  const s = v2(); s.accounts[0].balance = 10000;
  const ds = L.dailySeries(s, 'all', '2025-01');
  assert.strictEqual(ds.days.length, 31);
  const d = (n) => ds.days[n - 1];
  assert.strictEqual(d(1).balance, 10000);            // 基準日(1/1)の残高
  assert.strictEqual(d(19).prov, false);
  assert.strictEqual(d(20).debit, 6000); assert.strictEqual(d(20).debitProv, 6000); assert.strictEqual(d(20).prov, true);
  assert.strictEqual(d(20).balance, 4000);
  assert.strictEqual(d(25).income, 250000); assert.strictEqual(d(25).balance, 254000);
  assert.strictEqual(d(27).balance, 252000);
  assert.strictEqual(d(31).balance, 202000); assert.strictEqual(d(31).debitProv, 0);
  s.incomes = []; const ds2 = L.dailySeries(s, 'all', '2025-01');
  assert.strictEqual(ds2.days[19].neg, false); assert.strictEqual(ds2.days[26].neg, false); assert.strictEqual(ds2.days[30].neg, true); // 1/27 は 2000、1/31 の家賃で負
});
t('dailySeries: 基準日より前の日は残高なし / 月跨ぎの前月イベントを引き継ぐ', () => {
  const s = v2(); s.accounts[0].asOf = '2025-01-10'; s.accounts[0].balance = 100000;
  const ds = L.dailySeries(s, 'all', '2025-01');
  assert.strictEqual(ds.days[8].balance, null);
  assert.strictEqual(ds.days[9].balance, 100000);
  const feb = L.dailySeries(s, 'all', '2025-02');
  assert.strictEqual(feb.days.length, 28);
  assert.strictEqual(feb.days[0].balance, L.project(s, '2025-01-31', 'all').endBalance); // 2/1 は 1月末残高から
});
t('migrate: v1 データを v2 へ（カードは固定、actuals/変動フラグ追加）', () => {
  const v1 = { version: 1, accounts: [{ id: 'a', name: 'x', balance: 1, asOf: '2025-01-01' }], cards: [{ id: 'c', name: 'k', withdrawDay: 10, accountId: 'a' }],
    payments: [{ id: 'p', name: 'n', amount: 100, cardId: 'c', day: 3, active: true }], incomes: [{ id: 'i', name: 'g', amount: 5, day: 25, accountId: 'a' }], settings: { targetDate: '2025-02-01', projAccount: 'all' } };
  const m = L.migrate(v1);
  assert.strictEqual(m.version, 2);
  assert.strictEqual(m.cards[0].variable, false);
  assert.strictEqual(m.cards[0].fixDay, null);
  assert.strictEqual(m.payments[0].variable, false);
  assert.deepStrictEqual(m.actuals, {});
  assert.strictEqual(m.settings.targetDate, '2025-02-01');
  assert.strictEqual(v1.version, 1);                 // 元は変更しない
  // 移行後は v1 と同じ結果（全て確定）
  const r = L.project(m, '2025-02-10', 'all');
  assert.strictEqual(r.confirmedThrough, null);
  // v2 は未指定カードを変動(既定)、冪等
  const m2 = L.migrate(JSON.parse(JSON.stringify(m)));
  assert.deepStrictEqual(m2, m);
  assert.strictEqual(L.migrate({ version: 2, cards: [{ id: 'z' }] }).cards[0].variable, true);
  assert.deepStrictEqual(L.migrate(null).accounts, []);
});
t('computePending: 基準日以前の確定日には入力を求めない（新規の変動項目）', () => {
  const s = v2();                                   // 口座の基準日 2025-01-01
  s.payments.push({ id: 'pn', name: '新ガス', amount: 5000, cardId: null, accountId: s.accounts[0].id, day: 25, active: true, variable: true, fixDay: 10 });
  const today = '2025-01-12';
  // 12月10日の確定日は基準日(1/1)以前 → 出ない。1月10日は基準日より後 → 出る
  const p = L.computePending(s, today).filter((e) => e.refId === 'pn');
  assert.deepStrictEqual(p.map((e) => e.month), ['2025-01']);
  assert.strictEqual(p[0].fixDate, '2025-01-10');
  // 残高を確定日の後に更新しても、引き落とし(1/25)がまだ先なら入力待ちは残る
  s.accounts[0].asOf = '2025-01-10';
  assert.deepStrictEqual(L.computePending(s, today).filter((e) => e.refId === 'pn').map((e) => e.month), ['2025-01']);
  // 引き落とし日まで残高に反映済み（基準日>=引落日）なら出ない
  s.accounts[0].asOf = '2025-01-25';
  assert.strictEqual(L.computePending(s, '2025-01-26').filter((e) => e.refId === 'pn' && e.month === '2025-01').length, 0);
});
t('computePending: 項目の作成日より前の確定日は出さない / 作成日当日は出す', () => {
  const s = v2(); s.accounts[0].asOf = '2024-06-01';
  s.payments.push({ id: 'pn', name: '新ガス', amount: 5000, cardId: null, accountId: s.accounts[0].id, day: 25, active: true, variable: true, fixDay: 10, createdAt: '2025-01-05' });
  const m = (d) => L.computePending(s, d).filter((e) => e.refId === 'pn').map((e) => e.fixDate);
  assert.deepStrictEqual(m('2025-01-12'), ['2025-01-10']);   // 12/10 は作成前なので出ない
  s.payments.find((x) => x.id === 'pn').createdAt = '2025-01-10';
  assert.deepStrictEqual(m('2025-01-12'), ['2025-01-10']);   // 作成日当日の確定日は出す
  s.payments.find((x) => x.id === 'pn').createdAt = '2025-01-11';
  assert.deepStrictEqual(m('2025-01-12'), []);
  // 未来の確定日はまだ出ない（リマインダー側で通知）
  assert.deepStrictEqual(L.computePending(s, '2025-01-09').filter((e) => e.refId === 'pn'), []);
});

/* ---------- v5: ローン / 残高の更新 ---------- */
const loanState = (loan, cardId) => {
  const s = base(); s.accounts[0].asOf = '2025-01-01'; s.incomes = [];
  s.payments = [{ id: 'ln', name: '車ローン', amount: 30000, cardId: cardId || null, accountId: 'a1', day: 25, active: true, variable: false, loan: loan }];
  return s;
};
t('ローン: 開始月〜最終回だけ発生し、その後は自動で止まる（境界）', () => {
  const s = loanState({ start: '2025-02', count: 3 });
  const ds = L.genEvents(s, '2025-01-01', '2025-08-31').filter((e) => e.refId === 'ln').map((e) => e.date);
  assert.deepStrictEqual(ds, ['2025-02-25', '2025-03-25', '2025-04-25']);   // 1月は開始前、5月以降は終了
});
t('ローン: 1回払い / 年またぎ / 月末日の丸め', () => {
  assert.deepStrictEqual(L.genEvents(loanState({ start: '2025-03', count: 1 }), '2025-01-01', '2026-01-01').map((e) => e.date), ['2025-03-25']);
  assert.deepStrictEqual(L.genEvents(loanState({ start: '2025-11', count: 3 }), '2025-01-01', '2026-06-01').map((e) => e.date), ['2025-11-25', '2025-12-25', '2026-01-25']);
  const s = loanState({ start: '2025-01', count: 2 }); s.payments[0].day = 31;
  assert.deepStrictEqual(L.genEvents(s, '2025-01-01', '2025-04-01').map((e) => e.date), ['2025-01-31', '2025-02-28']);
});
t('ローン: 予測に含まれ、最終回の後は残高が減らない', () => {
  const s = loanState({ start: '2025-01', count: 2 });
  assert.strictEqual(L.project(s, '2025-01-31', 'all').endBalance, 100000 - 30000);
  assert.strictEqual(L.project(s, '2025-02-28', 'all').endBalance, 100000 - 60000);
  assert.strictEqual(L.project(s, '2025-06-30', 'all').endBalance, 100000 - 60000);
});
t('ローン: 残り回数（今日の分は支払い済みとして数える）', () => {
  const s = loanState({ start: '2025-01', count: 12 }); const p = s.payments[0];
  let i = L.loanInfo(s, p, '2025-01-10');
  assert.deepStrictEqual([i.total, i.paid, i.remaining, i.done, i.next, i.endMonth], [12, 0, 12, false, '2025-01-25', '2025-12']);
  i = L.loanInfo(s, p, '2025-01-25'); assert.deepStrictEqual([i.paid, i.remaining, i.next], [1, 11, '2025-02-25']);
  i = L.loanInfo(s, p, '2025-06-30'); assert.deepStrictEqual([i.paid, i.remaining, i.remainingAmount], [6, 6, 180000]);
  i = L.loanInfo(s, p, '2025-12-25'); assert.deepStrictEqual([i.remaining, i.done, i.next], [0, true, null]);
  i = L.loanInfo(s, p, '2030-01-01'); assert.strictEqual(i.remaining, 0);
  i = L.loanInfo(s, p, '2024-06-01'); assert.deepStrictEqual([i.paid, i.remaining], [0, 12]);   // 開始前
  assert.strictEqual(L.loanInfo(s, { amount: 1 }, '2025-01-01'), null);
});
t('ローン: 「すでにN回払い済み」から開始月を逆算すると、残り回数が一致', () => {
  for (const [today, paid] of [['2025-03-10', 5], ['2025-03-25', 5], ['2025-03-26', 5], ['2025-01-02', 0], ['2025-03-10', 12]]) {
    const start = L.loanStartForPaid(25, paid, today);
    const s = loanState({ start, count: 36 });
    const i = L.loanInfo(s, s.payments[0], today);
    assert.strictEqual(i.paid, paid, today + ' paid=' + paid + ' start=' + start);
    assert.strictEqual(i.remaining, 36 - paid);
  }
  assert.strictEqual(L.loanStartForPaid(25, 5, '2025-03-10'), '2024-10');   // 次回3/25が6回目 → 1回目は2024-10
});
t('ローン: カード払いはカードの請求額に含まれ、期間外の月は含まれない', () => {
  const s = loanState({ start: '2025-02', count: 2 }, 'c1');          // Aカード(27日)に紐づく
  s.payments.push({ id: 'x', name: '動画', amount: 1500, cardId: 'c1', day: 5, active: true });
  const ev = (m) => L.genEvents(s, '2025-01-01', '2025-04-30').find((e) => e.kind === 'card' && e.month === m);
  assert.strictEqual(ev('2025-01').amount, 1500);
  assert.strictEqual(ev('2025-02').amount, 31500);
  assert.strictEqual(ev('2025-03').amount, 31500);
  assert.strictEqual(ev('2025-04').amount, 1500);                      // 最終回(3月)の後は自動で外れる
  assert.deepStrictEqual(ev('2025-02').items.map((x) => x.name + ':' + x.amount), ['車ローン:30000', '動画:1500']);
  assert.strictEqual(L.loanInfo(s, s.payments[0], '2025-02-10').next, '2025-02-27');   // カードの引き落とし日で数える
  assert.strictEqual(L.monthlySummary(s, '2025-02').cards[0].total, 31500);
  assert.strictEqual(L.monthlySummary(s, '2025-05').cards[0].total, 1500);
});
t('ローン: 停止中は含まれず、ローンのイベントに回数情報がつく', () => {
  const s = loanState({ start: '2025-01', count: 3 });
  const e = L.genEvents(s, '2025-01-01', '2025-03-31');
  assert.deepStrictEqual(e.map((x) => x.loan.index + '/' + x.loan.total), ['1/3', '2/3', '3/3']);
  assert.ok(e.every((x) => x.confirmed && !x.variable));
  s.payments[0].active = false;
  assert.strictEqual(L.genEvents(s, '2025-01-01', '2025-03-31').length, 0);
});
t('setBalance: 残高と基準日を今日にして、今日より後の予定から再計算', () => {
  const s = base();                                   // 基準日 1/15・残高100000
  const before = L.project(s, '2025-01-31', 'all').endBalance;   // 1/25給与+200000, 1/27カード-2000, 1/31家賃-50000
  assert.strictEqual(before, 100000 + 200000 - 2000 - 50000);
  L.setBalance(s, 'a1', 98765, '2025-01-26');         // 1/26に電子マネーなどで残高を直した
  assert.deepStrictEqual([s.accounts[0].balance, s.accounts[0].asOf], [98765, '2025-01-26']);
  assert.strictEqual(L.project(s, '2025-01-31', 'all').endBalance, 98765 - 2000 - 50000);   // 1/26以前の予定は二重に反映されない
  assert.strictEqual(L.project(s, '2025-01-26', 'all').endBalance, 98765);
  assert.strictEqual(L.setBalance(s, 'nope', 1, '2025-01-26'), null);
  assert.strictEqual(L.setBalance(s, 'a1', 'abc', '2025-01-26'), null);
  L.setBalance(s, 'a1', -300.4, '2025-01-27'); assert.strictEqual(s.accounts[0].balance, -300);
});
t('今日の残高は確定：基準日=今日なら、仮の予定があっても今日は確定、仮の引落日以降は仮', () => {
  const s = v2(); const today = '2025-01-21';
  s.accounts.forEach((a) => { a.asOf = today; });
  const r0 = L.project(s, today, 'all');
  assert.strictEqual(r0.confirmedThrough, null);          // 今日＝入力した残高そのもの → 確定
  assert.strictEqual(r0.endBalance, r0.startBalance);
  const ds = L.dailySeries(s, 'all', '2025-01');
  assert.strictEqual(ds.days.find((d) => d.date === today).prov, false);   // グラフの今日の点も確定
  const pend = L.computePending(s, today);
  assert.ok(pend.length > 0);                              // 入力待ちは引き続き表示される
  const firstProvDate = pend.map((e) => e.date).sort()[0];
  const r1 = L.project(s, firstProvDate, 'all');
  assert.notStrictEqual(r1.confirmedThrough, null);       // 仮の引き落とし日以降は仮
  assert.ok(ds.days.filter((d) => d.date >= firstProvDate && d.date.startsWith('2025-01')).every((d) => d.prov));
  // 基準日が過去で、基準日〜今日の間に仮の予定がなければ今日は確定
  const s2 = v2(); s2.accounts.forEach((a) => { a.asOf = '2025-01-02'; });
  const r2 = L.project(s2, '2025-01-04', 'all');
  assert.ok(r2.events.every((e) => e.confirmed) && r2.confirmedThrough === null);
});
t('computePending v5.3: 引き落とし日を過ぎた(overdue)が上、確定日だけ過ぎた(awaiting)が下／残高はoverdueの日の前日まで確定', () => {
  const s = {
    accounts: [{ id: 'a1', name: 'メイン', balance: 100000, asOf: '2025-01-05' }],
    cards: [{ id: 'cA', name: 'Aカード', withdrawDay: 10, fixDay: 1, variable: true, accountId: 'a1' },
            { id: 'cB', name: 'Bカード', withdrawDay: 27, fixDay: 15, variable: true, accountId: 'a1' }],
    actuals: {},
    payments: [{ id: 'x1', name: 'X', amount: 2000, cardId: 'cA', day: 1, active: true },
               { id: 'x2', name: 'Y', amount: 3000, cardId: 'cB', day: 1, active: true },
               { id: 'e1', name: '電気', amount: 6000, cardId: null, accountId: 'a1', day: 25, variable: true, fixDay: 18, active: true }],
    incomes: [],
  };
  const today = '2025-01-20';
  const p = L.computePending(s, today).filter((e) => e.month === '2025-01');
  assert.deepStrictEqual(p.map((e) => [e.label, e.status]),
    [['Aカード', 'overdue'], ['電気', 'awaiting'], ['Bカード', 'awaiting']]);   // overdue先頭→awaitingは引落日の近い順
  // overdue(1/10)が未入力 → 1/9までは確定、1/10以降は仮
  assert.strictEqual(L.project(s, '2025-01-09', 'all').confirmedThrough, null);
  assert.strictEqual(L.project(s, '2025-01-10', 'all').confirmedThrough, '2025-01-09');
  // overdue を入力 → 今日(1/20)〜awaitingの最初の引落日(1/25)の前日まで確定
  L.setActual(s, 'card', 'cA', '2025-01', 2100);
  const p2 = L.computePending(s, today).filter((e) => e.month === '2025-01');
  assert.ok(p2.every((e) => e.status === 'awaiting'));
  assert.strictEqual(L.project(s, '2025-01-24', 'all').confirmedThrough, null);
  assert.strictEqual(L.project(s, '2025-01-24', 'all').endBalance, 100000 - 2100);
  assert.strictEqual(L.project(s, '2025-01-25', 'all').confirmedThrough, '2025-01-24');
  // 引き落とし日当日も overdue 扱い
  assert.strictEqual(L.computePending(s, '2025-01-25').find((e) => e.label === '電気' && e.month === '2025-01').status, 'overdue');
});
t('v5.4 月末(END_DAY): 2月・30日の月・31日の月で最終日になる', () => {
  const E = L.END_DAY;
  assert.deepStrictEqual(L.monthlyDates(E, '2025-01-01', '2025-05-31'), ['2025-01-31', '2025-02-28', '2025-03-31', '2025-04-30', '2025-05-31']);
  assert.deepStrictEqual(L.monthlyDates(E, '2024-01-31', '2024-03-01'), ['2024-02-29']);   // うるう年
  assert.strictEqual(L.clampDay(2025, 2, E), 28);
  assert.strictEqual(L.clampDay(2025, 6, E), 30);
  // 既存の数値 29〜31 も月末に丸める（移行不要）
  assert.deepStrictEqual(L.monthlyDates(31, '2025-01-31', '2025-04-30'), ['2025-02-28', '2025-03-31', '2025-04-30']);
  assert.deepStrictEqual(L.monthlyDates(29, '2025-01-31', '2025-03-31'), ['2025-02-28', '2025-03-29']);
  assert.strictEqual(L.dayLabel(E), '月末');
  assert.strictEqual(L.dayLabel(25), '25日');
  assert.strictEqual(L.dayLabel(null), '');
  assert.ok(L.isEndDay(E) && !L.isEndDay(31));
});
t('v5.4 月末: 確定日=月末・引落10日 → 前月末が確定日。残高計算にも反映', () => {
  const E = L.END_DAY;
  assert.strictEqual(L.confirmDate(E, '2025-03-10'), '2025-02-28');
  assert.strictEqual(L.confirmDate(E, '2025-05-10'), '2025-04-30');
  assert.strictEqual(L.confirmDate(E, '2025-03-31'), '2025-03-31');   // 引落も月末なら同日
  const s = {
    accounts: [{ id: 'a1', name: 'メイン', balance: 100000, asOf: '2025-02-01' }],
    cards: [{ id: 'c1', name: 'C', withdrawDay: E, fixDay: 15, variable: false, accountId: 'a1' }],
    actuals: {},
    payments: [{ id: 'r', name: '家賃', amount: 50000, cardId: null, accountId: 'a1', day: E, active: true },
               { id: 'x', name: 'X', amount: 1000, cardId: 'c1', day: 1, active: true }],
    incomes: [{ id: 'i', name: '給与', amount: 200000, day: E, accountId: 'a1', active: true }],
  };
  const ev = L.genEvents(s, '2025-02-01', '2025-04-30');
  assert.deepStrictEqual([...new Set(ev.map((e) => e.date))], ['2025-02-28', '2025-03-31', '2025-04-30']);
  assert.strictEqual(L.project(s, '2025-02-27', 'all').endBalance, 100000);
  assert.strictEqual(L.project(s, '2025-02-28', 'all').endBalance, 100000 - 50000 - 1000 + 200000);
  assert.strictEqual(L.project(s, '2025-04-30', 'all').endBalance, 100000 + 3 * (200000 - 51000));
  // ローンの引落日も月末
  const li = L.loanInfo({ cards: [] }, { amount: 1000, day: E, loan: { count: 3, start: '2025-02' } }, '2025-03-15');
  assert.strictEqual(li.paid, 1); assert.strictEqual(li.endDate, '2025-04-30');
});

/* ---------- v5.5 繰り返し ---------- */
const acc0 = (asOf) => ({ id: 'a1', name: 'メイン', balance: 1000000, asOf: asOf || '2025-12-31' });
t('v5.5 毎年: 年をまたいで年1回だけ（2025〜2027）', () => {
  const p = { id: 'y', name: '自動車税', amount: 39500, accountId: 'a1', day: 31, repeat: { type: 'yearly', month: 5 } };
  assert.deepStrictEqual(L.itemDates(p, '2025-01-01', '2027-12-31'), ['2025-05-31', '2026-05-31', '2027-05-31']);
  const s = { accounts: [acc0()], cards: [], payments: [p], incomes: [], actuals: {} };
  assert.deepStrictEqual(L.genEvents(s, '2025-12-31', '2027-12-31').map((e) => e.date), ['2026-05-31', '2027-05-31']);
  assert.strictEqual(L.repeatLabel(p, 31), '毎年5月31日');
});
t('v5.5 毎年: 月末・うるう年2月に丸め', () => {
  const p = { day: L.END_DAY, repeat: { type: 'yearly', month: 2 } };
  assert.deepStrictEqual(L.itemDates(p, '2026-01-01', '2028-12-31'), ['2026-02-28', '2027-02-28', '2028-02-29']);
  const q = { day: 31, repeat: { type: 'yearly', month: 4 } };
  assert.deepStrictEqual(L.itemDates(q, '2026-01-01', '2026-12-31'), ['2026-04-30']);
  assert.strictEqual(L.repeatLabel(p, L.END_DAY), '毎年2月末');
});
t('v5.5 ◯か月ごと: 開始月から N か月ごと、開始前は発生しない', () => {
  const p = { day: 25, repeat: { type: 'every', n: 6, start: '2026-04' } };
  assert.deepStrictEqual(L.itemDates(p, '2025-01-01', '2027-12-31'), ['2026-04-25', '2026-10-25', '2027-04-25', '2027-10-25']);
  const w = { day: 31, repeat: { type: 'every', n: 2, start: '2025-11' } };
  assert.deepStrictEqual(L.itemDates(w, '2025-10-01', '2026-06-30'), ['2025-11-30', '2026-01-31', '2026-03-31', '2026-05-31']);
  assert.strictEqual(L.nextOccurrence(p, 25, '2026-11-03'), '2027-04-25');
  assert.strictEqual(L.repeatLabel(p, 25), '6か月ごと・25日');
  assert.ok(!L.occursIn(p, '2025-10') && L.occursIn(p, '2026-10') && !L.occursIn(p, '2026-11'));
});
t('v5.5 1回だけ: 指定日に1回、過ぎたら次回なし', () => {
  const p = { day: 10, repeat: { type: 'once', date: '2026-12-10' } };
  assert.deepStrictEqual(L.itemDates(p, '2026-01-01', '2030-12-31'), ['2026-12-10']);
  assert.deepStrictEqual(L.itemDates(p, '2026-12-10', '2030-12-31'), []);
  assert.strictEqual(L.nextOccurrence(p, 10, '2026-11-03'), '2026-12-10');
  assert.strictEqual(L.nextOccurrence(p, 10, '2026-12-10'), null);
  assert.strictEqual(L.repeatLabel(p, 10), '2026/12/10、1回だけ');
});
t('v5.5 毎月(repeat なし・monthly)は従来どおり', () => {
  assert.strictEqual(L.repType({}), 'monthly'); assert.strictEqual(L.repType({ repeat: { type: 'monthly' } }), 'monthly');
  assert.deepStrictEqual(L.itemDates({ day: 5 }, '2026-01-01', '2026-03-31'), ['2026-01-05', '2026-02-05', '2026-03-05']);
  assert.strictEqual(L.repeatLabel({}, 25), '毎月25日');
});
t('v5.5 カード: 毎年・1回だけの支払いは発生する月の請求だけに含まれる', () => {
  const s = { accounts: [acc0()], actuals: {}, incomes: [],
    cards: [{ id: 'c', name: 'C', withdrawDay: 27, fixDay: 15, variable: false, accountId: 'a1' }],
    payments: [{ id: 'm', name: '月額', amount: 1000, cardId: 'c', day: 1, active: true },
      { id: 'y', name: '年会費', amount: 5000, cardId: 'c', day: 1, active: true, repeat: { type: 'yearly', month: 3 } },
      { id: 'o', name: '家電', amount: 30000, cardId: 'c', day: 1, active: true, repeat: { type: 'once', date: '2026-02-01' } }] };
  const ev = L.genEvents(s, '2025-12-31', '2026-04-30');
  assert.deepStrictEqual(ev.map((e) => [e.month, e.amount]), [['2026-01', 1000], ['2026-02', 31000], ['2026-03', 6000], ['2026-04', 1000]]);
  assert.deepStrictEqual(ev[2].items.map((i) => i.name), ['月額', '年会費']);
  assert.strictEqual(L.monthlySummary(s, '2026-03').cards[0].total, 6000);
  assert.strictEqual(L.monthlySummary(s, '2026-04').cards[0].total, 1000);
  assert.strictEqual(L.repeatLabel(s.payments[2], 27), '2026/2、1回だけ');
});
t('v5.5 変動カード: 仮の平均から年1回分を除き、発生月だけ上乗せ', () => {
  const s = { accounts: [acc0()], incomes: [], actuals: {},
    cards: [{ id: 'c', name: 'C', withdrawDay: 27, fixDay: 15, variable: true, accountId: 'a1' }],
    payments: [{ id: 'm', name: '月額', amount: 1000, cardId: 'c', day: 1, active: true },
      { id: 'y', name: '年会費', amount: 6000, cardId: 'c', day: 1, active: true, repeat: { type: 'yearly', month: 3 } }] };
  L.setActual(s, 'card', 'c', '2025-11', 2000); L.setActual(s, 'card', 'c', '2025-12', 3000); L.setActual(s, 'card', 'c', '2026-01', 4000);
  let ev = L.genEvents(s, '2026-01-31', '2026-03-31');
  assert.deepStrictEqual(ev.map((e) => [e.month, e.amount, e.confirmed]), [['2026-02', 3000, false], ['2026-03', 9000, false]]);
  // 年会費を含む3月の実績 10000 → 年会費分を除いた 4000 で平均
  L.setActual(s, 'card', 'c', '2026-02', 3000); L.setActual(s, 'card', 'c', '2026-03', 10000);
  ev = L.genEvents(s, '2026-03-31', '2026-04-30');
  assert.strictEqual(ev[0].amount, Math.round((4000 + 3000 + 4000) / 3));
});
t('v5.5 入力待ち・通知は発生する月だけ／仮は直近3回平均・なければ登録額', () => {
  const p = { id: 'w', name: '水道', amount: 5000, accountId: 'a1', day: 20, variable: true, fixDay: 10, active: true, repeat: { type: 'every', n: 2, start: '2026-01' } };
  const s = { accounts: [acc0('2025-12-31')], cards: [], payments: [p], incomes: [], actuals: {} };
  let ev = L.genEvents(s, '2025-12-31', '2026-06-30');
  assert.deepStrictEqual(ev.map((e) => [e.date, e.fixDate, e.amount, e.source]), [['2026-01-20', '2026-01-10', 5000, 'initial'], ['2026-03-20', '2026-03-10', 5000, 'initial'], ['2026-05-20', '2026-05-10', 5000, 'initial']]);
  assert.deepStrictEqual(L.computePending(s, '2026-02-15').map((e) => e.month), ['2026-01']);   // 2月は発生しないので入力待ちなし
  assert.deepStrictEqual(L.computePending(s, '2026-03-01').map((e) => e.month), ['2026-01']);   // 3月分は確定日(3/10)前
  assert.deepStrictEqual(L.computePending(s, '2026-03-12').map((e) => [e.month, e.status]), [['2026-03', 'awaiting']]);
  assert.deepStrictEqual(L.computeReminders(s, '2026-01-11', 60).map((r) => r.date), ['2026-03-10']);
  L.setActual(s, 'pay', 'w', '2026-01', 6000); L.setActual(s, 'pay', 'w', '2026-03', 7000);
  ev = L.genEvents(s, '2026-04-30', '2026-05-31');
  assert.deepStrictEqual([ev[0].amount, ev[0].source, ev[0].n], [6500, 'average', 2]);
  const y = { id: 'y', name: '固定資産税', amount: 80000, accountId: 'a1', day: 30, variable: true, fixDay: null, active: true, repeat: { type: 'yearly', month: 4 } };
  const s2 = { accounts: [acc0('2025-12-31')], cards: [], payments: [y], incomes: [], actuals: {} };
  assert.strictEqual(L.genEvents(s2, '2025-12-31', '2026-12-31')[0].amount, 80000);   // 実績なし→入力した金額
  L.setActual(s2, 'pay', 'y', '2025-04', 82000);
  assert.strictEqual(L.genEvents(s2, '2025-12-31', '2026-12-31')[0].amount, 82000);
});
t('v5.5 収入も繰り返し（賞与 6・12月 = 6か月ごと）', () => {
  const s = { accounts: [acc0()], cards: [], payments: [], actuals: {},
    incomes: [{ id: 'b', name: '賞与', amount: 400000, day: 10, accountId: 'a1', active: true, repeat: { type: 'every', n: 6, start: '2026-06' } }] };
  assert.deepStrictEqual(L.genEvents(s, '2025-12-31', '2027-12-31').map((e) => e.date), ['2026-06-10', '2026-12-10', '2027-06-10', '2027-12-10']);
  assert.strictEqual(L.project(s, '2026-12-31', 'all').endBalance, 1800000);
});

/* ---------- v5.7 ---------- */
t('firstNegativeWithin: 合計が最初にマイナスになる日と金額（期間外は無視）', () => {
  const s = base(); s.accounts[0].balance = 20000; s.incomes = [];
  const r = L.firstNegativeWithin(s, 'all', '2025-01-15', '2025-03-16');
  assert.strictEqual(r.date, '2025-01-31');
  assert.strictEqual(r.balance, -32000);
  assert.strictEqual(r.accountName, null);
  assert.strictEqual(r.provisional, false);
  assert.strictEqual(L.firstNegativeWithin(s, 'all', '2025-01-15', '2025-01-30'), null);
  assert.strictEqual(L.firstNegativeWithin(base(), 'all', '2025-01-15', '2025-03-16'), null);
});
t('firstNegativeWithin: 合計はプラスでも口座がマイナスなら口座名つき / 口座スコープ', () => {
  const s = base(); s.incomes = [];
  s.accounts[0].balance = 30000;
  s.accounts.push({ id: 'a2', name: '貯金', balance: 500000, asOf: '2025-01-15' });
  const r = L.firstNegativeWithin(s, 'all', '2025-01-15', '2025-03-16');
  assert.strictEqual(r.date, '2025-01-31');
  assert.strictEqual(r.balance, -22000);
  assert.strictEqual(r.accountName, 'メイン');
  assert.ok(r.total > 0);
  const r2 = L.firstNegativeWithin(s, 'a1', '2025-01-15', '2025-03-16');
  assert.strictEqual(r2.balance, -22000);
  assert.strictEqual(r2.accountName, null);
  assert.strictEqual(L.firstNegativeWithin(s, 'a2', '2025-01-15', '2025-03-16'), null);
});
t('firstNegativeWithin: 仮の金額を含むと provisional / 今すでにマイナスなら今日', () => {
  const s = base(); s.incomes = []; s.accounts[0].balance = 1000; s.cards[0].variable = true;
  const r = L.firstNegativeWithin(s, 'all', '2025-01-15', '2025-03-16');
  assert.strictEqual(r.date, '2025-01-27');
  assert.strictEqual(r.provisional, true);
  const s2 = base(); s2.accounts[0].balance = -500;
  const r2 = L.firstNegativeWithin(s2, 'all', '2025-01-20', '2025-03-16');
  assert.strictEqual(r2.date, '2025-01-20'); assert.strictEqual(r2.balance, -500);
  assert.strictEqual(L.firstNegativeWithin({ accounts: [], cards: [], payments: [], incomes: [], actuals: {} }, 'all', '2025-01-20', '2025-03-16'), null);
});
t('nextDebit: 次の引き落とし日・その日の最大・ほか件数・仮', () => {
  const s = base();
  s.payments.push({ id: 'p5', name: '保険', amount: 8000, cardId: null, accountId: 'a1', day: 27, active: true });
  const r = L.nextDebit(s, 'all', '2025-01-16');
  assert.strictEqual(r.date, '2025-01-27');
  assert.strictEqual(r.top.label, '保険'); assert.strictEqual(r.top.amount, 8000);
  assert.strictEqual(r.others, 1); assert.strictEqual(r.total, 10000);
  assert.strictEqual(r.provisional, false);
  // 収入は対象外、当日を含む（基準日より後なら）
  const r2 = L.nextDebit(s, 'all', '2025-01-28');
  assert.strictEqual(r2.date, '2025-01-31'); assert.strictEqual(r2.top.label, '家賃'); assert.strictEqual(r2.others, 0);
  assert.strictEqual(L.nextDebit(s, 'all', '2025-01-31').date, '2025-01-31');
  // 変動カードは仮
  const s3 = base(); s3.cards[0].variable = true;
  const r3 = L.nextDebit(s3, 'all', '2025-01-16');
  assert.strictEqual(r3.date, '2025-01-27'); assert.strictEqual(r3.provisional, true); assert.strictEqual(r3.top.confirmed, false);
  // 口座スコープ
  assert.strictEqual(L.nextDebit(s, 'zz', '2025-01-16'), null);
});
t('nextDebit: 基準日当日（残高に反映済み）の支払いは出さない', () => {
  const s = base(); s.accounts[0].asOf = '2025-01-27';
  assert.strictEqual(L.nextDebit(s, 'all', '2025-01-27').date, '2025-01-31');
});
t('previousActual / compareAmounts: 先月・前回と差額、30%判定', () => {
  const s = base(); s.actuals = { 'card:c1:2025-01': { amount: 37000 }, 'card:c1:2025-03': { amount: 40000 } };
  assert.deepStrictEqual(L.previousActual(s, 'card', 'c1', '2025-02'), { month: '2025-01', amount: 37000, label: '先月' });
  assert.deepStrictEqual(L.previousActual(s, 'card', 'c1', '2025-04'), { month: '2025-03', amount: 40000, label: '先月' });
  assert.strictEqual(L.previousActual(s, 'card', 'c1', '2025-06').label, '前回');
  assert.strictEqual(L.previousActual(s, 'card', 'c1', '2025-01'), null);
  assert.strictEqual(L.previousActual(s, 'card', 'zz', '2025-04'), null);
  const c = L.compareAmounts(37000, 45000);
  assert.strictEqual(c.diff, 8000); assert.strictEqual(c.big, false);
  assert.strictEqual(L.compareAmounts(10000, 13000).big, true);
  assert.strictEqual(L.compareAmounts(10000, 7000).big, true);
  assert.strictEqual(L.compareAmounts(10000, 7001).big, false);
  assert.strictEqual(L.compareAmounts(0, 500).big, true);
  assert.strictEqual(L.compareAmounts(0, 0).big, false);
  assert.strictEqual(L.compareAmounts(1000, NaN), null);
});
t('previousActual: 毎年の支払いは「前回」', () => {
  const s = { accounts: [acc0()], cards: [], incomes: [], payments: [{ id: 'y', name: '自動車税', amount: 39500, accountId: 'a1', day: 31, variable: true, repeat: { type: 'yearly', month: 5 } }], actuals: { 'pay:y:2025-05': { amount: 39500 } } };
  assert.deepStrictEqual(L.previousActual(s, 'pay', 'y', '2026-05'), { month: '2025-05', amount: 39500, label: '前回' });
});
t('validateBackup: 正常・壊れたファイル・別アプリ・新しすぎる版', () => {
  const ok = L.validateBackup(Object.assign({ app: 'money-app', exportedAt: '2025-01-15T00:00:00Z', version: 2 }, base()));
  assert.strictEqual(ok.ok, true);
  assert.deepStrictEqual(ok.counts, { accounts: 1, cards: 1, payments: 4, incomes: 1, actuals: 0, imports: 0 });
  assert.strictEqual(ok.state.app, undefined); assert.strictEqual(ok.state.version, L.SCHEMA_VERSION);
  assert.strictEqual(ok.exportedAt, '2025-01-15T00:00:00Z');
  assert.strictEqual(L.validateBackup(JSON.stringify(base())).ok, true);   // 文字列もOK・旧形式（app無し）もOK
  assert.strictEqual(L.validateBackup('{oops').ok, false);
  assert.strictEqual(L.validateBackup({ x: 1 }).ok, false);
  assert.strictEqual(L.validateBackup([]).ok, false);
  assert.strictEqual(L.validateBackup(null).ok, false);
  assert.strictEqual(L.validateBackup(Object.assign(base(), { app: 'other' })).ok, false);
  assert.strictEqual(L.validateBackup(Object.assign(base(), { cards: 'x' })).ok, false);
  assert.strictEqual(L.validateBackup(Object.assign(base(), { actuals: [] })).ok, false);
  assert.strictEqual(L.validateBackup(Object.assign(base(), { accounts: [{ name: 'IDなし', balance: 1 }] })).ok, false);
  assert.strictEqual(L.validateBackup(Object.assign(base(), { accounts: [{ id: 'a', balance: 'abc' }] })).ok, false);
  assert.strictEqual(L.validateBackup(Object.assign(base(), { version: 99 })).ok, false);
  const bad = L.validateBackup({ x: 1 }); assert.ok(typeof bad.error === 'string' && bad.error.length > 0);
});
t('backupFileName / backupStatus', () => {
  assert.strictEqual(L.backupFileName('2026-11-04'), 'money-backup-20261104.json');
  assert.deepStrictEqual(L.backupStatus(null, '2026-11-04'), { days: null, remind: true });
  assert.deepStrictEqual(L.backupStatus('2026-10-05', '2026-11-04'), { days: 30, remind: false });
  assert.deepStrictEqual(L.backupStatus('2026-10-04T10:00:00', '2026-11-04'), { days: 31, remind: true });
});
console.log(n + ' tests passed');
