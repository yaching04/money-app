// 日付セレクト（1〜31日＋月末）のE2E。使い方は e2e-delete.js と同じ。第2引数にスクショ出力先
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
  await go(); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('money-app-hint-pay', '1'); }); await go();
  await p.click('[data-act=sample]'); await sleep(2700);
  let s = await st();
  const bc = s.cards.find((c) => c.name.includes('Bカード'));
  ck('サンプルBカードの確定日=月末(99)', bc && bc.fixDay === 99);
  await p.click('[data-tab=acct]'); await sleep(250);
  const txt = await p.evaluate(() => document.body.innerText);
  ck('一覧に「毎月月末」と表示', txt.includes('請求額がわかる日 毎月月末'));
  // Aカードを編集
  const ac = s.cards.find((c) => c.name.includes('Aカード'));
  await p.click(`[data-act=edit-card][data-id="${ac.id}"]`); await sleep(300);
  const info = await p.evaluate(() => ['fixDay', 'withdrawDay'].map((id) => { const e = document.getElementById(id); return { tag: e.tagName, n: e.options.length, last: e.options[e.options.length - 1].text, lastV: e.options[e.options.length - 1].value, v: e.value }; }));
  ck('確定日・引落日が select', info.every((i) => i.tag === 'SELECT'));
  ck('選択肢 = 案内 + 1〜31日 + 月末', info.every((i) => i.n === 33 && i.last === '月末' && i.lastV === '99'));
  ck('既存値が選択されている', info[0].v === '15' && info[1].v === '27');
  await p.select('#withdrawDay', '99'); await sleep(100);
  if (OUT) { await p.evaluate(() => document.getElementById('withdrawDay').scrollIntoView({ block: 'center' })); await sleep(200); await p.screenshot({ path: OUT + '/v54-1-card-form.png' }); }
  await p.click('#dlg button[type=submit]'); await sleep(400);
  s = await st();
  ck('保存で withdrawDay=99', s.cards.find((c) => c.id === ac.id).withdrawDay === 99);
  const txt2 = await p.evaluate(() => document.body.innerText);
  ck('保存後「引き落とし日 毎月月末」表示', txt2.includes('引き落とし日 毎月月末'));
  // 支払い・収入フォームも select
  await p.click('[data-tab=pay]'); await sleep(250);
  const rent = s.payments.find((x) => x.name.includes('家賃'));
  ck('家賃 day=99', rent.day === 99);
  await p.click(`[data-act=edit-pay][data-id="${rent.id}"]`); await sleep(300);
  ck('支払いフォームの day/fixDay が select・月末選択', await p.evaluate(() => document.getElementById('day').tagName === 'SELECT' && document.getElementById('day').value === '99' && document.getElementById('fixDay').tagName === 'SELECT'));
  await p.click('#dlg [data-x=cancel]'); await sleep(300);
  ck('JSエラーなし', errs.length === 0); if (errs.length) console.log(errs);
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL OK'); process.exit(fails ? 1 : 0);
})();
