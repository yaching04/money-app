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
  const parse = (s) => { const [y, m, d] = String(s == null ? '' : s).split('-').map(Number); return { y, m, d }; };
  /** 実在する 'YYYY-MM-DD' か */
  const isDateStr = (s) => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const p = parse(s); return p.m >= 1 && p.m <= 12 && p.d >= 1 && p.d <= daysInMonth(p.y, p.m); };
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m は 1〜12
  // 31日指定でも30日/28日までの月は月末日に丸める
  /** 「月末」を表す日の値（数値のまま保存。clampDay で各月の最終日になる。29〜31日も同様に月末に丸める） */
  const END_DAY = 99;
  const isEndDay = (d) => Number(d) === END_DAY;
  /** 日の表示: 25 → '25日' / 月末 → '月末' / 未設定 → '' */
  const dayLabel = (d) => d == null || d === '' || !(Number(d) >= 1) ? '' : isEndDay(d) ? '月末' : Number(d) + '日';
  const clampDay = (y, m, d) => Math.min(Math.max(1, d), daysInMonth(y, m));
  const dayNum = (s) => { const p = parse(s); return Math.round(Date.UTC(p.y, p.m - 1, p.d) / 864e5); };
  const addDays = (s, n) => { const t = new Date((dayNum(s) + n) * 864e5); return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
  const today = () => { const t = new Date(); return fmt(t.getFullYear(), t.getMonth() + 1, t.getDate()); };
  const endOfMonth = (s) => { const p = parse(s); return fmt(p.y, p.m, daysInMonth(p.y, p.m)); };
  const addMonthsEnd = (s, n) => { const p = parse(s); const t = new Date(Date.UTC(p.y, p.m - 1 + n, 1)); return endOfMonth(fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, 1)); };
  const monthKey = (s) => String(s == null ? '' : s).slice(0, 7);
  const addMonthKey = (k, n) => { const [y, m] = String(k).split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1); };
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

  /* ---------- 繰り返し（毎月 / 毎年 / ◯か月ごと / 1回だけ） ----------
   * item.repeat が無い・type 'monthly' → 毎月（既存データはそのまま毎月）
   *   { type: 'yearly', month: 1〜12 }              毎年 month 月の day 日
   *   { type: 'every', n: 2〜12, start: 'YYYY-MM' }  start 月から n か月ごとの day 日（start より前は発生しない）
   *   { type: 'once', date: 'YYYY-MM-DD' }           その日に1回だけ（カード払いは date の月の請求に1回だけ含める）
   * カード払いの「月」はカードの引き落とし日が属する月（ローンと同じ数え方）。
   * 1か月に発生するのは最大1回なので、実績(確定額)は従来どおり「月」単位で記録できる。 */
  const repType = (it) => { const r = it && it.repeat; return r && ['yearly', 'every', 'once'].includes(r.type) ? r.type : 'monthly'; };
  const monthDiff = (a, b) => { const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number); return (by - ay) * 12 + (bm - am); };
  /** 月 month('YYYY-MM') にその項目が発生するか（ローンは別扱い：loanIndex） */
  function occursIn(it, month) {
    const r = it && it.repeat, t = repType(it);
    if (t === 'monthly') return true;
    if (t === 'yearly') return Number(month.slice(5)) === Number(r.month);
    if (t === 'every') { const n = Math.max(1, Math.round(Number(r.n) || 1)); if (!/^\d{4}-\d{2}$/.test(r.start || '')) return false; const d = monthDiff(r.start, month); return d >= 0 && d % n === 0; }
    if (t === 'once') return typeof r.date === 'string' && r.date.slice(0, 7) === month;
    return true;
  }
  /** 口座直接の支払い・収入の発生日（fromEx より後〜toIn 以内）。1回だけは指定日そのもの */
  function itemDates(it, fromEx, toIn) {
    const t = repType(it);
    if (t === 'once') { const d = it.repeat.date; return /^\d{4}-\d{2}-\d{2}$/.test(d || '') && d > fromEx && d <= toIn ? [d] : []; }
    return monthlyDates(Number(it.day), fromEx, toIn).filter((d) => occursIn(it, monthKey(d)));
  }
  /** fromEx より後で最初の発生日（day はカード払いならカードの引き落とし日）。無ければ null */
  function nextOccurrence(it, day, fromEx) {
    const t = repType(it);
    if (t === 'once') { const r = it.repeat; if (!r.date) return null; const p = parse(r.date); const d = it.cardId ? fmt(p.y, p.m, clampDay(p.y, p.m, Number(day))) : r.date; return d > fromEx ? d : null; }
    const lim = monthLast(addMonthKey(monthKey(fromEx), 13));
    const ds = monthlyDates(Number(day), fromEx, lim).filter((d) => occursIn(it, monthKey(d)));
    return ds[0] || null;
  }
  /** 繰り返しの表示: 毎月25日 / 毎年4月27日 / 6か月ごと・25日 / 2026/12/10、1回だけ（カード払いの1回だけは 2026/12） */
  function repeatLabel(it, day) {
    const t = repType(it), r = it.repeat || {}, dl = dayLabel(day) || '';
    if (t === 'yearly') { const mo = Number(r.month); return '毎年' + mo + '月' + (isEndDay(day) || (mo >= 1 && mo <= 12 && Number(day) > daysInMonth(2000, mo)) ? '末' : dl); }   // 2月31日・4月31日などは「月末」
    if (t === 'every') return Number(r.n) + 'か月ごと・' + dl;
    if (t === 'once') { const p = r.date ? parse(r.date) : null; return p ? (it.cardId ? p.y + '/' + p.m : p.y + '/' + p.m + '/' + p.d) + '、1回だけ' : '1回だけ'; }
    return '毎月' + dl;
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
  const payAmountIn = (p, month) => (p.loan ? (loanIndex(p, month) ? Number(p.amount || 0) : 0) : occursIn(p, month) ? Number(p.amount || 0) : 0);
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
        let a = amountFor(state, 'card', c.id, month, sumItems, variable);
        // 変動カードの仮の金額: 過去の実績から「毎月ではない支払い（毎年・◯か月ごと・1回だけ）」の登録額を除いた平均＋今月発生するそれらの登録額
        // （年会費などが入った月の実績で平均がふくらまない／発生する月だけ上乗せされる）
        if (variable && a.source === 'average') {
          const irr = items.filter((p) => !p.loan && repType(p) !== 'monthly');
          const irrIn = (m) => irr.reduce((s, p) => s + payAmountIn(p, m), 0);
          const h = history(state, 'card', c.id).filter((x) => x.month < month).slice(-3);
          const avg = Math.round(h.reduce((s, x) => s + Math.max(0, x.amount - irrIn(x.month)), 0) / h.length);
          a = Object.assign({}, a, { amount: avg + irrIn(month) });
        }
        if (!a.amount && a.source !== 'actual') continue;
        ev.push({ date: d, kind: 'card', delta: -a.amount, amount: a.amount, accountId: c.accountId, cardId: c.id, label: c.name,
          refKind: 'card', refId: c.id, month, variable, confirmed: a.confirmed, source: a.source, n: a.n,
          fixDate: confirmDate(c.fixDay, d), items: mItems.map((p) => ({ name: p.name, amount: payAmountIn(p, month), loan: p.loan ? loanIndex(p, month) + '/' + p.loan.count : undefined })) });
      }
    }
    for (const p of act) {
      if (p.cardId || !accIds.has(p.accountId)) continue;
      const variable = p.variable === true;
      for (const d of (p.loan ? monthlyDates(Number(p.day), fromEx, toIn) : itemDates(p, fromEx, toIn))) {
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
      for (const d of itemDates(i, fromEx, toIn)) {
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
    const act = activePayments(state).filter((p) => payAmountIn(p, mk) > 0);
    const cards = state.cards.map((c) => {
      const items = act.filter((p) => p.cardId === c.id);
      return { card: c, count: items.length, total: items.reduce((s, p) => s + Number(p.amount || 0), 0) };
    });
    const direct = act.filter((p) => !p.cardId);
    const directTotal = direct.reduce((s, p) => s + Number(p.amount || 0), 0);
    const cardTotal = cards.reduce((s, c) => s + c.total, 0);
    const incomeTotal = state.incomes.filter((i) => i.active !== false && occursIn(i, mk)).reduce((s, i) => s + Number(i.amount || 0), 0);
    return { cards, direct: { count: direct.length, total: directTotal }, paymentsTotal: cardTotal + directTotal, incomeTotal };
  }

  /* ---------- 金額入力待ち(インボックス)と通知 ---------- */
  /** 確定日が今日以前で、まだ実績が入っていない変動項目（口座の残高の日付より後に引き落とされたものはすべて。最長2年前まで） */
  function computePending(state, todayStr) {
    // 引き落とし(入金)日が口座の基準日（残高の日付）以前＝もう残高に反映済みのものは入力を求めない。
    // 項目の作成日より前の確定日も求めない。※残高を今日に更新しても、これからの引き落としの入力待ちは消えない
    const asOf = {}; for (const a of state.accounts) asOf[a.id] = a.asOf;
    const coll = { card: state.cards, pay: state.payments, inc: state.incomes };
    // 残高の日付が古い口座があれば、その日付から（＝残高に影響する仮の項目はすべて出す）。ただし最長2年前まで
    let from = addDays(todayStr, -45);
    for (const a of state.accounts) if (isDateStr(a.asOf) && a.asOf < from) from = a.asOf;
    const limit = addDays(todayStr, -731); if (from < limit) from = limit;
    return genEvents(state, from, addDays(todayStr, 62))
      .filter((e) => {
        if (!e.variable || e.confirmed || e.fixDate > todayStr) return false;
        const base = asOf[e.accountId];
        if (base && e.date <= base) return false;
        const it = (coll[e.refKind] || []).find((x) => x.id === e.refId);
        if (it && it.createdAt && e.fixDate < it.createdAt) return false;
        return true;
      })
      // status: 'overdue'＝引き落とし(入金)日が今日以前＝その日以降の残高が確定しない（優先）
      //         'awaiting'＝確定日は過ぎたが引き落とし日はまだ先＝その前日までの残高は確定できる
      .map((e) => Object.assign(e, { status: e.date <= todayStr ? 'overdue' : 'awaiting' }))
      .sort((a, b) => (a.status === b.status ? 0 : a.status === 'overdue' ? -1 : 1)
        || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.fixDate < b.fixDate ? -1 : a.fixDate > b.fixDate ? 1 : 0));
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

  /* ---------- v5.7 ホームの1行表示（マイナス警告・次の支払い）と比較・バックアップ ---------- */
  /**
   * 残高がマイナスになる最初の日（todayStr 〜 toIn）。scope: 'all' or 口座ID。
   * 'all' のときは合計か、いずれかの口座がマイナスになった最初の時点。
   * 戻り値 { date, balance, provisional, accountName(口座単位のときのみ), total } / 無ければ null
   */
  function firstNegativeWithin(state, scope, todayStr, toIn) {
    const pr = project(state, toIn, scope);
    if (pr.noAccounts || pr.beforeAsOf) return null;
    const accs = scope && scope !== 'all' ? state.accounts.filter((a) => a.id === scope) : state.accounts;
    const multi = accs.length > 1;
    // 基準日時点ですでにマイナス
    const negAcc = accs.find((a) => Number(a.balance || 0) < 0);
    if (pr.startBalance < 0 || negAcc) {
      const totalNeg = pr.startBalance < 0;
      return { date: todayStr, balance: totalNeg ? pr.startBalance : Number(negAcc.balance), provisional: false, accountName: !totalNeg && multi ? negAcc.name : null, total: pr.startBalance };
    }
    // 金額は「その日の終わり」の残高（同じ日に複数の引き落とし・入金があっても、全部反映した後の金額）
    const accBal = {}; for (const a of accs) accBal[a.id] = Number(a.balance || 0);
    const evs = pr.events;
    for (let i = 0; i < evs.length; i++) {
      const date = evs[i].date; if (date > toIn) break;
      let j = i, firstNeg = null;
      for (; j < evs.length && evs[j].date === date; j++) { accBal[evs[j].accountId] = evs[j].accountBalance; if (evs[j].negative && !firstNeg) firstNeg = evs[j]; }
      const last = evs[j - 1]; i = j - 1;
      const total = last.balance;
      let worst = null; for (const a of accs) if (accBal[a.id] < 0 && (!worst || accBal[a.id] < accBal[worst.id])) worst = a;
      if (total >= 0 && !worst) continue;
      const totalNeg = total < 0;
      return { date: date < todayStr ? todayStr : date, balance: totalNeg ? total : accBal[worst.id], provisional: !!last.uncertain, accountName: !totalNeg && multi ? worst.name : null, total, label: (firstNeg || last).label };
    }
    return null;
  }

  /**
   * 次の支払い（引き落とし）日と、その日のいちばん大きい支払い。
   * todayStr 以降で、口座の基準日（残高の日付）より後のもの（＝まだ残高に反映されていない）。
   * 戻り値 { date, top(イベント), others(同じ日の他の件数), total, provisional(その日に仮を含む) } / 無ければ null
   */
  function nextDebit(state, scope, todayStr, days) {
    const lim = addDays(todayStr, days == null ? 62 : days);
    const asOf = {}; for (const a of state.accounts) asOf[a.id] = a.asOf || todayStr;
    const evs = genEvents(state, addDays(todayStr, -1), lim).filter((e) => e.delta < 0 && e.amount > 0
      && (!scope || scope === 'all' || e.accountId === scope) && asOf[e.accountId] !== undefined && e.date > asOf[e.accountId]);
    if (!evs.length) return null;
    const date = evs[0].date, same = evs.filter((e) => e.date === date);
    const top = same.slice().sort((a, b) => b.amount - a.amount)[0];
    return { date, top, others: same.length - 1, total: same.reduce((s, e) => s + e.amount, 0), provisional: same.some((e) => !e.confirmed), events: same };
  }

  /** 前回の実績（month より前の最新）。label: 直前の月なら「先月」、それ以外（毎年・◯か月ごと・間が空いた）は「前回」 */
  function previousActual(state, refKind, id, month) {
    const h = history(state, refKind, id).filter((x) => x.month < month);
    if (!h.length) return null;
    const last = h[h.length - 1];
    return { month: last.month, amount: last.amount, label: last.month === addMonthKey(month, -1) ? '先月' : '前回' };
  }
  /** 今回の金額と前回の比較。big: 30%以上の変化（前回0円で今回>0 も） */
  function compareAmounts(prev, cur, threshold) {
    threshold = threshold == null ? 0.3 : threshold;
    prev = Number(prev); cur = Number(cur);
    if (!isFinite(prev) || !isFinite(cur)) return null;
    const diff = Math.round(cur - prev);
    const ratio = prev ? diff / Math.abs(prev) : (diff ? Infinity : 0);
    return { diff, ratio, big: Math.abs(ratio) >= threshold };
  }

  /** バックアップファイルの検証。OK なら { ok:true, state(移行済み), counts, exportedAt } / NG なら { ok:false, error } */
  function validateBackup(o) {
    if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { return { ok: false, error: 'JSONファイルとして読み込めませんでした。' }; } }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, error: 'このアプリのバックアップではないようです。' };
    if (o.app && o.app !== 'money-app') return { ok: false, error: '別のアプリのファイルです。' };
    const keys = ['accounts', 'cards', 'payments', 'incomes'];
    if (!Array.isArray(o.accounts)) return { ok: false, error: 'このアプリのバックアップではないようです（口座のデータがありません）。' };
    if (keys.some((k) => o[k] != null && !Array.isArray(o[k]))) return { ok: false, error: 'データの一部が壊れています。' };
    if (o.actuals != null && (typeof o.actuals !== 'object' || Array.isArray(o.actuals))) return { ok: false, error: '実績のデータが壊れています。' };
    if (o.imports != null && (typeof o.imports !== 'object' || Array.isArray(o.imports))) return { ok: false, error: '明細のデータが壊れています。' };
    for (const k of keys) for (const x of (o[k] || [])) if (!x || typeof x !== 'object' || !x.id) return { ok: false, error: 'データの一部が壊れています（IDのない項目があります）。' };
    for (const a of o.accounts) if (!isFinite(Number(a.balance))) return { ok: false, error: '口座の残高が数字ではありません。' };
    if (Number(o.version) > SCHEMA_VERSION) return { ok: false, error: '新しいバージョンのアプリで作られたバックアップです。アプリを更新してから読み込んでください。' };
    const st = migrate(o);
    delete st.exportedAt; delete st.app;
    return { ok: true, state: st, exportedAt: typeof o.exportedAt === 'string' ? o.exportedAt : null, oldFormat: (Number(o.version) || 1) < SCHEMA_VERSION,
      empty: !st.accounts.length && !st.cards.length && !st.payments.length && !st.incomes.length,
      counts: { accounts: st.accounts.length, cards: st.cards.length, payments: st.payments.length, incomes: st.incomes.length, actuals: Object.keys(st.actuals).length,
        imports: Object.values(st.imports).reduce((n, byM) => n + Object.keys(byM).length, 0) } };
  }
  /** バックアップのファイル名 money-backup-YYYYMMDD.json */
  const backupFileName = (todayStr) => 'money-backup-' + todayStr.replace(/-/g, '') + '.json';
  /** 最後のバックアップから何日か（未保存は null）と、おすすめ表示（30日超 or 未保存） */
  function backupStatus(lastDate, todayStr) {
    if (!lastDate || !/^\d{4}-\d{2}-\d{2}/.test(lastDate)) return { days: null, remind: true };
    const d = dayNum(todayStr) - dayNum(lastDate.slice(0, 10));
    return { days: d, remind: d > 30 };
  }

  /* ---------- データの整え（壊れた・古い形式のバックアップでも画面が開けるように） ---------- */
  const finite = (v, def) => { const n = Number(v); return v !== null && v !== '' && typeof v !== 'boolean' && isFinite(n) ? n : def; };
  /** 'YYYY-MM-DD' / 'YYYY/M/D' / 'YYYY.M.D' / ISO 日時 → 'YYYY-MM-DD'。読めなければ null */
  function normDate(v) {
    if (typeof v !== 'string') return null;
    const m = v.trim().match(/^(\d{4})[\-\/.](\d{1,2})[\-\/.](\d{1,2})/); if (!m) return null;
    const ds = fmt(Number(m[1]), Number(m[2]), Number(m[3]));
    return isDateStr(ds) ? ds : null;
  }
  const normDay = (v, def) => { const n = Math.round(finite(v, NaN)); return n === END_DAY ? END_DAY : n >= 1 && n <= 31 ? n : def; };
  const str = (v, def) => (typeof v === 'string' ? v : v == null ? def : String(v));
  function sanitizeRepeat(r) {
    if (!r || typeof r !== 'object') return null;
    if (r.type === 'yearly') { const mo = Math.round(finite(r.month, NaN)); return mo >= 1 && mo <= 12 ? { type: 'yearly', month: mo } : null; }
    if (r.type === 'every') { const n = Math.round(finite(r.n, NaN)); const st = typeof r.start === 'string' && /^\d{4}-\d{2}/.test(r.start) ? r.start.slice(0, 7) : null; return n >= 1 && st ? { type: 'every', n: Math.min(n, 120), start: st } : null; }
    if (r.type === 'once') { const d = normDate(r.date); return d ? { type: 'once', date: d } : null; }
    return null;
  }
  /** 項目ごとに型を整える（その場で変更）。読めない日付は今日、数字でない金額は0、日にち不明は1日 */
  function sanitize(s) {
    const t = today();
    const objs = (arr) => arr.filter((x) => x && typeof x === 'object' && !Array.isArray(x) && x.id != null);
    for (const k of ['accounts', 'cards', 'payments', 'incomes']) s[k] = objs(s[k]);
    for (const a of s.accounts) { a.id = String(a.id); a.name = str(a.name, '口座'); a.balance = Math.round(finite(a.balance, 0)); a.asOf = normDate(a.asOf) || t; }
    for (const c of s.cards) {
      c.id = String(c.id); c.name = str(c.name, 'カード'); c.withdrawDay = normDay(c.withdrawDay, 27); c.fixDay = normDay(c.fixDay, null);
      if (c.accountId != null) c.accountId = String(c.accountId);
    }
    for (const p of s.payments.concat(s.incomes)) {
      p.id = String(p.id); p.name = str(p.name, '（名前なし）'); p.amount = Math.max(0, Math.round(finite(p.amount, 0))); p.day = normDay(p.day, 1);
      if (p.fixDay !== undefined) p.fixDay = normDay(p.fixDay, null);
      if (p.repeat != null) p.repeat = sanitizeRepeat(p.repeat);
      if (p.loan != null) { const st = p.loan && typeof p.loan.start === 'string' && /^\d{4}-\d{2}/.test(p.loan.start) ? p.loan.start.slice(0, 7) : null, n = Math.round(finite(p.loan && p.loan.count, NaN)); p.loan = st && n >= 1 ? { start: st, count: Math.min(n, 600) } : null; }
      if (p.createdAt !== undefined) { const d = normDate(p.createdAt); if (d) p.createdAt = d; else delete p.createdAt; }
      if (p.memo != null) p.memo = str(p.memo, '');
      if (p.cardId != null) p.cardId = String(p.cardId);
      if (p.accountId != null) p.accountId = String(p.accountId);
    }
    for (const k of Object.keys(s.actuals)) { const v = s.actuals[k]; if (!v || typeof v !== 'object' || !isFinite(finite(v.amount, NaN)) || !/^(card|pay|inc):.+:\d{4}-\d{2}$/.test(k)) delete s.actuals[k]; else v.amount = Math.round(Number(v.amount)); }
    const st = s.settings;
    if (!st || typeof st !== 'object' || Array.isArray(st)) s.settings = { targetDate: null, projAccount: 'all', viewMonth: null };
    else { if (st.targetDate != null && !normDate(st.targetDate)) st.targetDate = null; if (typeof st.projAccount !== 'string') st.projAccount = 'all'; if (st.viewMonth != null && !/^\d{4}-\d{2}$/.test(String(st.viewMonth))) st.viewMonth = null; }
    return s;
  }

  /* ---------- データ形式の移行 ---------- */
  /** v1 / v2 / 不完全なデータを v2 形式に整える（元のオブジェクトは変更しない） */
  function migrate(o) {
    o = o && typeof o === 'object' ? JSON.parse(JSON.stringify(o)) : {};
    const ver = Number(o.version) || 1;
    const s = { version: SCHEMA_VERSION, accounts: [], cards: [], payments: [], incomes: [], actuals: {}, settings: { targetDate: null, projAccount: 'all', viewMonth: null } };
    for (const k of ['accounts', 'cards', 'payments', 'incomes']) s[k] = Array.isArray(o[k]) ? o[k] : [];
    if (o.actuals && typeof o.actuals === 'object' && !Array.isArray(o.actuals)) s.actuals = o.actuals;
    s.settings = Object.assign(s.settings, o.settings && typeof o.settings === 'object' && !Array.isArray(o.settings) ? o.settings : {});
    // v5.8 明細CSVの取り込み { cardId: { 'YYYY-MM': { at, rows: [[日付, 店名, 金額]] } } }。形の崩れた部分は捨てる
    s.imports = {};
    if (o.imports && typeof o.imports === 'object' && !Array.isArray(o.imports)) {
      for (const [cid, byM] of Object.entries(o.imports)) {
        if (!byM || typeof byM !== 'object' || Array.isArray(byM)) continue;
        for (const [m, v] of Object.entries(byM)) {
          if (!/^\d{4}-\d{2}$/.test(m) || !v || !Array.isArray(v.rows)) continue;
          const rows = v.rows.filter((r) => Array.isArray(r) && r.length >= 3 && isFinite(Number(r[2])));
          (s.imports[cid] = s.imports[cid] || {})[m] = { at: typeof v.at === 'string' ? v.at : null, rows };
        }
      }
    }
    sanitize(s);
    for (const c of s.cards) {
      if (c.fixDay == null) c.fixDay = null;
      // v1 のカードは請求額固定の挙動だったので変動なしに移行。v2 は未指定なら変動(既定)
      c.variable = ver < 2 ? false : c.variable !== false;
    }
    for (const p of s.payments) { p.variable = ver < 2 ? false : p.variable === true; if (p.fixDay === undefined) p.fixDay = null; }
    for (const i of s.incomes) { i.variable = ver < 2 ? false : i.variable === true; if (i.fixDay === undefined) i.fixDay = null; }
    return s;
  }

  return { SCHEMA_VERSION, END_DAY, isEndDay, isDateStr, normDate, dayLabel, pad, fmt, parse, daysInMonth, clampDay, dayNum, addDays, today, endOfMonth, addMonthsEnd, monthKey, addMonthKey, monthFirst, monthLast,
    repType, occursIn, itemDates, nextOccurrence, repeatLabel, loanIndex, payAmountIn, loanInfo, loanStartForPaid, setBalance,
    monthlyDates, confirmDate, actualKey, history, provisional, amountFor, setActual, removeActual, genEvents, project, dailySeries, monthEvents, monthlySummary,
    computePending, computeReminders, migrate,
    firstNegativeWithin, nextDebit, previousActual, compareAmounts, validateBackup, backupFileName, backupStatus };
});
