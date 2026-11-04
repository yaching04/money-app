// v5.7 のE2E：残高の下の1行（次の引き落とし／マイナス警告）、バックアップ保存・復元、実績入力の比較表示
// 使い方: (cd money-app && python3 -m http.server 8765 --bind 127.0.0.1 &) && node test/e2e-v57.js [スクショ出力先]
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.argv[2] || '';
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
  const shot = async (n) => { if (OUT) await p.screenshot({ path: OUT + '/v57-' + n + '.png' }); };
  const tab = async (t) => { await p.click('[data-tab=' + t + ']'); await sleep(250); };
  const txt = (sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
  const cnt = async (sel) => p.evaluate((s) => document.querySelectorAll(s).length, sel);
  const clickIn = async (sel) => { await p.waitForSelector(sel, { visible: true }); await p.click(sel); await sleep(250); };
  const confirmOpen = () => cnt('dialog.cdlg[open]');
  const okBtn = 'dialog.cdlg[open] [data-c="1"]', noBtn = 'dialog.cdlg[open] [data-c="0"]';
  const md = (s) => { const [y, m, d] = s.split('-').map(Number); return m + '/' + d + '(' + '日月火水木金土'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + ')'; };
  await go(); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('money-app-hint-pay', '1'); }); await go();
  await p.click('[data-act=sample]'); await sleep(2700);

  // 1) ふだん：大きな残高の下に「次の引き落とし」1行（警告は無し）
  const nx = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('money-app-v1')); const r = Logic.nextDebit(s, 'all', Logic.today()); return r && { date: r.date, label: r.top.label, others: r.others, conf: r.top.confirmed, after: Logic.project(s, r.date, 'all').endBalance }; });
  ck('サンプル: 次の引き落としがある', !!nx);
  ck('1行だけ（status は1つ・警告なし・旧ヒーロー警告なし）', (await cnt('.hero .status')) === 1 && (await cnt('.warnst')) === 0 && (await cnt('.warn.hero-in')) === 0);
  const nt = await txt('.hero .nextst');
  ck('次の引き落と: 日付・名前・残り ' + nt, nt.includes('次の引き落とし') && nt.includes(md(nx.date)) && nt.includes(nx.label) && nt.includes('→ 残り') && nt.includes(Math.abs(Math.round(nx.after)).toLocaleString('ja-JP')));
  ck('次の引き落とし: 仮は「仮」つき', nx.conf || nt.includes('仮'));
  ck('次の引き落とし: ほかN件', nx.others ? nt.includes('ほか' + nx.others + '件') : !nt.includes('ほか'));
  ck('大きな残高のすぐ下にある', await p.evaluate(() => { const s = document.querySelector('.hero .status'); return s.previousElementSibling.classList.contains('small') && s.parentElement.classList.contains('hero'); }));
  await shot('1b-home-next');
  await p.click('.hero .nextst'); await sleep(300);
  ck('タップでその日を選択', (await p.$eval('#target', (e) => e.value)) === nx.date);
  ck('タップで内訳の行が光る', (await cnt(`.hrow.flash[data-date="${nx.date}"]`)) === 1);
  await sleep(1800);
  ck('光りは消える', (await cnt('.hrow.flash')) === 0);

  // 2) マイナス見込み：同じ場所が薄い赤の警告に変わる
  await p.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('money-app-v1')); const t = Logic.today();
    const d = Logic.addDays(t, 20), day = Logic.parse(d).d;
    s.payments.push({ id: 'big1', name: '【例】引っ越し費用', amount: 700000, cardId: null, accountId: s.accounts[0].id, day, active: true, variable: false, fixDay: null, sample: true, repeat: { type: 'once', date: d } });
    localStorage.setItem('money-app-v1', JSON.stringify(s));
  });
  await go(); await sleep(300);
  const fn = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('money-app-v1')); const t = Logic.today(); return Logic.firstNegativeWithin(s, 'all', t, Logic.addDays(t, 60)); });
  ck('マイナスになる見込み（ロジック）', !!fn && fn.balance < 0);
  const wt = await txt('.hero .warnst');
  ck('警告: ⚠・日付・金額・見込み ' + wt, !!wt && wt.includes('⚠') && wt.includes(md(fn.date)) && wt.includes('−¥' + Math.abs(fn.balance).toLocaleString('ja-JP')) && wt.includes('になる見込み'));
  ck('警告: 1行だけ（次の引き落としと入れ替わる）', (await cnt('.hero .status')) === 1 && (await cnt('.nextst')) === 0);
  ck('警告: 薄い赤の背景', (await p.$eval('.warnst', (e) => getComputedStyle(e).backgroundColor)) === 'rgb(254, 242, 242)');
  ck('警告: 仮を含むなら「仮」', !fn.provisional || wt.includes('仮'));
  await shot('1-home');
  await p.click('.hero .warnst'); await sleep(300);
  ck('警告タップ: その日を選択', (await p.$eval('#target', (e) => e.value)) === fn.date);
  ck('警告タップ: マイナスの行が光る', (await cnt(`.hrow.flash[data-date="${fn.date}"]`)) === 1);
  await sleep(1700);

  // 3) バックアップ：設定のいちばん上・共有シート（navigator.share）で保存
  await tab('data');
  ck('バックアップは設定の一番上', await p.evaluate(() => document.querySelector('#main').firstElementChild.id === 'backup'));
  ck('未保存の表示', (await txt('#backup')).includes('まだバックアップしていません'));
  ck('未保存ならやさしいおすすめ', (await cnt('#backup .bk-remind')) === 1);
  await shot('2-backup');
  await p.evaluate(() => {
    window.__shared = null;
    navigator.canShare = (d) => !!(d && d.files && d.files.length);
    navigator.share = async (d) => { window.__shared = { name: d.files[0].name, type: d.files[0].type, text: await d.files[0].text() }; };
  });
  await p.click('[data-act=export]'); await sleep(400);
  const sh = await p.evaluate(() => window.__shared);
  const today = await p.evaluate(() => Logic.today());
  const s0 = await st();
  ck('共有: ファイル名 money-backup-YYYYMMDD.json', !!sh && sh.name === 'money-backup-' + today.replace(/-/g, '') + '.json');
  let bj = null; try { bj = JSON.parse(sh.text); } catch (_) {}
  ck('共有: 中身は全データのJSON', !!bj && bj.app === 'money-app' && bj.accounts.length === s0.accounts.length && bj.payments.length === s0.payments.length && Object.keys(bj.actuals).length === Object.keys(s0.actuals).length);
  ck('共有: 検証OK', await p.evaluate((t) => Logic.validateBackup(t).ok, sh.text));
  ck('最終バックアップ日を表示', (await txt('#backup')).includes('最終バックアップ ' + md(today)) && (await cnt('#backup .bk-remind')) === 0);
  await shot('2b-backup-done');
  // 共有に非対応ならダウンロード
  await p.evaluate(() => {
    delete navigator.share; navigator.share = undefined; window.__dl = null;
    HTMLAnchorElement.prototype.click = function () { const a = this; fetch(a.href).then((r) => r.text()).then((t) => { window.__dl = { name: a.download, text: t }; }); };
  });
  await p.click('[data-act=export]'); await sleep(500);
  const dl = await p.evaluate(() => window.__dl);
  ck('ダウンロード: 同じファイル名と中身', !!dl && dl.name === sh.name && JSON.parse(dl.text).accounts.length === s0.accounts.length);
  // 30日以上前ならおすすめ表示
  await p.evaluate(() => localStorage.setItem('money-app-last-backup', '2020-01-01T09:00:00')); await go(); await tab('data');
  ck('30日以上前: おすすめ表示', (await txt('#backup .bk-remind') || '').includes('30日以上'));

  // 4) 復元：ファイル → 確認（今のデータは上書き）→ 置き換わる
  const mod = JSON.parse(sh.text); mod.accounts[0].name = '復元テスト口座'; mod.payments = mod.payments.slice(0, 3);
  fs.writeFileSync('/tmp/e2e-v57-backup.json', JSON.stringify(mod));
  fs.writeFileSync('/tmp/e2e-v57-bad.json', '{"hello":"world"}');
  let inp = await p.$('#file');
  await inp.uploadFile('/tmp/e2e-v57-bad.json'); await sleep(400);
  ck('不正ファイル: アプリ内ダイアログで通知', (await confirmOpen()) === 1 && (await txt('dialog.cdlg[open]')).includes('読み込めませんでした'));
  await clickIn(okBtn);
  ck('不正ファイル: データはそのまま', (await st()).payments.length === s0.payments.length);
  inp = await p.$('#file');
  await inp.uploadFile('/tmp/e2e-v57-backup.json'); await sleep(400);
  ck('復元: 確認に「今のデータは上書きされます」', (await confirmOpen()) === 1 && (await txt('dialog.cdlg[open]')).includes('今のデータは上書きされます'));
  await clickIn(noBtn);
  ck('復元: キャンセルなら変わらない', (await st()).payments.length === s0.payments.length);
  inp = await p.$('#file');
  await inp.uploadFile('/tmp/e2e-v57-backup.json'); await sleep(400);
  await clickIn(okBtn); await sleep(300);
  let s1 = await st();
  ck('復元: データが置き換わる', s1.accounts[0].name === '復元テスト口座' && s1.payments.length === 3 && s1.app === undefined);
  ck('復元: 画面にも反映', (await txt('#main')).includes('口座' + s1.accounts.length + '・カード' + s1.cards.length + '・支払い3'));

  // 5) 比較表示：元のバックアップに戻して、カード請求額の入力
  fs.writeFileSync('/tmp/e2e-v57-backup.json', sh.text);
  inp = await p.$('#file'); await inp.uploadFile('/tmp/e2e-v57-backup.json'); await sleep(400); await clickIn(okBtn); await sleep(300);
  await tab('home');
  const tgt = await p.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('money-app-v1')); const c = s.cards.find((x) => x.variable !== false);
    const t = Logic.today(); const e = Logic.genEvents(s, Logic.addDays(t, -1), Logic.addDays(t, 75)).find((x) => x.refKind === 'card' && x.refId === c.id && !x.confirmed);
    const pa = Logic.previousActual(s, 'card', c.id, e.month); return { id: c.id, month: e.month, prev: pa };
  });
  ck('比較: 前回の実績がある', !!tgt.prev);
  await p.evaluate((g) => { const el = document.createElement('button'); el.dataset.act = 'enter'; el.dataset.kind = 'card'; el.dataset.id = g.id; el.dataset.month = g.month; el.id = 'tmpenter'; document.body.appendChild(el); }, tgt);
  await p.click('#tmpenter'); await sleep(300);
  const pv = '¥' + tgt.prev.amount.toLocaleString('ja-JP');
  ck('比較: 入力前は前回の金額だけ ' + await txt('#cmp'), (await txt('#cmp')).startsWith(tgt.prev.label === '先月' ? '先月 ' + pv : '前回'));
  await p.type('#amount', String(tgt.prev.amount + 100)); await sleep(150);
  ck('比較: 差額 +¥100（強調なし） ' + await txt('#cmp'), (await txt('#cmp')).includes('（+¥100）') && (await cnt('#cmp .cmp-big')) === 0);
  await p.$eval('#amount', (e) => { e.value = ''; });
  await p.type('#amount', String(Math.round(tgt.prev.amount * 1.5))); await sleep(150);
  const ct = await txt('#cmp');
  ck('比較: 30%以上は控えめに強調 ' + ct, ct.includes('（+¥') && (await cnt('#cmp .cmp-big')) === 1 && ct.includes('大きく変わっています'));
  await shot('3-compare');
  await p.click('#dlg [data-x=cancel]'); await sleep(250);
  // 入力待ちの行でも比較
  if (await cnt('[data-act=toggle-inbox]')) {
    await p.click('[data-act=toggle-inbox]'); await sleep(250);
    const rows = await cnt('.inb-row .cmp');
    ck('入力待ち: 比較の行がある', rows > 0);
    const sel = '.inb-row:has(.cmp) input';
    await p.type(sel, '1'); await sleep(150);
    ck('入力待ち: 入力で差額が出る ' + await txt('.inb-row .cmp'), /（[−+±]¥/.test(await txt('.inb-row .cmp')));
  }
  // 実績がない項目は表示しない
  const none = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('money-app-v1')); const c = s.cards.find((x) => x.variable === false); return c && c.id; });
  if (none) { await p.evaluate((id) => { const el = document.querySelector('#tmpenter') || document.createElement('button'); el.dataset.act = 'enter'; el.dataset.kind = 'card'; el.dataset.id = id; el.dataset.month = Logic.monthKey(Logic.today()); el.id = 'tmpenter'; document.body.appendChild(el); }, none);
    await p.click('#tmpenter'); await sleep(300);
    ck('比較: 前回の実績なしなら何も出さない', await p.$eval('#cmp', (e) => e.hidden && e.textContent === ''));
    await p.click('#dlg [data-x=cancel]'); await sleep(200); }

  ck('ネイティブ confirm/prompt/alert は0回', natives.length === 0);
  ck('コンソールエラーなし ' + JSON.stringify(errs), errs.length === 0);
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL OK'); process.exit(fails ? 1 : 0);
})();
