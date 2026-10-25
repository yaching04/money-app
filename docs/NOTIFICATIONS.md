# 通知について（正直な現状）

## 今できること（サーバーなし）
- **アプリ内インボックス**: ホーム画面に「金額の入力待ち」を表示（請求額がわかる日が今日以前で未入力の変動項目を毎回計算）。これは確実に動く。
- **ローカル通知**（`notify.js`）: 設定 → 「通知を許可する」を押した後、
  - アプリを開いている間は、次の請求額がわかる日の朝8:00(JST)にタイマーで通知。
  - Android Chrome など Notification Trigger API (`TimestampTrigger`) 対応環境では、アプリを閉じていても予約通知。
  - アプリを開いた時点（朝8時以降）に未入力が残っていれば、1日1回まとめて通知。
- iPhone で通知を使うには、**Safari で「ホーム画面に追加」した PWA** を iOS 16.4 以降で起動し、アプリ内のボタンから許可する必要がある（Safari のタブ上では不可）。

## できないこと
- **iPhone でアプリを閉じている間の「朝8:00」通知は、今の構成では届かない。** iOS は TimestampTrigger に非対応で、
  バックグラウンドで勝手にコードを動かすこともできない。確実に届けるには **Web Push（小さなサーバー）** が必要で、**未実装**。

## 将来 Web Push を足すときの手順（コードは受け口だけ用意済み）
1. サーバー（例: Cloudflare Workers / Vercel / 小さな Node サーバー）で VAPID 鍵を生成。
2. `notify.js` の `Notify.subscribePush(vapidPublicKey)` を設定画面のボタンから呼び、返る購読 JSON をサーバーへ保存。
   （サーバーに送るデータは購読情報と、通知予定の計算に必要なデータ。端末のみ保存の方針を変えるなら、ここで初めてデータを送る点に注意）
3. サーバーで `logic.js` を `require` し、`computeReminders(state, today, days)` が返す `{at, title, body}` を使って
   毎日 8:00 JST（cron）に Web Push を送信。`computeReminders` は DOM 非依存。
4. `sw.js` の `push` イベントハンドラは実装済み（`{title, body, url}` の JSON を想定）。
