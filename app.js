/* 支払い管理アプリ v2（UI）。データは localStorage に保存。計算は logic.js、通知は notify.js */
(function () {
  'use strict';
  const L = window.Logic;
  const KEY = 'money-app-v1'; // v1 と同じキーを使い、読み込み時に migrate() で v2 形式へ
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const fin = (n) => { n = Number(n); return isFinite(n) ? n : 0; };   // 壊れたデータでも「¥NaN」を出さない
  const yen = (n) => { n = fin(n); return (n < 0 ? '−' : '') + '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP'); };
  const yenAbs = (n) => '¥' + Math.abs(Math.round(fin(n))).toLocaleString('ja-JP');
  const short = (n) => { n = fin(n); const a = Math.abs(n); const s = a >= 10000 ? (Math.round(a / 1000) / 10).toString().replace(/\.0$/, '') + '万' : Math.round(a).toString(); return (n < 0 ? '−' : '') + s; };
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const dow = (s) => { const p = L.parse(s); return WD[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]; };
  const md = (s) => { if (!L.isDateStr(s)) return '—'; const p = L.parse(s); return p.m + '/' + p.d + '(' + dow(s) + ')'; };
  const ymd = (s) => { if (!L.isDateStr(s)) return '—'; const p = L.parse(s); return p.y + '年' + p.m + '月' + p.d + '日(' + dow(s) + ')'; };
  const ymLabel = (k) => { if (!/^\d{4}-\d{2}/.test(String(k))) return '—'; const [y, m] = String(k).split('-'); return y + '年' + Number(m) + '月'; };

  /* ---------- 状態 ---------- */
  function load() { try { return L.migrate(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return L.migrate(null); } }
  let state = load();
  let notifTimer;
  const save = () => {
    state.version = L.SCHEMA_VERSION;
    localStorage.setItem(KEY, JSON.stringify(state));
    clearTimeout(notifTimer); notifTimer = setTimeout(syncNotify, 500);
  };
  async function syncNotify() { try { if (window.Notify) lastNotify = await Notify.sync(state, L); } catch (e) { /* 通知は補助機能 */ } }
  let lastNotify = null;
  let tab = 'home';
  let sumMonth = null;
  const todayStr = () => L.today();
  // 指定日・表示月は保存しない（アプリを開くたびに今日から）
  const sel = { target: null, vm: null };
  const getTarget = () => sel.target || todayStr();
  const getViewMonth = () => sel.vm || L.monthKey(getTarget());
  const getScope = () => { const a = state.settings.projAccount || 'all'; return a === 'all' || byId(state.accounts, a) ? a : 'all'; };
  const byId = (arr, id) => arr.find((x) => x.id === id);
  const itemOf = (kind, id) => byId(kind === 'card' ? state.cards : kind === 'pay' ? state.payments : state.incomes, id);
  const initialOf = (kind, it, month) => kind === 'card' ? state.payments.filter((p) => p.active !== false && p.cardId === it.id).reduce((s, p) => s + L.payAmountIn(p, month || L.monthKey(todayStr())), 0) : Number(it.amount || 0);
  function cleanActuals() {
    for (const k of Object.keys(state.actuals)) {
      const [kind, id] = k.split(':');
      if (!itemOf(kind, id)) delete state.actuals[k];
    }
    if (window.CsvImport) CsvImport.cleanImports(state);
  }

  let toastTimer;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2400); }
  const sampleTag = (x) => (x.sample ? '<span class="tag sample">サンプル</span>' : '');
  const PV = '<span class="tag prov">仮</span>';
  // 符号つき金額: 確定=支出は赤・収入は緑 / 仮=「仮 −¥1,000」（金額は黒）
  const sgn = (delta, amount, confirmed) => { const t = (delta < 0 ? '−' : '+') + yenAbs(amount); return confirmed ? `<span class="sg ${delta < 0 ? 'neg-t' : 'pos-t'}">${t}</span>` : `<span class="sg">${PV} <span class="amt-p">${t}</span></span>`; };
  const pvYen = (n, prov) => `<span class="sg">${prov ? PV + ' ' : ''}${yen(n)}</span>`;   // 残高など（マイナスは赤のまま）
  const badge = (e) => (e.confirmed ? '<span class="tag ok">確定額</span>' : '<span class="tag prov">仮</span>');
  const srcText = (e) => e.source === 'actual' ? '実績' : e.source === 'average' ? '直近' + e.n + '回の実績平均' : e.source === 'initial' ? '初期見込み額（実績なし）' : '';

  /* v5.7: 実績入力の下に「先月 ¥37,000（+¥8,000）」。毎年・◯か月ごと・間が空いたときは「前回（5月）」。30%以上の変化は控えめに強調 */
  function cmpInner(kind, id, month, val) {
    const pa = L.previousActual(state, kind, id, month);
    if (!pa) return '';
    const it = itemOf(kind, id), rt = it && kind !== 'card' ? L.repType(it) : 'monthly';
    const label = pa.label === '先月' && rt === 'monthly' ? '先月' : '前回（' + (pa.month.slice(0, 4) === month.slice(0, 4) ? '' : pa.month.slice(0, 4) + '年') + Number(pa.month.slice(5)) + '月）';
    let t = `${label} ${yenAbs(pa.amount)}`, big = false;
    if (val !== '' && val != null && isFinite(Number(val))) {
      const c = L.compareAmounts(pa.amount, Number(val));
      t += `（${c.diff > 0 ? '+' : c.diff < 0 ? '−' : '±'}${yenAbs(c.diff)}）`; big = c.big;
    }
    return `<span class="${big ? 'cmp-big' : ''}">${t}${big ? '・大きく変わっています' : ''}</span>`;
  }
  // 入力欄に比較表示をつなぐ（box: 表示先, get: {kind,id,month}）
  function bindCmp(inp, box, get) {
    const up = () => { const g = get(); box.innerHTML = g ? cmpInner(g.kind, g.id, g.month, inp.value) : ''; box.hidden = !box.innerHTML; };
    inp.addEventListener('input', up); up(); return up;
  }

  /* ---------- 共通パーツ: 予定の1行 ---------- */
  function eventRow(e, o) {
    o = o || {};
    const kindTag = e.kind === 'income' ? '<span class="tag inc">収入</span>' : e.kind === 'card' ? '<span class="tag">カード</span>' : '<span class="tag dir">口座直接</span>';
    const items = o.items !== false && e.kind === 'card' && e.items.length ? `<ul class="items">${e.items.map((i) => `<li>・${esc(i.name)} <span class="sg">${yenAbs(i.amount)}</span></li>`).join('')}</ul>` : '';
    const acc = byId(state.accounts, e.accountId);
    const accLine = state.accounts.length > 1 && acc ? `<small>${esc(acc.name)}${o.balance && o.multi ? '：残高 ' + pvYen(e.accountBalance, e.uncertain) : ''}</small>` : '';
    let right = `<div class="amt">${sgn(e.delta, e.amount, e.confirmed)}</div>`;
    if (o.balance) right += `<small class="${e.negative ? 'neg-t' : ''}">残高 ${pvYen(e.balance, e.uncertain)}${e.negative ? ' ⚠' : ''}</small>`;
    const p = L.parse(e.date);
    const sub = [srcText(e), e.variable ? '明細が確定する日 ' + md(e.fixDate) : ''].filter(Boolean).join('・');
    const tap = e.variable ? `data-act="enter" data-kind="${e.refKind}" data-id="${e.refId}" data-month="${e.month}"` : '';
    return `<div class="ev ${o.balance && e.negative ? 'bad' : ''} ${e.confirmed ? '' : 'prov'} ${e.variable ? 'tap' : ''}" ${tap}>
      <div class="d"><b>${p.m}/${p.d}</b>(${dow(e.date)})</div>
      <div class="m">${kindTag}<b>${esc(e.label)}</b>${accLine}${sub ? `<small>${esc(sub)}${e.variable ? ' ✎' : ''}</small>` : ''}${items}</div>
      <div class="a">${right}</div></div>`;
  }

  /* ---------- チャート（SVG・外部ライブラリなし） ---------- */
  function chartGeo(ds, bars) {
    // v6.0.3: 縦軸ラベルの幅を見積もって左余白を決める（大きい残高でも切れない）
    let padL = bars ? 34 : 48;
    if (!bars) {
      const lw = (t) => [...t].reduce((w, ch) => w + (/[0-9.]/.test(ch) ? 6.6 : 11.8), 0);
      const mx = L.axisRange(ds.min, ds.max).ticks.reduce((m, t) => Math.max(m, lw(t.label)), 0);
      padL = Math.min(120, Math.max(48, Math.ceil(mx + 10)));
    }
    const W = 360, padR = 8, top = 24, hL = bars ? 0 : 150, gap = 0, hB = bars ? 140 : 0, bot = 22;
    const n = ds.days.length, cw = (W - padL - padR) / n, H = top + hL + gap + hB + bot;
    const X = (i) => padL + (i + 0.5) * cw;
    let lo, hi, ticks = [];
    if (bars) { const range = (ds.max - ds.min) || Math.max(1, Math.abs(ds.max) * 0.1); lo = ds.min < 0 ? ds.min - range * 0.12 : Math.max(0, ds.min - range * 0.35); hi = ds.max + range * 0.12; }
    else ({ lo, hi, ticks } = L.axisRange(ds.min, ds.max));
    const Y = (v) => top + hL - ((v - lo) / (hi - lo)) * hL;
    return { W, padL, padR, top, hL, gap, hB, bot, n, cw, H, X, Y, lo, hi, ticks };
  }
  /** 残高の線の色: 前日より減った=赤 / 増えた=緑 / 変化なし=グレー */
  const LINE_COL = { down: '#dc2626', up: '#15803d', flat: '#64748b' };
  function dirCol(a, b) {
    if (!a || !b || a.balance === null || b.balance === null || b.balance === a.balance) return LINE_COL.flat;
    return b.balance < a.balance ? LINE_COL.down : LINE_COL.up;
  }
  /** 指定日のマーカー（縦線・つまみ・点）。ドラッグ中はここだけ差し替える */
  function selMarker(ds, target, G) {
    const i = ds.days.findIndex((d) => d.date === target); if (i < 0) return '';
    const x = G.X(i), c = '#1d4ed8', d = ds.days[i], w = 64, lx = Math.min(G.W - w - 2, Math.max(2, x - w / 2));
    let s = `<line x1="${x}" x2="${x}" y1="${G.top - 4}" y2="${G.top + G.hL}" stroke="${c}" stroke-width="1.5"/>`;
    if (d.balance !== null) s += `<circle cx="${x}" cy="${G.Y(d.balance)}" r="4.4" fill="#fff" stroke="${dirCol(ds.days[i - 1], d)}" stroke-width="2.2"/>`;
    s += `<g class="grip"><rect x="${lx}" y="2" width="${w}" height="18" rx="9" fill="${c}"/><text x="${lx + w / 2}" y="15" text-anchor="middle" class="cs-t" fill="#fff">◀ 指定日 ▶</text></g>`;
    return s;
  }
  function chartSvg(ds, target, mode) {
    const bars = mode === 'bars';   // 'bars'=日別の収入・支出（集計タブ） / 既定=残高の線（ホーム）
    const G = chartGeo(ds, bars);
    const { W, padL, padR, top, hL, gap, hB, bot, n, cw, H, X, Y, lo, hi, ticks } = G;
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="月の残高推移グラフ${bars ? '' : '（左右にドラッグして日付を変更）'}" ${bars ? '' : 'data-drag="1"'}>
      <defs>
        <pattern id="hatchR" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#fecaca"/><line x1="0" y1="0" x2="0" y2="5" stroke="#dc2626" stroke-width="2"/></pattern>
        <pattern id="hatchG" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#bbf7d0"/><line x1="0" y1="0" x2="0" y2="5" stroke="#15803d" stroke-width="2"/></pattern>
      </defs>`;
    // 週末の薄い背景
    ds.days.forEach((d, i) => { const w = new Date(d.date + 'T00:00:00Z').getUTCDay(); if (w === 0 || w === 6) s += `<rect x="${padL + i * cw}" y="${top}" width="${cw}" height="${hL + gap + hB}" fill="${w === 0 ? '#fef2f2' : '#eff6ff'}" opacity=".55"/>`; });
    // 横グリッド
    if (!bars) ticks.forEach(({ v, label }) => { if (v === 0 && lo < 0) return; const y = Y(v); s += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="#e2e8f0"/><text x="${padL - 4}" y="${y + 4}" text-anchor="end" class="cs-t">${esc(label)}</text>`; });
    if (!bars && lo < 0 && hi > 0) s += `<line x1="${padL}" x2="${W - padR}" y1="${Y(0)}" y2="${Y(0)}" stroke="#dc2626" stroke-dasharray="3 3"/><text x="${padL - 4}" y="${Y(0) + 4}" text-anchor="end" class="cs-t" fill="#dc2626">0</text>`;
    // 今日・指定日
    const mark = (date, color, label, dash) => { const i = ds.days.findIndex((d) => d.date === date); if (i < 0) return ''; return `<line x1="${X(i)}" x2="${X(i)}" y1="${top}" y2="${top + hL + gap + hB}" stroke="${color}" stroke-width="1.5" ${dash ? 'stroke-dasharray="2 3"' : ''}/><text x="${X(i) > W - 28 ? W - 2 : X(i)}" y="${top - 8}" text-anchor="${X(i) > W - 28 ? 'end' : 'middle'}" class="cs-t" fill="${color}">${label}</text>`; };
    s += mark(todayStr(), '#64748b', '今日', true);
    // 0円より下（残高マイナス）は薄い赤の背景
    if (!bars && lo < 0) s += `<rect x="${padL}" y="${Y(0)}" width="${W - padL - padR}" height="${top + hL - Y(0)}" fill="#fef2f2" opacity=".8"/>`;
    // 残高の線（区間ごと: 減る=赤 / 増える=緑 / 変化なし=グレー。仮=破線・確定=実線）
    for (let i = 1; !bars && i < n; i++) {
      const a = ds.days[i - 1], b = ds.days[i];
      if (a.balance === null || b.balance === null) continue;
      const prov = b.prov, col = dirCol(a, b), w = col === LINE_COL.flat ? 2.2 : 2.8;
      s += `<line class="seg" data-dir="${col === LINE_COL.down ? 'down' : col === LINE_COL.up ? 'up' : 'flat'}" x1="${X(i - 1)}" y1="${Y(a.balance)}" x2="${X(i)}" y2="${Y(b.balance)}" stroke="${col}" stroke-width="${w}" stroke-linecap="round" ${prov ? 'stroke-dasharray="5 4"' : ''}/>`;
    }
    if (!bars) ds.days.forEach((d, i) => { if (d.balance === null) return; if (d.events.length || i === 0) s += `<circle cx="${X(i)}" cy="${Y(d.balance)}" r="2.8" fill="#fff" stroke="${dirCol(ds.days[i - 1], d)}" stroke-width="2"/>`; });
    // 棒グラフ（収入=上・支出=下。仮の分は斜線）
    if (bars) {
    const base = top + hL + gap + hB / 2;
    const mx = Math.max(1, ...ds.days.map((d) => Math.max(d.debit, d.income)));
    const sc = (hB / 2 - 3) / mx;
    s += `<line x1="${padL}" x2="${W - padR}" y1="${base}" y2="${base}" stroke="#94a3b8"/><text x="${padL - 4}" y="${base - hB / 2 + 8}" text-anchor="end" class="cs-t" fill="#15803d">収入</text><text x="${padL - 4}" y="${base + hB / 2 - 2}" text-anchor="end" class="cs-t" fill="#dc2626">支出</text>`;
    const bw = Math.max(3, cw * 0.62);
    ds.days.forEach((d, i) => {
      const x = X(i) - bw / 2;
      if (d.debit) { const hc = (d.debit - d.debitProv) * sc, hp = d.debitProv * sc;
        if (hc) s += `<rect x="${x}" y="${base}" width="${bw}" height="${hc}" fill="#dc2626"/>`;
        if (hp) s += `<rect x="${x}" y="${base + hc}" width="${bw}" height="${hp}" fill="url(#hatchR)" stroke="#dc2626" stroke-dasharray="2 1.5" stroke-width=".8"/>`; }
      if (d.income) { const hc = (d.income - d.incomeProv) * sc, hp = d.incomeProv * sc;
        if (hc) s += `<rect x="${x}" y="${base - hc}" width="${bw}" height="${hc}" fill="#15803d"/>`;
        if (hp) s += `<rect x="${x}" y="${base - hc - hp}" width="${bw}" height="${hp}" fill="url(#hatchG)" stroke="#15803d" stroke-dasharray="2 1.5" stroke-width=".8"/>`; }
    });
    }
    // 日付ラベル
    const labs = [1, 5, 10, 15, 20, 25, n].filter((d, i, a) => a.indexOf(d) === i && (d === n ? n - 25 >= 3 || n === 25 : true));
    labs.forEach((d) => { s += `<text x="${X(d - 1)}" y="${H - 7}" text-anchor="middle" class="cs-t">${d}</text>`; });
    // 指定日マーカー（タップ・ドラッグで移動。操作は pointer イベントで #main に委譲）
    if (!bars) s += `<g id="selmk">${selMarker(ds, target, G)}</g>`;
    return s + '</svg>';
  }

  /* ---------- 空の状態（口座が未登録） ---------- */
  /* v6.0 はじめに：支払いが1件登録されるまでホームの一番上に出す。終わった手順には ✓、タップでその登録画面へ */
  function onboardCard() {
    const steps = [
      ['口座', 'add-account', state.accounts.length > 0, '口座名と今日の残高'],
      ['カード', 'add-card', state.cards.length > 0, 'カード払いがなければ飛ばしてOK'],
      ['支払い', 'add-pay', state.payments.length > 0, '家賃・サブスク・電気代など'],
    ];
    const cur = steps.findIndex((x, i) => !x[2] && !(i === 1 && state.payments.length));
    let h = `<section class="card onb" id="onboard"><h2>はじめに</h2>`;
    if (!state.accounts.length) h += `<p class="onb-lead">「いつ・いくら払って、<b>この日に口座にいくら残るか</b>」がわかるアプリです。</p>`;
    h += `<div class="onb-steps">${steps.map((x, i) => `<button type="button" class="onb-step ${x[2] ? 'done' : ''} ${i === cur ? 'now' : ''}" data-act="${x[1]}"><span class="n" aria-hidden="true">${x[2] ? '✓' : ['①', '②', '③'][i]}</span><span class="t"><b>${x[0]}</b><small>${x[2] ? '登録済み' : x[3]}</small></span><span class="c" aria-hidden="true">›</span></button>`).join('')}</div>`;
    if (!state.accounts.length) h += `<button class="btn sec" data-act="sample">サンプルデータで試す（あとで一括削除できます）</button>`;
    return h + `</section>`;
  }
  function renderWelcome() { return onboardCard(); }
  const needAcctGuide = () => `<div class="guide"><b>まず口座を登録しましょう。</b><br>口座を登録すると、この画面が使えるようになります。<button class="btn sm" style="margin-top:8px" data-act="add-account">口座を登録する</button> <button class="btn sm sec" data-tab="home" style="margin-top:8px">はじめに戻る</button></div>`;

  /* ---------- ホーム ---------- */
  const PAYHELP_KEY = 'money-app-hint-pay';   // 支払いタブの説明を閉じたか（アプリのデータとは別に保存）
  const payHelpSeen = () => { try { return localStorage.getItem(PAYHELP_KEY) === '1'; } catch (_) { return false; } };
  const ui = { inbox: false, all: false, help: false, payHelp: !payHelpSeen(), pastHint: null };   // ホームの開閉状態（保存しない）
  function homeRow(e) {
    const p = L.parse(e.date);
    const tap = e.variable ? `data-act="enter" data-kind="${e.refKind}" data-id="${e.refId}" data-month="${e.month}"` : '';
    return `<div class="hrow ${e.confirmed ? '' : 'prov'} ${e.variable ? 'tap' : ''}" data-date="${e.date}" data-ref="${e.refKind}:${e.refId}" ${e.negative ? 'data-neg="1"' : ''} ${tap}>
      <div class="d">${p.m}/${p.d}<small>${dow(e.date)}</small></div>
      <div class="m"><b>${esc(e.label)}</b>${L.shiftNote(e) ? `<small class="shift">${L.shiftNote(e)}</small>` : ''}</div>
      <div class="a">${sgn(e.delta, e.amount, e.confirmed)}</div>${e.negative ? `<small class="hneg neg-t">${e.balance >= 0 && e.accountBalance < 0 ? `この後の${esc(e.accountName || '口座')}の残高` : 'この後の残高'} <span class="sg">${yen(e.balance >= 0 && e.accountBalance < 0 ? e.accountBalance : e.balance)}</span> ⚠</small>` : ''}</div>`;
  }
  /* v6.0: 大きな残高のすぐ下の枠（最大2行）。1行目は常に「次の引き落とし … → 残り …」。
   * 2行目はマイナスになる見込みがあるときだけ、薄い赤の背景に赤い ⚠ の警告。どちらもタップでその日を選んで内訳の行へ */
  function statusLine(target, scope) {
    const today = todayStr(), lim = L.addDays(today, 60);
    const neg = L.firstNegativeWithin(state, scope, today, target > lim ? target : lim);
    const nx = L.nextDebit(state, scope, today);
    if (!nx && !neg) return '';
    let h = '<div class="status">';
    if (nx) {
      const pj = L.project(state, nx.date, scope), after = pj.endBalance;
      const inc = pj.events.filter((e) => e.date === nx.date && e.delta > 0).reduce((t, e) => t + e.delta, 0);
      const cnt = nx.others + 1, amt = cnt > 1 ? nx.total : nx.top.amount, pv = cnt > 1 ? nx.provisional : !nx.top.confirmed;
      // v6.0.4: いつも2行。1行目=日付と名前（ほか○件は消さない）、2行目=その日の合計と残り（残りと計算が合う）
      h += `<button class="st-line nextst st2" data-act="jump" data-date="${nx.date}" data-ref="${nx.top.refKind}:${nx.top.refId}" aria-label="次の引き落としの日を見る"><span class="st-l1"><span class="st-k"><span class="st-kl">次の引き落とし</span><span class="st-ks">次回</span></span><b class="st-d">${md(nx.date).replace(/\(.\)$/, (w) => `<span class="st-dw">${w}</span>`)}</b><span class="st-n"><span class="st-nm">${esc(nx.top.label)}</span>${nx.others ? `<span class="st-o">ほか${nx.others}件</span>` : ''}</span></span><span class="st-l2 st-ar"><span class="st-a sg">${pv ? PV + ' ' : ''}−${yenAbs(amt)}</span><span class="st-r">→ 残り <b>${yen(after)}</b></span></span>${inc > 0 ? `<span class="st-l3">同じ日の入金 <span class="sg st-ia">+${yenAbs(inc)}</span> を含む</span>` : ''}</button>`;
    } else h += `<div class="st-line nextst"><span class="st-k">次の引き落とし</span><span class="st-n">60日以内にはありません</span></div>`;
    if (neg) h += `<button class="st-line warnst st2" data-act="jump" data-date="${neg.date}" data-neg="1" aria-label="マイナスになる日を見る"><span class="st-l1"><span class="st-ic" aria-hidden="true">⚠</span><span class="st-w">${neg.provisional ? PV + ' ' : ''}${md(neg.date)}に${neg.accountName ? esc(neg.accountName) + 'が' : '残高が'}</span></span><span class="st-l2"><span class="st-wu"><b class="st-wa sg">${yen(neg.balance)}</b><span class="st-wt">になる見込み</span></span></span></button>`;
    return h + '</div>';
  }
  /* ヒーロー（大きな残高・日付・クイック選択）。ドラッグ中はここだけ作り直す */
  function heroHtml(target) {
    const today = todayStr(), scope = getScope();
    const pr = L.project(state, target, scope);
    const prov = pr.confirmedThrough !== null && !pr.beforeAsOf;
    const pending = L.computePending(state, today);
    const scopeName = scope === 'all' ? '口座合計' : esc(byId(state.accounts, scope).name);
    let h = `<section class="hero ${pr.negative ? 'neg' : ''}">
      <div class="hero-bar"><input type="date" id="target" value="${target}" aria-label="見込みを見る日付">
        ${state.accounts.length > 1 ? `<select id="pacc" aria-label="口座">${`<option value="all" ${scope === 'all' ? 'selected' : ''}>口座合計</option>` + state.accounts.map((a) => `<option value="${a.id}" ${scope === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>` : ''}
        <button class="q" data-act="toggle-help" aria-label="説明を表示" aria-expanded="${ui.help}">？</button></div>
      <div class="big"><span>${yen(pr.endBalance)}</span><span class="hero-tag">${prov ? '仮' : '確定額'}</span></div>
      <div class="small">${ymd(target)} 時点・${scopeName}</div>`;
    h += statusLine(target, scope);
    h += `<div class="chips"><button class="chip" data-act="quick" data-m="-1">今日</button><button class="chip" data-act="quick" data-m="0">今月末</button><button class="chip" data-act="quick" data-m="1">来月末</button><button class="chip" data-act="quick" data-m="3">3か月後</button></div>`;
    if (ui.help) {
      const rem = pending.length ? null : L.computeReminders(state, today, 30)[0];
      h += `<div class="helpbox">`;
      if (pr.beforeAsOf) h += `<p>口座の残高の日付より前の日付です。その日付時点の残高を表示しています。</p>`;
      else if (!prov) h += `<p>✅ この日までの予定はすべて確定額です。${pending.length ? `入力待ち${pending.length}件は、この見込みの対象外（指定日より後、または選択中以外の口座）の分です。` : ''}</p>`;
      else h += `<p>${pr.confirmedThrough < pr.minAsOf ? '⏳ 残高の日付の翌日から仮の金額を含みます。' : '✅ ' + md(pr.confirmedThrough) + ' までは確定額のみ。以降は仮の金額を含みます。'}</p>`;
      if (!pr.beforeAsOf) h += `<p>期間中の最低残高 ${yen(pr.minBalance)}（${md(pr.minDate)}）</p>`;
      h += `<p>「仮」は、金額が未入力の変動項目（直近3回の実績平均で計算）です。金額を入力すると確定額に置き換わります。</p>`;
      if (rem) h += `<p>🔔 次に金額を入力する日：${md(rem.date)} ${esc(rem.names.join('、'))}（<a href="#" data-tab="data">通知の設定</a>）</p>`;
      h += `</div>`;
    }
    return h + `</section>`;
  }

  let chartCtx = null;   // ホームのグラフ（ドラッグ用）
  function readoutHtml(ds, target) {
    const td = ds.days.find((d) => d.date === target);
    return td && td.balance !== null ? `<div class="readout"><b>${md(target)}</b>　<b class="${td.neg ? 'neg-t' : ''}">${pvYen(td.balance, td.prov)}</b> ${td.prov ? '' : '<span class="tag ok">確定額</span>'}</div>` : '';
  }
  function renderHome() {
    if (!state.accounts.length) return renderWelcome();
    const target = getTarget(), today = todayStr(), scope = getScope();
    const pr = L.project(state, target, scope);
    const vm = getViewMonth();
    const ds = L.dailySeries(state, scope, vm);
    const prov = pr.confirmedThrough !== null && !pr.beforeAsOf;
    const pending = L.computePending(state, today);

    let h = (state.payments.length ? '' : onboardCard()) + heroHtml(target) + (ui.pastHint ? pastHintHtml(ui.pastHint.kind, ui.pastHint.id, true) : '');

    // 2) 入力待ち：細い帯。タップで開く。引き落とし日を過ぎたもの(overdue)があれば赤系＋上に並ぶ
    if (pending.length) {
      const over = pending.filter((e) => e.status === 'overdue').length;
      h += `<section class="band ${over ? 'over' : ''} ${ui.inbox ? 'open' : ''}"><button class="band-btn" data-act="toggle-inbox" aria-expanded="${ui.inbox}"><span>📝 入力待ち ${pending.length}件${over ? `<small class="band-over">うち${over}件は引き落とし日を過ぎています</small>` : ''}</span><span class="chev">${ui.inbox ? '▲' : '▼'}</span></button>`;
      if (ui.inbox) {
        h += `<div class="band-body"><p class="sub">${over ? '赤は引き落とし日を過ぎたもの（その日以降の残高が仮のまま）です。先に入力してください。' : '明細が確定する日になりました。'}金額を入力すると、仮が確定額に置き換わります。</p>`;
        h += pending.map((e) => {
          const w = e.kind === 'income' ? '入金' : '引き落とし';
          const st = e.status === 'overdue'
            ? `<span class="pst over">${md(e.date)}の${w}日を過ぎています</span>`
            : `<span class="pst wait">${md(e.date)}の${w}までに入力</span>`;
          return `<div class="inb-row ${e.status === 'overdue' ? 'over' : 'wait'}" data-kind="${e.refKind}" data-id="${e.refId}" data-month="${e.month}">
          <div class="l">${st}<b>${esc(e.label)}</b> <span class="tag mo">${Number(e.month.slice(5))}月分</span><small>${w}日 ${md(e.date)}・明細が確定する日 ${md(e.fixDate)}</small><small>仮 ${yenAbs(e.amount)}（${esc(srcText(e))}）</small></div>
          <div class="in"><input type="number" inputmode="numeric" min="0" step="1" placeholder="${e.amount}" aria-label="${esc(e.label)} ${Number(e.month.slice(5))}月分の金額"><button class="btn sm" data-act="confirm-actual">金額を確定する</button></div>${(() => { const c = cmpInner(e.refKind, e.refId, e.month, ''); return c ? `<p class="cmp">${c}</p>` : ''; })()}</div>`;
        }).join('');
        h += `</div>`;
      }
      h += `</section>`;
    }

    // 3) 月の残高の線グラフ
    const days = ds.days;
    h += `<section class="sec"><div class="mnav"><button data-act="mnav" data-d="-1" aria-label="前の月">‹</button><b>${ymLabel(vm)}</b><button data-act="mnav" data-d="1" aria-label="次の月">›</button>
      ${vm !== L.monthKey(today) ? '<button class="chip2" data-act="mnav" data-d="0">今月へ</button>' : ''}</div>`;
    if (!ds.hasData) h += `<div class="empty">この月は口座の残高の日付より前のため、予測はありません</div>`;
    else {
      chartCtx = { ds, G: chartGeo(ds, false) };
      h += chartSvg(ds, target);
      if (days[0].balance === null) h += `<div class="chartnote">※ 口座の残高の日付より前は表示されません</div>`;
      h += `<div class="legend"><span><i class="ln red"></i>減る</span><span><i class="ln grn"></i>増える</span><span><i class="ln dash"></i>破線=仮</span></div>`;
      h += `<div id="readwrap">${readoutHtml(ds, target)}</div>`;
    }
    h += `</section>`;

    // 4) これからの引き落とし：直近3件（指定日までが3件未満でも、その先の予定で3件まで見せる）+ すべて見る
    const N = 3, evs = pr.events, list = ui.all ? evs : evs.slice(0, N);
    const extra = !pr.beforeAsOf && evs.length < N ? L.project(state, L.addDays(target > today ? target : today, 400), scope).events.filter((e) => e.date > target).slice(0, N - evs.length) : [];
    h += `<section class="sec"><h2>これからの引き落とし</h2>
      <div class="hrow base"><div class="m"><b>${pr.minAsOf && pr.minAsOf < today ? `登録した残高（${md(pr.minAsOf)}時点）` : '今日の残高'}</b></div><div class="a"><span class="${pr.startBalance < 0 ? 'neg-t' : ''}">${yen(pr.startBalance)}</span><button class="lnk" data-act="edit-balance" data-id="${scope === 'all' ? '' : scope}">変更</button></div></div>`;
    h += evs.length ? list.map(homeRow).join('') : extra.length ? '' : `<div class="empty">この期間に反映される引き落とし・入金はありません</div>`;
    if (evs.length > N) h += `<button class="more" data-act="toggle-all">${ui.all ? '閉じる' : `すべて見る（残り${evs.length - N}件）`}</button>`;
    h += `<div class="hrow base end"><div class="m"><b>${md(target)} の見込み</b></div><div class="a ${pr.endBalance < 0 ? 'neg-t' : ''}">${pvYen(pr.endBalance, prov)}</div></div>`;
    if (extra.length) h += `<p class="hsub">${md(target)}より後の予定</p>` + extra.map((e) => homeRow(Object.assign({}, e, { later: true }))).join('');
    h += `</section>`;
    return h;
  }

  /* ---------- 支払い一覧 ---------- */
  function nextEvents() {
    const map = {}; const t = todayStr();
    for (const e of L.genEvents(state, L.addDays(t, -1), L.addDays(t, 75))) { const k = e.refKind + ':' + e.refId; if (!map[k]) map[k] = e; }
    return map;
  }
  function renderPay() {
    if (!state.accounts.length) return needAcctGuide();
    const nx = nextEvents();
    const payRow = (p) => {
      const card = byId(state.cards, p.cardId), acc = byId(state.accounts, p.accountId);
      const e = nx['pay:' + p.id];
      const dv = p.variable && !p.cardId;     // 口座直接の変動項目
      // カード払いの行は補足なし（引き落とし日はカードの見出しに1回だけ書く）。口座直接は1行。
      let meta = '';
      if (p.cardId) { if (!card) meta = '<span class="neg-t">カードが見つかりません</span>'; else if (!p.loan) meta = esc(freqText(p, card.withdrawDay, true)); }
      else if (dv) {
        // 変動の口座直接: 2行目は1本の補足行（メモは編集シートでのみ表示）
        const src = e ? (e.source === 'average' ? `直近${e.n}回平均` : e.source === 'actual' ? '実績' : e.source === 'initial' ? '初期見込み' : '') : '';
        meta = [esc(freqText(p, p.day)), acc ? esc(acc.name) : '<span class="neg-t">口座未設定</span>', src].filter(Boolean).join('・');
      } else meta = `引き落とし日 ${esc(freqText(p, p.day))}・${acc ? esc(acc.name) : '<span class="neg-t">口座未設定</span>'}`;
      // v6.0: 土日祝・年末年始で次回がずれるときは「次回 12/28(月)※27日が日曜のため」
      if (!p.cardId && e && e.nominal) meta += `・次回 ${md(e.date)}${L.shiftNote(e)}`;
      let right = yenAbs(p.amount), nameTag = '';
      if (p.loan) {
        const li = L.loanInfo(state, p, todayStr());
        const st = li.done ? '完了（全' + li.total + '回）' : `<b class="rem">残り${li.remaining}回</b>／全${li.total}回`;
        meta = '<span class="tag loan">ローン</span>' + st + (p.cardId ? '' : `・毎月${dl(p.day)}・${acc ? esc(acc.name) : '<span class="neg-t">口座未設定</span>'}`);
        if (!li.done && li.paid === 0 && li.startMonth > L.monthKey(todayStr())) meta = '<span class="tag loan">ローン</span>' + `${Number(li.startMonth.slice(5))}月開始・全${li.total}回` + (p.cardId ? '' : `・毎月${dl(p.day)}`);
      }
      const done = !p.loan && onceDone(p, card ? card.withdrawDay : p.day);   // 1回だけで日付が過ぎたもの（薄く表示）
      const sw = `<label class="sw" title="有効/停止"><input type="checkbox" data-act="toggle-pay" data-id="${p.id}" ${p.active !== false ? 'checked' : ''}><i></i></label>`;
      if (dv) {
        // 変動の口座直接は2行: 1行目=名前・金額・スイッチ / 2行目=補足・（変動・仮）・実績
        if (e) right = yenAbs(e.amount);
        const ed = `data-act="edit-pay" data-id="${p.id}"`;
        return `<div class="row pv ${p.active === false ? 'off' : ''} ${done ? 'ldone' : ''}">
        <b class="n nm tap" ${ed}>${esc(p.name)}</b>
        <div class="a tap" ${ed}>${right}</div>${sw}
        <small class="s tap" ${ed}>${meta}</small>
        <small class="bdg tap" ${ed}><span class="var-t">変動</span>${e ? badge(e) : ''}</small>
        <button class="btn sm sec" data-act="actuals" data-kind="pay" data-id="${p.id}">実績</button></div>`;
      }
      return `<div class="row ${p.active === false ? 'off' : ''} ${done || (p.loan && L.loanInfo(state, p, todayStr()).done) ? 'ldone' : ''}">
        <div class="l tap" data-act="edit-pay" data-id="${p.id}"><div class="nmw"><b class="nm">${esc(p.name)}</b>${nameTag}</div>${meta ? `<small>${meta}</small>` : ''}</div>
        <div class="r tap" data-act="edit-pay" data-id="${p.id}">${right}</div>${sw}</div>`;
    };
    const hasSample = [].concat(state.accounts, state.cards, state.payments, state.incomes).some((x) => x.sample);
    let h = `<div class="pagebar"><span class="sub">${hasSample ? 'サンプルデータを表示中（【例】がサンプルです）' : ''}</span>${state.cards.length ? '<button class="btn sm sec csv-btn" data-act="csv-open">明細CSVを読み込む</button>' : ''}<button class="q" data-act="toggle-payhelp" aria-label="使い方を表示" aria-expanded="${ui.payHelp}">？</button></div>`;
    if (ui.payHelp) h += `<div class="info helpcard"><span>タップで編集、右のスイッチで有効/停止。「変動」は毎月金額が変わる項目で、「実績」から確定額を記録できます。</span><button class="x" data-act="close-payhelp" aria-label="閉じる">✕</button></div>`;
    if (!state.payments.length) h += `<div class="card empty">支払いが未登録です。右下の ＋ から追加してください。</div>`;
    for (const c of state.cards) {
      const items = state.payments.filter((p) => p.cardId === c.id);
      if (!items.length) continue;
      const e = nx['card:' + c.id];
      const tot = items.filter((p) => p.active !== false).reduce((s, p) => s + L.payAmountIn(p, L.monthKey(todayStr())), 0);
      h += `<div class="card"><h2><span>${esc(c.name)}</span><span class="h2a">今月の登録額 <span class="sg">${yenAbs(tot)}</span></span></h2><div class="hint" style="margin:-4px 0 8px">引き落とし日 毎月${dl(c.withdrawDay)}（カード設定に従う）</div>
        ${e ? `<div class="cardnext">次回の請求 ${md(e.date)}${L.shiftNote(e) ? `<small class="shift">${L.shiftNote(e)}</small>` : ''}：${e.confirmed ? '' : PV + ' '}${yenAbs(e.amount)} ${e.confirmed ? badge(e) : ''} ${c.variable !== false ? `<button class="btn sm sec" data-act="actuals" data-kind="card" data-id="${c.id}">実績</button>` : ''}</div>` : ''}
        ${items.map((x) => payRow(x) + pastHintHtml('pay', x.id)).join('')}</div>`;
    }
    const direct = state.payments.filter((p) => !p.cardId);
    if (direct.length) h += `<div class="card"><h2><span>口座から直接引き落とし</span></h2>${direct.map((x) => payRow(x) + pastHintHtml('pay', x.id)).join('')}</div>`;
    const orphans = state.payments.filter((p) => p.cardId && !byId(state.cards, p.cardId));
    if (orphans.length) h += `<div class="card"><h2><span>カード未設定</span></h2>${orphans.map(payRow).join('')}</div>`;
    return h + `<button class="fab" data-act="add-pay" aria-label="支払いを追加">＋</button>`;
  }

  /* ---------- カード・口座・収入 ---------- */
  function renderAcct() {
    const nx = nextEvents();
    let h = (state.accounts.length ? '' : needAcctGuide()) + `<div class="sec-h"><h3>🏦 口座</h3><button class="btn sm" data-act="add-account">＋ 追加</button></div><div class="card">`;
    h += state.accounts.length ? state.accounts.map((a) => `<div class="row"><div class="l tap" data-act="edit-account" data-id="${a.id}"><div class="nmw"><b class="nm">${esc(a.name)}</b>${sampleTag(a)}</div><small>${md(a.asOf)}時点の残高</small></div><button class="btn sm sec" data-act="edit-balance" data-id="${a.id}">残高変更</button><div class="r ${a.balance < 0 ? 'neg-t' : ''}">${yen(a.balance)}</div></div>`).join('') : '<div class="empty">口座が未登録です</div>';
    h += `</div><div class="sec-h"><h3>💳 カード</h3><button class="btn sm" data-act="add-card">＋ 追加</button></div><div class="card">`;
    h += state.cards.length ? state.cards.map((c) => { const a = byId(state.accounts, c.accountId); return `<div class="row"><div class="l tap" data-act="edit-card" data-id="${c.id}"><div class="nmw"><b class="nm">${esc(c.name)}</b>${c.variable !== false ? '<span class="tag var">変動</span>' : '<span class="tag">固定</span>'}${sampleTag(c)}</div><small>明細が確定する日 毎月${dl(c.fixDay)} → 引き落とし日 毎月${dl(c.withdrawDay)}</small><small>${a ? esc(a.name) : '<span class="neg-t">口座未設定</span>'}</small></div>${c.variable !== false ? `<button class="btn sm sec" data-act="actuals" data-kind="card" data-id="${c.id}">実績</button>` : ''}<div class="r tap" data-act="edit-card" data-id="${c.id}">›</div></div>`; }).join('') : '<div class="empty">カードが未登録です</div>';
    h += `</div><div class="sec-h"><h3>💰 収入（給与など）</h3><button class="btn sm" data-act="add-income">＋ 追加</button></div><div class="card">`;
    h += state.incomes.length ? state.incomes.map((i) => { const a = byId(state.accounts, i.accountId); const e = nx['inc:' + i.id];
      return `<div class="row ${i.active === false ? 'off' : ''} ${onceDone(i, i.day) ? 'ldone' : ''}"><div class="l tap" data-act="edit-income" data-id="${i.id}"><div class="nmw"><b class="nm">${esc(i.name)}</b>${i.variable ? '<span class="tag var">変動</span>' : ''}${sampleTag(i)}</div><small>${esc(freqText(i, i.day))} → ${a ? esc(a.name) : '<span class="neg-t">口座未設定</span>'}${i.variable ? '・明細が確定する日' + (i.fixDay ? dl(i.fixDay) : '＝入金日') : ''}${i.active === false ? '・停止中' : ''}${e && e.nominal ? `・次回 ${md(e.date)}${L.shiftNote(e)}` : ''}</small></div>${i.variable ? `<button class="btn sm sec" data-act="actuals" data-kind="inc" data-id="${i.id}">実績</button>` : ''}<div class="r tap" data-act="edit-income" data-id="${i.id}">${i.variable && e ? sgn(1, e.amount, e.confirmed) : sgn(1, i.amount, true)}</div></div>` + pastHintHtml('inc', i.id); }).join('') : '<div class="empty">収入が未登録です（登録すると残高予測に反映されます）</div>';
    return h + `</div><p class="note">カードで払うものは「支払い」で登録すると、カードごとに1つの請求額にまとめて引き落とし日に口座から引かれます。カードが「変動」の場合、明細が確定する日に実績を入力します（それまでは直近3回の平均、実績がなければ登録額の合計で仮計算）。</p>`;
  }

  /* ---------- 集計（サブ画面） ---------- */
  // v5.8 読み込んだ明細の店別合計（カード別の各行の下）
  function impDetails(e) {
    if (!window.CsvImport) return '';
    const mt = CsvImport.merchantTotals(state, e.refId, e.month); if (!mt.length) return '';
    return `<details><summary>明細（CSV）の店別 ${mt.length}件</summary><ul class="items">${mt.map((x) => `<li>・${esc(x.name)}${x.count > 1 ? `（${x.count}回）` : ''} <span class="sg ${x.amount < 0 ? 'pos-t' : ''}">${x.amount < 0 ? '+' : ''}${yenAbs(x.amount)}</span></li>`).join('')}</ul></details>`;
  }
  function renderSummary() {
    if (!state.accounts.length) return needAcctGuide();
    const mk = sumMonth || L.monthKey(todayStr());
    const evs = L.monthEvents(state, mk);
    const outs = evs.filter((e) => e.delta < 0), ins = evs.filter((e) => e.delta > 0);
    const out = outs.reduce((s, e) => s + e.amount, 0), inc = ins.reduce((s, e) => s + e.amount, 0);
    const prov = evs.some((e) => !e.confirmed);
    const ap = prov ? PV + ' ' : '';
    let h = `<div class="card"><div class="mnav"><button data-act="snav" data-d="-1">‹</button><b>${ymLabel(mk)}</b><button data-act="snav" data-d="1">›</button>${mk !== L.monthKey(todayStr()) ? '<button class="chip2" data-act="snav" data-d="0">今月へ</button>' : ''}</div>
      <div class="rcpt"><div class="rr"><span class="rk">収入合計</span><b class="v sg pos-t">${ap}${yenAbs(inc)}</b></div><div class="rr"><span class="rk">支出合計</span><b class="v sg neg-t">${ap}${yenAbs(out)}</b></div><div class="rr tot"><span class="rk">差引</span><b class="v sg ${inc - out < 0 ? 'neg-t' : ''}">${ap}${yen(inc - out)}</b></div></div>
      ${prov ? '<p class="hint" style="margin:8px 0 0">「仮」は仮の金額を含みます（実績未入力の変動項目）。</p>' : ''}</div>`;
    const dsS = L.dailySeries(state, 'all', mk);
    if (dsS.hasData) h += `<div class="card"><h2><span>日別の収入・支出</span></h2>${chartSvg(dsS, null, 'bars')}<div class="legend"><span><i class="bx r"></i>支出</span><span><i class="bx g"></i>収入</span><span><i class="bx hatch"></i>斜線=仮</span></div></div>`;
    const bar = (v, mx, cls) => `<div class="bar"><i class="${cls || ''}" style="width:${mx ? Math.max(2, Math.round((v / mx) * 100)) : 0}%"></i></div>`;
    const cardEv = outs.filter((e) => e.kind === 'card');
    h += `<div class="card"><h2><span>カード別（この月に引き落とされる請求）</span></h2>`;
    const mxC = Math.max(1, ...cardEv.map((e) => e.amount));
    h += cardEv.length ? cardEv.map((e) => `<div class="srow"><div class="stop"><div class="l"><b class="nm xp">${esc(e.label)}</b><small>引落 ${md(e.date)}・登録${e.items.length}件</small></div><div class="r">${e.confirmed ? '<span class="sg neg-t">' + yenAbs(e.amount) + '</span>' : '<span class="sg">' + PV + ' <span class="amt-p">' + yenAbs(e.amount) + '</span></span>'}</div></div>${bar(e.amount, mxC)}
      ${e.items.length ? `<details><summary>内訳（登録額）${e.items.length}件</summary><ul class="items">${e.items.map((i) => `<li>・${esc(i.name)} <span class="sg">${yenAbs(i.amount)}</span></li>`).join('')}</ul></details>` : ''}${impDetails(e)}</div>`).join('') : '<div class="empty">この月のカード引き落としはありません</div>';
    h += `</div>`;
    // 支払い別
    const rows = [];
    for (const e of outs.filter((x) => x.kind === 'direct')) { const p = byId(state.payments, e.refId); rows.push({ name: e.label, sub: e.loan ? `ローン ${e.loan.index}/${e.loan.total}回目・口座から直接` : '口座から直接', dir: true, amount: e.amount, confirmed: e.confirmed, sample: p && p.sample }); }
    const cardIdsThisMonth = new Set(cardEv.map((e) => e.cardId));
    for (const p of state.payments.filter((x) => x.active !== false && x.cardId && cardIdsThisMonth.has(x.cardId) && L.payAmountIn(x, mk) > 0)) { const c = byId(state.cards, p.cardId); rows.push({ name: p.name, sub: (c ? c.name : '') + (p.loan ? `・ローン ${L.loanIndex(p, mk)}/${p.loan.count}回目` : ''), amount: L.payAmountIn(p, mk), confirmed: true, sample: p.sample, reg: true }); }
    rows.sort((a, b) => b.amount - a.amount);
    const mxP = Math.max(1, ...rows.map((r) => r.amount));
    h += `<div class="card"><h2><span>支払い別（金額の大きい順）</span></h2>${rows.length ? rows.map((r) => `<div class="srow"><div class="stop"><div class="l"><b class="nm xp">${esc(r.name)}${r.sample ? '<span class="tag sample">サンプル</span>' : ''}</b><small class="nm xp">${esc(r.sub)}${r.reg ? '（登録額）' : ''}</small></div><div class="r">${r.confirmed ? '<span class="sg neg-t">' + yenAbs(r.amount) + '</span>' : '<span class="sg">' + PV + ' <span class="amt-p">' + yenAbs(r.amount) + '</span></span>'}</div></div>${bar(r.amount, mxP, r.dir ? 'dir' : '')}</div>`).join('') : '<div class="empty">支払いがありません</div>'}
      <p class="hint" style="margin:6px 0 0">カードの請求額を実績で確定している場合、カード別の合計と、カード内の支払い（登録額）の合計は一致しないことがあります。</p></div>`;
    const loans = state.payments.filter((p) => p.loan && p.active !== false).map((p) => ({ p, i: L.loanInfo(state, p, todayStr()) })).filter((x) => !x.i.done);
    if (loans.length) h += `<div class="card"><h2><span>ローン（残り回数）</span><span class="h2a">残り合計 <span class="sg">${yenAbs(loans.reduce((s, x) => s + x.i.remainingAmount, 0))}</span></span></h2>${loans.map((x) => `<div class="row"><div class="l"><b class="nm xp">${esc(x.p.name)}</b><small>毎月 ${yenAbs(x.p.amount)}・最終回 ${ymLabel(x.i.endMonth)}</small></div><div class="r"><b>残り${x.i.remaining}回</b><small>残額 ${yenAbs(x.i.remainingAmount)}</small></div></div>`).join('')}<p class="hint" style="margin:6px 0 0">利息は計算に含めず、毎月の返済額は一定として数えています。</p></div>`;
    h += `<div class="card"><h2><span>収入</span></h2>${ins.length ? ins.map((e) => `<div class="row"><div class="l"><b class="nm xp">${esc(e.label)}</b><small>入金 ${md(e.date)}</small></div><div class="r">${sgn(1, e.amount, e.confirmed)}</div></div>`).join('') : '<div class="empty">この月の収入はありません</div>'}</div>`;
    // 口座別（ホームから移動）
    const tg = getTarget();
    h += `<div class="card"><h2><span>口座別の残高見込み（${md(tg)}時点）</span></h2>${state.accounts.map((a) => { const r = L.project(state, tg, a.id), pv = r.confirmedThrough !== null && !r.beforeAsOf; return `<div class="row"><div class="l"><b class="nm xp">${esc(a.name)}</b><small>今日の残高 ${yen(a.balance)}（${md(a.asOf)}時点）</small></div><div class="r ${r.endBalance < 0 ? 'neg-t' : ''}">${pvYen(r.endBalance, pv)}</div></div>`; }).join('')}</div>`;
    return h;
  }

  /* ---------- データ・設定 ---------- */
  function renderData() {
    const hasSample = [].concat(state.accounts, state.cards, state.payments, state.incomes).some((x) => x.sample);
    const N = window.Notify;
    const perm = N ? N.permission() : 'unsupported';
    const permTxt = { granted: '許可済み', denied: '拒否されています（端末の設定から変更）', default: '未設定', unsupported: 'このブラウザは非対応' }[perm];
    const ios = N && N.isIOS(), sa = N && N.isStandalone();
    return `${backupCard()}<div class="card"><h2>土日・祝日の引き落とし</h2><div class="f chk"><label><input type="checkbox" id="holidayShift" ${L.shiftOn(state) ? 'checked' : ''}> 土日・祝日・年末年始（12/31〜1/3）は翌営業日にずらす</label><small>引き落とし・入金・カード・ローンすべてに使います。明細が確定する日（通知）はずらしません。</small></div></div><div class="card"><h2>🔔 金額を入力する日の通知（朝8:00）</h2>
      <p class="hint">状態：<b>${permTxt}</b>${lastNotify && perm === 'granted' ? '（予約 ' + lastNotify.scheduled + '件・' + ({ trigger: '端末予約', timer: 'アプリ起動中のタイマー', none: '予定なし' }[lastNotify.mode]) + '）' : ''}</p>
      ${ios && !sa ? '<div class="info">iPhoneでは、Safariの共有ボタン →「ホーム画面に追加」で追加したアプリから開いて許可してください（iOS 16.4以降）。</div>' : ''}
      <button class="btn" data-act="notif-request" ${perm === 'unsupported' || perm === 'denied' ? 'disabled' : ''}>通知を許可する</button>
      <button class="btn sec" data-act="notif-test" ${perm !== 'granted' ? 'disabled' : ''}>テスト通知を送る</button>
      <div class="info" style="margin-top:8px"><b>正直な注意：</b>今のアプリはサーバーを持たないため、<b>iPhoneでアプリを閉じている間は朝8:00に通知が届きません。</b>アプリを開いたときに「入力待ち」がホームに出て、8時以降なら通知も1日1回出ます。確実に朝8:00に届けるには、小さなサーバー（Web Push）が必要で、<b>未実装</b>です（受け口のコードは用意済み）。</div></div>
      <div class="card"><h2>サンプルデータ</h2>
      <button class="btn sec" data-act="sample">サンプルデータを追加</button>
      ${hasSample ? '<button class="btn danger" data-act="del-sample">サンプルデータだけ全て削除</button>' : ''}</div>
      <div class="card"><h2>全データ削除</h2><button class="btn danger" data-act="reset">すべて削除して初期状態に戻す</button></div>
      <p class="note" style="text-align:center">データ形式 v${L.SCHEMA_VERSION}・口座${state.accounts.length}・カード${state.cards.length}・支払い${state.payments.length}・収入${state.incomes.length}・実績${Object.keys(state.actuals).length}・明細${Object.values(state.imports || {}).reduce((n, m) => n + Object.keys(m).length, 0)}か月分</p>`;
  }

  function backupCard() {
    const last = lastBackup(), bs = L.backupStatus(last, todayStr());
    const when = last ? `最終バックアップ <b>${md(last.slice(0, 10))}</b>${bs.days === 0 ? '（今日）' : `（${bs.days}日前）`}` : 'まだバックアップしていません';
    return `<div class="card" id="backup"><h2>バックアップ</h2>
      <p class="bk-last">${when}</p>
      ${bs.remind && state.accounts.length ? `<p class="bk-remind">${last ? '30日以上たっています。' : ''}機種変更やブラウザのデータ削除に備えて、ときどき保存しておくと安心です。</p>` : ''}
      <p class="hint">データはこの端末の中だけに保存されています。保存したファイルは「ファイル」アプリやAirDropで残せます。</p>
      <button class="btn" data-act="export">バックアップを保存</button>
      <button class="btn sec" data-act="import">バックアップから復元</button>
      <input type="file" id="file" accept="application/json,.json" hidden></div>`;
  }

  /* ---------- 描画 ---------- */
  const TITLES = { home: '口座残高の見込み', pay: '毎月の支払い', acct: 'カード・口座・収入', sum: '支出の集計', data: '設定・バックアップ' };
  function render() {
    $('#title').textContent = TITLES[tab];
    // 万一データが壊れていても画面が固まらないように。設定タブ（バックアップ・復元・全削除）は開けるようにする
    let html;
    try { html = { home: renderHome, pay: renderPay, acct: renderAcct, sum: renderSummary, data: renderData }[tab](); }
    catch (err) {
      console.warn('render failed', err);
      html = `<div class="card"><h2>この画面を表示できませんでした</h2><p class="hint">保存されているデータの一部が読み取れない形になっている可能性があります。「設定」からバックアップを保存するか、別のバックアップから復元してください。</p>${tab === 'data' ? '' : '<button class="btn sec" data-tab="data">設定を開く</button>'}</div>`;
    }
    $('#main').innerHTML = html;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  }
  function go(t) { tab = t; render(); window.scrollTo(0, 0); }

  /* ---------- フォーム ---------- */
  const opt = (v, label, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(label)}</option>`;
  const field = (id, label, inner, hint) => `<div class="f"><div class="lbl"><label for="${id}">${label}</label>${hint ? '<button type="button" class="q" data-act="hint" aria-label="説明を表示">？</button>' : ''}</div>${inner}${hint ? `<small hidden>${hint}</small>` : ''}</div>`;
  // 日付（毎月◯日）は選択式。iPhone では下からホイールが出る。末尾に「月末」(L.END_DAY)
  const dayInput = (id, v, req) => { const cur = v == null || v === '' ? '' : Number(v);
    let o = `<option value="" ${cur === '' ? 'selected' : ''} ${req === false ? '' : 'disabled'}>${req === false ? '指定なし' : '選択してください'}</option>`;
    for (let d = 1; d <= 31; d++) o += opt(d, d + '日', cur === d);
    o += opt(L.END_DAY, '月末', cur === L.END_DAY);
    return `<select id="${id}" name="${id}" class="daysel" ${req === false ? '' : 'required'}>${o}</select>`; };
  const DAYHINT = '「月末」は毎月の最終日（2月は28日／29日、30日の月は30日）。29〜31日を選んだ場合も、その日がない月は月末日として計算します。';
  const dl = (d) => L.dayLabel(d) || '-';
  const acctOptions = (sel) => state.accounts.map((a) => opt(a.id, a.name, a.id === sel)).join('');
  const num = (fd, k) => Number(fd.get(k));
  const day = (fd, k) => { const n = Math.round(num(fd, k)); return n === L.END_DAY ? L.END_DAY : Math.min(31, Math.max(1, n || 1)); };
  const optDay = (fd, k) => { const v = fd.get(k); return v === '' || v == null ? null : day(fd, k); };
  /* 繰り返し（毎月 / 毎年 / ◯か月ごと / 1回だけ）。選んだものに必要な欄だけ表示 */
  const REP = [['monthly', '毎月'], ['yearly', '毎年'], ['every', '◯か月ごと'], ['once', '1回だけ']];
  function repeatFields(it) {
    const r = (it && it.repeat) || {}, t = L.repType(it || {}), mk = L.monthKey(todayStr());
    let mo = ''; for (let m = 1; m <= 12; m++) mo += opt(m, m + '月', Number(r.month || Number(mk.slice(5))) === m);
    let no = ''; for (let n = 2; n <= 12; n++) no += opt(n, n + 'か月ごと', Number(r.n || 2) === n);
    const od = t === 'once' && r.date ? r.date : '';
    return `<div id="repWrap">${field('repeat', '繰り返し', `<select id="repeat" name="repeat">${REP.map(([v, l]) => opt(v, l, v === t)).join('')}</select>`)}` +
      `<div id="repY">${field('repMonth', '何月', `<select id="repMonth" name="repMonth">${mo}</select>`)}</div>` +
      `<div id="repE"><div class="f2">${field('repN', '間隔', `<select id="repN" name="repN">${no}</select>`)}${field('repStart', '開始月（1回目）', `<input id="repStart" name="repStart" type="month" value="${esc(t === 'every' && r.start ? r.start : mk)}">`)}</div></div>` +
      `<div id="repO">${field('repDate', '日付', `<input id="repDate" name="repDate" type="date" value="${esc(od)}">`)}${field('repYm', '請求される月（カードの引き落とし月）', `<input id="repYm" name="repYm" type="month" value="${esc(od ? od.slice(0, 7) : '')}">`)}</div></div>`;
  }
  /** 表示切り替え。isCard=カード払い（日付はカード設定に従うので月だけ選ぶ）。戻り値=選択中の種類 */
  function syncRepeat(f, isCard, hide) {
    const t = hide ? 'monthly' : f.repeat.value;
    $('#repWrap', f).hidden = !!hide;
    const show = (id, on, names) => { $(id, f).hidden = !on; names.forEach((k) => { f[k].disabled = !on; f[k].required = on; }); };
    show('#repY', t === 'yearly', ['repMonth']); show('#repE', t === 'every', ['repN', 'repStart']);
    $('#repO', f).hidden = t !== 'once';
    const dOn = t === 'once' && !isCard, mOn = t === 'once' && isCard;
    f.repDate.disabled = !dOn; f.repDate.required = dOn; f.repDate.closest('.f').hidden = !dOn;
    f.repYm.disabled = !mOn; f.repYm.required = mOn; f.repYm.closest('.f').hidden = !mOn;
    $('#repY label', f).textContent = isCard ? '何月の請求か（カードの引き落とし月）' : '何月';
    $('#repE label[for=repStart]', f).textContent = isCard ? '最初の請求月（カードの引き落とし月）' : '開始月（1回目）';
    return t;
  }
  /** フォームから repeat を読む。毎月は null（既存データと同じ形）。エラーは文字列 */
  function readRepeat(fd, isCard) {
    const t = fd.get('repeat') || 'monthly';
    if (t === 'yearly') return { type: 'yearly', month: Math.min(12, Math.max(1, Math.round(num(fd, 'repMonth')) || 1)) };
    if (t === 'every') { const st = fd.get('repStart'); if (!/^\d{4}-\d{2}$/.test(st || '')) return '開始月を選んでください'; return { type: 'every', n: Math.min(12, Math.max(2, Math.round(num(fd, 'repN')) || 2)), start: st }; }
    if (t === 'once') {
      if (isCard) { const ym = fd.get('repYm'); if (!/^\d{4}-\d{2}$/.test(ym || '')) return '請求される月を選んでください'; return { type: 'once', date: ym + '-01' }; }
      const d = fd.get('repDate'); if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return '日付を選んでください'; return { type: 'once', date: d };
    }
    return null;
  }
  /** 一覧の表示: 毎月25日 / 毎年4月27日 / 6か月ごと・25日（次回 2027/4） / 2026/12/10、1回だけ。カード払いは「◯月の請求」 */
  function freqText(it, dayV, isCard) {
    const t = L.repType(it), r = it.repeat || {}, nx = L.nextOccurrence(it, dayV, L.addDays(todayStr(), -1));
    const ym = (d) => { const p = L.parse(d); return p.y + '/' + p.m; };
    if (isCard) {
      if (t === 'yearly') return '毎年' + Number(r.month) + '月の請求';
      if (t === 'every') return Number(r.n) + 'か月ごと' + (nx ? '（次回 ' + ym(nx) + 'の請求）' : '');
      if (t === 'once') return ym(r.date) + 'の請求、1回だけ' + (onceDone(it, dayV) ? '（済み）' : '');
      return '';
    }
    return L.repeatLabel(it, dayV) + (t === 'every' && nx ? '（次回 ' + ym(nx) + '）' : '') + (t === 'once' && onceDone(it, dayV) ? '（済み）' : '');
  }
  const onceDone = (it, dayV) => L.repType(it) === 'once' && !L.nextOccurrence(it, dayV, L.addDays(todayStr(), -1));

  /* アプリ内の確認ダイアログ（confirm/prompt/alert の代わり。iPhoneのホーム画面アプリでも確実に動く）
   * 毎回新しい <dialog> を作って最前面に出し、閉じたら取り除く。OK=true / キャンセル・外側タップ=false を返す */
  function askConfirm(o) {
    return new Promise((resolve) => {
      const d = document.createElement('dialog'); d.className = 'cdlg';
      const danger = o.danger !== false;
      d.innerHTML = `<div class="sheet cfm" role="alertdialog" aria-labelledby="cfmT"><h2 id="cfmT">${esc(o.title)}</h2><p>${esc(o.message || '').replace(/\n/g, '<br>')}</p>
        <div class="btns">${o.noCancel ? '' : `<button type="button" class="btn sec" data-c="0">${esc(o.cancelLabel || 'キャンセル')}</button>`}<button type="button" class="btn ${danger ? 'solid-danger' : ''}" data-c="1">${esc(o.okLabel || 'OK')}</button></div></div>`;
      let done = false;
      const fin = (v) => { if (done) return; done = true; try { d.close(); } catch (_) {} d.remove(); resolve(v); };
      d.addEventListener('click', (e) => { const c = e.target.dataset && e.target.dataset.c; if (c === '1') fin(true); else if (c === '0') fin(false); else if (e.target === d && !o.noCancel) fin(false); });
      d.addEventListener('cancel', (e) => { e.preventDefault(); fin(false); });   // Esc
      document.body.appendChild(d); d.showModal();
    });
  }

  function openForm(o) {
    const dlg = $('#dlg');
    dlg.innerHTML = `<form class="sheet" id="f" novalidate><h2>${o.title}</h2>${o.body}
      <div class="btns"><button type="button" class="btn sec" data-x="cancel">キャンセル</button><button type="submit" class="btn">${o.saveLabel || '保存'}</button></div>
      ${o.onDelete ? `<button type="button" class="btn danger" data-x="del">${o.deleteLabel || '削除'}</button>` : ''}</form>`;
    const f = $('#f', dlg);
    f.addEventListener('click', (e) => {
      const x = e.target.dataset && e.target.dataset.x;
      if (x === 'cancel') dlg.close();
      if (x === 'del') {
        const lbl = o.deleteLabel || '削除', msg = typeof o.delMsg === 'function' ? o.delMsg() : o.delMsg;
        askConfirm({ title: lbl + 'しますか？', message: (msg || '') + (msg ? '\n' : '') + '元に戻せません。', okLabel: lbl + 'する' }).then((ok) => {
          if (!ok) return;
          o.onDelete(); dlg.close(); cleanActuals(); save(); render(); toast(lbl === '削除' ? '削除しました' : '完了しました');
        });
      }
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!f.checkValidity()) { f.reportValidity(); return; }
      if (f.dataset.busy) return;
      f.dataset.busy = '1';
      // onSubmit は エラー文字列 / CANCEL（何もしないでフォームに戻る）/ それらを返す Promise
      Promise.resolve(o.onSubmit(new FormData(f))).then((err) => {
        delete f.dataset.busy;
        if (err === CANCEL) return;
        if (err) { toast(err); return; }
        dlg.close(); save(); render(); toast(o.doneMsg || '保存しました');
      });
    });
    if (o.setup) o.setup(f);
    dlg.showModal();
  }
  const CANCEL = { cancel: true };
  /** 既存の実績を別の金額で上書きするときは必ず確認する（同じ金額・実績なしはそのまま） */
  function confirmOverwrite(kind, id, month, amount) {
    const a = (state.actuals || {})[L.actualKey(kind, id, month)];
    if (!a || !isFinite(Number(a.amount)) || Number(a.amount) === Math.round(Number(amount))) return Promise.resolve(true);
    return askConfirm({ title: '実績を上書きしますか？', message: `${ymLabel(month)}分にはすでに ${yenAbs(a.amount)} が記録されています。\n${yenAbs(Math.round(Number(amount)))} に置き換えます。`, okLabel: '上書きする', danger: false });
  }
  /** v6.0: 新しく登録した変動項目の下に出す案内（タップで実績の記録へ） */
  function pastHintHtml(kind, id, withName) {
    const h = ui.pastHint; if (!h || h.kind !== kind || h.id !== id) return '';
    const it = itemOf(kind, id); if (!it) return '';
    return `<div class="pasthint"><button type="button" class="pasthint-b" data-act="actuals" data-kind="${kind}" data-id="${id}">${withName ? esc(it.name) + '：' : ''}過去の金額も入れると予測が正確になります <span aria-hidden="true">›</span></button><button type="button" class="pasthint-x" data-act="close-pasthint" aria-label="閉じる">×</button></div>`;
  }
  /** v6.0: フォームの入力から「前回（今日以前で最後）の引き落とし／入金」を求める。分からなければ null */
  function formLastOcc(f) {
    const fd = new FormData(f), rep = readRepeat(fd, false);
    if (typeof rep === 'string') return null;
    const once = rep && rep.type === 'once';
    if (!once && !f.day.value) return null;
    const it = { repeat: rep, day: once ? L.parse(rep.date).d : day(fd, 'day') };
    return L.lastOccurrence(state, it, todayStr());
  }
  // v6.0.2: 日付（引き落とし日／入金日・1回だけの日付・繰り返し設定）がまだ決まっていないか
  function formDatePending(f) {
    const fd = new FormData(f), rep = readRepeat(fd, false);
    if (typeof rep === 'string') return true;
    return rep && rep.type === 'once' ? !fd.get('repDate') : !f.day.value;
  }
  const mdPlain = (s) => { const p = L.parse(s); return p.m + '/' + p.d; };
  function needAccount() { if (!state.accounts.length) { toast('先に口座を登録してください'); return true; } return false; }

  function formAccount(id) {
    const a = id ? byId(state.accounts, id) : null;
    openForm({
      title: a ? '口座を編集' : '口座を追加',
      body: field('name', '口座名', `<input id="name" name="name" required maxlength="40" value="${esc(a ? a.name : '')}" placeholder="例：〇〇銀行 普通">`) +
        field('balance', '今日の残高（円）', `<input id="balance" name="balance" type="number" inputmode="numeric" step="1" required value="${a ? a.balance : ''}">`, 'いまの口座残高を入力します（マイナスも可）') +
        field('asOf', '上の残高の日付（通常は今日）', `<input id="asOf" name="asOf" type="date" required value="${a ? a.asOf : todayStr()}">`, 'この残高を確認した日。この日の翌日以降の引き落とし・入金が予測に反映されます。'),
      onSubmit(fd) {
        const v = { name: fd.get('name').trim(), balance: Math.round(num(fd, 'balance')), asOf: fd.get('asOf') };
        if (!v.name) return '口座名を入力してください';
        if (a && v.balance !== a.balance && v.asOf === a.asOf) v.asOf = todayStr();   // 残高だけ直したら、その残高は「今日時点」
        if (a) Object.assign(a, v); else state.accounts.push(Object.assign({ id: uid() }, v));
      },
      delMsg: a ? () => `口座「${a.name}」を削除します。` + (state.cards.some((c) => c.accountId === a.id) || state.payments.some((p) => p.accountId === a.id) || state.incomes.some((i) => i.accountId === a.id) ? '\nこの口座に紐づくカード・支払い・収入は消えませんが「口座未設定」になり、予測に含まれなくなります。' : '') : '',
      onDelete: a ? () => { state.accounts = state.accounts.filter((x) => x.id !== a.id); } : null,
    });
  }
  /* 残高の変更（電子マネーの利用などで少しずつ変わる残高を、今日の値に直す） */
  function formBalance(id) {
    if (needAccount()) return;
    const t = todayStr(), cur = (acc) => Math.round(L.project(state, t, acc.id).endBalance);
    const a0 = byId(state.accounts, id) || state.accounts[0];
    openForm({
      title: '残高を変更', saveLabel: 'この残高にする', doneMsg: '残高を更新しました',
      body: (state.accounts.length > 1 ? field('accountId', '口座', `<select id="accountId" name="accountId">${state.accounts.map((x) => opt(x.id, x.name, x.id === a0.id)).join('')}</select>`) : `<p class="hint" style="margin:0 0 6px"><b>${esc(a0.name)}</b></p>`) +
        field('balance', `いまの残高（円・${md(t)}時点）`, `<input id="balance" name="balance" type="number" inputmode="numeric" step="1" required value="${cur(a0)}">`) +
        `<p class="hint" id="balNote"></p>`,
      setup(f) {
        const acc = () => byId(state.accounts, f.accountId ? f.accountId.value : a0.id);
        const note = () => { const x = acc(); $('#balNote', f).textContent = `今日（${md(t)}）の残高として保存し、明日以降の引き落とし・入金から見込みを計算し直します。（登録済み：${yen(x.balance)}・${md(x.asOf)}時点）`; };
        if (f.accountId) f.accountId.addEventListener('change', () => { f.balance.value = cur(acc()); note(); });
        note(); setTimeout(() => { try { f.balance.focus(); f.balance.select(); } catch (_) {} }, 50);
      },
      onSubmit(fd) {
        if (!L.setBalance(state, fd.get('accountId') || a0.id, num(fd, 'balance'), t)) return '残高を数字で入力してください';
      },
    });
  }
  function formCard(id) {
    if (needAccount()) return;
    const c = id ? byId(state.cards, id) : null;
    openForm({
      title: c ? 'カードを編集' : 'カードを追加',
      body: field('name', 'カード名', `<input id="name" name="name" required maxlength="40" value="${esc(c ? c.name : '')}" placeholder="例：〇〇カード">`) +
        field('fixDay', '明細が確定する日（毎月）', dayInput('fixDay', c ? c.fixDay : ''), '締め後に、カードの明細が確定する日。この日の朝8:00に金額の入力をお知らせします。' + DAYHINT) +
        field('withdrawDay', '引き落とし日（毎月）', dayInput('withdrawDay', c ? c.withdrawDay : ''), DAYHINT) +
        field('accountId', '引き落とし口座', `<select id="accountId" name="accountId">${acctOptions(c ? c.accountId : state.accounts[0].id)}</select>`) +
        `<div class="f chk"><label><input type="checkbox" name="variable" ${!c || c.variable !== false ? 'checked' : ''}> 請求額は毎月変わる（明細が確定する日に金額を入力する）</label><small>オフ＝カード内の支払い合計を常に確定額として扱います。</small></div>` +
        (c ? `<button type="button" class="btn sec" data-act="csv-open" data-id="${c.id}">このカードの明細CSVを読み込む</button>` : ''),
      onSubmit(fd) {
        const v = { name: fd.get('name').trim(), fixDay: day(fd, 'fixDay'), withdrawDay: day(fd, 'withdrawDay'), accountId: fd.get('accountId'), variable: fd.get('variable') === 'on' };
        if (!v.name) return 'カード名を入力してください';
        if (c) Object.assign(c, v); else state.cards.push(Object.assign({ id: uid(), createdAt: todayStr() }, v));
      },
      delMsg: c ? () => { const n = state.payments.filter((p) => p.cardId === c.id).length; return `カード「${c.name}」を削除します。` + (n ? `\nこのカードの支払い${n}件も一緒に削除されます。` : ''); } : '',
      onDelete: c ? () => {
        state.payments = state.payments.filter((p) => p.cardId !== c.id);
        state.cards = state.cards.filter((x) => x.id !== c.id);
      } : null,
    });
  }
  function formPay(id) {
    if (needAccount()) return;
    const p = id ? byId(state.payments, id) : null;
    const curCard = p ? p.cardId || '' : (state.cards[0] ? state.cards[0].id : '');
    openForm({
      title: p ? '支払いを編集' : '支払いを追加',
      body: field('ptype', '種類', `<select id="ptype" name="ptype">${opt('normal', '通常の支払い（サブスク・家賃など）', !(p && p.loan))}${opt('loan', 'ローン（回数が決まった分割払い）', !!(p && p.loan))}</select>`) +
        field('name', '名前・サイト／サービス名', `<input id="name" name="name" required maxlength="60" value="${esc(p ? p.name : '')}" placeholder="例：動画配信サービス">`) +
        field('cardId', '支払い方法（カードを選択）', `<select id="cardId" name="cardId">${state.cards.map((c) => opt(c.id, 'カード：' + c.name, c.id === curCard)).join('')}${opt('', '口座から直接引き落とし', curCard === '')}</select>`, state.cards.length ? '' : 'カードが未登録です。先に「カード・口座」タブで追加すると選べます。') +
        `<div id="accWrap">${field('accountId', '引き落とし口座', `<select id="accountId" name="accountId">${acctOptions(p ? p.accountId : state.accounts[0].id)}</select>`)}</div>` +
        `<div id="varWrap" class="f chk"><label><input type="checkbox" name="variable" id="variable" ${p && p.variable ? 'checked' : ''}> 変動（毎月金額が変わる：電気代など）</label></div>` +
        repeatFields(p && !p.loan ? p : null) +
        `<div id="dayWrap">${field('day', '引き落とし日', dayInput('day', p && !p.cardId ? p.day : ''), DAYHINT)}</div>` +
        `<div id="cardDayNote" class="guide" hidden></div>` +
        `<div class="f"><label for="amount" id="amtLabel">金額（円／毎月）</label><input id="amount" name="amount" type="number" inputmode="numeric" min="0" step="1" required value="${p ? p.amount : ''}"><small id="amtHint" class="hint" hidden>金額が分かったら「実績」から入力すると置き換わります。</small>${p ? '' : `<label class="unk" id="unkWrap" hidden><input type="checkbox" id="unknown" name="unknown"> まだ分からない</label>`}</div>` +
        `<div id="fixWrap">${field('fixDay', '明細が確定する日（毎月・任意）', dayInput('fixDay', p ? p.fixDay : '', false), '明細が確定する日。空欄なら引き落とし日当日。この日の朝8:00に入力をお知らせします。')}</div>` +
        `<div id="loanWrap">` +
        field('loanCount', '支払い回数（全部で何回）', `<input id="loanCount" name="loanCount" type="number" inputmode="numeric" min="1" max="600" step="1" value="${p && p.loan ? p.loan.count : ''}" placeholder="例：36">`) +
        field('loanPaid', 'すでに支払った回数', `<input id="loanPaid" name="loanPaid" type="number" inputmode="numeric" min="0" max="600" step="1" value="${p && p.loan ? '' : 0}">`, '途中から登録するときは、これまでに払った回数を入れると開始月が自動で決まります。') +
        field('loanStart', '開始月（1回目の引き落とし月）', `<input id="loanStart" name="loanStart" type="month" value="${p && p.loan ? p.loan.start : ''}">`, '上の「すでに支払った回数」と連動します。どちらを直してもOKです。') +
        `<div id="loanNote" class="guide"></div></div>` +
        field('memo', 'メモ（任意）', `<input id="memo" name="memo" maxlength="120" value="${esc(p ? p.memo || '' : '')}" placeholder="例：年払いではなく月払い">`) +
        `<div class="f chk"><label><input type="checkbox" name="active" ${!p || p.active !== false ? 'checked' : ''}> 有効（オフにすると予測・合計に含めません）</label></div>`,
      setup(f) {
        const sel = f.cardId, varC = f.variable;
        const isLoan = () => f.ptype.value === 'loan';
        const loanDayNow = () => { const cd = byId(state.cards, sel.value); return cd ? Number(cd.withdrawDay) : (Number(f.day.value) || 1); };
        let last = p && p.loan ? 'start' : 'paid';         // 最後に直したのは「回数」か「開始月」か
        const loanSync = () => {
          if (!isLoan()) return;
          const cnt = Math.round(Number(f.loanCount.value)), today = todayStr();
          if (last === 'paid') { if (f.loanPaid.value !== '') f.loanStart.value = L.loanStartForPaid(loanDayNow(), Number(f.loanPaid.value), today); }
          else if (/^\d{4}-\d{2}$/.test(f.loanStart.value) && cnt >= 1) f.loanPaid.value = L.loanInfo(state, { amount: 0, cardId: sel.value || null, day: loanDayNow(), loan: { start: f.loanStart.value, count: cnt } }, today).paid;
          const note = $('#loanNote', f);
          if (/^\d{4}-\d{2}$/.test(f.loanStart.value) && cnt >= 1) {
            const i = L.loanInfo(state, { amount: Number(f.amount.value) || 0, cardId: sel.value || null, day: loanDayNow(), loan: { start: f.loanStart.value, count: cnt } }, today);
            note.innerHTML = i.done ? '✅ すべて支払い済みです（予測には含まれません）' : `残り <b>${i.remaining}回</b>（全${i.total}回・${i.paid}回払い済み）<br>最終回：${ymLabel(i.endMonth)}・残り合計 ${yenAbs(i.remainingAmount)}<br><small>最後の回のあとは自動で止まります。利息は含みません。</small>`;
          } else note.textContent = '支払い回数を入れると、残りの回数が表示されます。';
        };
        f.loanPaid.addEventListener('input', () => { last = 'paid'; loanSync(); });
        f.loanStart.addEventListener('input', () => { last = 'start'; loanSync(); });
        [f.loanCount, f.amount, f.day].forEach((el) => { el.addEventListener('input', loanSync); el.addEventListener('change', loanSync); });
        f.ptype.addEventListener('change', () => { sync(); loanSync(); });
        const sync = () => {
          const isCard = sel.value !== '', loan = isLoan();
          $('#loanWrap', f).hidden = !loan; ['loanCount', 'loanPaid', 'loanStart'].forEach((k) => { f[k].disabled = !loan; });
          f.loanCount.required = loan; f.loanStart.required = loan; f.loanPaid.required = loan;
          $('#accWrap', f).hidden = isCard; $('#varWrap', f).hidden = isCard || loan;
          const rt = syncRepeat(f, isCard, loan);
          const noDay = isCard || rt === 'once';   // 1回だけ（口座直接）は日付欄で日まで決まる
          $('#dayWrap', f).hidden = noDay; f.day.disabled = noDay; f.day.required = !noDay;
          const cd = byId(state.cards, sel.value); const note = $('#cardDayNote', f);
          note.hidden = !isCard; if (cd) note.innerHTML = '💳 <b>引き落とし日はカード設定に従います</b>（' + esc(cd.name) + '：毎月' + dl(cd.withdrawDay) + '、' + esc((byId(state.accounts, cd.accountId) || {}).name || '口座未設定') + '）。変更は「カード・口座」タブのカード編集で行います。';
          $('#fixWrap', f).hidden = isCard || loan || !varC.checked;
          const per = { monthly: '毎月', yearly: '1回あたり', every: '1回あたり', once: '1回' }[rt];
          const dv = !loan && !isCard && varC.checked;
          // v6.0: 新規の変動（口座直接）は「前回の引き落とし（M/D）の金額」。まだ分からない／前回がない ときは従来の目安
          const pend = !p && dv && formDatePending(f);   // v6.0.2: 日付が未選択でも「前回の引き落とし」として扱う
          const lo = !p && dv ? formLastOcc(f) : null, unk = f.unknown && f.unknown.checked;
          if (f.unknown) $('#unkWrap', f).hidden = !(lo || pend);
          const known = lo && !unk, pk = pend && !unk;
          $('#amtHint', f).hidden = !dv;
          $('#amtHint', f).textContent = known ? `${ymLabel(lo.month)}分の実績として記録し、これからの目安にも使います。` : pk ? '引き落とし日を選ぶと日付が入ります' : '金額が分かったら「実績」から入力すると置き換わります。';
          $('#amtLabel', f).textContent = loan ? '毎月の返済額（円）' : known ? `前回の引き落とし（${mdPlain(lo.date)}）の金額` : pk ? '前回の引き落としの金額' : dv ? '目安の金額（先月の金額でOK・円）' : isCard ? `金額（円／${per}・カードの請求額に含まれます）` : `金額（円／${per}）`;
        };
        sel.addEventListener('change', () => { sync(); loanSync(); }); varC.addEventListener('change', sync); f.repeat.addEventListener('change', sync);
        ['day', 'repMonth', 'repN', 'repStart', 'repDate', 'unknown'].forEach((k) => { if (f[k]) { f[k].addEventListener('change', sync); f[k].addEventListener('input', sync); } });
        sync(); loanSync();
      },
      onSubmit(fd) {
        const cardId = fd.get('cardId') || null;
        const loanOn = fd.get('ptype') === 'loan';
        const variable = !loanOn && !cardId && fd.get('variable') === 'on';
        let loan = null;
        if (loanOn) {
          const count = Math.round(Number(fd.get('loanCount'))), start = fd.get('loanStart');
          if (!(count >= 1)) return '支払い回数を入力してください';
          if (!/^\d{4}-\d{2}$/.test(start)) return '開始月を入力してください（または「すでに支払った回数」を入力）';
          loan = { start, count };
        }
        const repeat = loanOn ? null : readRepeat(fd, !!cardId);
        if (typeof repeat === 'string') return repeat;
        const dayV = cardId ? (p && p.day ? p.day : 1) : repeat && repeat.type === 'once' ? L.parse(repeat.date).d : day(fd, 'day');
        const v = { loan, repeat, name: fd.get('name').trim(), amount: Math.max(0, Math.round(num(fd, 'amount'))), cardId, accountId: cardId ? (byId(state.cards, cardId) || {}).accountId : fd.get('accountId'), day: dayV, variable, fixDay: variable ? optDay(fd, 'fixDay') : null, memo: fd.get('memo').trim(), active: fd.get('active') === 'on' };
        if (!v.name) return '名前を入力してください';
        if (p) { Object.assign(p, v); return; }
        const np = Object.assign({ id: uid(), createdAt: todayStr() }, v);
        state.payments.push(np);
        recordFirstActual('pay', np, fd);
      },
      delMsg: p ? `支払い「${p.name}」を削除します。` : '',
      onDelete: p ? () => { state.payments = state.payments.filter((x) => x.id !== p.id); } : null,
    });
  }
  function formIncome(id) {
    if (needAccount()) return;
    const i = id ? byId(state.incomes, id) : null;
    openForm({
      title: i ? '収入を編集' : '収入を追加',
      body: field('name', '名前', `<input id="name" name="name" required maxlength="40" value="${esc(i ? i.name : '')}" placeholder="例：給与">`) +
        field('accountId', '入金口座', `<select id="accountId" name="accountId">${acctOptions(i ? i.accountId : state.accounts[0].id)}</select>`) +
        `<div id="varWrap" class="f chk"><label><input type="checkbox" name="variable" id="variable" ${i && i.variable ? 'checked' : ''}> 変動（毎月金額が変わる：給与の残業代など）</label></div>` +
        repeatFields(i) +
        `<div id="dayWrap">${field('day', '入金日', dayInput('day', i ? i.day : ''), DAYHINT)}</div>` +
        `<div class="f"><label for="amount" id="amtLabel">金額（円／毎月）</label><input id="amount" name="amount" type="number" inputmode="numeric" min="0" step="1" required value="${i ? i.amount : ''}"><small id="amtHint" class="hint" hidden>金額が分かったら「実績」から入力すると置き換わります。</small>${i ? '' : `<label class="unk" id="unkWrap" hidden><input type="checkbox" id="unknown" name="unknown"> まだ分からない</label>`}</div>` +
        `<div id="fixWrap">${field('fixDay', '明細が確定する日（毎月・任意）', dayInput('fixDay', i ? i.fixDay : '', false), '給与明細などで明細が確定する日。空欄なら入金日当日。')}</div>` +
        `<div class="f chk"><label><input type="checkbox" name="active" ${!i || i.active !== false ? 'checked' : ''}> 有効</label></div>`,
      setup(f) { const sync = () => { const rt = syncRepeat(f, false, false), noDay = rt === 'once';
        $('#dayWrap', f).hidden = noDay; f.day.disabled = noDay; f.day.required = !noDay;
        const dv = f.variable.checked, lo = !i && dv ? formLastOcc(f) : null, unk = f.unknown && f.unknown.checked, known = lo && !unk;
        const pend = !i && dv && formDatePending(f), pk = pend && !unk;
        if (f.unknown) $('#unkWrap', f).hidden = !(lo || pend);
        $('#fixWrap', f).hidden = !dv; $('#amtHint', f).hidden = !dv;
        $('#amtHint', f).textContent = known ? `${ymLabel(lo.month)}分の実績として記録し、これからの目安にも使います。` : pk ? '入金日を選ぶと日付が入ります' : '金額が分かったら「実績」から入力すると置き換わります。';
        $('#amtLabel', f).textContent = known ? `前回の入金（${mdPlain(lo.date)}）の金額` : pk ? '前回の入金の金額' : dv ? '目安の金額（先月の金額でOK・円）' : `金額（円／${{ monthly: '毎月', yearly: '1回あたり', every: '1回あたり', once: '1回' }[rt]}）`; };
        f.variable.addEventListener('change', sync); f.repeat.addEventListener('change', sync);
        ['day', 'repMonth', 'repN', 'repStart', 'repDate', 'unknown'].forEach((k) => { if (f[k]) { f[k].addEventListener('change', sync); f[k].addEventListener('input', sync); } });
        sync(); },
      onSubmit(fd) {
        const variable = fd.get('variable') === 'on';
        const repeat = readRepeat(fd, false); if (typeof repeat === 'string') return repeat;
        const v = { repeat, name: fd.get('name').trim(), amount: Math.max(0, Math.round(num(fd, 'amount'))), day: repeat && repeat.type === 'once' ? L.parse(repeat.date).d : day(fd, 'day'), accountId: fd.get('accountId'), variable, fixDay: variable ? optDay(fd, 'fixDay') : null, active: fd.get('active') === 'on' };
        if (!v.name) return '名前を入力してください';
        if (i) { Object.assign(i, v); return; }
        const ni = Object.assign({ id: uid(), createdAt: todayStr() }, v);
        state.incomes.push(ni);
        recordFirstActual('inc', ni, fd);
      },
      delMsg: i ? `収入「${i.name}」を削除します。` : '',
      onDelete: i ? () => { state.incomes = state.incomes.filter((x) => x.id !== i.id); } : null,
    });
  }

  /* ---------- 実績（確定額）の入力 ---------- */
  const NEG_MSG = 'マイナスの金額は入力できません。返金などで請求がなかった月は 0 を入力してください';
  function setActual(kind, id, month, amount) {
    if (!isFinite(amount)) { toast('金額を入力してください'); return false; }
    if (amount < 0) { toast(NEG_MSG); return false; }
    L.setActual(state, kind, id, month, amount); save(); return true;
  }
  /** v6.0: 新規の変動（口座直接）項目。入れた金額を前回分の実績（＋目安の金額）として記録し、案内を出す。
   *  前回分が口座の残高日以前なら、残高に反映済みなので予測では二重に引かない（genEvents は残高日より後だけ数える） */
  function recordFirstActual(kind, it, fd) {
    if (!it.variable || it.cardId || it.loan) return;
    ui.pastHint = { kind, id: it.id };
    if (fd.get('unknown') === 'on') return;
    const lo = L.lastOccurrence(state, it, todayStr());
    if (lo) L.setActual(state, kind, it.id, lo.month, it.amount);
  }
  /** 1回分の実績入力（予定の行タップ用） */
  function openEnter(kind, id, month) {
    const it = itemOf(kind, id); if (!it) return;
    const e = L.monthEvents(state, month).find((x) => x.refKind === kind && x.refId === id && x.month === month);
    const cur = e ? e.amount : initialOf(kind, it);
    const label = kind === 'card' ? it.name + ' の請求額' : it.name;
    openForm({
      title: '実績（確定額）を入力',
      saveLabel: '金額を確定する', deleteLabel: '実績を取り消す', doneMsg: '確定額を保存しました',
      body: `<p class="hint"><b>${esc(label)}</b>${e ? '<br>' + (e.kind === 'income' ? '入金日 ' : '引き落とし日 ') + md(e.date) + '・明細が確定する日 ' + md(e.fixDate) : ''}<br>現在: ${e ? (e.confirmed ? '' : '仮 ') + yenAbs(e.amount) + '（' + srcText(e) + '）' : '-'}</p>` +
        field('amount', ymLabel(month) + '分の確定金額（円）', `<input id="amount" name="amount" type="number" inputmode="numeric" min="0" step="1" required value="${e && e.confirmed ? e.amount : ''}" placeholder="${cur}" autofocus><p class="cmp" id="cmp" hidden></p>`, '入力すると仮の金額が実績に置き換わり、今後の平均（直近3回）にも使われます。'),
      onSubmit(fd) { const v = num(fd, 'amount'); if (!isFinite(v) || fd.get('amount') === '') return '金額を入力してください'; if (v < 0) return NEG_MSG;
        return confirmOverwrite(kind, id, month, v).then((ok) => { if (!ok) return CANCEL; L.setActual(state, kind, id, month, v); }); },
      delMsg: '入力した確定額を取り消して、仮の金額に戻します。',
      onDelete: e && e.source === 'actual' ? () => { L.removeActual(state, kind, id, month); } : null,
      setup(f) { bindCmp($('#amount', f), $('#cmp', f), () => ({ kind, id, month })); },
    });
  }
  /** 実績の履歴と追加（過去分のまとめ入力もここで） */
  let actCtx = null;
  function openActuals(kind, id) {
    const it = itemOf(kind, id); if (!it) return;
    actCtx = { kind, id };
    drawActuals();
    const dlg = $('#dlg'); if (!dlg.open) dlg.showModal();
  }
  function drawActuals() {
    const { kind, id } = actCtx; const it = itemOf(kind, id); const dlg = $('#dlg');
    const hist = L.history(state, kind, id).slice().reverse();
    const t = todayStr();
    const nextProv = L.genEvents(state, L.addDays(t, -1), L.addDays(t, 75)).find((e) => e.refKind === kind && e.refId === id && !e.confirmed);
    const defMonth = nextProv ? nextProv.month : L.monthKey(t);
    dlg.innerHTML = `<div class="sheet"><h2>実績の記録：${esc(it.name)}</h2>
      <p class="hint">${nextProv ? `次回の仮の金額：<b>仮 ${yenAbs(nextProv.amount)}</b>（${md(nextProv.date)}・${esc(srcText(nextProv))}）` : '次回の予定はありません'}<br>仮の金額＝直近(最大)3回の実績の平均。実績が無いうちは初期見込み額（${yenAbs(initialOf(kind, it))}）です。</p>
      <div class="f"><label>月（引き落とし${kind === 'inc' ? '（入金）' : ''}日が属する月）</label><input type="month" id="am" value="${defMonth}"></div>
      <div class="f"><label>確定した金額（円）</label><input type="number" id="aa" inputmode="numeric" min="0" step="1" placeholder="例：6200"><p class="cmp" id="acmp" hidden></p></div>
      <button class="btn" data-act="act-add">この月の実績を保存</button>
      <h3 style="margin:16px 0 8px;font-size:16px;color:var(--sub)">これまでの実績（新しい順）</h3>
      ${hist.length ? hist.map((x, i) => `<div class="row"><div class="l"><b>${ymLabel(x.month)}</b>${i < 3 ? '<small>平均の対象（直近3件）</small>' : ''}</div><div class="r">${yenAbs(x.amount)}</div><button class="btn sm danger" data-act="act-del" data-month="${x.month}">削除</button></div>`).join('') : '<div class="empty">まだ実績がありません</div>'}
      <button class="btn sec" data-act="close-dlg" style="margin-top:12px">閉じる</button></div>`;
    const up = bindCmp($('#aa', dlg), $('#acmp', dlg), () => ($('#am', dlg).value ? { kind, id, month: $('#am', dlg).value } : null));
    $('#am', dlg).addEventListener('change', up);
  }

  /* ---------- v5.8 明細CSVの読み込み ----------
   * 1/3 カードを選んでファイルを選ぶ → 2/3 中身・合計・請求月の確認（列がわからなければ列の割り当て）→ 3/3 チェックした内容を登録 */
  const CI = window.CsvImport;
  let csv = null;   // { cardId, step, file, encoding, text, an, month, sugg }
  const csvCard = () => csv && byId(state.cards, csv.cardId);
  const csvAmt = (n) => sgn(-n, Math.abs(n), true);   // 支出=赤「−¥」・返金=緑「+¥」
  function openCsv(cardId) {
    if (!state.cards.length) { toast('先にカードを登録してください'); return; }
    csv = { cardId: byId(state.cards, cardId) ? cardId : state.cards[0].id, step: 'card' };
    drawCsv();
    const dlg = $('#dlg'); if (!dlg.open) dlg.showModal();
  }
  // v6.0: 「1 ファイル選択・2 中身の確認・3 登録する内容」（今の手順だけ太字）
  const csvSteps = (n) => `<p class="csv-step" aria-label="手順 ${n}/3">${['1 ファイル選択', '2 中身の確認', '3 登録する内容'].map((l, i) => i + 1 === n ? `<b aria-current="step">${l}</b>` : `<span>${l}</span>`).join('・')}</p>`;
  // v6.0: 手順2・3で同じ形の合計「7件・合計 −¥23,990（返金1件を含む）」
  const csvSumText = (count, total, refunds) => `${count}件・合計 <b class="${total > 0 ? 'neg-t' : total < 0 ? 'pos-t' : ''}">${total < 0 ? '+' : total > 0 ? '−' : ''}${yenAbs(total)}</b>${refunds ? `（返金${refunds}件を含む）` : ''}`;
  /** 列の割り当て：その列が日付／金額として読めるか（見出しより下の行の半分以上が読めればOK） */
  function csvColOk(tb, header, col, kind) {
    if (col < 0) return null;
    const data = tb.slice(header + 1).filter((r) => r.some((c) => String(c || '').trim() !== ''));
    if (!data.length) return false;
    const f = kind === 'date' ? (c) => !!CI.parseDate(c || '') : (c) => CI.parseAmount(c || '') !== null;
    return data.filter((r) => f(r[col])).length / data.length >= 0.5;
  }
  function billOpt(card, m) {
    const w = L.monthlyDates(Number(card.withdrawDay), L.addDays(m + '-01', -1), L.monthLast(m))[0];
    return ymLabel(m) + (w ? `（${md(w)} 引き落とし）` : '');
  }
  function drawCsv() {
    const dlg = $('#dlg'), card = csvCard(); if (!card) return;
    let h = '';
    if (csv.step === 'card') {
      h = `<h2>明細CSVを読み込む</h2>${csvSteps(1)}
        <div class="f"><label for="csvCard">どのカードの明細ですか</label><select id="csvCard">${state.cards.map((c) => opt(c.id, c.name, c.id === csv.cardId)).join('')}</select></div>
        <p class="hint">カード会社の会員サイトやアプリでダウンロードした「利用明細」のCSVファイルを選んでください。データはこの端末の中だけで読み込み、外部には送りません。</p>
        <button type="button" class="btn" data-act="csv-pick">CSVファイルを選ぶ</button>
        <input type="file" id="csvfile" accept=".csv,text/csv,text/comma-separated-values,application/vnd.ms-excel" hidden>
        <details class="csv-help"><summary>iPhoneでCSVを用意するには</summary><ol>
          <li>Safariでカード会社の会員サイトにログインし、利用明細（ご利用代金明細）の画面を開きます。</li>
          <li>「CSV」「ダウンロード」などのボタンを押します。保存先はふつう「ファイル」アプリの「ダウンロード」です。</li>
          <li>ここで「CSVファイルを選ぶ」→「ブラウズ」→「ダウンロード」から選びます。</li>
          <li>スマホ表示ではCSVが出せないカード会社もあります。その場合は、Safariの「ぁあ」→「デスクトップ用Webサイトを表示」を試すか、パソコンでダウンロードしてiCloud Drive・AirDropで送ってください。</li></ol></details>
        <button type="button" class="btn sec" data-act="close-dlg">閉じる</button>`;
    } else if (csv.step === 'map') {
      const tb = csv.an.table, mp = csv.an.map;
      const sample = tb.find((r, i) => i > mp.header && r.some((c) => CI.parseDate(c))) || tb[mp.header + 1] || tb[0] || [];
      const width = Math.max(...tb.slice(0, 50).map((r) => r.length));
      const colOpts = (cur, none) => (none ? opt(-1, '（なし）', cur < 0) : '') + Array.from({ length: width }, (_, i) => opt(i, `列${i + 1}：${(sample[i] || '').trim().slice(0, 16) || '（空）'}`, i === cur)).join('');
      const pv = CI.analyze(csv.text, { header: mp.header, date: mp.date, merchant: mp.merchant, amount: mp.amount, alt: -1 });
      const r0 = pv.rows[0];
      const dOk = csvColOk(tb, mp.header, mp.date, 'date'), aOk = csvColOk(tb, mp.header, mp.amount, 'amount');
      const st = (ok, what) => `<p class="csv-colst ${ok ? 'ok' : 'ng'}">${ok ? '✓ ' + what + 'として読めます' : '✕ ' + what + 'として読めません'}</p>`;
      const merSt = mp.merchant < 0 ? '<p class="csv-colst">（なし）店名は空欄で登録します</p>' : '<p class="csv-colst ok">✓ 店名・内容として使います</p>';
      const why = r0 ? '' : mp.date === mp.amount ? '日付と金額に同じ列が選ばれています' : !dOk ? '日付の列を選び直してください' : !aOk ? '金額の列を選び直してください' : 'この割り当てでは明細を1件も読み取れません';
      h = `<h2>中身の確認：列の割り当て</h2>${csvSteps(2)}
        <p class="hint">${mp.method ? '自動の判定を変更できます。' : 'この明細の形式を自動で判定できませんでした。'}日付・店名・金額の列を選んでください。（例は1件目の行）</p>
        ${field('mDate', '日付の列', `<select id="mDate">${colOpts(mp.date, false)}</select>${st(dOk, '日付')}`)}
        ${field('mMer', '店名・内容の列', `<select id="mMer">${colOpts(mp.merchant, true)}</select>${merSt}`)}
        ${field('mAmt', '金額の列', `<select id="mAmt">${colOpts(mp.amount, false)}</select>${st(aOk, '金額')}`)}
        <div class="csv-prev"><small>1件目の読み取り結果</small>${r0 ? `<div class="row"><div class="l"><b>${esc(r0.merchant)}</b><small>${md(r0.date)}</small></div><div class="r">${csvAmt(r0.amount)}</div></div><small>${csvSumText(pv.rows.length, pv.total, pv.rows.filter((r) => r.amount < 0).length)}</small>` : '<div class="empty">この割り当てでは明細を読み取れません</div>'}</div>
        <div class="btns"><button type="button" class="btn sec" data-act="csv-back" data-to="card">戻る</button><button type="button" class="btn" data-act="csv-map-ok" ${r0 ? '' : 'disabled'}>この割り当てで進む</button></div>
        ${why ? `<p class="csv-why">${why}</p>` : ''}`;
    } else if (csv.step === 'preview') {
      const rows = csv.an.rows, total = csv.an.total, dr = CI.dateRange(rows), ds = dr.inliers.map((r) => r.date).sort();
      const skipped = csv.an.skipped || [], rejoined = csv.an.rejoined || 0;
      const refunds = rows.filter((r) => r.amount < 0);
      const guess = CI.guessBillMonth(card, rows, todayStr());
      const months = CI.billMonthOptions(guess, 4, 2); if (!months.includes(csv.month)) months.push(csv.month); months.sort();
      const pm = CI.previewMerge(state, card.id, csv.month, rows), had = CI.importedRows(state, card.id, csv.month).length;
      const MAX = 40;
      const sgKeys = new Set(CI.suggestRecurring(state, card.id, csv.month, rows).map((s) => s.key));
      h = `<h2>中身の確認</h2>${csvSteps(2)}
        <p class="hint">${esc(card.name)}・${esc(csv.file)}${csv.encoding === 'shift_jis' ? '（Shift_JIS）' : ''}</p>
        <div class="csv-sum"><p>${csvSumText(rows.length, total, refunds.length)}</p><small>利用日 ${md(ds[0])} 〜 ${md(ds[ds.length - 1])}</small></div>
        ${dr.outliers.length ? `<p class="hint csv-warn">ほかの明細と日付が大きく離れた行が${dr.outliers.length}件あります（${dr.outliers.slice(0, 3).map((r) => esc(r.date.replace(/-/g, '/'))).join('・')}${dr.outliers.length > 3 ? ' ほか' : ''}）。請求月の推定には使っていません。日付が正しいか確認してください。</p>` : ''}
        ${skipped.length ? `<details class="csv-skip"><summary>読めなかった行${skipped.length}件（日付か金額を読み取れないため除外）</summary><ul class="items">${skipped.slice(0, 10).map((x) => `<li>・${x.line ? x.line + '行目：' : ''}${esc(String(x.text).slice(0, 40))}</li>`).join('')}${skipped.length > 10 ? `<li>ほか${skipped.length - 10}件</li>` : ''}</ul></details>` : ''}
        ${rejoined ? `<p class="hint">引用符なしでカンマ付きの金額（例：1,234）を${rejoined}件、1つの金額として読みました。</p>` : ''}
        ${field('csvMonth', 'どの月の請求ですか（引き落としの月）', `<select id="csvMonth">${months.map((m) => opt(m, billOpt(card, m) + (m === guess ? '・推定' : ''), m === csv.month)).join('')}</select>`, 'カードの「明細が確定する日」「引き落とし日」と、明細の最後の利用日から推定しています。違うときは変更してください。')}
        ${had ? `<p class="hint">この月は前にも読み込んでいます（${had}件）。同じ明細は二重に数えません：合わせて ${pm.count}件・${yenAbs(pm.total)}</p>` : ''}
        <div class="csv-rows">${rows.slice(0, MAX).map((r) => `<div class="row"><div class="l"><b>${esc(r.merchant)}${sgKeys.has(CI.merchantKey(r.merchant)) ? '<span class="tag sug">毎月？</span>' : ''}</b><small>${md(r.date)}${dr.outliers.includes(r) ? '<span class="tag">日付？</span>' : ''}</small></div><div class="r">${csvAmt(r.amount)}</div></div>`).join('')}${rows.length > MAX ? `<p class="hint">ほか${rows.length - MAX}件</p>` : ''}</div>
        <button type="button" class="lnk" data-act="csv-map">列の割り当てを変更</button>
        <div class="btns"><button type="button" class="btn sec" data-act="csv-back" data-to="card">戻る</button><button type="button" class="btn" data-act="csv-next">次へ</button></div>`;
    } else if (csv.step === 'actions') {
      const pm = CI.previewMerge(state, card.id, csv.month, csv.an.rows);
      const cur = state.actuals[L.actualKey('card', card.id, csv.month)];
      const sugg = csv.sugg = CI.suggestRecurring(state, card.id, csv.month, csv.an.rows);
      const cmp = cmpInner('card', card.id, csv.month, pm.total);
      const why = (s) => s.varies ? (s.reason === 'known' ? '毎月ありそうな支払い（金額は変動）' : '前の月にも出ている・毎月ありそうな支払い（金額は変動）') : { history: '前の月にも同じくらいの金額', known: '定額サービスの名前に一致', both: '前の月にも同じくらいの金額・定額サービス' }[s.reason];
      h = `<h2>登録する内容</h2>${csvSteps(3)}
        <div class="csv-sum"><p>${csvSumText(pm.count, pm.total, csv.an.rows.filter((r) => r.amount < 0).length)}</p><small>${esc(card.name)}・${ymLabel(csv.month)}分</small></div>
        <div class="csv-act"><label class="f chk"><input type="checkbox" id="caActual" ${pm.total >= 0 ? 'checked' : 'disabled'}> <span>合計 <b>${pm.total < 0 ? '+' : ''}${yenAbs(pm.total)}</b> を <b>${ymLabel(csv.month)}</b> の確定額にする</span></label>
          <small>${esc(card.name)}の請求額として記録します（「実績」に手で入力するのと同じ）。${cur ? `今の確定額 ${yenAbs(cur.amount)} を置き換えます。` : ''}${pm.total < 0 ? `返金のほうが多く、合計が +${yenAbs(pm.total)}（戻ってくる金額）のため確定額にはできません。` : ''}</small>
          ${cmp ? `<p class="cmp">${cmp}</p>` : ''}</div>
        <h3 class="csv-h">毎月の支払いとして登録</h3>
        ${sugg.length ? sugg.map((s, i) => `<div class="csv-act"><label class="f chk"><input type="checkbox" class="caSug" data-i="${i}" ${s.strong ? 'checked' : ''}> <span><b>${esc(s.name)}</b> ${yenAbs(s.amount)}／毎月</span></label><small>${esc(s.merchant)}・${why(s)}</small></div>`).join('')
          : '<p class="hint">候補はありません（前の月の明細を読み込むと、毎月出てくる支払いを見つけやすくなります）。</p>'}
        <p class="hint csv-once">同じファイルは二重に登録されません <button type="button" class="q" data-act="csv-more" aria-label="詳しく" aria-expanded="false">？</button></p>
        <p class="hint csv-more" hidden>明細（${csv.an.rows.length}件）はこのカードの${ymLabel(csv.month)}分として保存します。${sugg.length ? '「毎月の支払い」は支払いタブに「毎月」の支払い（このカード払い）として追加され、名前や金額はあとから編集できます。金額が変動する公共料金も、カードの請求額は確定額で記録されます。' : ''}</p>
        <div class="btns"><button type="button" class="btn sec" data-act="csv-back" data-to="preview">戻る</button><button type="button" class="btn" data-act="csv-apply" id="caApply">登録</button></div>`;
    }
    dlg.innerHTML = `<div class="sheet csv">${h}</div>`;
    const ap = $('#caApply', dlg);
    if (ap) {
      const upd = () => { const a = $('#caActual', dlg), n = (a && a.checked ? 1 : 0) + dlg.querySelectorAll('.caSug:checked').length; ap.textContent = n ? n + '件を登録' : '明細だけ保存'; };
      dlg.querySelectorAll('#caActual, .caSug').forEach((x) => x.addEventListener('change', upd)); upd();
      const mb = $('[data-act=csv-more]', dlg); mb.addEventListener('click', (ev) => { ev.stopPropagation(); const m = $('.csv-more', dlg); m.hidden = !m.hidden; mb.setAttribute('aria-expanded', String(!m.hidden)); });
    }
    const cs = $('#csvCard', dlg); if (cs) cs.addEventListener('change', () => { csv.cardId = cs.value; });
    const ms = $('#csvMonth', dlg); if (ms) ms.addEventListener('change', () => { csv.month = ms.value; drawCsv(); });
    ['mDate', 'mMer', 'mAmt'].forEach((k) => { const s = $('#' + k, dlg); if (s) s.addEventListener('change', () => { const mp = csv.an.map; mp[{ mDate: 'date', mMer: 'merchant', mAmt: 'amount' }[k]] = Number(s.value); mp.alt = -1; drawCsv(); }); });
    const fi = $('#csvfile', dlg); if (fi) fi.addEventListener('change', () => { if (fi.files[0]) readCsvFile(fi.files[0]); fi.value = ''; });
  }
  const csvFail = (msg) => askConfirm({ title: '読み込めませんでした', message: msg, okLabel: 'OK', noCancel: true, danger: false });
  async function readCsvFile(file) {
    if (file.size > 5 * 1024 * 1024) return csvFail('ファイルが大きすぎます（5MBまで）。');
    let buf;
    try { buf = file.arrayBuffer ? await file.arrayBuffer() : await new Promise((ok, ng) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ng; r.readAsArrayBuffer(file); }); }
    catch (e) { return csvFail('ファイルを開けませんでした。'); }
    const dec = CI.decodeBytes(buf), an = CI.analyze(dec.text);
    if (!an.table.length) return csvFail('CSVの中身が見つかりませんでした。カード会社の「利用明細」のCSVファイルか確認してください。');
    if (!an.ok && !an.table.some((r) => r.some((c) => CI.parseDate(c))) && an.table.some((r) => r.some((c) => CI.matchHead('date', c) >= 0) && r.some((c) => CI.matchHead('amount', c) >= 0))) return csvFail('明細が0件でした。日付の入った明細の行が見つかりません。見出しだけのファイルや、まだ利用のない月のCSVではないか確認してください。');
    Object.assign(csv, { file: file.name || 'CSV', encoding: dec.encoding, text: dec.text, an });
    if (!an.ok) { csv.step = 'map'; if (an.map.date < 0) Object.assign(an.map, { date: 0, merchant: 1, amount: 2, header: -1, alt: -1 }); drawCsv(); return; }
    csv.month = CI.guessBillMonth(csvCard(), an.rows, todayStr());
    csv.step = 'preview'; drawCsv();
  }
  async function applyCsv() {
    const card = csvCard(), dlg = $('#dlg'); if (!card || !csv.an) return;
    const doActual = $('#caActual', dlg) && $('#caActual', dlg).checked;
    const picks = Array.from(dlg.querySelectorAll('.caSug')).filter((x) => x.checked).map((x) => csv.sugg[Number(x.dataset.i)]);
    const pm = CI.previewMerge(state, card.id, csv.month, csv.an.rows);
    const cur = state.actuals[L.actualKey('card', card.id, csv.month)];
    if (doActual && cur && Math.round(cur.amount) !== Math.round(pm.total)) {
      const ok = await askConfirm({ title: '確定額を置き換えますか？', message: `${ymLabel(csv.month)}の確定額 ${yenAbs(cur.amount)} を、明細の合計 ${yenAbs(pm.total)} に置き換えます。`, okLabel: '置き換える', danger: false });
      if (!ok) return;
    }
    const res = CI.mergeImport(state, card.id, csv.month, csv.an.rows);
    if (doActual && res.total >= 0) L.setActual(state, 'card', card.id, csv.month, res.total);
    const t = todayStr();
    // 登録の直前にもう一度、登録済みと重ならないか確認（同じ候補を2回押した場合など）
    const still = new Set(CI.suggestRecurring(state, card.id, csv.month, csv.an.rows).map((s) => s.key));
    let nPay = 0;
    for (const s of picks) if (still.has(s.key)) { state.payments.push(CI.paymentFromSuggestion(s, card, uid(), t)); nPay++; }
    save(); csv = null; dlg.close(); render();
    toast(['明細' + res.added + '件を保存' + (res.dup ? `（重複${res.dup}件は省略）` : ''), doActual && res.total >= 0 ? '確定額を記録' : '', nPay ? `支払い${nPay}件を登録` : ''].filter(Boolean).join('・'));
  }

  /* ---------- サンプル・バックアップ ---------- */
  function addSample() {
    const t = todayStr(), base = L.monthKey(t);
    const addD = L.addDays, dom = (d) => L.parse(d).d;   // サンプルの残高は「今日」入力したもの（今日は確定）。直近の「明細が確定する日」を過ぎた入力待ちも見せる
    const a = { id: uid(), name: '【例】メイン口座', balance: 300000, asOf: t, sample: true };
    const a2 = { id: uid(), name: '【例】サブ口座', balance: 50000, asOf: t, sample: true };
    const c1 = { id: uid(), name: '【例】Aカード（請求額が変動）', fixDay: 15, withdrawDay: 27, accountId: a.id, variable: true, sample: true };
    const c2 = { id: uid(), name: '【例】Bカード（固定）', fixDay: L.END_DAY, withdrawDay: 10, accountId: a.id, variable: false, sample: true };
    state.accounts.push(a, a2); state.cards.push(c1, c2);
    const P = (name, amount, card, d, extra) => { const p = Object.assign({ id: uid(), name, amount, cardId: card ? card.id : null, accountId: a.id, day: d, memo: '', active: true, variable: false, fixDay: null, sample: true }, extra || {}); state.payments.push(p); return p; };
    P('【例】動画配信サービス', 1490, c1, 5); P('【例】音楽サブスク', 980, c1, 12);
    P('【例】クラウドストレージ', 400, c2, 15); P('【例】通販サイト年会費', 600, c2, 20);
    P('【例】家賃', 80000, null, L.END_DAY, { memo: '毎月月末に引き落とし' });
    P('【例】携帯料金', 7000, null, 20);
    P('【例】自動車ローン', 28000, null, 28, { loan: { start: L.loanStartForPaid(28, 10, t), count: 36 } });
    P('【例】スマホ分割払い', 2500, c1, 5, { loan: { start: L.loanStartForPaid(27, 8, t), count: 24 } });
    P('【例】自動車税', 39500, null, 31, { repeat: { type: 'yearly', month: 5 }, memo: '毎年5月31日' });
    const elec = P('【例】電気代', 6000, null, 25, { variable: true, fixDay: dom(addD(t, -2)), memo: '変動：直近3回の平均で仮計算' });
    const sal = { id: uid(), name: '【例】給与', amount: 250000, day: 25, accountId: a.id, active: true, variable: true, fixDay: dom(addD(t, -1)), sample: true };
    state.incomes.push(sal, { id: uid(), name: '【例】副収入', amount: 30000, day: 10, accountId: a2.id, active: true, variable: false, fixDay: null, sample: true });
    [[elec, 'pay', [7300, 6100, 5200]], [sal, 'inc', [261500, 252000]], [c1, 'card', [2850, 2610, 2400]]].forEach(([it, k, vals]) => vals.forEach((v, i) => L.setActual(state, k, it.id, L.addMonthKey(base, -(i + 1)), v)));
    // Aカードの直近の請求は確定済みにして「確定」と「仮」が両方見えるようにする
    const nextA = L.genEvents(state, L.addDays(t, -1), L.addDays(t, 45)).find((e) => e.refKind === 'card' && e.refId === c1.id);
    if (nextA && nextA.fixDate <= t) L.setActual(state, 'card', c1.id, nextA.month, 2590);
    save(); render(); toast('サンプルデータを追加しました');
  }
  async function delSample() {
    if (!(await askConfirm({ title: 'サンプルデータを削除', message: '「サンプル」と表示されているデータ（口座・カード・支払い・収入）をすべて削除します。\nご自身で入力したデータは残ります。', okLabel: 'サンプルを削除する' }))) return;
    for (const k of ['accounts', 'cards', 'payments', 'incomes']) state[k] = state[k].filter((x) => !x.sample);
    cleanActuals(); save(); render(); toast('サンプルデータを削除しました');
  }
  // 全データ削除：2段階の確認（文字入力は使わない＝IME・全角半角の問題がない）
  async function resetAll() {
    if (!(await askConfirm({ title: 'すべてのデータを削除', message: '口座・カード・支払い・収入・実績がすべて消えます。\n先に「バックアップを保存」しておくことをおすすめします。', okLabel: '次へ' }))) return;
    if (!(await askConfirm({ title: '最後の確認', message: '本当にすべて削除しますか？この操作は元に戻せません。', okLabel: 'すべて削除する' }))) return;
    state = L.migrate(null); try { localStorage.removeItem(LASTBK_KEY); } catch (_) {} save(); render(); toast('すべて削除しました');
  }
  const LASTBK_KEY = 'money-app-last-backup';   // 復元でデータを置き換えても消えないよう、別のキーに保存
  const lastBackup = () => { try { return localStorage.getItem(LASTBK_KEY); } catch (_) { return null; } };
  const markBackup = () => { try { localStorage.setItem(LASTBK_KEY, new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 19)); } catch (_) {} };
  const backupJson = () => JSON.stringify(Object.assign({ app: 'money-app', exportedAt: new Date().toISOString() }, state), null, 2);
  // iPhone: 共有シート（「ファイル」に保存・AirDrop など）／非対応ならダウンロード
  async function exportJson() {
    const name = L.backupFileName(todayStr()), json = backupJson();
    let file = null;
    try { file = new File([json], name, { type: 'application/json' }); } catch (_) {}
    if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); markBackup(); render(); toast('バックアップを保存しました'); return; }
      catch (e) { if (e && e.name === 'AbortError') { toast('キャンセルしました'); return; } /* 共有できなければダウンロードへ */ }
    }
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    markBackup(); render(); toast('バックアップを保存しました');
  }
  function importJson(file) {
    const r = new FileReader();
    r.onload = () => {
      const v = L.validateBackup(String(r.result || ''));
      if (!v.ok) { askConfirm({ title: '読み込めませんでした', message: v.error, okLabel: 'OK', noCancel: true, danger: false }); return; }
      const c = v.counts, when = v.exportedAt ? new Date(v.exportedAt) : null;
      const whenTxt = when && !isNaN(when) ? `${when.getFullYear()}年${when.getMonth() + 1}月${when.getDate()}日に保存したバックアップ\n` : '';
      if (v.empty) {
        // 空のバックアップ（口座・カード・支払い・収入が0件）で復元すると、今のデータがすべて消える。2段階で確認
        askConfirm({ title: '空のバックアップです', message: `${whenTxt}このファイルには口座・カード・支払い・収入が1件も入っていません。\n\n復元すると今のデータはすべて消え、空の状態になります。`, okLabel: '次へ' })
          .then((ok) => ok && askConfirm({ title: '最後の確認', message: '今のデータをすべて消して、空の状態にしますか？この操作は元に戻せません。', okLabel: '空にして復元する' }))
          .then((ok) => { if (!ok) return; state = v.state; sel.target = null; sel.vm = null; save(); render(); toast('復元しました（空のデータ）'); });
        return;
      }
      askConfirm({ title: 'バックアップから復元', message: `${whenTxt}口座${c.accounts}・カード${c.cards}・支払い${c.payments}・収入${c.incomes}・実績${c.actuals}${c.imports ? '・明細' + c.imports + 'か月分' : ''}\n\n今のデータは上書きされます。${v.oldFormat ? '\n（古い形式のデータは自動で変換されます）' : ''}`, okLabel: '上書きして復元' })
        .then((ok) => { if (!ok) return; state = v.state; sel.target = null; sel.vm = null; save(); render(); toast('復元しました'); });
    };
    r.onerror = () => askConfirm({ title: '読み込めませんでした', message: 'ファイルを開けませんでした。', okLabel: 'OK', noCancel: true, danger: false });
    r.readAsText(file);
  }

  // その日を選び、内訳の該当行までスクロールして少し光らせる（5件より後なら「すべて見る」を開く）
  function jumpTo(d, ref, neg) {
    if (!d) return;
    sel.target = d; sel.vm = L.monthKey(d); render();
    const find = () => (ref && $(`.hrow[data-date="${d}"][data-ref="${ref}"]`)) || (neg && $(`.hrow[data-date="${d}"][data-neg]`)) || $(`.hrow[data-date="${d}"]`);
    let row = find();
    if (!row && !ui.all && $('[data-act=toggle-all]')) { ui.all = true; render(); row = find(); }
    if (!row) row = $('.hrow.base');
    if (!row) return;
    if (row.scrollIntoView) row.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1600);
  }

  /* ---------- イベント ---------- */
  // v6.0.1: 集計の長い名前は2行で…。タップで全文を表示／もう一度で戻す
  window.addEventListener('click', (e) => {
    const n = e.target.closest && e.target.closest('#main .nm.xp'); if (!n) return;
    if (!n.classList.contains('open') && n.scrollHeight <= n.clientHeight + 1) return;
    n.classList.toggle('open'); n.setAttribute('aria-expanded', n.classList.contains('open') ? 'true' : 'false');
    e.preventDefault(); e.stopPropagation();
  }, true);
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab],[data-act]');
    if (!t) return;
    if (t.dataset.tab) { e.preventDefault(); return go(t.dataset.tab); }
    const id = t.dataset.id;
    switch (t.dataset.act) {
      case 'sample': addSample(); break;
      case 'del-sample': delSample(); break;
      case 'add-account': formAccount(); break;
      case 'edit-balance': formBalance(id); break;
      case 'edit-account': formAccount(id); break;
      case 'add-card': formCard(); break;
      case 'edit-card': formCard(id); break;
      case 'add-pay': formPay(); break;
      case 'edit-pay': formPay(id); break;
      case 'add-income': formIncome(); break;
      case 'edit-income': formIncome(id); break;
      case 'export': exportJson(); break;
      case 'import': $('#file').click(); break;
      case 'reset': {
        resetAll(); break;
      }
      case 'quick': {
        const m = Number(t.dataset.m);
        sel.target = m < 0 ? todayStr() : L.addMonthsEnd(todayStr(), m);
        sel.vm = L.monthKey(sel.target); render(); break;
      }
      case 'jump': jumpTo(t.dataset.date, t.dataset.ref, t.dataset.neg === '1'); break;
      case 'toggle-inbox': ui.inbox = !ui.inbox; render(); break;
      case 'toggle-help': ui.help = !ui.help; render(); break;
      case 'toggle-payhelp': ui.payHelp = !ui.payHelp; if (!ui.payHelp) { try { localStorage.setItem(PAYHELP_KEY, '1'); } catch (_) {} } render(); break;
      case 'close-payhelp': ui.payHelp = false; try { localStorage.setItem(PAYHELP_KEY, '1'); } catch (_) {} render(); break;
      case 'toggle-all': ui.all = !ui.all; render(); break;
      case 'hint': { const sm = t.closest('.f').querySelector('small'); if (sm) sm.hidden = !sm.hidden; break; }
      case 'pacc': state.settings.projAccount = id; save(); render(); break;
      case 'mnav': { const d = Number(t.dataset.d); sel.vm = d === 0 ? L.monthKey(todayStr()) : L.addMonthKey(getViewMonth(), d); render(); break; }
      case 'snav': { const d = Number(t.dataset.d); sumMonth = d === 0 ? null : L.addMonthKey(sumMonth || L.monthKey(todayStr()), d); render(); break; }
      case 'enter': openEnter(t.dataset.kind, id, t.dataset.month); break;
      case 'actuals': if (ui.pastHint && ui.pastHint.id === id) ui.pastHint = null; openActuals(t.dataset.kind, id); break;
      case 'close-pasthint': ui.pastHint = null; render(); break;
      case 'close-dlg': $('#dlg').close(); break;
      case 'csv-open': openCsv(id); break;
      case 'csv-pick': { const fi = $('#csvfile'); if (fi) fi.click(); break; }
      case 'csv-back': if (csv) { csv.step = t.dataset.to; drawCsv(); } break;
      case 'csv-map': if (csv) { csv.step = 'map'; drawCsv(); } break;
      case 'csv-map-ok': if (csv) { const mp = csv.an.map; csv.an = CsvImport.analyze(csv.text, { header: mp.header, date: mp.date, merchant: mp.merchant, amount: mp.amount, alt: mp.alt }); csv.an.map.headers = mp.headers; csv.month = CsvImport.guessBillMonth(csvCard(), csv.an.rows, todayStr()); csv.step = 'preview'; drawCsv(); } break;
      case 'csv-next': if (csv) { csv.step = 'actions'; drawCsv(); } break;
      case 'csv-apply': if (csv) applyCsv(); break;
      case 'act-add': {
        const m = $('#am').value, v = Number($('#aa').value);
        if (!m) { toast('月を選んでください'); break; }
        if ($('#aa').value === '') { toast('金額を入力してください'); break; }
        if (!isFinite(v)) { toast('金額を入力してください'); break; }
        if (v < 0) { toast(NEG_MSG); break; }
        const ctx = actCtx;
        confirmOverwrite(ctx.kind, ctx.id, m, v).then((ok) => { if (!ok || actCtx !== ctx) return; if (setActual(ctx.kind, ctx.id, m, v)) { drawActuals(); toast('実績を保存しました'); } });
        break;
      }
      case 'act-del': {
        const ctx = actCtx, mo = t.dataset.month;
        askConfirm({ title: '実績を削除しますか？', message: `${ymLabel(mo)}の実績を削除します。平均の計算からも外れます。\n元に戻せません。`, okLabel: '削除する' }).then((ok) => { if (ok && ctx && actCtx === ctx) { L.removeActual(state, ctx.kind, ctx.id, mo); save(); drawActuals(); toast('削除しました'); } });
        break;
      }
      case 'confirm-actual': {
        const row = t.closest('.inb-row'), inp = $('input', row);
        if (inp.value === '' && inp.validity && inp.validity.badInput) { toast('数字で入力してください'); inp.focus(); break; }
        if (inp.value === '') { toast('金額を入力してください'); inp.focus(); break; }
        if (Number(inp.value) < 0) { toast(NEG_MSG); inp.focus(); break; }
        const rk = row.dataset.kind, ri = row.dataset.id, rm = row.dataset.month, rv = Number(inp.value);
        confirmOverwrite(rk, ri, rm, rv).then((ok) => { if (ok && setActual(rk, ri, rm, rv)) { render(); toast('金額を確定しました'); } });
        break;
      }
      case 'notif-request': Notify.request().then(async (p) => { await syncNotify(); render(); toast(p === 'granted' ? '通知を許可しました' : '通知は許可されませんでした'); }); break;
      case 'notif-test': Notify.show('テスト通知', '通知は正常に表示されます。', 'test-' + Date.now()).then(() => toast('テスト通知を送りました')).catch(() => toast('通知を表示できませんでした')); break;
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'target') { if (t.value) { sel.target = t.value; sel.vm = L.monthKey(t.value); render(); } }
    else if (t.id === 'holidayShift') { state.settings.holidayShift = t.checked; save(); render(); toast(t.checked ? '翌営業日にずらして計算します' : '登録した日のまま計算します'); }
    else if (t.id === 'pacc') { state.settings.projAccount = t.value; save(); render(); }
    else if (t.dataset && t.dataset.act === 'toggle-pay') { const p = byId(state.payments, t.dataset.id); if (p) { p.active = t.checked; save(); render(); } }
    else if (t.id === 'file' && t.files[0]) { importJson(t.files[0]); t.value = ''; }
  });
  // 入力待ちの行：入力に合わせて先月との比較を更新
  document.addEventListener('input', (e) => {
    const row = e.target.closest && e.target.closest('.inb-row'); if (!row) return;
    const box = $('.cmp', row); if (box) box.innerHTML = cmpInner(row.dataset.kind, row.dataset.id, row.dataset.month, e.target.value);
  });
  $('#dlg').addEventListener('close', () => { actCtx = null; csv = null; render(); });
  // 日付が変わった／しばらく閉じていたあとに開き直したら、指定日を今日に戻す
  let hiddenAt = 0, lastDay = todayStr();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (todayStr() !== lastDay || (hiddenAt && Date.now() - hiddenAt > 10 * 60 * 1000)) { sel.target = null; sel.vm = null; }
    lastDay = todayStr(); render(); syncNotify();
  });

  /* ---------- グラフの指定日マーカー：タップで選択／左右ドラッグで移動（マウス・タッチ共通の pointer イベント） ---------- */
  let drag = null;
  const chartDay = (svg, clientX) => {
    const ds = chartCtx.ds, G = chartCtx.G, r = svg.getBoundingClientRect();
    const vx = (clientX - r.left) * (G.W / r.width);
    const i = Math.max(0, Math.min(ds.days.length - 1, Math.floor((vx - G.padL) / G.cw)));
    return ds.days[i].date;
  };
  const moveTo = (date) => {                       // ドラッグ中は 大きな残高・読み取り・マーカーだけ更新（全体の描画は離したときに1回）
    if (!date || date === getTarget()) return;
    sel.target = date;
    const mk = $('#selmk'), hero = $('.hero'), rw = $('#readwrap');
    if (!mk || !hero) { render(); return; }
    mk.innerHTML = selMarker(chartCtx.ds, date, chartCtx.G);
    hero.outerHTML = heroHtml(date);
    if (rw) rw.innerHTML = readoutHtml(chartCtx.ds, date);
  };
  const main = $('#main');
  main.addEventListener('pointerdown', (e) => {
    const svg = e.target.closest && e.target.closest('svg.chart[data-drag]');
    if (!svg || !chartCtx || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag = { svg, id: e.pointerId, x0: e.clientX, moved: false };
    try { svg.setPointerCapture(e.pointerId); } catch (_) {}
  });
  main.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) { if (Math.abs(e.clientX - drag.x0) < 5) return; drag.moved = true; svgDragging(drag.svg, true); }
    moveTo(chartDay(drag.svg, e.clientX));
  });
  const svgDragging = (svg, on) => svg.classList.toggle('dragging', on);
  const endDrag = (e, cancel) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null; svgDragging(d.svg, false);
    if (!d.moved && cancel) return;                  // 縦スクロールになった場合は日付を変えない
    if (!d.moved) { sel.target = chartDay(d.svg, e.clientX); }
    render();
  };
  main.addEventListener('pointerup', (e) => endDrag(e, false));
  main.addEventListener('pointercancel', (e) => endDrag(e, true));

  // iPhone: キーボードの表示中は下のタブバーを隠し、閉じたら画面のずれ（固定要素が浮いたまま）を戻す
  const isTyping = (el) => el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|file|range|color)$/.test(el.type)));
  document.addEventListener('focusin', (e) => { if (isTyping(e.target)) document.body.classList.add('typing'); });
  document.addEventListener('focusout', () => setTimeout(() => {
    if (isTyping(document.activeElement)) return;
    document.body.classList.remove('typing');
    if (window.scrollX) window.scrollTo(0, window.scrollY);
  }, 60));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { if (!isTyping(document.activeElement)) { document.body.classList.remove('typing'); if (window.scrollX) window.scrollTo(0, window.scrollY); } });
  render();
  syncNotify();
  // v6.0.7: 更新バーは余白だけ足す（スクロール位置は変えない）。末尾までスクロールすれば押せる
  function showUpdateBar() {
    if (document.getElementById('updBar')) return;
    const d = document.createElement('div'); d.id = 'updBar'; d.className = 'updbar'; d.setAttribute('role', 'status');
    d.innerHTML = '<span>新しい版があります</span><button type="button" class="upd-go">更新する</button><button type="button" class="upd-x" aria-label="閉じる">✕</button>';
    d.querySelector('.upd-go').onclick = () => location.reload();
    d.querySelector('.upd-x').onclick = () => {
      d.remove(); document.body.classList.remove('has-upd'); document.documentElement.classList.remove('has-upd');
      document.body.style.removeProperty('--upd-h'); document.documentElement.style.removeProperty('--upd-h');
    };
    document.body.appendChild(d);
    const h = Math.ceil(d.getBoundingClientRect().height) || 56;
    document.body.style.setProperty('--upd-h', h + 'px');
    document.documentElement.style.setProperty('--upd-h', h + 'px');
    document.body.classList.add('has-upd'); document.documentElement.classList.add('has-upd');
  }
  window.__showUpdateBar = showUpdateBar;   // テスト用
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    // v6.0.4: 新しい版が入ったら下に「新しい版があります」バー（最初のインストールでは出さない）
    const hadCtrl = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      syncNotify();
      reg.addEventListener('updatefound', () => {
        const w = reg.installing; if (!w) return;
        w.addEventListener('statechange', () => { if (w.state === 'activated' && hadCtrl) showUpdateBar(); });
      });
    }).catch(() => {});
  }
})();
