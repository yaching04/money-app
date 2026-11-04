/* v5.8 カードの利用明細CSVの読み込み（DOM非依存。ブラウザと Node の両方で動く）
 * - 文字コード: UTF-8（BOM有無）→ ダメなら Shift_JIS
 * - 列の自動判定: 見出し行（前置きの行・会員情報の行のあと）を探す。見出しが無い形式（例: 三井住友Vpass）は中身から推定
 * - 取り込んだ明細は state.imports[cardId][請求月] = { at, rows: [[日付, 店名, 金額], ...] } にコンパクトに保存
 * - 同じ明細を何度読み込んでも増えない（同じ行は「件数の多い方」に合わせる）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logic.js'));
  else root.CsvImport = factory(root.Logic);
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';

  /* ---------- 文字コード ---------- */
  /** ArrayBuffer / Uint8Array → { text, encoding: 'utf-8' | 'shift_jis' } */
  function decodeBytes(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let text, encoding = 'utf-8';
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(u8); }
    catch (e) { text = new TextDecoder('shift_jis').decode(u8); encoding = 'shift_jis'; }
    return { text: text.replace(/^\uFEFF/, ''), encoding };
  }

  /* ---------- CSV ---------- */
  /** RFC4180 準拠（"…" の中のカンマ・改行・"" を扱う）。CRLF/LF/CR。カンマが無くタブがある形式はタブ区切り */
  function parseCsv(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    const head = text.slice(0, 2000);
    const delim = !head.includes(',') && head.includes('\t') ? '\t' : ',';
    const rows = []; let row = [], f = '', q = false, i = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
        f += c; i++; continue;
      }
      if (c === '"' && f.trim() === '') { q = true; f = ''; i++; continue; }
      if (c === delim) { row.push(f); f = ''; i++; continue; }
      if (c === '\r' || c === '\n') { row.push(f); rows.push(row); row = []; f = ''; i += c === '\r' && text[i + 1] === '\n' ? 2 : 1; continue; }
      f += c; i++;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x !== ''));
  }

  /* ---------- 値の読み取り ---------- */
  const nfkc = (s) => String(s == null ? '' : s).normalize('NFKC');
  /** 日付 → 'YYYY-MM-DD' / null。YYYY/MM/DD・YYYY-MM-DD・YYYY.MM.DD・YY/MM/DD・YYYY年M月D日・YYYYMMDD（全角数字も可） */
  function parseDate(s) {
    s = nfkc(s).trim().replace(/\s+/g, '');
    let m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/) || s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
    let y;
    if (m) y = Number(m[1]);
    else { m = s.match(/^(\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/); if (!m) return null; y = 2000 + Number(m[1]); }
    const mo = Number(m[2]), d = Number(m[3]);
    if (y < 2000 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > L.daysInMonth(y, mo)) return null;
    return L.fmt(y, mo, d);
  }
  /** 金額 → 整数 / null。¥・円・カンマ・全角数字・△▲−（マイナス）・(1,000)（マイナス）に対応 */
  function parseAmount(s) {
    let t = nfkc(s).trim().replace(/[\s,¥\\円]/g, '').replace(/[−‐‑–—ー]/g, '-');
    if (t === '') return null;
    let neg = false;
    if (/^[△▲]/.test(t)) { neg = true; t = t.slice(1); }
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    if (/^-/.test(t)) { neg = !neg; t = t.slice(1); }
    if (/-$/.test(t)) { neg = !neg; t = t.slice(0, -1); }
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    const v = Math.round(Number(t));
    return neg ? -v : v;
  }

  /* ---------- 列の判定 ---------- */
  // 見出しの言い換え（NFKC・空白除去後に照合）。配列の前ほど優先
  const HEAD = {
    date: [/^(ご)?利用(年月)?日/, /^利用日\/キャンセル日/, /^ご?利用年月日/, /^(お)?取引日/, /^売上日/, /^日付$/, /^年月日$/, /^利用日付/],
    merchant: [/利用店名/, /ご?利用先/, /ご?利用店/, /ご?利用場所/, /加盟店/, /店名/, /ご?利用内容/, /^内容/, /^摘要/, /商品名/, /^明細/, /^(ご)?利用(の)?詳細/],
    // 請求額にするのは「今回の支払金額」が最優先（分割・リボは今月分だけ）。無ければ利用金額
    amount: [/^(\d+月)?(お)?支払(い)?金額/, /今回(ご)?請求(額|金額)/, /^請求金額/, /^ご?請求額/, /^(ご)?利用金額/, /^金額/, /^利用額/],
  };
  const AMOUNT_NG = /支払総額|手数料|繰越|残高|回数|区分|開始|ポイント|現地|レート|元金/;
  const DATE_NG = /処理日|支払日|お支払日|開始月|締/;
  const headKey = (s) => nfkc(s).replace(/\s+/g, '').replace(/[(（][^)）]*[)）]$/, '');
  function matchHead(kind, cell) {
    const k = headKey(cell); if (!k) return -1;
    if (kind === 'amount' && AMOUNT_NG.test(k)) return -1;
    if (kind === 'date' && DATE_NG.test(k)) return -1;
    const i = HEAD[kind].findIndex((re) => re.test(k));
    return i;
  }
  function bestCol(kind, row, exclude) {
    let best = -1, bp = 99;
    row.forEach((c, i) => { if (exclude.includes(i)) return; const p = matchHead(kind, c); if (p >= 0 && p < bp) { bp = p; best = i; } });
    return best;
  }
  /** 主な金額列のほかに、空欄のときに使う予備の金額列（例: 支払金額が空 → 利用金額） */
  function altAmountCol(row, main, exclude) {
    let best = -1, bp = 99;
    row.forEach((c, i) => { if (i === main || exclude.includes(i)) return; const p = matchHead('amount', c); if (p >= 0 && p < bp) { bp = p; best = i; } });
    return best;
  }
  const isSummary = (s) => /^(合計|小計|総合計|総計|ご?請求(額|金額)?(合計)?|お?支払(い)?(金額)?合計|今回(ご)?請求)/.test(nfkc(s).replace(/\s+/g, ''));

  /**
   * 列の自動判定。戻り値 { header: 見出し行の位置 or -1, date, merchant, amount, alt, ok, method: 'header'|'data'|null, headers }
   * ok=false なら列の割り当て画面を出す
   */
  function detectColumns(rows) {
    const res = { header: -1, date: -1, merchant: -1, amount: -1, alt: -1, ok: false, method: null, headers: null };
    // 1) 見出し行（最初の40行から）
    for (let r = 0; r < Math.min(rows.length, 40); r++) {
      const row = rows[r];
      const d = bestCol('date', row, []); if (d < 0) continue;
      const a = bestCol('amount', row, [d]); if (a < 0) continue;
      const m = bestCol('merchant', row, [d, a]);
      // 見出しの次の行に日付が入っているか（説明文の誤検出よけ）
      const nextHasDate = rows.slice(r + 1, r + 6).some((x) => parseDate(x[d]));
      if (!nextHasDate) continue;
      Object.assign(res, { header: r, date: d, amount: a, merchant: m, alt: altAmountCol(row, a, [d, m]), method: 'header', headers: row.slice() });
      if (m < 0) res.merchant = guessMerchant(rows.slice(r + 1), [d, a]);
      res.ok = res.merchant >= 0;
      return res;
    }
    // 2) 見出しなし: 中身から（日付が入っている行だけを見る）
    const data = rows.filter((x) => x.some((c) => parseDate(c)));
    if (data.length < 1) return res;
    const width = Math.max(...data.map((x) => x.length));
    const rate = (f) => Array.from({ length: width }, (_, i) => data.filter((x) => f(x[i])).length / data.length);
    const dr = rate((c) => !!parseDate(c));
    const d = dr.indexOf(Math.max(...dr));
    if (dr[d] < 0.6) return res;
    const ar = rate((c) => parseAmount(c) !== null && !parseDate(c));
    const mean = Array.from({ length: width }, (_, i) => { const v = data.map((x) => parseAmount(x[i])).filter((v) => v !== null); return v.length ? v.reduce((s, x) => s + Math.abs(x), 0) / v.length : 0; });
    // 金額らしい列: 数字の割合が高く、平均が回数（1・2…）より大きい列。2つ以上あれば後ろ（＝今回の支払金額のことが多い）
    const cands = []; for (let i = 0; i < width; i++) if (i !== d && ar[i] >= 0.8 && mean[i] >= 30) cands.push(i);
    if (!cands.length) return res;
    const a = cands[cands.length - 1], alt = cands.length > 1 ? cands[0] : -1;
    const m = guessMerchant(data, [d, a].concat(cands));
    Object.assign(res, { date: d, amount: a, alt, merchant: m, method: 'data', ok: m >= 0, headers: null });
    return res;
  }
  /** 店名らしい列: 数字・日付でない文字が多く、平均の長さが長い列 */
  function guessMerchant(data, exclude) {
    const rowsD = data.filter((x) => x.some((c) => parseDate(c)));
    if (!rowsD.length) return -1;
    const width = Math.max(...rowsD.map((x) => x.length));
    let best = -1, bs = 0;
    for (let i = 0; i < width; i++) {
      if (exclude.includes(i)) continue;
      const vals = rowsD.map((x) => x[i] || '');
      const textish = vals.filter((v) => v && parseAmount(v) === null && !parseDate(v));
      const share = textish.length / vals.length;
      const uniq = new Set(textish).size / Math.max(1, textish.length);
      const len = textish.reduce((s, v) => s + v.length, 0) / Math.max(1, textish.length);
      const score = share * Math.min(len, 20) * (0.5 + uniq);
      if (share >= 0.5 && score > bs) { bs = score; best = i; }
    }
    return best;
  }

  /** 割り当てに沿って明細行を取り出す。日付・金額が読めない行（前置き・会員情報・合計の行など）は除く */
  function extractRows(rows, map) {
    const out = [];
    const start = map.header >= 0 ? map.header + 1 : 0;
    for (let r = start; r < rows.length; r++) {
      const x = rows[r];
      const date = parseDate(x[map.date]); if (!date) continue;
      let amount = parseAmount(x[map.amount]);
      if (amount === null && map.alt >= 0) amount = parseAmount(x[map.alt]);
      if (amount === null) continue;
      const merchant = String(map.merchant >= 0 ? x[map.merchant] || '' : '').replace(/\s+/g, ' ').trim();
      if (isSummary(merchant)) continue;
      out.push({ date, merchant: merchant || '（店名なし）', amount });
    }
    return out;
  }

  /** テキスト → { rows(明細), map(列), table(全セル), encoding? } をまとめて */
  function analyze(text, mapOverride) {
    const table = parseCsv(text);
    const map = mapOverride ? Object.assign({ header: -1, alt: -1 }, mapOverride, { ok: true, method: 'manual' }) : detectColumns(table);
    const rows = map.date >= 0 && map.amount >= 0 ? extractRows(table, map) : [];
    return { table, map, rows, total: rows.reduce((s, r) => s + r.amount, 0), ok: map.ok && rows.length > 0 };
  }

  /* ---------- 請求月 ---------- */
  /** カードの引き落とし日のリスト（fromEx〜toIn）と、その確定日 */
  const cardBills = (card, fromEx, toIn) => L.monthlyDates(Number(card.withdrawDay), fromEx, toIn).map((w) => ({ month: L.monthKey(w), withdraw: w, fix: L.confirmDate(card.fixDay, w) }));
  /**
   * どの月の請求か（引き落とし日の属する月 'YYYY-MM'）。
   * 明細の最後の利用日より後に「金額の確定日」が来る、最初の引き落とし。明細が無ければ今日から見て
   * 「確定済みでまだ引き落とされていない請求」→ 無ければ次の請求。
   */
  function guessBillMonth(card, rows, todayStr) {
    const dates = (rows || []).map((r) => r.date).filter(Boolean).sort();
    if (dates.length) {
      const last = dates[dates.length - 1];
      const b = cardBills(card, L.addDays(last, -1), L.addDays(last, 100)).find((x) => x.fix >= last);
      if (b) return b.month;
    }
    const bs = cardBills(card, L.addDays(todayStr, -1), L.addDays(todayStr, 70));
    const fixed = bs.find((x) => x.fix <= todayStr);
    return (fixed || bs[0] || { month: L.monthKey(todayStr) }).month;
  }
  /** 請求月の選択肢（推定月の前後） */
  function billMonthOptions(guess, before, after) {
    const out = []; for (let i = -(before == null ? 4 : before); i <= (after == null ? 2 : after); i++) out.push(L.addMonthKey(guess, i)); return out;
  }

  /* ---------- 保存（同じ明細は増やさない） ---------- */
  /** 店名の比較用キー: 全角→半角・大文字・空白と記号を除く・末尾の番号を除く */
  function merchantKey(s) {
    return nfkc(s).toUpperCase().replace(/[\s・.,\-_*\/／()（）「」【】\[\]#＃:：'"!！?？&＆+＋]/g, '').replace(/\d{4,}$/, '').replace(/(株式会社|\(株\)|カブシキガイシヤ|カ\)|ｶ\))/g, '');
  }
  const rowKey = (r) => r.date + '|' + merchantKey(r.merchant) + '|' + r.amount;
  /**
   * cardId・請求月の明細に rows を合わせる。同じ行（日付・店名・金額）が既にあれば足さない。
   * 同じ日に同じ店で同じ金額を2回使った場合も、ファイル内の件数を上限に合わせる（多い方を残す）。
   * 戻り値 { added, dup, count, total }
   */
  function mergeImport(state, cardId, month, rows, nowIso) {
    state.imports = state.imports || {};
    const byCard = state.imports[cardId] = state.imports[cardId] || {};
    const cur = byCard[month] = byCard[month] || { at: null, rows: [] };
    const have = {}; for (const r of cur.rows) { const k = rowKey({ date: r[0], merchant: r[1], amount: r[2] }); have[k] = (have[k] || 0) + 1; }
    const seen = {}; let added = 0, dup = 0;
    for (const r of rows) {
      const k = rowKey(r); seen[k] = (seen[k] || 0) + 1;
      if (seen[k] > (have[k] || 0)) { cur.rows.push([r.date, r.merchant, r.amount]); added++; } else dup++;
    }
    cur.rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    cur.at = nowIso || new Date().toISOString();
    return { added, dup, count: cur.rows.length, total: cur.rows.reduce((s, r) => s + Number(r[2]), 0) };
  }
  /** 保存済みの明細（[{date, merchant, amount}]） */
  function importedRows(state, cardId, month) {
    const m = state.imports && state.imports[cardId] && state.imports[cardId][month];
    return m ? m.rows.map((r) => ({ date: r[0], merchant: r[1], amount: Number(r[2]) })) : [];
  }
  /** 取り込みを足した後の、その月の件数と合計（プレビュー用。state は変えない） */
  function previewMerge(state, cardId, month, rows) {
    const copy = { imports: {} }; copy.imports[cardId] = {}; copy.imports[cardId][month] = { at: null, rows: importedRows(state, cardId, month).map((r) => [r.date, r.merchant, r.amount]) };
    return mergeImport(copy, cardId, month, rows, 'x');
  }
  /** 店ごとの合計（集計タブ用。金額の大きい順） */
  function merchantTotals(state, cardId, month) {
    const by = {};
    for (const r of importedRows(state, cardId, month)) { const k = merchantKey(r.merchant) || r.merchant; (by[k] = by[k] || { name: r.merchant, amount: 0, count: 0 }); by[k].amount += r.amount; by[k].count++; }
    return Object.values(by).sort((a, b) => b.amount - a.amount);
  }
  /** カードを消したときなど、存在しないカードの明細を消す */
  function cleanImports(state) {
    if (!state.imports) return;
    const ids = new Set((state.cards || []).map((c) => c.id));
    for (const k of Object.keys(state.imports)) if (!ids.has(k)) delete state.imports[k];
  }

  /* ---------- 毎月の支払いの候補 ---------- */
  // よくある定額サービス（NFKC・大文字・記号なしのキーに対して照合）。strong=毎月の定額であることが多い
  const KNOWN = [
    [/NETFLIX|ネツトフリツクス|ネットフリックス/, 'Netflix', true],
    [/AMAZONPRIME|AMAZONプライム|アマゾンプライム|プライム会費|PRIMEVIDEO/, 'Amazonプライム', true],
    [/SPOTIFY|スポテイフアイ|スポティファイ/, 'Spotify', true],
    [/YOUTUBEPREMIUM|YOUTUBEPREM|YOUTUBEMUSIC|GOOGLEYOUTUBE|YOUTUBE/, 'YouTube Premium', true],
    [/DISNEY|デイズニープラス|ディズニープラス/, 'Disney+', true],
    [/UNEXT|ユーネクスト/, 'U-NEXT', true],
    [/HULU|フールー/, 'Hulu', true],
    [/DAZN|ダゾーン/, 'DAZN', true],
    [/ABEMA/, 'ABEMA', true],
    [/APPLECOMBILL|APPLECOM|ITUNES|APPLEMUSIC|ICLOUD|アツプル|アップル/, 'Apple', false],
    [/GOOGLEONE|GOOGLEPLAY|GOOGLESTORAGE|GOOGLE|グ-グル|グーグル/, 'Google', false],
    [/MICROSOFT|OFFICE365|MICROSOFT365|マイクロソフト/, 'Microsoft 365', false],
    [/ADOBE|アドビ/, 'Adobe', true],
    [/DROPBOX/, 'Dropbox', true],
    [/OPENAI|CHATGPT/, 'ChatGPT', true],
    [/NHK/, 'NHK受信料', true],
    [/DOCOMO|ドコモ|NTTドコモ/, 'docomo', true],
    [/KDDI|^AU(通信|携帯|電話|料金|ご利用)?$|AU携帯|AU電話/, 'au', true],
    [/SOFTBANK|ソフトバンク|ソフトハンク/, 'SoftBank', true],
    [/YMOBILE|ワイモバイル/, 'Y!mobile', true],
    [/楽天モバイル|RAKUTENMOBILE/, '楽天モバイル', true],
    [/UQMOBILE|UQモバイル|^UQ/, 'UQ mobile', true],
    [/AHAMO|アハモ/, 'ahamo', true],
    [/POVO/, 'povo', true],
    [/LINEMO/, 'LINEMO', true],
    [/電力|でんき|電気|ENEOSでんき|エネオスでんき|LOOOP/, '電気代', false],
    [/ガス/, 'ガス代', false],
    [/水道/, '水道代', false],
    [/NURO|フレツツ|フレッツ|光回線|ビツグロ-ブ|BIGLOBE|SONETNET|SONET|プロバイダ/, 'インターネット', true],
  ];
  // 毎月ありそうだが金額は変動する（公共料金）
  const VARIES = new Set(['電気代', 'ガス代', '水道代']);
  /** よくある定額サービスか → { name, strong } / null */
  function knownSub(name) {
    const k = merchantKey(name);
    for (const [re, label, strong] of KNOWN) if (re.test(k)) return { name: label, strong, key: label, varies: VARIES.has(label) };
    return null;
  }
  /** 名前がだいたい同じか（どちらかがもう一方を含む・3文字以上、または同じ定額サービス） */
  function similarName(a, b) {
    const ka = merchantKey(a), kb = merchantKey(b);
    if (!ka || !kb) return false;
    if (ka === kb) return true;
    const s = ka.length <= kb.length ? ka : kb, l = ka.length <= kb.length ? kb : ka;
    if (s.length >= 3 && l.includes(s)) return true;
    const sa = knownSub(a), sb = knownSub(b);
    return !!(sa && sb && sa.key === sb.key);
  }
  const near = (a, b, tol) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * (tol == null ? 0.2 : tol));
  /**
   * 「毎月の支払いとして登録」の候補。
   * - 同じカードの前に読み込んだ月にも同じ店・近い金額で1回ずつ出ている（history）
   * - よくある定額サービスの名前に当てはまる（known）
   * そのカードに登録済みの支払い（名前が似ている・明細から登録したもの）は出さない。返金（マイナス）は対象外。
   * 戻り値 [{ key, name, merchant, amount, reason: 'history'|'known'|'both', strong, months }]
   */
  function suggestRecurring(state, cardId, month, rows) {
    const regs = (state.payments || []).filter((p) => p.cardId === cardId);
    const prevMonths = Object.keys((state.imports && state.imports[cardId]) || {}).filter((m) => m !== month).sort();
    const groups = {};
    for (const r of rows) { const k = merchantKey(r.merchant); if (!k) continue; (groups[k] = groups[k] || { key: k, merchant: r.merchant, rows: [] }).rows.push(r); }
    const out = [];
    for (const g of Object.values(groups)) {
      if (g.rows.some((r) => r.amount <= 0)) continue;
      if (g.rows.length > 1) continue;                    // 同じ月に何回も出る店（コンビニなど）は定額ではない
      const amount = g.rows[0].amount;
      const ks = knownSub(g.merchant);
      // 前の月にも1回だけ・近い金額で出ているか
      const months = prevMonths.filter((m) => { const pr = importedRows(state, cardId, m).filter((r) => merchantKey(r.merchant) === g.key); return pr.length === 1 && near(pr[0].amount, amount); });
      const hist = months.length > 0;
      if (!hist && !ks) continue;
      if (regs.some((p) => (p.importKey && p.importKey === g.key) || similarName(p.name, g.merchant) || (ks && similarName(p.name, ks.name)))) continue;
      const strong = hist || !!(ks && ks.strong);
      out.push({ key: g.key, name: ks ? ks.name : g.merchant, merchant: g.merchant, amount, reason: hist && ks ? 'both' : hist ? 'history' : 'known', strong, months, varies: !!(ks && ks.varies) });
    }
    return out.sort((a, b) => (b.strong - a.strong) || b.amount - a.amount);
  }

  /** 候補から支払いを作る（毎月・カード払い） */
  function paymentFromSuggestion(s, card, uid, todayStr) {
    return { id: uid, name: s.name, amount: Math.max(0, Math.round(s.amount)), cardId: card.id, accountId: card.accountId, day: 1, repeat: null, loan: null,
      variable: false, fixDay: null, memo: '明細CSVから登録（' + s.merchant + '）', active: true, importKey: s.key, createdAt: todayStr };
  }

  return { decodeBytes, parseCsv, parseDate, parseAmount, detectColumns, extractRows, analyze, isSummary, matchHead,
    guessBillMonth, billMonthOptions, merchantKey, rowKey, mergeImport, importedRows, previewMerge, merchantTotals, cleanImports,
    knownSub, similarName, suggestRecurring, paymentFromSuggestion, KNOWN };
});
