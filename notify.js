/* 通知まわり（ブラウザ内ローカル通知）。
 *
 * できること（サーバー不要）:
 *  - アプリを開いたとき/開いている間に「確定日の朝8:00(JST)」のタイマーで通知
 *  - Chrome(Android)等の Notification Trigger API (TimestampTrigger) がある環境では、アプリを閉じていても予約通知
 *  - アプリを開いた時点で、確定日を過ぎて未入力の項目があれば1日1回まとめて通知
 * できないこと:
 *  - iPhone(Safari/ホーム画面アプリ)は TimestampTrigger 非対応。アプリを閉じている間の「朝8:00」通知は
 *    Web Push（小さなサーバーが必要）でしか確実に届けられない。サーバーは未実装。
 *    → subscribePush() と sw.js の 'push' ハンドラは将来の追加用に用意済み。docs/NOTIFICATIONS.md 参照。
 */
(function (root) {
  'use strict';
  const NOTIFIED_KEY = 'money-app-notified-v1';
  let timers = [];

  const hasNotif = () => typeof Notification !== 'undefined';
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => navigator.standalone === true || (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches);
  const triggerSupported = () => hasNotif() && 'showTrigger' in Notification.prototype && typeof root.TimestampTrigger !== 'undefined';
  const jstHour = () => Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hour12: false })) % 24;
  const jstDate = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }); // YYYY-MM-DD

  function readNotified() { try { return JSON.parse(localStorage.getItem(NOTIFIED_KEY)) || {}; } catch (e) { return {}; } }
  function markNotified(k) { const o = readNotified(); o[k] = Date.now(); const keys = Object.keys(o).sort().slice(-60); const n = {}; keys.forEach((x) => (n[x] = o[x])); localStorage.setItem(NOTIFIED_KEY, JSON.stringify(n)); }

  async function show(title, body, tag, extra) {
    const opts = Object.assign({ body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: './index.html' } }, extra || {});
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg && reg.showNotification) return reg.showNotification(title, opts);
    return new Notification(title, opts);
  }

  async function request() { if (!hasNotif()) return 'unsupported'; return Notification.requestPermission(); }

  /** 状態から通知予定を再計算してスケジュール/表示する。アプリ起動時・復帰時・データ保存時に呼ぶ */
  async function sync(state, L) {
    const info = { permission: hasNotif() ? Notification.permission : 'unsupported', scheduled: 0, mode: 'none', shownNow: false };
    timers.forEach(clearTimeout); timers = [];
    if (info.permission !== 'granted') return info;
    const todayStr = L.today();
    const now = Date.now();
    const reminders = L.computeReminders(state, todayStr, 14).filter((r) => r.at.getTime() > now);
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    for (const r of reminders) {
      if (triggerSupported() && reg) {
        try { await reg.showNotification(r.title, { body: r.body, tag: 'fix-' + r.date, icon: 'icons/icon-192.png', data: { url: './index.html' }, showTrigger: new root.TimestampTrigger(r.at.getTime()) }); info.scheduled++; info.mode = 'trigger'; continue; } catch (e) { /* フォールバック */ }
      }
      const ms = r.at.getTime() - now;
      if (ms < 2147483000) { timers.push(setTimeout(() => { const k = 'fix-' + r.date; if (!readNotified()[k]) { markNotified(k); show(r.title, r.body, k); } }, ms)); info.scheduled++; if (info.mode === 'none') info.mode = 'timer'; }
    }
    // 取りこぼし: 確定日を過ぎて未入力のものを、8時以降に1日1回だけまとめて通知
    const pending = L.computePending(state, todayStr);
    const k = 'pending-' + jstDate();
    if (pending.length && jstHour() >= 8 && !readNotified()[k]) {
      markNotified(k);
      await show('金額の入力待ちが' + pending.length + '件あります', pending.slice(0, 4).map((e) => e.label).join('、') + (pending.length > 4 ? ' ほか' : '') + '（アプリを開いて実績を入力してください）', k);
      info.shownNow = true;
    }
    return info;
  }

  /** 【未使用・将来用】Web Push 購読。サーバー側(VAPID鍵・配信)を作ったら設定画面から呼ぶ。戻り値の JSON をサーバーへ送る */
  async function subscribePush(vapidPublicKey) {
    const reg = await navigator.serviceWorker.ready;
    const b64 = vapidPublicKey.replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const key = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    return sub.toJSON();
  }

  root.Notify = { supported: () => hasNotif() && 'serviceWorker' in navigator, permission: () => (hasNotif() ? Notification.permission : 'unsupported'), isIOS, isStandalone, triggerSupported, request, show, sync, subscribePush };
})(typeof self !== 'undefined' ? self : this);
