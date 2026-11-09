// v6.0.8 E2E: 支払い詳細を開いた直後は「種類」selectが閉じたまま（フォーカスなし）。タップで開き、値を選べる。
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ck = (n, c, info) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (c || info === undefined ? '' : ' [' + info + ']')); };
const NOW = Date.parse('2026-11-04T12:00:00+09:00');
const P = (o) => Object.assign({ cardId: null, accountId: 'a1', memo: '', active: true, variable: false, fixDay: null, repeat: null, loan: null, createdAt: '2026-08-01' }, o);
const base = (o) => Object.assign({ version: 2, accounts: [{ id: 'a1', name: '銀行', balance: 300000, asOf: '2026-11-04' }], cards: [{ id: 'c1', name: 'Aカード', fixDay: 15, withdrawDay: 27, accountId: 'a1', variable: true, createdAt: '2026-08-01' }], payments: [], incomes: [], actuals: {}, imports: {}, settings: { targetDate: null, projAccount: 'all', viewMonth: null } }, o);
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
  const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setBypassServiceWorker(true); await p.emulateTimezone('Asia/Tokyo');
  await p.evaluateOnNewDocument((now) => { const R = Date; const off = now - R.now();
    class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } } window.Date = D; }, NOW);
  const URL = process.env.APPURL || 'http://127.0.0.1:8765/index.html';
  const S = 'screenshots/';
  await p.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const state = base({
    payments: [
      P({ id: 'p1', name: '動画', amount: 1490, day: 27, cardId: 'c1' }),
      P({ id: 'p2', name: '家賃', amount: 80000, day: 99, accountId: 'a1' }),
      P({ id: 'p3', name: '車ローン', amount: 25000, day: 10, accountId: 'a1', loan: { start: '2025-01', count: 36 } }),
    ],
  });
  await p.goto(URL, { waitUntil: 'networkidle0' });
  await p.evaluate((s) => { localStorage.setItem('money-app-v1', JSON.stringify(s)); localStorage.setItem('money-app-hint-pay', '1'); }, state);
  await p.goto(URL, { waitUntil: 'networkidle0' }); await sleep(300);
  await p.click('[data-tab=pay]'); await sleep(300);
  await p.click('[data-act=edit-pay][data-id=p1]'); await sleep(400);

  const closed = await p.evaluate(() => {
    const dlg = document.getElementById('dlg');
    const ae = document.activeElement;
    const sel = document.getElementById('ptype');
    const opts = [...sel.options].map((o) => { const r = o.getBoundingClientRect(); return { t: o.text, h: r.height, vis: r.height > 0 && r.width > 0 }; });
    const r = sel.getBoundingClientRect();
    return {
      dlgOpen: dlg.open,
      activeTag: ae && ae.tagName,
      activeId: ae && ae.id,
      activeIsSelect: !!(ae && ae.tagName === 'SELECT'),
      value: sel.value,
      selectH: Math.round(r.height),
      size: sel.size,
      anyOptVis: opts.some((o) => o.vis),
      opts,
      title: dlg.querySelector('h2') && dlg.querySelector('h2').textContent,
    };
  });
  ck('詳細を開いた直後: ダイアログが開いている', closed.dlgOpen);
  ck('詳細を開いた直後: selectにフォーカスしていない（種類のホイールが出ない） ' + JSON.stringify({ tag: closed.activeTag, id: closed.activeId }), !closed.activeIsSelect);
  ck('詳細を開いた直後: 種類は閉じた高さ（1行分） ' + closed.selectH, closed.selectH > 30 && closed.selectH < 70);
  ck('詳細を開いた直後: optionはレイアウトされていない（一覧が開いていない）', !closed.anyOptVis && closed.size === 0);
  ck('既存値「通常の支払い」が表示用に選択されている', closed.value === 'normal');
  await p.screenshot({ path: S + 'v608-detail-closed.png' });

  // タップでフォーカス（ネイティブの選択肢が開く契機）。headlessではホイールUIは出ないが、フォーカスは付く
  await p.click('#ptype'); await sleep(200);
  const opened = await p.evaluate(() => {
    const ae = document.activeElement;
    const sel = document.getElementById('ptype');
    return { focused: ae === sel, value: sel.value, h: Math.round(sel.getBoundingClientRect().height) };
  });
  ck('種類をタップするとフォーカスが当たる ' + JSON.stringify(opened), opened.focused);
  await p.screenshot({ path: S + 'v608-detail-open.png' });

  // 値を選ぶ（ローン）→ UIが切り替わる
  await p.select('#ptype', 'loan'); await sleep(200);
  const after = await p.evaluate(() => ({
    value: document.getElementById('ptype').value,
    loanVis: !document.getElementById('loanWrap').hidden,
    repHidden: document.getElementById('repWrap').hidden,
  }));
  ck('種類でローンを選ぶと値が変わる・ローン欄が出る ' + JSON.stringify(after), after.value === 'loan' && after.loanVis && after.repHidden);

  // 既存のローン支払いを開いても閉じたまま・値が loan
  await p.click('#dlg [data-x=cancel]'); await sleep(300);
  await p.click('[data-act=edit-pay][data-id=p3]'); await sleep(400);
  const loanClosed = await p.evaluate(() => ({
    activeIsSelect: document.activeElement && document.activeElement.tagName === 'SELECT',
    value: document.getElementById('ptype').value,
    loanVis: !document.getElementById('loanWrap').hidden,
  }));
  ck('ローン編集を開いた直後も select にフォーカスしない', !loanClosed.activeIsSelect);
  ck('ローン編集: 既存値 loan が選択されローン欄が見える', loanClosed.value === 'loan' && loanClosed.loanVis);
  await p.click('#dlg [data-x=cancel]'); await sleep(200);

  // 追加フォームでも同様（種類が先頭）
  await p.click('[data-act=add-pay]'); await sleep(400);
  const addClosed = await p.evaluate(() => ({
    activeIsSelect: document.activeElement && document.activeElement.tagName === 'SELECT',
    value: document.getElementById('ptype').value,
    h: Math.round(document.getElementById('ptype').getBoundingClientRect().height),
  }));
  ck('追加フォームを開いた直後も select にフォーカスしない', !addClosed.activeIsSelect);
  ck('追加フォーム: 初期値 normal・閉じた高さ', addClosed.value === 'normal' && addClosed.h > 30 && addClosed.h < 70);
  await p.click('#dlg [data-x=cancel]'); await sleep(200);

  // カード編集の日付selectも、開いた直後はフォーカスしない（名前が先頭だが念のため）
  await p.click('[data-tab=acct]'); await sleep(300);
  await p.click('[data-act=edit-card][data-id=c1]'); await sleep(400);
  const card = await p.evaluate(() => ({
    activeIsSelect: document.activeElement && document.activeElement.tagName === 'SELECT',
    fix: document.getElementById('fixDay').value,
    wd: document.getElementById('withdrawDay').value,
  }));
  ck('カード編集を開いた直後も select にフォーカスしない', !card.activeIsSelect);
  ck('カード編集: 既存の確定日・引落日が選択されている', card.fix === '15' && card.wd === '27');

  ck('JSエラーなし', errs.length === 0); if (errs.length) console.log(errs);
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
