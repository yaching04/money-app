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
  // 基準日をちょうど確定日に合わせると、その日(以前)は出ない
  s.accounts[0].asOf = '2025-01-10';
  assert.strictEqual(L.computePending(s, today).filter((e) => e.refId === 'pn').length, 0);
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
console.log(n + ' tests passed');
