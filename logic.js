/* 日付・残高予測・変動額(仮/確定)ロジック（DOM非依存。ブラウザと Node の両方で動く）
 * 将来 Web Push サーバーを作る場合も、このファイルをそのまま Node で require して
 * computeReminders() / computePending() を使える。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 2;
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (y, m, d) => String(y).padStart(4, '0') + '-' + pad(m) + '-' + pad(d);
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m は 1〜12
  // 31日指定でも30日/28日までの月は月末日に丸める
  const clampDay = (y, m, d) => Math.min(Math.max(1, d), daysInMonth(y, m));
  const dayNum = (s) => { const p = parse(s); return Math.round(Date.UTC(p.y, p.m - 1, p.d) / 864e5); };
  const addDays = (s, n) => { const t = new Date((dayNum(s) + n) * 864e5); return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
  const today = () => { const t = new Date(); return fmt(t.getFullYear(), t.getMonth() + 1, t.getDate()); };
  const endOfMonth = (s) => { const p = parse(s); return fmt(p.y, p.m, daysInMonth(p.y, p.m)); };
  const addMonthsEnd = (s, n) => { const p = parse(s); const t = new Date(Date.UTC(p.y, p.m - 1 + n, 1)); return endOfMonth(fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, 1)); };
  const monthKey = (s) => s.slice(0, 7);
  const addMonthKey = (k, n) => { const [y, m] = k.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1); };
  const monthFirst = (k) => k + '-01';
  const monthLast = (k) => endOfMonth(k + '-01');

  /** 毎月 day 日の発生日のうち、fromEx より後（含まない）〜 toIn 以前（含む）を返す */
  function monthlyDates(day, fromEx, toIn) {
    const out = [];
    if (!(day >= 1) || !fromEx || !toIn || fromEx >= toIn) return out;
    let { y, m } = parse(fromEx);
    const end = parse(toIn);
    let guard = 0;
    while ((y < end.y || (y === end.y && m <= end.m)) && guard++ < 1200) {
      const ds = fmt(y, m, clampDay(y, m, day));
      if (ds > fromEx && ds <= toIn) out.push(ds);
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }

  /** 引き落とし(入金)日 W に対する「金額の確定日」: fixDay の日のうち W 以前で最も近い日。
   *  例) 確定日15・引落27 → 同月15日 / 確定日31(月末)・引落10 → 前月末 / fixDay 未設定 → W 当日 */
  function confirmDate(fixDay, W) {
    fixDay = Number(fixDay);
    if (!(fixDay >= 1)) return W;
    const p = parse(W);
    const same = fmt(p.y, p.m, clampDay(p.y, p.m, fixDay));
    if (same <= W) return same;
    const q = parse(addMonthKey(monthKey(W), -1) + '-01');
    return fmt(q.y, q.m, clampDay(q.y, q.m, fixDay));
  }

  /* ---------- 実績(確定額)と仮の金額 ---------- */
  // refKind: 'card'(カードの請求額) | 'pay'(口座直接の支払い) | 'inc'(収入)。month は引き落とし(入金)日の属する月 'YYYY-MM'
  const actualKey = (refKind, id, month) => refKind + ':' + id + ':' + month;

  /** その項目の実績一覧（月の昇順） */
  function history(state, refKind, id) {
    const pre = refKind + ':' + id + ':';
    const a = state.actuals || {};
    return Object.keys(a).filter((k) => k.startsWith(pre))
      .map((k) => ({ month: k.slice(pre.length), amount: Number(a[k].amount) }))
      .sort((x, y) => (x.month < y.month ? -1 : x.month > y.month ? 1 : 0));
  }

  /** 仮の金額 = 対象月より前の実績のうち直近(最大)3件の平均（四捨五入）。実績が無ければ初期見込み額 */
  function provisional(state, refKind, id, month, initial) {
    const h = history(state, refKind, id).filter((x) => x.month < month).slice(-3);
    if (h.length) return { amount: Math.round(h.reduce((s, x) => s + x.amount, 0) / h.length), source: 'average', n: h.length };
    return { amount: Number(initial || 0), source: 'initial', n: 0 };
  }

  /** 月ごとの金額。実績があれば確定(actual)、変動項目で実績なしなら仮、固定項目は確定(fixed) */
  function amountFor(state, refKind, id, month, initial, variable) {
    const a = (state.actuals || {})[actualKey(refKind, id, month)];
    if (a && isFinite(Number(a.amount))) return { amount: Number(a.amount), confirmed: true, source: 'actual', n: 0 };
    if (!variable) return { amount: Number(initial || 0), confirmed: true, source: 'fixed', n: 0 };
    const p = provisional(state, refKind, id, month, initial);
    return { amount: p.amount, confirmed: false, source: p.source, n: p.n };
  }

  function setActual(state, refKind, id, month, amount) {
    state.actuals = state.actuals || {};
    state.actuals[actualKey(refKind, id, month)] = { amount: Math.round(Number(amount)), at: new Date().toISOString() };
  }
  function removeActual(state, refKind, id, month) { if (state.actuals) delete state.actuals[actualKey(refKind, id, month)]; }

  /* ---------- ローン（毎月定額・利息は考慮しない） ----------
   * payment.loan = { start: 'YYYY-MM'(1回目の引き落とし月), count: 全支払回数 }。
   * 「引き落とし日が属する月」が start 〜 start+count-1 の間だけ毎月 amount が発生し、最後の回の後は自動で止まる。
   * カード払いのローンはカードの引き落とし日の月で数える。 */
  const loanDay = (state, p) => { const c = p.cardId ? (state.cards || []).find((x) => x.id === p.cardId) : null; return c ? Number(c.withdrawDay) : Number(p.day); };
  /** 月 month(引き落とし月) がローンの何回目か（範囲外・ローンでなければ 0） */
  function loanIndex(p, month) {
    if (!p.loan || !p.loan.start || !(Number(p.loan.count) >= 1)) return 0;
    const [sy, sm] = p.loan.start.split('-').map(Number), [y, m] = month.split('-').map(Number);
    const i = (y - sy) * 12 + (m - sm) + 1;
    return i >= 1 && i <= Number(p.loan.count) ? i : 0;
  }
  /** その月に発生する金額（通常の支払いは常に amount。ローンは範囲外の月は 0） */
  const payAmountIn = (p, month) => (p.loan ? (loanIndex(p, month) ? Number(p.amount || 0) : 0) : Number(p.amount || 0));
  /** ローンの状況。支払い済み＝引き落とし日が today 以前の回（今日の分は反映済みとして数える） */
  function loanInfo(state, p, todayStr) {
    if (!p.loan) return null;
    const total = Number(p.loan.count), start = p.loan.start, day = loanDay(state, p);
    let paid = 0, next = null;
    for (let i = 0; i < total; i++) {
      const mk = addMonthKey(start, i), pm = parse(monthFirst(mk));
      const d = fmt(pm.y, pm.m, clampDay(pm.y, pm.m, day));
      if (d <= todayStr) paid++; else if (!next) next = d;
    }
    const endMonth = addMonthKey(start, total - 1), pe = parse(monthFirst(endMonth));
    return { total, paid, remaining: total - paid, done: paid >= total, next, startMonth: start, endMonth,
      endDate: fmt(pe.y, pe.m, clampDay(pe.y, pe.m, day)), remainingAmount: (total - paid) * Number(p.amount || 0) };
  }
  /** 「すでに paid 回払い済み」から開始月を逆算（次回の引き落とし日が属する月の paid 回前） */
  function loanStartForPaid(day, paid, todayStr) {
    const t = parse(todayStr);
    const thisMonth = fmt(t.y, t.m, clampDay(t.y, t.m, day)) > todayStr;   // 今月の分がまだ先なら、次回は今月
    return addMonthKey(monthKey(todayStr), (thisMonth ? 0 : 1) - Math.max(0, Math.round(paid)));
  }
  /** 口座残高を「今日の残高」として更新（基準日も今日に）。今日より後の予定から再計算される */
  function setBalance(state, accountId, balance, todayStr) {
    const a = state.accounts.find((x) => x.id === accountId);
    if (!a || !isFinite(Number(balance))) return null;
    a.balance = Math.round(Number(balance)); a.asOf = todayStr || today();
    return a;
  }

  const activePayments = (state) => state.payments.filter((p) => p.active !== false);
  const isCardVariable = (c) => c.variable !== false;

  /**
   * 発生イベントを生成（fromEx より後〜toIn 以内）。
   * - カード払いは「カードごとに1件にまとめて」カードの引落日に口座から引かれる。
   *   カードが変動(既定)なら請求額は実績/仮、固定ならカード内の支払い合計で常に確定扱い
   * - 口座直接払いは各支払いの日。変動フラグがあれば実績/仮
   * - 収入は各収入の日。変動フラグがあれば実績/仮
   * 同日の順序は 支出 → 収入（安全側）
   * 各イベント: confirmed(確定=true/仮=false), source('actual'|'fixed'|'average'|'initial'), fixDate(確定日), variable, refKind/refId/month
   */
  function genEvents(state, fromEx, toIn) {
    const ev = [];
    const accIds = new Set(state.accounts.map((a) => a.id));
    const act = activePayments(state);
    for (const c of state.cards) {
      if (!accIds.has(c.accountId)) continue;
      const items = act.filter((p) => p.cardId === c.id);
      const variable = isCardVariable(c);
      for (const d of monthlyDates(Number(c.withdrawDay), fromEx, toIn)) {
        const month = monthKey(d);
        const mItems = items.filter((p) => payAmountIn(p, month) > 0);
        const sumItems = mItems.reduce((s, p) => s + payAmountIn(p, month), 0);
        const a = amountFor(state, 'card', c.id, month, sumItems, variable);
        if (!a.amount && a.source !== 'actual') continue;
        ev.push({ date: d, kind: 'card', delta: -a.amount, amount: a.amount, accountId: c.accountId, cardId: c.id, label: c.name,
          refKind: 'card', refId: c.id, month, variable, confirmed: a.confirmed, source: a.source, n: a.n,
          fixDate: confirmDate(c.fixDay, d), items: mItems.map((p) => ({ name: p.name, amount: payAmountIn(p, month), loan: p.loan ? loanIndex(p, month) + '/' + p.loan.count : undefined })) });
      }
    }
    for (const p of act) {
      if (p.cardId || !accIds.has(p.accountId)) continue;
      const variable = p.variable === true;
      for (const d of monthlyDates(Number(p.day), fromEx, toIn)) {
        const month = monthKey(d);
        if (p.loan && !loanIndex(p, month)) continue;
        const a = amountFor(state, 'pay', p.id, month, p.amount, variable);
        if (!a.amount && a.source !== 'actual') continue;
        ev.push({ date: d, kind: 'direct', delta: -a.amount, amount: a.amount, accountId: p.accountId, label: p.name, items: [], loan: p.loan ? { index: loanIndex(p, month), total: Number(p.loan.count) } : null,
          refKind: 'pay', refId: p.id, month, variable, confirmed: a.confirmed, source: a.source, n: a.n, fixDate: confirmDate(p.fixDay, d) });
      }
    }
    for (const i of state.incomes) {
      if (i.active === false || !accIds.has(i.accountId)) continue;
      const variable = i.variable === true;
      for (const d of monthlyDates(Number(i.day), fromEx, toIn)) {
        const month = monthKey(d);
        const a = amountFor(state, 'inc', i.id, month, i.amount, variable);
        if (!a.amount && a.source !== 'actual') continue;
        ev.push({ date: d, kind: 'income', delta: a.amount, amount: a.amount, accountId: i.accountId, label: i.name, items: [],
          refKind: 'inc', refId: i.id, month, variable, confirmed: a.confirmed, source: a.source, n: a.n, fixDate: confirmDate(i.fixDay, d) });
      }
    }
    const order = { card: 0, direct: 0, income: 1 };
    ev.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : order[a.kind] - order[b.kind] || a.label.localeCompare(b.label, 'ja'));
    return ev;
  }

  /**
   * 残高予測。口座の基準日(asOf)の「翌日」から target(含む)までのイベントを反映。
   * accountId: 'all'（合計）または口座ID
   * 戻り値に confirmedThrough: 「この日までは確定額のみで計算」の日付（最初の仮イベントの前日）。仮が無ければ null(=全期間確定)
   */
  function project(state, target, accountId) {
    const accs = (accountId && accountId !== 'all') ? state.accounts.filter((a) => a.id === accountId) : state.accounts.slice();
    const res = { startBalance: 0, endBalance: 0, events: [], minBalance: 0, minDate: null, negative: false, firstNegative: null, beforeAsOf: false, noAccounts: !accs.length, confirmedThrough: null, firstProvisional: null, minAsOf: null };
    if (!accs.length) return res;
    const asOf = {}; const run = {}; const names = {};
    for (const a of accs) { asOf[a.id] = a.asOf || today(); run[a.id] = Number(a.balance || 0); names[a.id] = a.name; }
    const sum = () => accs.reduce((s, a) => s + run[a.id], 0);
    res.startBalance = sum();
    const minAsOf = Object.values(asOf).sort()[0];
    res.minAsOf = minAsOf;
    res.beforeAsOf = target < minAsOf;
    let min = res.startBalance; let minDate = minAsOf;
    if (accs.some((a) => run[a.id] < 0)) res.negative = true;
    let provSeen = false;
    if (!res.beforeAsOf) {
      const raw = genEvents(state, minAsOf, target).filter((e) => asOf[e.accountId] !== undefined && e.date > asOf[e.accountId]);
      for (const e of raw) {
        run[e.accountId] += e.delta;
        const bal = sum();
        const accBal = run[e.accountId];
        const neg = bal < 0 || accBal < 0;
        if (!e.confirmed && !provSeen) { provSeen = true; res.firstProvisional = e; res.confirmedThrough = addDays(e.date, -1); }
        const row = Object.assign({}, e, { balance: bal, accountBalance: accBal, accountName: names[e.accountId], negative: neg, uncertain: provSeen });
        res.events.push(row);
        if (bal < min) { min = bal; minDate = e.date; }
        if (neg && !res.firstNegative) res.firstNegative = row;
        if (neg) res.negative = true;
      }
    }
    res.endBalance = sum();
    res.minBalance = min; res.minDate = minDate;
    return res;
  }

  /** 月表示用: 1日ごとの残高・支出・収入（確定/仮の内訳つき） */
  function dailySeries(state, accountId, month) {
    const first = monthFirst(month), last = monthLast(month);
    const pr = project(state, last, accountId);
    const days = [];
    let idx = 0; let bal = pr.startBalance; let prov = false;
    // 月初より前のイベントを先に消化
    const evs = pr.events;
    const n = parse(last).d;
    for (let d = 1; d <= n; d++) {
      const date = fmt(parse(first).y, parse(first).m, d);
      const day = { date, balance: null, debit: 0, income: 0, debitProv: 0, incomeProv: 0, prov: false, neg: false, events: [] };
      while (idx < evs.length && evs[idx].date <= date) {
        const e = evs[idx++];
        bal = e.balance; if (!e.confirmed) prov = true;
        if (e.date === date) {
          day.events.push(e);
          if (e.delta < 0) { day.debit += e.amount; if (!e.confirmed) day.debitProv += e.amount; }
          else { day.income += e.amount; if (!e.confirmed) day.incomeProv += e.amount; }
        }
      }
      if (!pr.beforeAsOf && pr.minAsOf <= date) { day.balance = bal; day.prov = prov; day.neg = bal < 0; }
      days.push(day);
    }
    const vals = days.filter((d) => d.balance !== null).map((d) => d.balance);
    return { days, min: vals.length ? Math.min.apply(null, vals) : 0, max: vals.length ? Math.max.apply(null, vals) : 0, hasData: vals.length > 0, result: pr };
  }

  /** 月の集計（口座の基準日に関係なく、その月に発生する予定すべて） */
  function monthEvents(state, month) {
    return genEvents(state, addDays(monthFirst(month), -1), monthLast(month));
  }

  /** 毎月の合計（登録額ベース。参考用） */
  function monthlySummary(state, month) {
    const mk = month || monthKey(today());
    const act = activePayments(state).filter((p) => !p.loan || loanIndex(p, mk));
    const cards = state.cards.map((c) => {
      const items = act.filter((p) => p.cardId === c.id && (!p.loan || loanIndex(p, mk)));
      return { card: c, count: items.length, total: items.reduce((s, p) => s + Number(p.amount || 0), 0) };
    });
    const direct = act.filter((p) => !p.cardId);
    const directTotal = direct.reduce((s, p) => s + Number(p.amount || 0), 0);
    const cardTotal = cards.reduce((s, c) => s + c.total, 0);
    const incomeTotal = state.incomes.filter((i) => i.active !== false).reduce((s, i) => s + Number(i.amount || 0), 0);
    return { cards, direct: { count: direct.length, total: directTotal }, paymentsTotal: cardTotal + directTotal, incomeTotal };
  }

  /* ---------- 金額入力待ち(インボックス)と通知 ---------- */
  /** 確定日が今日以前で、まだ実績が入っていない変動項目（支払日が45日以内に過ぎたものも含む） */
  function computePending(state, todayStr) {
    // 口座の基準日（残高の日付）以前の確定日、および項目の作成日より前の確定日は入力を求めない
    const asOf = {}; for (const a of state.accounts) asOf[a.id] = a.asOf;
    const coll = { card: state.cards, pay: state.payments, inc: state.incomes };
    return genEvents(state, addDays(todayStr, -45), addDays(todayStr, 62))
      .filter((e) => {
        if (!e.variable || e.confirmed || e.fixDate > todayStr) return false;
        const base = asOf[e.accountId];
        if (base && e.fixDate <= base) return false;
        const it = (coll[e.refKind] || []).find((x) => x.id === e.refId);
        if (it && it.createdAt && e.fixDate < it.createdAt) return false;
        return true;
      });
  }

  /** 今後 days 日以内に確定日が来る項目を日付ごとにまとめ、朝8:00(JST)の通知予定を返す */
  function computeReminders(state, todayStr, days) {
    days = days == null ? 14 : days;
    const evs = genEvents(state, addDays(todayStr, -1), addDays(todayStr, days + 62))
      .filter((e) => e.variable && !e.confirmed && e.fixDate >= todayStr && e.fixDate <= addDays(todayStr, days));
    const byDate = {};
    for (const e of evs) { (byDate[e.fixDate] = byDate[e.fixDate] || { date: e.fixDate, at: new Date(e.fixDate + 'T08:00:00+09:00'), names: [], keys: [] });
      byDate[e.fixDate].names.push(e.label); byDate[e.fixDate].keys.push(actualKey(e.refKind, e.refId, e.month)); }
    return Object.keys(byDate).sort().map((k) => Object.assign(byDate[k], {
      title: '金額の入力をお願いします',
      body: byDate[k].names.join('、') + ' の請求額がわかる日です。金額を入力すると残高予測が正確になります。' }));
  }

  /* ---------- データ形式の移行 ---------- */
  /** v1 / v2 / 不完全なデータを v2 形式に整える（元のオブジェクトは変更しない） */
  function migrate(o) {
    o = o && typeof o === 'object' ? JSON.parse(JSON.stringify(o)) : {};
    const ver = Number(o.version) || 1;
    const s = { version: SCHEMA_VERSION, accounts: [], cards: [], payments: [], incomes: [], actuals: {}, settings: { targetDate: null, projAccount: 'all', viewMonth: null } };
    for (const k of ['accounts', 'cards', 'payments', 'incomes']) s[k] = Array.isArray(o[k]) ? o[k] : [];
    if (o.actuals && typeof o.actuals === 'object' && !Array.isArray(o.actuals)) s.actuals = o.actuals;
    s.settings = Object.assign(s.settings, o.settings || {});
    for (const c of s.cards) {
      if (c.fixDay == null) c.fixDay = null;
      // v1 のカードは請求額固定の挙動だったので変動なしに移行。v2 は未指定なら変動(既定)
      c.variable = ver < 2 ? false : c.variable !== false;
    }
    for (const p of s.payments) { p.variable = ver < 2 ? false : p.variable === true; if (p.fixDay === undefined) p.fixDay = null; }
    for (const i of s.incomes) { i.variable = ver < 2 ? false : i.variable === true; if (i.fixDay === undefined) i.fixDay = null; }
    return s;
  }

  return { SCHEMA_VERSION, pad, fmt, parse, daysInMonth, clampDay, dayNum, addDays, today, endOfMonth, addMonthsEnd, monthKey, addMonthKey, monthFirst, monthLast,
    loanIndex, payAmountIn, loanInfo, loanStartForPaid, setBalance,
    monthlyDates, confirmDate, actualKey, history, provisional, amountFor, setActual, removeActual, genEvents, project, dailySeries, monthEvents, monthlySummary,
    computePending, computeReminders, migrate };
});
