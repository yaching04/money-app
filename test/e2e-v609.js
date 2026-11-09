// v6.0.9 E2E: すべてのダイアログを開いた直後、activeElement が select / month / date でないこと。
// 実績の記録はステッパー＋金額 #aa フォーカス。CSV手順1は見出しフォーカス。
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ck = (n, c, info) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (c || info === undefined ? '' : ' [' + info + ']')); };
const NOW = Date.parse('2026-11-04T12:00:00+09:00');
const P = (o) => Object.assign({ cardId: null, accountId: 'a1', memo: '', active: true, variable: false, fixDay: null, repeat: null, loan: null, createdAt: '2026-08-01' }, o);
const base = (o) => Object.assign({ version: 2, accounts: [{ id: 'a1', name: '銀行', balance: 300000, asOf: '2026-11-04' }], cards: [{ id: 'c1', name: 'Aカード', fixDay: 15, withdrawDay: 27, accountId: 'a1', variable: true, createdAt: '2026-08-01' }], payments: [], incomes: [], actuals: {}, imports: {}, settings: { targetDate: null, projAccount: 'all', viewMonth: null } }, o);
const focusInfo = () => ({
  tag: document.activeElement && document.activeElement.tagName,
  id: document.activeElement && document.activeElement.id,
  type: document.activeElement && document.activeElement.type,
  isSelect: !!(document.activeElement && document.activeElement.tagName === 'SELECT'),
  isMonthDate: !!(document.activeElement && (document.activeElement.type === 'month' || document.activeElement.type === 'date')),
  h2: !!(document.activeElement && document.activeElement.tagName === 'H2'),
  labelled: document.getElementById('dlg') && document.getElementById('dlg').getAttribute('aria-labelledby'),
});
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
  const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setBypassServiceWorker(true); await p.emulateTimezone('Asia/Tokyo');
  await p.evaluateOnNewDocument((now) => { const R = Date; const off = now - R.now();
    class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } } window.Date = D; }, NOW);
  const URL = process.env.APPURL || 'http://127.0.0.1:8765/index.html';
  const S = 'screenshots/';
  const state = base({
    payments: [
      P({ id: 'p1', name: '動画', amount: 1490, day: 27, cardId: 'c1', variable: true }),
      P({ id: 'p2', name: '家賃', amount: 80000, day: 99, accountId: 'a1' }),
    ],
    incomes: [{ id: 'i1', name: '給与', amount: 250000, day: 25, accountId: 'a1', active: true, variable: false, createdAt: '2026-08-01' }],
  });
  const load = async (w) => {
    await p.setViewport({ width: w, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await p.goto(URL, { waitUntil: 'networkidle0' });
    await p.evaluate((s) => { localStorage.setItem('money-app-v1', JSON.stringify(s)); localStorage.setItem('money-app-hint-pay', '1'); }, state);
    await p.goto(URL, { waitUntil: 'networkidle0' }); await sleep(250);
  };
  const close = async () => { await p.keyboard.press('Escape'); await sleep(200); if (await p.evaluate(() => document.getElementById('dlg').open)) await p.evaluate(() => document.getElementById('dlg').close()); await sleep(100); };
  const assertSafe = async (name) => {
    const f = await p.evaluate(focusInfo);
    ck(name + ': selectでもmonth/dateでもない ' + JSON.stringify(f), !f.isSelect && !f.isMonthDate);
    return f;
  };

  for (const w of [320, 375, 390]) {
    await load(w);

    // 支払い編集（種類 select が先頭）
    await p.click('[data-tab=pay]'); await sleep(200);
    await p.click('[data-act=edit-pay][data-id=p1]'); await sleep(350);
    await assertSafe(w + ' 支払い編集');
    ck(w + ' 支払い編集: 見出しフォーカスか', (await p.evaluate(focusInfo)).h2 || (await p.evaluate(focusInfo)).tag === 'H2');
    await close();

    // 支払い追加
    await p.click('[data-act=add-pay]'); await sleep(350);
    await assertSafe(w + ' 支払い追加');
    await close();

    // 実績の記録
    await p.click('[data-act=actuals][data-kind=card][data-id=c1]'); await sleep(400);
    const act = await p.evaluate(() => {
      const f = { tag: document.activeElement && document.activeElement.tagName, id: document.activeElement && document.activeElement.id, type: document.activeElement && document.activeElement.type };
      const am = document.getElementById('am');
      const lbl = document.getElementById('amLbl');
      const stepper = !!document.querySelector('.amnav');
      const monthInput = !!document.querySelector('#dlg input[type=month]');
      return { f, am: am && am.value, amType: am && am.type, lbl: lbl && lbl.textContent, stepper, monthInput,
        btnW: (() => { const b = document.querySelector('[data-act=am-prev]'); const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })() };
    });
    ck(w + ' 実績: 金額 #aa にフォーカス ' + JSON.stringify(act.f), act.f.id === 'aa' && act.f.type === 'number');
    ck(w + ' 実績: 月は hidden + ステッパー（month input なし）', act.amType === 'hidden' && act.stepper && !act.monthInput);
    ck(w + ' 実績: ラベル表示 ' + act.lbl, /月分$/.test(act.lbl || ''));
    ck(w + ' 実績: ‹ が44px以上 ' + JSON.stringify(act.btnW), act.btnW.w >= 44 && act.btnW.h >= 44);
    if (w === 375) await p.screenshot({ path: S + 'v609-actuals-open.png' });
    // ステッパー操作
    const before = act.am;
    await p.click('#dlg [data-act=am-prev]'); await sleep(150);
    const afterPrev = await p.evaluate(() => ({ am: document.getElementById('am').value, lbl: document.getElementById('amLbl').textContent, aa: document.activeElement && document.activeElement.id }));
    ck(w + ' 実績: ‹ で前月 ' + JSON.stringify(afterPrev), afterPrev.am < before && /月分$/.test(afterPrev.lbl));
    await p.click('#dlg [data-act=am-next]'); await sleep(100);
    await p.click('#dlg [data-act=am-next]'); await sleep(100);
    const atMax = await p.evaluate(() => ({ am: document.getElementById('am').value, dis: document.querySelector('[data-act=am-next]').disabled }));
    ck(w + ' 実績: › は翌月まで ' + JSON.stringify(atMax), atMax.am === '2026-12' && atMax.dis === true);
    await close();

    // CSV 手順1
    await p.click('[data-act=csv-open]'); await sleep(350);
    const csv = await assertSafe(w + ' CSV手順1');
    ck(w + ' CSV手順1: 見出しフォーカス（#csvCard でない） ' + JSON.stringify(csv), csv.h2 && csv.id !== 'csvCard');
    if (w === 375) await p.screenshot({ path: S + 'v609-csv-step1.png' });
    await close();

    // カード編集
    await p.click('[data-tab=acct]'); await sleep(200);
    await p.click('[data-act=edit-card][data-id=c1]'); await sleep(350);
    await assertSafe(w + ' カード編集');
    await close();

    // 口座編集（date あり）
    await p.click('[data-act=edit-account][data-id=a1]'); await sleep(350);
    await assertSafe(w + ' 口座編集');
    await close();

    // 残高変更 → 金額フォーカス
    await p.click('[data-act=edit-balance][data-id=a1]'); await sleep(400);
    const bal = await p.evaluate(focusInfo);
    ck(w + ' 残高変更: #balance フォーカス ' + JSON.stringify(bal), bal.id === 'balance' && !bal.isSelect && !bal.isMonthDate);
    await close();

    // 収入編集
    await p.click('[data-act=edit-income][data-id=i1]'); await sleep(350);
    await assertSafe(w + ' 収入編集');
    await close();

    // 入力待ちからの実績（openEnter）— 変動カードの請求を入力待ちに出すため実績なしのままホームへ
    await p.click('[data-tab=home]'); await sleep(300);
    const entered = await p.evaluate(() => {
      const b = document.querySelector('[data-act=enter]');
      if (b) { b.click(); return true; }
      return false;
    });
    if (entered) {
      await sleep(400);
      const en = await p.evaluate(focusInfo);
      ck(w + ' 入力待ち実績: 金額フォーカス ' + JSON.stringify(en), en.id === 'amount' && !en.isSelect && !en.isMonthDate);
      await close();
    } else {
      ck(w + ' 入力待ち実績: 行が無くスキップ', true);
    }

    // 確認ダイアログ（askConfirm）
    await p.click('[data-tab=data]'); await sleep(200);
    await p.click('[data-act=reset]'); await sleep(300);
    const cfm = await p.evaluate(() => {
      const d = document.querySelector('dialog.cdlg');
      const ae = document.activeElement;
      return { open: !!(d && d.open), tag: ae && ae.tagName, isSelect: ae && ae.tagName === 'SELECT', labelled: d && d.getAttribute('aria-labelledby') };
    });
    ck(w + ' 確認ダイアログ: select でない ' + JSON.stringify(cfm), cfm.open && !cfm.isSelect);
    await p.keyboard.press('Escape'); await sleep(200);
  }

  ck('showModal は showAppDialog 経由のみ', await p.evaluate(async () => {
    const src = await (await fetch('app.js')).text();
    const naked = [...src.matchAll(/\.showModal\s*\(/g)].filter((m) => {
      const before = src.slice(Math.max(0, m.index - 80), m.index);
      return !/showAppDialog/.test(before) && !/if\s*\(\s*!dlg\.open\s*\)/.test(before);
    });
    return naked.length === 0;
  }));
  ck('キャッシュ名 v609', require('fs').readFileSync(__dirname + '/../sw.js', 'utf8').includes("CACHE = 'money-app-v609'"));
  ck('JSエラーなし', errs.length === 0); if (errs.length) console.log(errs);
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
