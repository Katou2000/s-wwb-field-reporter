# S WWB Field Reporter

WWB Field Reporterは、現場のplayerと離れたrequesterが同じライブセッションを見ながら、数字・小役・イベント・指示・会話・画像をリアルタイム共有するモバイルファーストWebアプリです。

## v0.4の主な機能

- 現在差枚、現在持ちメダル、現在G、総Gを最上部へ集約
- ステータスをアイコン＋色で強調し、「判断ほしい」「指示待ち」などを一目で判別
- 進行中セッションと終了済みセッションをホームで分離
- 現在G、現金投資、持ちメダル、AT終了のクイック操作
- 最大4件の共有ライブcounter
- 常時展開の指示メモ、各指示へのコメント、独立した掲示板
- Eventに紐づく指示には元ログのゲーム数・獲得枚数・タグ等を表示
- 「見た」「了解」「質問アリ」を独立して複数選択できるreaction
- ログの「タイトル」とユーザー編集可能な「タグ」を分離
- 終了画面などを残せる画像共有。アップロード時に最大辺1600pxへ軽量化
- 作成者のみ、終了済みセッションを完全削除可能
- 通常／ダークテーマとlocalStorage保存
- player／requester双方からの共同編集とRealtime同期

## ローカル起動

ES Modulesを使用するため、`index.html`を直接開かずHTTPサーバーから配信します。

```bash
python -m http.server 8000
```

ブラウザで`http://localhost:8000`を開きます。

## Supabase接続設定

1. Supabase DashboardでAnonymous Sign-Insを有効化します。
2. `js/config.example.js`を参考に、ローカルの`js/config.js`へProject URLとPublishable keyを設定します。
3. Secret key／`service_role` keyはブラウザへ置かないでください。

`js/config.js`はGit管理対象外の実環境ファイルです。既存ファイルを自動生成・上書き・削除しないでください。

## migrationの適用

Supabase SQL Editorで未適用分を番号順に実行してください。

```text
1. supabase/migrations/2026083101_wwb_v02_collaboration.sql
2. supabase/migrations/2026083102_wwb_v02_finish_session.sql
3. supabase/migrations/2026083103_wwb_v03_live_workspace.sql
4. supabase/migrations/2026083104_wwb_v04_visibility_images_cleanup.sql
```

v0.4 migrationは以下を追加します。

- `events.tag`
- `session_images`テーブルとRLS
- private Storage bucket `wwb-session-images`
- Storage objectのmember向けRLS
- `hard_delete_session(p_session_id)`
- `session_images`のRealtime publication

## 画像容量について

画像はアップロード前にブラウザ側で最大辺1600pxへ縮小し、通常はJPEG品質82%へ圧縮します。Bucket側にも1ファイル5MB制限を設けます。画像ストレージは有限なので、不要画像は画像タブから個別削除できます。終了済みセッションを「完全削除」すると、そのセッションに紐づく画像オブジェクトも先に削除してからDBを削除します。

## 現在差枚

```text
投資換算枚数 = round(現金投資合計 ÷ 貸出円単位 × 貸出枚数単位)
現在差枚     = 現在持ちメダル − 開始持ちメダル − 投資換算枚数
```

AT終了の`acquired_medals`はイベントの獲得枚数で、現在持ちメダルとは別データです。

## 実DB確認

通常ウィンドウとシークレットウィンドウで同じセッションを開き、以下を確認してください。

1. ステータス変更が色・アイコン・相手画面へ反映される。
2. 終了後、ホームの「終了済みセッション」に移る。
3. 指示メモ本文とコメントが常時表示され、質問アリ→コメントが使える。
4. Event由来の指示に元ログ詳細が表示される。
5. ログのタイトルとタグが別表示になる。
6. 画像を共有・表示・削除できる。
7. 作成者のみ終了済みセッションを完全削除できる。
8. 掲示板、カウンター、ゲーム数、差枚、終了処理が従来通り同期する。

詳しい仕様は`SPEC.md`、今後の予定は`TODO.md`を参照してください。
