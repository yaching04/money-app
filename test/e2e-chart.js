// 残高グラフの線の色（減る=赤/増える=緑/変化なし=グレー、仮=破線）とドラッグのE2E。第2引数にスクショ出力先
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
  await go(); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('money-app-hint-pay', '1'); }); await go();
  await p.click('[data-act=sample]'); await sleep(2700);
  const segs = await p.evaluate(() => [...document.querySelectorAll('svg.chart[data-drag] line.seg')].map((l) => ({ dir: l.dataset.dir, col: l.getAttribute('stroke'), dash: l.hasAttribute('stroke-dasharray'), y1: +l.getAttribute('y1'), y2: +l.getAttribute('y2') })));
  ck('線の区間がある', segs.length > 0);
  ck('減る区間=赤・下向き', segs.some((s) => s.dir === 'down') && segs.filter((s) => s.dir === 'down').every((s) => s.col === '#dc2626' && s.y2 > s.y1));
  ck('増える区間=緑・上向き', segs.filter((s) => s.dir === 'up').every((s) => s.col === '#15803d' && s.y2 < s.y1));
  ck('変化なし=グレー・水平', segs.filter((s) => s.dir === 'flat').every((s) => s.col === '#64748b' && Math.abs(s.y2 - s.y1) < 1e-6));
  ck('仮の区間は破線のまま', segs.some((s) => s.dash));
  const leg = await p.evaluate(() => document.querySelector('.legend').innerText);
  ck('凡例 減る/増える/仮', leg.includes('減る') && leg.includes('増える') && leg.includes('仮'));
  // ドラッグ
  const before = await p.evaluate(() => document.querySelector('#selmk line').getAttribute('x1'));
  const box = await (await p.$('svg.chart[data-drag]')).boundingBox();
  const y = box.y + box.height * 0.5;
  await p.mouse.move(box.x + box.width * 0.3, y); await p.mouse.down();
  await p.mouse.move(box.x + box.width * 0.6, y, { steps: 8 }); await p.mouse.move(box.x + box.width * 0.8, y, { steps: 8 }); await p.mouse.up(); await sleep(400);
  const after = await p.evaluate(() => document.querySelector('#selmk line') && document.querySelector('#selmk line').getAttribute('x1'));
  ck('指定日マーカーをドラッグで移動', after && after !== before);
  await p.click('[data-act=today]').catch(() => {}); await sleep(300);
  await go(); await sleep(400);
  if (OUT) await p.screenshot({ path: OUT, fullPage: false });
  ck('コンソールエラーなし', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); console.log(fails ? `${fails} FAIL` : 'ALL OK'); process.exit(fails ? 1 : 0);
})();
