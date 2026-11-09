// v6.0.10 E2E: 実績の記録のデザイン磨き（枠なしステッパー・引き落とし日行・？説明・プレースホルダー）
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ck = (n, c, info) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (c || info === undefined ? '' : ' [' + info + ']')); };
const NOW = Date.parse('2026-11-04T12:00:00+09:00');
const P = (o) => Object.assign({ cardId: null, accountId: 'a1', memo: '', active: true, variable: false, fixDay: null, repeat: null, loan: null, createdAt: '2026-08-01' }, o);
const base = (o) => Object.assign({ version: 2, accounts: [{ id: 'a1', name: '銀行', balance: 300000, asOf: '2026-11-04' }], cards: [{ id: 'c1', name: 'Aカード', fixDay: 15, withdrawDay: 27, accountId: 'a1', variable: true, createdAt: '2026-08-01' }], payments: [P({ id: 'p1', name: '動画', amount: 1490, day: 27, cardId: 'c1' })], incomes: [], actuals: {}, imports: {}, settings: { targetDate: null, projAccount: 'all', viewMonth: null } }, o);
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
  const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setBypassServiceWorker(true); await p.emulateTimezone('Asia/Tokyo');
  await p.evaluateOnNewDocument((now) => { const R = Date; const off = now - R.now();
    class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } } window.Date = D; }, NOW);
  const URL = process.env.APPURL || 'http://127.0.0.1:8765/index.html';
  const S = 'screenshots/';
  await p.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const state = base({});
  await p.goto(URL, { waitUntil: 'networkidle0' });
  await p.evaluate((s) => { localStorage.setItem('money-app-v1', JSON.stringify(s)); localStorage.setItem('money-app-hint-pay', '1'); }, state);
  await p.goto(URL, { waitUntil: 'networkidle0' }); await sleep(300);
  await p.click('[data-tab=pay]'); await sleep(250);
  await p.click('[data-act=actuals][data-kind=card][data-id=c1]'); await sleep(400);

  const info = await p.evaluate(() => {
    const dlg = document.getElementById('dlg');
    const top = dlg.querySelector('.act-top');
    const helpBtn = dlg.querySelector('[data-act=act-avg-help]');
    const help = dlg.querySelector('.act-avg-help');
    const prev = dlg.querySelector('[data-act=am-prev]');
    const next = dlg.querySelector('[data-act=am-next]');
    const cs = getComputedStyle(prev);
    const lab = dlg.querySelector('#amLab');
    const oldLab = /月（引き落とし/.test(dlg.textContent) && !!lab;
    return {
      open: dlg.open,
      focus: document.activeElement && document.activeElement.id,
      top: top && top.innerText.replace(/\s+/g, ' ').trim(),
      helpHidden: help && help.hidden,
      helpTxt: help && help.textContent,
      lbl: document.getElementById('amLbl') && document.getElementById('amLbl').textContent,
      sub: document.getElementById('amSub') && document.getElementById('amSub').textContent,
      am: document.getElementById('am') && document.getElementById('am').value,
      ph: document.getElementById('aa') && document.getElementById('aa').placeholder,
      border: cs.borderTopWidth + '/' + cs.borderTopStyle + '/' + cs.backgroundColor,
      btn: { w: Math.round(prev.getBoundingClientRect().width), h: Math.round(prev.getBoundingClientRect().height) },
      nextDis: next.disabled,
      noOldLab: !lab && !/月（引き落とし/.test((dlg.querySelector('h2') && dlg.querySelector('h2').nextElementSibling && dlg.querySelector('.amnav-wrap') && '') || '') && !document.getElementById('amLab'),
      sheetH: Math.round(dlg.querySelector('.sheet').getBoundingClientRect().height),
    };
  });
  ck('ダイアログが開いている', info.open);
  ck('フォーカスは #aa', info.focus === 'aa');
  ck('仮の金額は1行 [' + info.top + ']', /次回の仮の金額：\s*仮 ¥1,490/.test(info.top) && !/直近/.test(info.top) && !/初期見込み/.test(info.top));
  ck('平均の説明は？の裏に隠れている', info.helpHidden === true && /直近/.test(info.helpTxt || ''));
  ck('月ラベル 11月分', info.lbl === '11月分');
  ck('引き落とし日行 [' + info.sub + ']', info.sub === '11/27 引き落とし');
  ck('見出し「月（引き落とし…）」なし', info.noOldLab === true);
  ck('プレースホルダーが仮の金額 [' + info.ph + ']', info.ph === '1490');
  ck('ステッパーに枠なし [' + info.border + ']', info.border.startsWith('0px/none') || /^(0px\/none\/rgba\(0,\s*0,\s*0,\s*0\)|0px\/none\/transparent)/.test(info.border) || (info.border.includes('0px') && info.border.includes('none')));
  ck('タップ領域 44px ' + JSON.stringify(info.btn), info.btn.w >= 44 && info.btn.h >= 44);
  ck('シートがコンパクト（≤560px） [' + info.sheetH + ']', info.sheetH > 0 && info.sheetH <= 560);
  await p.screenshot({ path: S + 'v6010-actuals-open.png' });

  await p.click('#dlg [data-act=act-avg-help]'); await sleep(150);
  const opened = await p.evaluate(() => { const h = document.querySelector('#dlg .act-avg-help'); const b = document.querySelector('#dlg [data-act=act-avg-help]'); return { hidden: h.hidden, exp: b.getAttribute('aria-expanded') }; });
  ck('？で説明が開く', opened.hidden === false && opened.exp === 'true');
  await p.click('#dlg [data-act=act-avg-help]'); await sleep(100);
  ck('？でもう一度で閉じる', await p.evaluate(() => document.querySelector('#dlg .act-avg-help').hidden) === true);

  await p.click('#dlg [data-act=am-prev]'); await sleep(150);
  const oct = await p.evaluate(() => ({ am: document.getElementById('am').value, lbl: document.getElementById('amLbl').textContent, sub: document.getElementById('amSub').textContent }));
  ck('‹ で10月・引き落とし日も更新 [' + JSON.stringify(oct) + ']', oct.am === '2026-10' && oct.lbl === '10月分' && oct.sub === '10/27 引き落とし');

  // 翌月まで進めて › 無効＆薄いグレー
  await p.click('#dlg [data-act=am-next]'); await sleep(80);
  await p.click('#dlg [data-act=am-next]'); await sleep(80);
  const maxed = await p.evaluate(() => {
    const n = document.querySelector('#dlg [data-act=am-next]');
    const cs = getComputedStyle(n);
    return { am: document.getElementById('am').value, dis: n.disabled, color: cs.color, sub: document.getElementById('amSub').textContent };
  });
  ck('› は翌月で無効 [' + JSON.stringify(maxed) + ']', maxed.am === '2026-12' && maxed.dis === true);
  ck('無効の › は薄いグレー', /148|149|150|160|163|176|148,\s*163,\s*184|rgb\(148/.test(maxed.color) || maxed.color === 'rgb(148, 163, 184)');
  ck('12月の引き落とし日 [' + maxed.sub + ']', maxed.sub === '12/27 引き落とし' || /12\/\d+ 引き落とし/.test(maxed.sub));

  // 下限付近：12か月戻して ‹ 無効
  await p.evaluate(() => {
    for (let i = 0; i < 20; i++) {
      const b = document.querySelector('#dlg [data-act=am-prev]');
      if (!b || b.disabled) break;
      b.click();
    }
  });
  await sleep(200);
  const mined = await p.evaluate(() => {
    const b = document.querySelector('#dlg [data-act=am-prev]');
    const cs = getComputedStyle(b);
    return { am: document.getElementById('am').value, dis: b.disabled, color: cs.color };
  });
  ck('‹ は12か月前で無効 [' + mined.am + ']', mined.dis === true && mined.am === '2025-11');
  ck('無効の ‹ は薄いグレー', /148|163|184/.test(mined.color));

  await p.screenshot({ path: S + 'v6010-actuals-open.png' });
  // スクショ用に見やすい月へ戻す
  await p.evaluate(() => {
    const am = document.getElementById('am');
    // click next until Nov 2026 or disabled
    for (let i = 0; i < 50; i++) {
      if (am.value >= '2026-11') break;
      const b = document.querySelector('#dlg [data-act=am-next]');
      if (!b || b.disabled) break;
      b.click();
    }
  });
  await sleep(200);
  await p.screenshot({ path: S + 'v6010-actuals-open.png' });

  ck('キャッシュ名 v6010', require('fs').readFileSync(__dirname + '/../sw.js', 'utf8').includes("CACHE = 'money-app-v6011'"));
  ck('JSエラーなし', errs.length === 0); if (errs.length) console.log(errs);
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
