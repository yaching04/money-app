/* 支払い管理アプリ v2（UI）。データは localStorage に保存。計算は logic.js、通知は notify.js */
(function () {
  'use strict';
  const L = window.Logic;
  const KEY = 'money-app-v1'; // v1 と同じキーを使い、読み込み時に migrate() で v2 形式へ
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const yen = (n) => (n < 0 ? '−' : '') + '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
  const yenAbs = (n) => '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
  const short = (n) => { const a = Math.abs(n); const s = a >= 10000 ? (Math.round(a / 1000) / 10).toString().replace(/\.0$/, '') + '万' : Math.round(a).toString(); return (n < 0 ? '−' : '') + s; };
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const dow = (s) => { const p = L.parse(s); return WD[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]; };
  const md = (s) => { const p = L.parse(s); return p.m + '/' + p.d + '(' + dow(s) + ')'; };
  const ymd = (s) => { const p = L.parse(s); return p.y + '年' + p.m + '月' + p.d + '日(' + dow(s) + ')'; };
  const ymLabel = (k) => { const [y, m] = k.split('-'); return y + '年' + Number(m) + '月'; };

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

  /* ---------- 共通パーツ: 予定の1行 ---------- */
  function eventRow(e, o) {
    o = o || {};
    const kindTag = e.kind === 'income' ? '<span class="tag inc">収入</span>' : e.kind === 'card' ? '<span class="tag">カード</span>' : '<span class="tag dir">口座直接</span>';
    const items = o.items !== false && e.kind === 'card' && e.items.length ? `<ul class="items">${e.items.map((i) => `<li>・${esc(i.name)} ${yenAbs(i.amount)}</li>`).join('')}</ul>` : '';
    const acc = byId(state.accounts, e.accountId);
    const accLine = state.accounts.length > 1 && acc ? `<small>${esc(acc.name)}${o.balance && o.multi ? '：残高 ' + pvYen(e.accountBalance, e.uncertain) : ''}</small>` : '';
    let right = `<div class="amt">${sgn(e.delta, e.amount, e.confirmed)}</div>`;
    if (o.balance) right += `<small class="${e.negative ? 'neg-t' : ''}">残高 ${pvYen(e.balance, e.uncertain)}${e.negative ? ' ⚠' : ''}</small>`;
    const p = L.parse(e.date);
    const sub = [srcText(e), e.variable ? '請求額がわかる日 ' + md(e.fixDate) : ''].filter(Boolean).join('・');
    const tap = e.variable ? `data-act="enter" data-kind="${e.refKind}" data-id="${e.refId}" data-month="${e.month}"` : '';
    return `<div class="ev ${o.balance && e.negative ? 'bad' : ''} ${e.confirmed ? '' : 'prov'} ${e.variable ? 'tap' : ''}" ${tap}>
      <div class="d"><b>${p.m}/${p.d}</b>(${dow(e.date)})</div>
      <div class="m">${kindTag}<b>${esc(e.label)}</b>${accLine}${sub ? `<small>${esc(sub)}${e.variable ? ' ✎' : ''}</small>` : ''}${items}</div>
      <div class="a">${right}</div></div>`;
  }

  /* ---------- チャート（SVG・外部ライブラリなし） ---------- */
  // 1・2・5 × 10^n の区切りのよい目盛り（例：10万刻み）
  function niceTicks(lo, hi) {
    const raw = (hi - lo) / 3.5 || 1, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v)); return out;
  }
  function chartGeo(ds, bars) {
    const W = 360, padL = bars ? 34 : 48, padR = 8, top = 24, hL = bars ? 0 : 150, gap = 0, hB = bars ? 140 : 0, bot = 22;
    const n = ds.days.length, cw = (W - padL - padR) / n, H = top + hL + gap + hB + bot;
    const X = (i) => padL + (i + 0.5) * cw;
    const range = (ds.max - ds.min) || Math.max(1, Math.abs(ds.max) * 0.1);
    const lo = ds.min < 0 ? ds.min - range * 0.12 : Math.max(0, ds.min - range * 0.35);
    const hi = ds.max + range * 0.12;
    const Y = (v) => top + hL - ((v - lo) / (hi - lo)) * hL;
    return { W, padL, padR, top, hL, gap, hB, bot, n, cw, H, X, Y, lo, hi };
  }
  /** 指定日のマーカー（縦線・つまみ・点）。ドラッグ中はここだけ差し替える */
  function selMarker(ds, target, G) {
    const i = ds.days.findIndex((d) => d.date === target); if (i < 0) return '';
    const x = G.X(i), c = '#1d4ed8', d = ds.days[i], w = 64, lx = Math.min(G.W - w - 2, Math.max(2, x - w / 2));
    let s = `<line x1="${x}" x2="${x}" y1="${G.top - 4}" y2="${G.top + G.hL}" stroke="${c}" stroke-width="1.5"/>`;
    if (d.balance !== null) s += `<circle cx="${x}" cy="${G.Y(d.balance)}" r="4.4" fill="#fff" stroke="${d.neg ? '#dc2626' : d.prov ? '#d97706' : '#0f766e'}" stroke-width="2.2"/>`;
    s += `<g class="grip"><rect x="${lx}" y="2" width="${w}" height="18" rx="9" fill="${c}"/><text x="${lx + w / 2}" y="15" text-anchor="middle" class="cs-t" fill="#fff">◀ 指定日 ▶</text></g>`;
    return s;
  }
  function chartSvg(ds, target, mode) {
    const bars = mode === 'bars';   // 'bars'=日別の収入・支出（集計タブ） / 既定=残高の線（ホーム）
    const G = chartGeo(ds, bars);
    const { W, padL, padR, top, hL, gap, hB, bot, n, cw, H, X, Y, lo, hi } = G;
    const COL = { ok: '#0f766e', prov: '#d97706', neg: '#dc2626' };
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="月の残高推移グラフ${bars ? '' : '（左右にドラッグして日付を変更）'}" ${bars ? '' : 'data-drag="1"'}>
      <defs>
        <pattern id="hatchR" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#fecaca"/><line x1="0" y1="0" x2="0" y2="5" stroke="#dc2626" stroke-width="2"/></pattern>
        <pattern id="hatchG" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#bbf7d0"/><line x1="0" y1="0" x2="0" y2="5" stroke="#15803d" stroke-width="2"/></pattern>
      </defs>`;
    // 週末の薄い背景
    ds.days.forEach((d, i) => { const w = new Date(d.date + 'T00:00:00Z').getUTCDay(); if (w === 0 || w === 6) s += `<rect x="${padL + i * cw}" y="${top}" width="${cw}" height="${hL + gap + hB}" fill="${w === 0 ? '#fef2f2' : '#eff6ff'}" opacity=".55"/>`; });
    // 横グリッド
    if (!bars) niceTicks(lo, hi).forEach((v) => { if (v === 0 && lo < 0) return; const y = Y(v); s += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="#e2e8f0"/><text x="${padL - 4}" y="${y + 4}" text-anchor="end" class="cs-t">${short(v)}</text>`; });
    if (!bars && lo < 0 && hi > 0) s += `<line x1="${padL}" x2="${W - padR}" y1="${Y(0)}" y2="${Y(0)}" stroke="#dc2626" stroke-dasharray="3 3"/><text x="${padL - 4}" y="${Y(0) + 4}" text-anchor="end" class="cs-t" fill="#dc2626">0</text>`;
    // 今日・指定日
    const mark = (date, color, label, dash) => { const i = ds.days.findIndex((d) => d.date === date); if (i < 0) return ''; return `<line x1="${X(i)}" x2="${X(i)}" y1="${top}" y2="${top + hL + gap + hB}" stroke="${color}" stroke-width="1.5" ${dash ? 'stroke-dasharray="2 3"' : ''}/><text x="${X(i) > W - 28 ? W - 2 : X(i)}" y="${top - 8}" text-anchor="${X(i) > W - 28 ? 'end' : 'middle'}" class="cs-t" fill="${color}">${label}</text>`; };
    s += mark(todayStr(), '#64748b', '今日', true);
    // 残高の線（区間ごと: マイナス=赤 / 仮=破線 / 確定=実線）
    for (let i = 1; !bars && i < n; i++) {
      const a = ds.days[i - 1], b = ds.days[i];
      if (a.balance === null || b.balance === null) continue;
      const neg = a.balance < 0 || b.balance < 0, prov = b.prov;
      s += `<line x1="${X(i - 1)}" y1="${Y(a.balance)}" x2="${X(i)}" y2="${Y(b.balance)}" stroke="${neg ? COL.neg : prov ? COL.prov : COL.ok}" stroke-width="2.6" stroke-linecap="round" ${prov ? 'stroke-dasharray="5 4"' : ''}/>`;
    }
    if (!bars) ds.days.forEach((d, i) => { if (d.balance === null) return; if (d.events.length || i === 0) s += `<circle cx="${X(i)}" cy="${Y(d.balance)}" r="2.8" fill="#fff" stroke="${d.neg ? COL.neg : d.prov ? COL.prov : COL.ok}" stroke-width="2"/>`; });
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
  function renderWelcome() {
    const steps = [['口座を登録', '口座名・今日の残高を入力します。<b>ここまでで見込みが見られます。</b>'], ['カード・支払いを登録', '毎月の支払い（カード払い／口座から直接）や収入を追加します。'], ['見込みを見る', 'ホームで日付を選ぶと、その日の口座残高の見込みがわかります。']];
    return `<div class="card"><h2>はじめに</h2>
      <p style="margin:0 0 4px">「いつ・いくら払って（入って）、<b>この日には口座にいくら残るか</b>」が一目でわかるアプリです。</p>
      <div class="steps">${steps.map((x, i) => `<div class="step ${i === 0 ? 'now' : ''}"><div class="n">${['①', '②', '③'][i]}</div><div><b>${x[0]}</b><small>${x[1]}</small></div></div>`).join('')}</div>
      <p class="hint" style="margin:0 0 8px">💡 口座だけ登録すれば見込みは見られます。支払いは後から追加できます。</p>
      <button class="btn" data-act="add-account">① 口座を登録する</button>
      <button class="btn sec" data-act="sample">サンプルデータで試す（あとで一括削除できます）</button></div>`;
  }
  const needAcctGuide = () => `<div class="guide"><b>まず口座を登録しましょう。</b><br>口座を登録すると、この画面が使えるようになります。<button class="btn sm" style="margin-top:8px" data-act="add-account">口座を登録する</button> <button class="btn sm sec" data-tab="home" style="margin-top:8px">はじめに戻る</button></div>`;

  /* ---------- ホーム ---------- */
  const PAYHELP_KEY = 'money-app-hint-pay';   // 支払いタブの説明を閉じたか（アプリのデータとは別に保存）
  const payHelpSeen = () => { try { return localStorage.getItem(PAYHELP_KEY) === '1'; } catch (_) { return false; } };
  const ui = { inbox: false, all: false, help: false, payHelp: !payHelpSeen() };   // ホームの開閉状態（保存しない）
  function homeRow(e) {
    const p = L.parse(e.date);
    const tap = e.variable ? `data-act="enter" data-kind="${e.refKind}" data-id="${e.refId}" data-month="${e.month}"` : '';
    return `<div class="hrow ${e.confirmed ? '' : 'prov'} ${e.variable ? 'tap' : ''}" ${tap}>
      <div class="d">${p.m}/${p.d}<small>${dow(e.date)}</small></div>
      <div class="m"><b>${esc(e.label)}</b>${e.negative ? `<small class="neg-t">この後の残高 ${yen(e.balance)} ⚠</small>` : ''}</div>
      <div class="a">${sgn(e.delta, e.amount, e.confirmed)}</div></div>`;
  }
  /* ヒーロー（大きな残高・日付・クイック選択）。ドラッグ中はここだけ作り直す */
  function heroHtml(target) {
    const today = todayStr(), scope = getScope();
    const pr = L.project(state, target, scope);
    const multi = scope === 'all' && state.accounts.length > 1;
    const prov = pr.confirmedThrough !== null && !pr.beforeAsOf;
    const pending = L.computePending(state, today);
    const scopeName = scope === 'all' ? '口座合計' : esc(byId(state.accounts, scope).name);
    let h = `<section class="hero ${pr.negative ? 'neg' : ''}">
      <div class="hero-bar"><input type="date" id="target" value="${target}" aria-label="見込みを見る日付">
        ${state.accounts.length > 1 ? `<select id="pacc" aria-label="口座">${`<option value="all" ${scope === 'all' ? 'selected' : ''}>口座合計</option>` + state.accounts.map((a) => `<option value="${a.id}" ${scope === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>` : ''}
        <button class="q" data-act="toggle-help" aria-label="説明を表示" aria-expanded="${ui.help}">？</button></div>
      <div class="big"><span>${yen(pr.endBalance)}</span><span class="hero-tag">${prov ? '仮' : '確定額'}</span></div>
      <div class="small">${ymd(target)} 時点・${scopeName}</div>`;
    if (pr.negative) {
      const f = pr.firstNegative;
      h += `<div class="warn hero-in">⚠ 残高がマイナスになります${f ? '：' + md(f.date) + ' ' + esc(f.label) + ' の後（' + yen(f.balance) + (multi ? '／' + esc(f.accountName) + ' ' + yen(f.accountBalance) : '') + '）' : '（現在マイナスの口座があります）'}${f && f.uncertain ? '<br><small>※ 仮の金額を含む予測です</small>' : ''}</div>`;
    }
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

    let h = heroHtml(target);

    // 2) 入力待ち：細い黄色の帯。タップで開く
    if (pending.length) {
      h += `<section class="band ${ui.inbox ? 'open' : ''}"><button class="band-btn" data-act="toggle-inbox" aria-expanded="${ui.inbox}"><span>📝 入力待ち ${pending.length}件</span><span class="chev">${ui.inbox ? '▲' : '▼'}</span></button>`;
      if (ui.inbox) {
        h += `<div class="band-body"><p class="sub">請求額がわかる日になりました。金額を入力すると、仮が確定額に置き換わります。</p>`;
        h += pending.map((e) => `<div class="inb-row" data-kind="${e.refKind}" data-id="${e.refId}" data-month="${e.month}">
          <div class="l"><b>${esc(e.label)}</b> <span class="tag mo">${Number(e.month.slice(5))}月分</span><small>${e.kind === 'income' ? '入金' : '引き落とし'}日 ${md(e.date)}・請求額がわかる日 ${md(e.fixDate)}</small><small>仮 ${yenAbs(e.amount)}（${esc(srcText(e))}）</small></div>
          <div class="in"><input type="number" inputmode="numeric" min="0" step="1" placeholder="${e.amount}" aria-label="${esc(e.label)} ${Number(e.month.slice(5))}月分の金額"><button class="btn sm" data-act="confirm-actual">金額を確定する</button></div></div>`).join('');
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
      h += `<div class="legend"><span><i class="ln"></i>確定額</span><span><i class="ln dash"></i>仮</span><span><i class="ln red"></i>マイナス</span></div>`;
      h += `<div id="readwrap">${readoutHtml(ds, target)}</div>`;
    }
    h += `</section>`;

    // 4) 内訳：直近5件 + すべて見る
    const N = 5, evs = pr.events, list = ui.all ? evs : evs.slice(0, N);
    h += `<section class="sec"><h2>内訳</h2>
      <div class="hrow base"><div class="m"><b>今日の残高</b></div><div class="a"><span class="${pr.startBalance < 0 ? 'neg-t' : ''}">${yen(pr.startBalance)}</span><button class="lnk" data-act="edit-balance" data-id="${scope === 'all' ? '' : scope}">変更</button></div></div>`;
    h += evs.length ? list.map(homeRow).join('') : `<div class="empty">この期間に反映される引き落とし・入金はありません</div>`;
    if (evs.length > N) h += `<button class="more" data-act="toggle-all">${ui.all ? '閉じる' : `すべて見る（残り${evs.length - N}件）`}</button>`;
    h += `<div class="hrow base end"><div class="m"><b>${md(target)} の見込み</b></div><div class="a ${pr.endBalance < 0 ? 'neg-t' : ''}">${pvYen(pr.endBalance, prov)}</div></div></section>`;
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
      if (p.cardId) { if (!card) meta = '<span class="neg-t">カードが見つかりません</span>'; }
      else if (dv) {
        // 変動の口座直接: 2行目は1本の補足行（メモは編集シートでのみ表示）
        const src = e ? (e.source === 'average' ? `直近${e.n}回平均` : e.source === 'actual' ? '実績' : e.source === 'initial' ? '初期見込み' : '') : '';
        meta = [p.day + '日', acc ? esc(acc.name) : '<span class="neg-t">口座未設定</span>', src].filter(Boolean).join('・');
      } else meta = `引き落とし日 毎月${p.day}日・${acc ? esc(acc.name) : '<span class="neg-t">口座未設定</span>'}`;
      let right = yenAbs(p.amount), nameTag = '';
      if (p.loan) {
        const li = L.loanInfo(state, p, todayStr());
        const st = li.done ? '完了（全' + li.total + '回）' : `<b class="rem">残り${li.remaining}回</b>／全${li.total}回`;
        meta = '<span class="tag loan">ローン</span>' + st + (p.cardId ? '' : `・毎月${p.day}日・${acc ? esc(acc.name) : '<span class="neg-t">口座未設定</span>'}`);
        if (!li.done && li.paid === 0 && li.startMonth > L.monthKey(todayStr())) meta = '<span class="tag loan">ローン</span>' + `${Number(li.startMonth.slice(5))}月開始・全${li.total}回` + (p.cardId ? '' : `・毎月${p.day}日`);
      }
      const sw = `<label class="sw" title="有効/停止"><input type="checkbox" data-act="toggle-pay" data-id="${p.id}" ${p.active !== false ? 'checked' : ''}><i></i></label>`;
      if (dv) {
        // 変動の口座直接は2行: 1行目=名前・金額・スイッチ / 2行目=補足・（変動・仮）・実績
        if (e) right = yenAbs(e.amount);
        const ed = `data-act="edit-pay" data-id="${p.id}"`;
        return `<div class="row pv ${p.active === false ? 'off' : ''}">
        <b class="n tap" ${ed}>${esc(p.name)}</b>
        <div class="a tap" ${ed}>${right}</div>${sw}
        <small class="s tap" ${ed}>${meta}</small>
        <small class="bdg tap" ${ed}><span class="var-t">変動</span>${e ? badge(e) : ''}</small>
        <button class="btn sm sec" data-act="actuals" data-kind="pay" data-id="${p.id}">実績</button></div>`;
      }
      return `<div class="row ${p.active === false ? 'off' : ''} ${p.loan && L.loanInfo(state, p, todayStr()).done ? 'ldone' : ''}">
        <div class="l tap" data-act="edit-pay" data-id="${p.id}"><b>${esc(p.name)}${nameTag}</b>${meta ? `<small>${meta}</small>` : ''}</div>
        <div class="r tap" data-act="edit-pay" data-id="${p.id}">${right}</div>${sw}</div>`;
    };
    const hasSample = [].concat(state.accounts, state.cards, state.payments, state.incomes).some((x) => x.sample);
    let h = `<div class="pagebar"><span class="sub">${hasSample ? 'サンプルデータを表示中（【例】がサンプルです）' : ''}</span><button class="q" data-act="toggle-payhelp" aria-label="使い方を表示" aria-expanded="${ui.payHelp}">？</button></div>`;
    if (ui.payHelp) h += `<div class="info helpcard"><span>タップで編集、右のスイッチで有効/停止。「変動」は毎月金額が変わる項目で、「実績」から確定額を記録できます。</span><button class="x" data-act="close-payhelp" aria-label="閉じる">✕</button></div>`;
    if (!state.payments.length) h += `<div class="card empty">支払いが未登録です。右下の ＋ から追加してください。</div>`;
    for (const c of state.cards) {
      const items = state.payments.filter((p) => p.cardId === c.id);
      if (!items.length) continue;
      const e = nx['card:' + c.id];
      const tot = items.filter((p) => p.active !== false).reduce((s, p) => s + L.payAmountIn(p, L.monthKey(todayStr())), 0);
      h += `<div class="card"><h2><span>${esc(c.name)}</span><span>今月の登録額 ${yenAbs(tot)}</span></h2><div class="hint" style="margin:-4px 0 8px">引き落とし日 毎月${c.withdrawDay}日（カード設定に従う）</div>
        ${e ? `<div class="cardnext">次回の請求 ${md(e.date)}：${e.confirmed ? '' : PV + ' '}${yenAbs(e.amount)} ${e.confirmed ? badge(e) : ''} ${c.variable !== false ? `<button class="btn sm sec" data-act="actuals" data-kind="card" data-id="${c.id}">実績</button>` : ''}</div>` : ''}
        ${items.map(payRow).join('')}</div>`;
    }
    const direct = state.payments.filter((p) => !p.cardId);
    if (direct.length) h += `<div class="card"><h2><span>口座から直接引き落とし</span></h2>${direct.map(payRow).join('')}</div>`;
    const orphans = state.payments.filter((p) => p.cardId && !byId(state.cards, p.cardId));
    if (orphans.length) h += `<div class="card"><h2><span>カード未設定</span></h2>${orphans.map(payRow).join('')}</div>`;
    return h + `<button class="fab" data-act="add-pay" aria-label="支払いを追加">＋</button>`;
  }

  /* ---------- カード・口座・収入 ---------- */
  function renderAcct() {
    const nx = nextEvents();
    let h = (state.accounts.length ? '' : needAcctGuide()) + `<div class="sec-h"><h3>🏦 口座</h3><button class="btn sm" data-act="add-account">＋ 追加</button></div><div class="card">`;
    h += state.accounts.length ? state.accounts.map((a) => `<div class="row"><div class="l tap" data-act="edit-account" data-id="${a.id}"><b>${esc(a.name)}${sampleTag(a)}</b><small>${md(a.asOf)}時点の残高</small></div><button class="btn sm sec" data-act="edit-balance" data-id="${a.id}">残高変更</button><div class="r ${a.balance < 0 ? 'neg-t' : ''}">${yen(a.balance)}</div></div>`).join('') : '<div class="empty">口座が未登録です</div>';
    h += `</div><div class="sec-h"><h3>💳 カード</h3><button class="btn sm" data-act="add-card">＋ 追加</button></div><div class="card">`;
    h += state.cards.length ? state.cards.map((c) => { const a = byId(state.accounts, c.accountId); return `<div class="row"><div class="l tap" data-act="edit-card" data-id="${c.id}"><b>${esc(c.name)}${c.variable !== false ? '<span class="tag var">変動</span>' : '<span class="tag">固定</span>'}${sampleTag(c)}</b><small>請求額がわかる日 毎月${c.fixDay || '-'}日 → 引き落とし日 毎月${c.withdrawDay}日</small><small>${a ? esc(a.name) : '<span class="neg-t">口座未設定</span>'}</small></div>${c.variable !== false ? `<button class="btn sm sec" data-act="actuals" data-kind="card" data-id="${c.id}">実績</button>` : ''}<div class="r tap" data-act="edit-card" data-id="${c.id}">›</div></div>`; }).join('') : '<div class="empty">カードが未登録です</div>';
    h += `</div><div class="sec-h"><h3>💰 収入（給与など）</h3><button class="btn sm" data-act="add-income">＋ 追加</button></div><div class="card">`;
    h += state.incomes.length ? state.incomes.map((i) => { const a = byId(state.accounts, i.accountId); const e = nx['inc:' + i.id];
      return `<div class="row ${i.active === false ? 'off' : ''}"><div class="l tap" data-act="edit-income" data-id="${i.id}"><b>${esc(i.name)}${i.variable ? '<span class="tag var">変動</span>' : ''}${sampleTag(i)}</b><small>毎月${i.day}日 → ${a ? esc(a.name) : '<span class="neg-t">口座未設定</span>'}${i.variable ? '・請求額がわかる日' + (i.fixDay ? i.fixDay + '日' : '＝入金日') : ''}${i.active === false ? '・停止中' : ''}</small></div>${i.variable ? `<button class="btn sm sec" data-act="actuals" data-kind="inc" data-id="${i.id}">実績</button>` : ''}<div class="r tap" data-act="edit-income" data-id="${i.id}">${i.variable && e ? sgn(1, e.amount, e.confirmed) : sgn(1, i.amount, true)}</div></div>`; }).join('') : '<div class="empty">収入が未登録です（登録すると残高予測に反映されます）</div>';
    return h + `</div><p class="note">カードで払うものは「支払い」で登録すると、カードごとに1つの請求額にまとめて引き落とし日に口座から引かれます。カードが「変動」の場合、請求額がわかる日に実績を入力します（それまでは直近3回の平均、実績がなければ登録額の合計で仮計算）。</p>`;
  }

  /* ---------- 集計（サブ画面） ---------- */
  function renderSummary() {
    if (!state.accounts.length) return needAcctGuide();
    const mk = sumMonth || L.monthKey(todayStr());
    const evs = L.monthEvents(state, mk);
    const outs = evs.filter((e) => e.delta < 0), ins = evs.filter((e) => e.delta > 0);
    const out = outs.reduce((s, e) => s + e.amount, 0), inc = ins.reduce((s, e) => s + e.amount, 0);
    const prov = evs.some((e) => !e.confirmed);
    const ap = prov ? PV + ' ' : '';
    let h = `<div class="card"><div class="mnav"><button data-act="snav" data-d="-1">‹</button><b>${ymLabel(mk)}</b><button data-act="snav" data-d="1">›</button>${mk !== L.monthKey(todayStr()) ? '<button class="chip2" data-act="snav" data-d="0">今月へ</button>' : ''}</div>
      <div class="grid3"><div><small>支出合計</small><b class="neg-t">${ap}${yenAbs(out)}</b></div><div><small>収入合計</small><b class="pos-t">${ap}${yenAbs(inc)}</b></div><div><small>差引</small><b class="${inc - out < 0 ? 'neg-t' : 'pos-t'}">${ap}${yen(inc - out)}</b></div></div>
      ${prov ? '<p class="hint" style="margin:8px 0 0">「仮」は仮の金額を含みます（実績未入力の変動項目）。</p>' : ''}</div>`;
    const dsS = L.dailySeries(state, 'all', mk);
    if (dsS.hasData) h += `<div class="card"><h2><span>日別の収入・支出</span></h2>${chartSvg(dsS, null, 'bars')}<div class="legend"><span><i class="bx r"></i>支出</span><span><i class="bx g"></i>収入</span><span><i class="bx hatch"></i>斜線=仮</span></div></div>`;
    const bar = (v, mx, cls) => `<div class="bar"><i class="${cls || ''}" style="width:${mx ? Math.max(2, Math.round((v / mx) * 100)) : 0}%"></i></div>`;
    const cardEv = outs.filter((e) => e.kind === 'card');
    h += `<div class="card"><h2><span>カード別（この月に引き落とされる請求）</span></h2>`;
    const mxC = Math.max(1, ...cardEv.map((e) => e.amount));
    h += cardEv.length ? cardEv.map((e) => `<div class="srow"><div class="stop"><div class="l"><b>${esc(e.label)}</b><small>引落 ${md(e.date)}・登録${e.items.length}件</small></div><div class="r">${e.confirmed ? '<span class="sg neg-t">' + yenAbs(e.amount) + '</span>' : '<span class="sg">' + PV + ' <span class="amt-p">' + yenAbs(e.amount) + '</span></span>'}</div></div>${bar(e.amount, mxC)}
      ${e.items.length ? `<details><summary>内訳（登録額）${e.items.length}件</summary><ul class="items">${e.items.map((i) => `<li>・${esc(i.name)} ${yenAbs(i.amount)}</li>`).join('')}</ul></details>` : ''}</div>`).join('') : '<div class="empty">この月のカード引き落としはありません</div>';
    h += `</div>`;
    // 支払い別
    const rows = [];
    for (const e of outs.filter((x) => x.kind === 'direct')) { const p = byId(state.payments, e.refId); rows.push({ name: e.label, sub: e.loan ? `ローン ${e.loan.index}/${e.loan.total}回目・口座から直接` : '口座から直接', dir: true, amount: e.amount, confirmed: e.confirmed, sample: p && p.sample }); }
    const cardIdsThisMonth = new Set(cardEv.map((e) => e.cardId));
    for (const p of state.payments.filter((x) => x.active !== false && x.cardId && cardIdsThisMonth.has(x.cardId) && L.payAmountIn(x, mk) > 0)) { const c = byId(state.cards, p.cardId); rows.push({ name: p.name, sub: (c ? c.name : '') + (p.loan ? `・ローン ${L.loanIndex(p, mk)}/${p.loan.count}回目` : ''), amount: L.payAmountIn(p, mk), confirmed: true, sample: p.sample, reg: true }); }
    rows.sort((a, b) => b.amount - a.amount);
    const mxP = Math.max(1, ...rows.map((r) => r.amount));
    h += `<div class="card"><h2><span>支払い別（金額の大きい順）</span></h2>${rows.length ? rows.map((r) => `<div class="srow"><div class="stop"><div class="l"><b>${esc(r.name)}${r.sample ? '<span class="tag sample">サンプル</span>' : ''}</b><small>${esc(r.sub)}${r.reg ? '（登録額）' : ''}</small></div><div class="r">${r.confirmed ? '<span class="sg neg-t">' + yenAbs(r.amount) + '</span>' : '<span class="sg">' + PV + ' <span class="amt-p">' + yenAbs(r.amount) + '</span></span>'}</div></div>${bar(r.amount, mxP, r.dir ? 'dir' : '')}</div>`).join('') : '<div class="empty">支払いがありません</div>'}
      <p class="hint" style="margin:6px 0 0">カードの請求額を実績で確定している場合、カード別の合計と、カード内の支払い（登録額）の合計は一致しないことがあります。</p></div>`;
    const loans = state.payments.filter((p) => p.loan && p.active !== false).map((p) => ({ p, i: L.loanInfo(state, p, todayStr()) })).filter((x) => !x.i.done);
    if (loans.length) h += `<div class="card"><h2><span>ローン（残り回数）</span><span>残り合計 ${yenAbs(loans.reduce((s, x) => s + x.i.remainingAmount, 0))}</span></h2>${loans.map((x) => `<div class="row"><div class="l"><b>${esc(x.p.name)}</b><small>毎月 ${yenAbs(x.p.amount)}・最終回 ${ymLabel(x.i.endMonth)}</small></div><div class="r"><b>残り${x.i.remaining}回</b><small>残額 ${yenAbs(x.i.remainingAmount)}</small></div></div>`).join('')}<p class="hint" style="margin:6px 0 0">利息は計算に含めず、毎月の返済額は一定として数えています。</p></div>`;
    h += `<div class="card"><h2><span>収入</span></h2>${ins.length ? ins.map((e) => `<div class="row"><div class="l"><b>${esc(e.label)}</b><small>入金 ${md(e.date)}</small></div><div class="r">${sgn(1, e.amount, e.confirmed)}</div></div>`).join('') : '<div class="empty">この月の収入はありません</div>'}</div>`;
    // 口座別（ホームから移動）
    const tg = getTarget();
    h += `<div class="card"><h2><span>口座別の残高見込み（${md(tg)}時点）</span></h2>${state.accounts.map((a) => { const r = L.project(state, tg, a.id), pv = r.confirmedThrough !== null && !r.beforeAsOf; return `<div class="row"><div class="l"><b>${esc(a.name)}</b><small>今日の残高 ${yen(a.balance)}（${md(a.asOf)}時点）</small></div><div class="r ${r.endBalance < 0 ? 'neg-t' : ''}">${pvYen(r.endBalance, pv)}</div></div>`; }).join('')}</div>`;
    return h;
  }

  /* ---------- データ・設定 ---------- */
  function renderData() {
    const hasSample = [].concat(state.accounts, state.cards, state.payments, state.incomes).some((x) => x.sample);
    const N = window.Notify;
    const perm = N ? N.permission() : 'unsupported';
    const permTxt = { granted: '許可済み', denied: '拒否されています（端末の設定から変更）', default: '未設定', unsupported: 'このブラウザは非対応' }[perm];
    const ios = N && N.isIOS(), sa = N && N.isStandalone();
    return `<div class="card"><h2>🔔 金額を入力する日の通知（朝8:00）</h2>
      <p class="hint">状態：<b>${permTxt}</b>${lastNotify && perm === 'granted' ? '（予約 ' + lastNotify.scheduled + '件・' + ({ trigger: '端末予約', timer: 'アプリ起動中のタイマー', none: '予定なし' }[lastNotify.mode]) + '）' : ''}</p>
      ${ios && !sa ? '<div class="info">iPhoneでは、Safariの共有ボタン →「ホーム画面に追加」で追加したアプリから開いて許可してください（iOS 16.4以降）。</div>' : ''}
      <button class="btn" data-act="notif-request" ${perm === 'unsupported' || perm === 'denied' ? 'disabled' : ''}>通知を許可する</button>
      <button class="btn sec" data-act="notif-test" ${perm !== 'granted' ? 'disabled' : ''}>テスト通知を送る</button>
      <div class="info" style="margin-top:8px"><b>正直な注意：</b>今のアプリはサーバーを持たないため、<b>iPhoneでアプリを閉じている間は朝8:00に通知が届きません。</b>アプリを開いたときに「入力待ち」がホームに出て、8時以降なら通知も1日1回出ます。確実に朝8:00に届けるには、小さなサーバー（Web Push）が必要で、<b>未実装</b>です（受け口のコードは用意済み）。</div></div>
      <div class="card"><h2>バックアップ</h2>
      <p class="hint">データはこの端末のブラウザ内にだけ保存されています。機種変更やブラウザのデータ削除に備えて、ときどき保存してください。古い形式（v1）のバックアップも読み込めます。</p>
      <button class="btn" data-act="export">⬇ JSONバックアップを保存</button>
      <button class="btn sec" data-act="import">⬆ バックアップから復元（現在のデータは置き換え）</button>
      <input type="file" id="file" accept="application/json,.json" hidden></div>
      <div class="card"><h2>サンプルデータ</h2>
      <button class="btn sec" data-act="sample">サンプルデータを追加</button>
      ${hasSample ? '<button class="btn danger" data-act="del-sample">サンプルデータだけ全て削除</button>' : ''}</div>
      <div class="card"><h2>全データ削除</h2><button class="btn danger" data-act="reset">すべて削除して初期状態に戻す</button></div>
      <p class="note" style="text-align:center">データ形式 v${L.SCHEMA_VERSION}・口座${state.accounts.length}・カード${state.cards.length}・支払い${state.payments.length}・収入${state.incomes.length}・実績${Object.keys(state.actuals).length}</p>`;
  }

  /* ---------- 描画 ---------- */
  const TITLES = { home: '口座残高の見込み', pay: '毎月の支払い', acct: 'カード・口座・収入', sum: '支出の集計', data: '設定・バックアップ' };
  function render() {
    $('#title').textContent = TITLES[tab];
    $('#main').innerHTML = { home: renderHome, pay: renderPay, acct: renderAcct, sum: renderSummary, data: renderData }[tab]();
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  }
  function go(t) { tab = t; render(); window.scrollTo(0, 0); }

  /* ---------- フォーム ---------- */
  const opt = (v, label, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(label)}</option>`;
  const field = (id, label, inner, hint) => `<div class="f"><div class="lbl"><label for="${id}">${label}</label>${hint ? '<button type="button" class="q" data-act="hint" aria-label="説明を表示">？</button>' : ''}</div>${inner}${hint ? `<small hidden>${hint}</small>` : ''}</div>`;
  const dayInput = (id, v, req) => `<input id="${id}" name="${id}" type="number" inputmode="numeric" min="1" max="31" step="1" ${req === false ? '' : 'required'} value="${v == null ? '' : esc(v)}">`;
  const DAYHINT = '31日など、その日がない月は月末日として計算します。';
  const acctOptions = (sel) => state.accounts.map((a) => opt(a.id, a.name, a.id === sel)).join('');
  const num = (fd, k) => Number(fd.get(k));
  const day = (fd, k) => Math.min(31, Math.max(1, Math.round(num(fd, k))));
  const optDay = (fd, k) => { const v = fd.get(k); return v === '' || v == null ? null : day(fd, k); };

  function openForm(o) {
    const dlg = $('#dlg');
    dlg.innerHTML = `<form class="sheet" id="f" novalidate><h2>${o.title}</h2>${o.body}
      <div class="btns"><button type="button" class="btn sec" data-x="cancel">キャンセル</button><button type="submit" class="btn">${o.saveLabel || '保存'}</button></div>
      ${o.onDelete ? `<button type="button" class="btn danger" data-x="del">${o.deleteLabel || '削除'}</button>` : ''}</form>`;
    const f = $('#f', dlg);
    f.addEventListener('click', (e) => {
      const x = e.target.dataset && e.target.dataset.x;
      if (x === 'cancel') dlg.close();
      if (x === 'del' && confirm((o.deleteLabel || '削除') + 'してよろしいですか？')) { o.onDelete(); dlg.close(); cleanActuals(); save(); render(); toast('完了しました'); }
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!f.checkValidity()) { f.reportValidity(); return; }
      const err = o.onSubmit(new FormData(f));
      if (err) { toast(err); return; }
      dlg.close(); save(); render(); toast(o.doneMsg || '保存しました');
    });
    if (o.setup) o.setup(f);
    dlg.showModal();
  }
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
      onDelete: a ? () => {
        const used = state.cards.some((c) => c.accountId === a.id) || state.payments.some((p) => p.accountId === a.id) || state.incomes.some((i) => i.accountId === a.id);
        if (used && !confirm('この口座に紐づくカード・支払い・収入があります。それでも削除しますか？（紐づけは「口座未設定」になり予測に含まれません）')) return;
        state.accounts = state.accounts.filter((x) => x.id !== a.id);
      } : null,
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
        field('fixDay', '請求額がわかる日（明細の確定日・毎月）', dayInput('fixDay', c ? c.fixDay : ''), '締め後に、明細で請求額がわかる日。この日の朝8:00に金額の入力をお知らせします。' + DAYHINT) +
        field('withdrawDay', '引き落とし日（毎月）', dayInput('withdrawDay', c ? c.withdrawDay : ''), DAYHINT) +
        field('accountId', '引き落とし口座', `<select id="accountId" name="accountId">${acctOptions(c ? c.accountId : state.accounts[0].id)}</select>`) +
        `<div class="f chk"><label><input type="checkbox" name="variable" ${!c || c.variable !== false ? 'checked' : ''}> 請求額は毎月変わる（請求額がわかる日に金額を入力する）</label><small>オフ＝カード内の支払い合計を常に確定額として扱います。</small></div>`,
      onSubmit(fd) {
        const v = { name: fd.get('name').trim(), fixDay: day(fd, 'fixDay'), withdrawDay: day(fd, 'withdrawDay'), accountId: fd.get('accountId'), variable: fd.get('variable') === 'on' };
        if (!v.name) return 'カード名を入力してください';
        if (c) Object.assign(c, v); else state.cards.push(Object.assign({ id: uid(), createdAt: todayStr() }, v));
      },
      onDelete: c ? () => {
        const n = state.payments.filter((p) => p.cardId === c.id).length;
        if (n && !confirm(`このカードの支払い${n}件も一緒に削除されます。よろしいですか？`)) return;
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
        `<div class="f"><label for="amount" id="amtLabel">金額（円／毎月）</label><input id="amount" name="amount" type="number" inputmode="numeric" min="0" step="1" required value="${p ? p.amount : ''}"></div>` +
        field('cardId', '支払い方法（カードを選択）', `<select id="cardId" name="cardId">${state.cards.map((c) => opt(c.id, 'カード：' + c.name, c.id === curCard)).join('')}${opt('', '口座から直接引き落とし', curCard === '')}</select>`, state.cards.length ? '' : 'カードが未登録です。先に「カード・口座」タブで追加すると選べます。') +
        `<div id="accWrap">${field('accountId', '引き落とし口座', `<select id="accountId" name="accountId">${acctOptions(p ? p.accountId : state.accounts[0].id)}</select>`)}</div>` +
        `<div id="dayWrap">${field('day', '引き落とし日（毎月）', dayInput('day', p && !p.cardId ? p.day : ''), DAYHINT)}</div>` +
        `<div id="cardDayNote" class="guide" hidden></div>` +
        `<div id="varWrap" class="f chk"><label><input type="checkbox" name="variable" id="variable" ${p && p.variable ? 'checked' : ''}> 変動（毎月金額が変わる：電気代など）</label></div>` +
        `<div id="fixWrap">${field('fixDay', '請求額がわかる日（明細の確定日・毎月・任意）', dayInput('fixDay', p ? p.fixDay : '', false), '請求額がわかる日。空欄なら引き落とし日当日。この日の朝8:00に入力をお知らせします。')}</div>` +
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
        [f.loanCount, f.amount, f.day].forEach((el) => el.addEventListener('input', loanSync));
        f.ptype.addEventListener('change', () => { sync(); loanSync(); });
        const sync = () => {
          const isCard = sel.value !== '', loan = isLoan();
          $('#loanWrap', f).hidden = !loan; ['loanCount', 'loanPaid', 'loanStart'].forEach((k) => { f[k].disabled = !loan; });
          f.loanCount.required = loan; f.loanStart.required = loan; f.loanPaid.required = loan;
          $('#accWrap', f).hidden = isCard; $('#varWrap', f).hidden = isCard || loan;
          $('#dayWrap', f).hidden = isCard; f.day.disabled = isCard; f.day.required = !isCard;
          const cd = byId(state.cards, sel.value); const note = $('#cardDayNote', f);
          note.hidden = !isCard; if (cd) note.innerHTML = '💳 <b>引き落とし日はカード設定に従います</b>（' + esc(cd.name) + '：毎月' + cd.withdrawDay + '日、' + esc((byId(state.accounts, cd.accountId) || {}).name || '口座未設定') + '）。変更は「カード・口座」タブのカード編集で行います。';
          $('#fixWrap', f).hidden = isCard || loan || !varC.checked;
          $('#amtLabel', f).textContent = loan ? '毎月の返済額（円）' : !isCard && varC.checked ? '仮の金額（初回の見込み額・円）' : isCard ? '金額（円／毎月・カードの請求額に含まれます）' : '金額（円／毎月）';
        };
        sel.addEventListener('change', () => { sync(); loanSync(); }); varC.addEventListener('change', sync); sync(); loanSync();
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
        const v = { loan, name: fd.get('name').trim(), amount: Math.max(0, Math.round(num(fd, 'amount'))), cardId, accountId: cardId ? (byId(state.cards, cardId) || {}).accountId : fd.get('accountId'), day: cardId ? (p && p.day ? p.day : 1) : day(fd, 'day'), variable, fixDay: variable ? optDay(fd, 'fixDay') : null, memo: fd.get('memo').trim(), active: fd.get('active') === 'on' };
        if (!v.name) return '名前を入力してください';
        if (p) Object.assign(p, v); else state.payments.push(Object.assign({ id: uid(), createdAt: todayStr() }, v));
      },
      onDelete: p ? () => { state.payments = state.payments.filter((x) => x.id !== p.id); } : null,
    });
  }
  function formIncome(id) {
    if (needAccount()) return;
    const i = id ? byId(state.incomes, id) : null;
    openForm({
      title: i ? '収入を編集' : '収入を追加',
      body: field('name', '名前', `<input id="name" name="name" required maxlength="40" value="${esc(i ? i.name : '')}" placeholder="例：給与">`) +
        `<div class="f"><label for="amount" id="amtLabel">金額（円／毎月）</label><input id="amount" name="amount" type="number" inputmode="numeric" min="0" step="1" required value="${i ? i.amount : ''}"></div>` +
        field('day', '入金日（毎月）', dayInput('day', i ? i.day : ''), DAYHINT) +
        field('accountId', '入金口座', `<select id="accountId" name="accountId">${acctOptions(i ? i.accountId : state.accounts[0].id)}</select>`) +
        `<div class="f chk"><label><input type="checkbox" name="variable" id="variable" ${i && i.variable ? 'checked' : ''}> 変動（毎月金額が変わる：給与の残業代など）</label></div>` +
        `<div id="fixWrap">${field('fixDay', '金額がわかる日（明細の確定日・毎月・任意）', dayInput('fixDay', i ? i.fixDay : '', false), '給与明細などで金額がわかる日。空欄なら入金日当日。')}</div>` +
        `<div class="f chk"><label><input type="checkbox" name="active" ${!i || i.active !== false ? 'checked' : ''}> 有効</label></div>`,
      setup(f) { const sync = () => { $('#fixWrap', f).hidden = !f.variable.checked; $('#amtLabel', f).textContent = f.variable.checked ? '仮の金額（初回の見込み額・円）' : '金額（円／毎月）'; }; f.variable.addEventListener('change', sync); sync(); },
      onSubmit(fd) {
        const variable = fd.get('variable') === 'on';
        const v = { name: fd.get('name').trim(), amount: Math.max(0, Math.round(num(fd, 'amount'))), day: day(fd, 'day'), accountId: fd.get('accountId'), variable, fixDay: variable ? optDay(fd, 'fixDay') : null, active: fd.get('active') === 'on' };
        if (!v.name) return '名前を入力してください';
        if (i) Object.assign(i, v); else state.incomes.push(Object.assign({ id: uid(), createdAt: todayStr() }, v));
      },
      onDelete: i ? () => { state.incomes = state.incomes.filter((x) => x.id !== i.id); } : null,
    });
  }

  /* ---------- 実績（確定額）の入力 ---------- */
  function setActual(kind, id, month, amount) {
    if (!isFinite(amount) || amount < 0) { toast('金額を入力してください'); return false; }
    L.setActual(state, kind, id, month, amount); save(); return true;
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
      body: `<p class="hint"><b>${esc(label)}</b>${e ? '<br>' + (e.kind === 'income' ? '入金日 ' : '引き落とし日 ') + md(e.date) + '・請求額がわかる日 ' + md(e.fixDate) : ''}<br>現在: ${e ? (e.confirmed ? '' : '仮 ') + yenAbs(e.amount) + '（' + srcText(e) + '）' : '-'}</p>` +
        field('amount', ymLabel(month) + '分の確定金額（円）', `<input id="amount" name="amount" type="number" inputmode="numeric" min="0" step="1" required value="${e && e.confirmed ? e.amount : ''}" placeholder="${cur}" autofocus>`, '入力すると仮の金額が実績に置き換わり、今後の平均（直近3回）にも使われます。'),
      onSubmit(fd) { const v = num(fd, 'amount'); if (!isFinite(v) || v < 0) return '金額を入力してください'; L.setActual(state, kind, id, month, v); },
      onDelete: e && e.source === 'actual' ? () => { L.removeActual(state, kind, id, month); } : null,
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
      <div class="f"><label>確定した金額（円）</label><input type="number" id="aa" inputmode="numeric" min="0" step="1" placeholder="例：6200"></div>
      <button class="btn" data-act="act-add">この月の実績を保存</button>
      <h3 style="margin:16px 0 8px;font-size:16px;color:var(--sub)">これまでの実績（新しい順）</h3>
      ${hist.length ? hist.map((x, i) => `<div class="row"><div class="l"><b>${ymLabel(x.month)}</b>${i < 3 ? '<small>平均の対象（直近3件）</small>' : ''}</div><div class="r">${yenAbs(x.amount)}</div><button class="btn sm danger" data-act="act-del" data-month="${x.month}">削除</button></div>`).join('') : '<div class="empty">まだ実績がありません</div>'}
      <button class="btn sec" data-act="close-dlg" style="margin-top:12px">閉じる</button></div>`;
  }

  /* ---------- サンプル・バックアップ ---------- */
  function addSample() {
    const t = todayStr(), base = L.monthKey(t);
    const addD = L.addDays, dom = (d) => L.parse(d).d;   // サンプルは4日前の残高から開始し、直近の「請求額がわかる日」を過ぎた状態にする
    const a = { id: uid(), name: '【例】メイン口座', balance: 300000, asOf: addD(t, -4), sample: true };
    const a2 = { id: uid(), name: '【例】サブ口座', balance: 50000, asOf: addD(t, -4), sample: true };
    const c1 = { id: uid(), name: '【例】Aカード（請求額が変動）', fixDay: 15, withdrawDay: 27, accountId: a.id, variable: true, sample: true };
    const c2 = { id: uid(), name: '【例】Bカード（固定）', fixDay: 31, withdrawDay: 10, accountId: a.id, variable: false, sample: true };
    state.accounts.push(a, a2); state.cards.push(c1, c2);
    const P = (name, amount, card, d, extra) => { const p = Object.assign({ id: uid(), name, amount, cardId: card ? card.id : null, accountId: a.id, day: d, memo: '', active: true, variable: false, fixDay: null, sample: true }, extra || {}); state.payments.push(p); return p; };
    P('【例】動画配信サービス', 1490, c1, 5); P('【例】音楽サブスク', 980, c1, 12);
    P('【例】クラウドストレージ', 400, c2, 15); P('【例】通販サイト年会費', 600, c2, 20);
    P('【例】家賃', 80000, null, 31, { memo: '月末（31日がない月は月末日）' });
    P('【例】携帯料金', 7000, null, 20);
    P('【例】自動車ローン', 28000, null, 28, { loan: { start: L.loanStartForPaid(28, 10, t), count: 36 } });
    P('【例】スマホ分割払い', 2500, c1, 5, { loan: { start: L.loanStartForPaid(27, 8, t), count: 24 } });
    const elec = P('【例】電気代', 6000, null, 25, { variable: true, fixDay: dom(addD(t, -2)), memo: '変動：直近3回の平均で仮計算' });
    const sal = { id: uid(), name: '【例】給与', amount: 250000, day: 25, accountId: a.id, active: true, variable: true, fixDay: dom(addD(t, -1)), sample: true };
    state.incomes.push(sal, { id: uid(), name: '【例】副収入', amount: 30000, day: 10, accountId: a2.id, active: true, variable: false, fixDay: null, sample: true });
    [[elec, 'pay', [7300, 6100, 5200]], [sal, 'inc', [261500, 252000]], [c1, 'card', [2850, 2610, 2400]]].forEach(([it, k, vals]) => vals.forEach((v, i) => L.setActual(state, k, it.id, L.addMonthKey(base, -(i + 1)), v)));
    // Aカードの直近の請求は確定済みにして「確定」と「仮」が両方見えるようにする
    const nextA = L.genEvents(state, L.addDays(t, -1), L.addDays(t, 45)).find((e) => e.refKind === 'card' && e.refId === c1.id);
    if (nextA && nextA.fixDate <= t) L.setActual(state, 'card', c1.id, nextA.month, 2590);
    save(); render(); toast('サンプルデータを追加しました');
  }
  function delSample() {
    if (!confirm('「サンプル」と表示されているデータをすべて削除します。よろしいですか？')) return;
    for (const k of ['accounts', 'cards', 'payments', 'incomes']) state[k] = state[k].filter((x) => !x.sample);
    cleanActuals(); save(); render(); toast('サンプルデータを削除しました');
  }
  function exportJson() {
    const blob = new Blob([JSON.stringify(Object.assign({ exportedAt: new Date().toISOString(), app: 'money-app' }, state), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'money-backup-' + todayStr().replace(/-/g, '') + '.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('バックアップを保存しました');
  }
  function importJson(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const o = JSON.parse(r.result);
        if (!o || typeof o !== 'object' || !['accounts', 'cards', 'payments', 'incomes'].every((k) => Array.isArray(o[k]))) throw new Error('形式が違います');
        const n = L.migrate(o);
        if (!confirm(`口座${n.accounts.length}・カード${n.cards.length}・支払い${n.payments.length}・収入${n.incomes.length}・実績${Object.keys(n.actuals).length} を読み込み、現在のデータを置き換えます。${(Number(o.version) || 1) < 2 ? '\n（旧形式v1のデータはv2へ自動変換されます）' : ''}\nよろしいですか？`)) return;
        state = n; save(); render(); toast('復元しました');
      } catch (e) { alert('読み込めませんでした：' + e.message); }
    };
    r.readAsText(file);
  }

  /* ---------- イベント ---------- */
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
        const w = prompt('すべてのデータを削除します。元に戻せません（先にバックアップ推奨）。\n続けるには「削除」と入力してください。');
        if (w === null) break;
        if (w.trim() !== '削除') { toast('「削除」と入力されなかったため、削除しませんでした'); break; }
        state = L.migrate(null); save(); render(); toast('すべて削除しました'); break;
      }
      case 'quick': {
        const m = Number(t.dataset.m);
        sel.target = m < 0 ? todayStr() : L.addMonthsEnd(todayStr(), m);
        sel.vm = L.monthKey(sel.target); render(); break;
      }
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
      case 'actuals': openActuals(t.dataset.kind, id); break;
      case 'close-dlg': $('#dlg').close(); break;
      case 'act-add': {
        const m = $('#am').value, v = Number($('#aa').value);
        if (!m) { toast('月を選んでください'); break; }
        if ($('#aa').value === '' || !setActual(actCtx.kind, actCtx.id, m, v)) break;
        drawActuals(); toast('実績を保存しました'); break;
      }
      case 'act-del': L.removeActual(state, actCtx.kind, actCtx.id, t.dataset.month); save(); drawActuals(); break;
      case 'confirm-actual': {
        const row = t.closest('.inb-row'), inp = $('input', row);
        if (inp.value === '') { toast('金額を入力してください'); inp.focus(); break; }
        if (setActual(row.dataset.kind, row.dataset.id, row.dataset.month, Number(inp.value))) { render(); toast('金額を確定しました'); }
        break;
      }
      case 'notif-request': Notify.request().then(async (p) => { await syncNotify(); render(); toast(p === 'granted' ? '通知を許可しました' : '通知は許可されませんでした'); }); break;
      case 'notif-test': Notify.show('テスト通知', '通知は正常に表示されます。', 'test-' + Date.now()).then(() => toast('テスト通知を送りました')).catch(() => toast('通知を表示できませんでした')); break;
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'target') { if (t.value) { sel.target = t.value; sel.vm = L.monthKey(t.value); render(); } }
    else if (t.id === 'pacc') { state.settings.projAccount = t.value; save(); render(); }
    else if (t.dataset && t.dataset.act === 'toggle-pay') { const p = byId(state.payments, t.dataset.id); if (p) { p.active = t.checked; save(); render(); } }
    else if (t.id === 'file' && t.files[0]) { importJson(t.files[0]); t.value = ''; }
  });
  $('#dlg').addEventListener('close', () => { actCtx = null; render(); });
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

  render();
  syncNotify();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').then(() => syncNotify()).catch(() => {});
  }
})();
