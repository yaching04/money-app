// 繰り返し（毎月/毎年/◯か月ごと/1回だけ）のE2E。使い方は e2e-delete.js と同じ。第2引数にスクショ出力先
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.argv[2] || '';
let fails = 0; const ck = (n, c) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); };
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
  const p = await b.newPage(); p.setDefaultNavigationTimeout(90000); const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', (e) => errs.push(e.message));
  await p.setBypassServiceWorker(true);
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const URL = 'http://127.0.0.1:8765/index.html';
  const go = () => p.goto(URL, { waitUntil: 'networkidle0' });
  const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('money-app-v1')));
  const body = () => p.evaluate(() => document.body.innerText);
  const vis = (sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.closest('[hidden]'); }, sel);
  await go(); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('money-app-hint-pay', '1'); }); await go();
  await p.click('[data-act=sample]'); await sleep(2700);
  await p.click('[data-tab=pay]'); await sleep(250);
  ck('サンプルの自動車税「毎年5月31日」', (await body()).includes('引き落とし日 毎年5月31日'));
  const today = await p.evaluate(() => Logic.today());
  const addPay = async (name, amount, cardText, fn) => {
    await p.click('[data-act=add-pay]'); await sleep(300);
    await p.type('#name', name); await p.type('#amount', String(amount));
    const cv = await p.evaluate((t) => { const o = [...document.getElementById('cardId').options].find((x) => x.text.includes(t)); return o ? o.value : ''; }, cardText);
    await p.select('#cardId', cv); await sleep(80);
    await fn(); await sleep(120);
    await p.click('#dlg button[type=submit]'); await sleep(400);
  };
  // 毎年（口座直接） — スクショ
  await p.click('[data-act=add-pay]'); await sleep(300);
  await p.type('#name', '固定資産税'); await p.type('#amount', '80000');
  await p.select('#cardId', ''); await p.select('#repeat', 'yearly'); await sleep(100);
  ck('毎年: 月の欄が出る・間隔/日付は隠れる', (await vis('#repMonth')) && !(await vis('#repN')) && !(await vis('#repDate')) && (await vis('#day')));
  await p.select('#repMonth', '4'); await p.select('#day', '30');
  if (OUT) { await p.evaluate(() => document.getElementById('repeat').scrollIntoView({ block: 'center' })); await sleep(200); await p.screenshot({ path: OUT + '/v55-1-form-yearly.png' }); }
  await p.click('#dlg button[type=submit]'); await sleep(400);
  // ◯か月ごと（口座直接）
  await addPay('水道代', 4800, '口座から直接', async () => { await p.select('#repeat', 'every'); await sleep(80); await p.select('#repN', '2'); await p.evaluate(() => { document.getElementById('repStart').value = '2026-12'; }); await p.select('#day', '20'); });
  // 6か月ごと（カード）
  await addPay('保険', 12000, 'Aカード', async () => { await p.select('#repeat', 'every'); await sleep(80);
    ck('カード: 日付欄は隠れる', !(await vis('#day'))); await p.select('#repN', '6'); await p.evaluate(() => { document.getElementById('repStart').value = '2027-04'; }); });
  // 1回だけ（口座直接）
  await addPay('家電', 50000, '口座から直接', async () => { await p.select('#repeat', 'once'); await sleep(80);
    ck('1回だけ: 日付欄が出て、毎月の日の欄は隠れる', (await vis('#repDate')) && !(await vis('#day')) && !(await vis('#repYm')));
    await p.evaluate(() => { document.getElementById('repDate').value = '2026-12-10'; }); });
  // 1回だけ（過去・済み）
  await addPay('旅行代', 30000, '口座から直接', async () => { await p.select('#repeat', 'once'); await sleep(80); await p.evaluate(() => { document.getElementById('repDate').value = '2026-01-15'; }); });
  // ローンでは繰り返しが隠れる
  await p.click('[data-act=add-pay]'); await sleep(300); await p.select('#ptype', 'loan'); await sleep(80);
  ck('ローン: 繰り返し欄は隠れる', !(await vis('#repeat'))); await p.click('#dlg [data-x=cancel]'); await sleep(300);
  const s = await st(); const by = (n) => s.payments.find((x) => x.name === n);
  ck('保存: 固定資産税 yearly/4/30', JSON.stringify(by('固定資産税').repeat) === '{"type":"yearly","month":4}' && by('固定資産税').day === 30);
  ck('保存: 水道代 every 2 2026-12', JSON.stringify(by('水道代').repeat) === '{"type":"every","n":2,"start":"2026-12"}');
  ck('保存: 保険 カード every 6', by('保険').cardId && by('保険').repeat.n === 6);
  ck('保存: 家電 once 2026-12-10 day=10', by('家電').repeat.date === '2026-12-10' && by('家電').day === 10);
  const tx = await body();
  ck('一覧「毎年4月30日」', tx.includes('毎年4月30日'));
  ck('一覧「2か月ごと・20日（次回 2026/12）」', tx.includes('2か月ごと・20日（次回 2026/12）'));
  ck('一覧カード「6か月ごと（次回 2027/4の請求）」', tx.includes('6か月ごと（次回 2027/4の請求）'));
  ck('一覧「2026/12/10、1回だけ」', tx.includes('2026/12/10、1回だけ'));
  ck('一覧 過去の1回だけ「（済み）」＋薄く', tx.includes('2026/1/15、1回だけ（済み）') && await p.evaluate(() => [...document.querySelectorAll('.row.ldone')].some((r) => r.innerText.includes('旅行代'))));
  ck('一覧 毎月はそのまま「毎月20日」', tx.includes('引き落とし日 毎月20日'));
  // 編集で値が戻る
  await p.click(`[data-act=edit-pay][data-id="${by('水道代').id}"]`); await sleep(300);
  ck('編集: 既存の繰り返しが選択されている', await p.evaluate(() => document.getElementById('repeat').value === 'every' && document.getElementById('repN').value === '2' && document.getElementById('repStart').value === '2026-12'));
  await p.click('#dlg [data-x=cancel]'); await sleep(300);
  if (OUT) { await p.evaluate(() => { const r = [...document.querySelectorAll('.card h2')].find((h) => h.innerText.includes('口座から直接')); if (r) r.scrollIntoView({ block: 'start' }); window.scrollBy(0, -60); }); await sleep(200); await p.screenshot({ path: OUT + '/v55-2-list.png' }); }
  // 収入: 6か月ごと
  await p.click('[data-tab=acct]'); await sleep(250); await p.click('[data-act=add-income]'); await sleep(300);
  await p.type('#name', '賞与'); await p.type('#amount', '400000'); await p.select('#repeat', 'every'); await sleep(80);
  await p.select('#repN', '6'); await p.evaluate(() => { document.getElementById('repStart').value = '2026-12'; }); await p.select('#day', '10');
  await p.click('#dlg button[type=submit]'); await sleep(400);
  ck('収入一覧「6か月ごと・10日（次回 2026/12）」', (await body()).includes('6か月ごと・10日（次回 2026/12）'));
  // 集計・ホームが動く
  await p.click('[data-tab=sum]'); await sleep(300); await p.click('[data-tab=home]'); await sleep(300);
  ck('ホーム表示OK', (await body()).includes('見込み'));
  ck('JSエラーなし', errs.length === 0); if (errs.length) console.log(errs);
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL OK'); process.exit(fails ? 1 : 0);
})();
