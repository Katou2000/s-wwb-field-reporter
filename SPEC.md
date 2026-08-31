# WWB Field Reporter v0.4 仕様

## 目的

WWBはplayerとrequesterが同じライブセッションを見ながら、現状・数字・小役・イベント・判断・会話・画像を共有するボードです。重要情報の視認性と、スマホでの見逃しにくさを優先します。

## ステータス視認性

`ready / playing / need_help / waiting_instruction / checking / break / finished`を維持します。現在ステータスカードと最近のセッションでは、文字だけでなくアイコンと色を併用します。特に`need_help`は赤系、`waiting_instruction`は黄系で強調し、終了済みは彩度を落として明確に区別します。

## 最近のセッション

ホームでは進行中と終了済みを分離します。終了済みは折りたたみ可能な「終了済みセッション」フォルダへまとめます。各カードにはlifecycleとplayer statusを表示します。

## 指示メモとコメント

指示カードは折りたたまず常時展開します。本文、reaction、指示ごとのコメントを一画面で確認できます。`comments.target_instruction_id`を利用して指示スレッドを作り、普通の掲示板コメントとは分離します。

`question` reactionを新たにONにしたときは、その指示のコメント入力へフォーカスしやすい導線を設けます。

## Event参照指示

`instructions.target_type = event`の場合、`target_event_id`に対応する元Eventを指示カード内に表示します。最低限、タイトル、タグ、時刻、ゲーム数、獲得枚数、投資・持ちメダル等のEvent値、補足を表示します。

## ログのタイトルとタグ

`events.label`はログのタイトルです。v0.4で`events.tag`を追加し、右上のバッジはユーザーが入力したタグを優先します。従来の`hit`というevent typeを「当選」という固定バッジとして表示しません。AT終了などシステムEventは補助バッジを表示できます。

## 画像共有

- metadata: `public.session_images`
- object: private Storage bucket `wwb-session-images`
- 画像形式: JPEG / PNG / WebP
- クライアントで最大辺1600pxへ縮小
- 通常JPEGは品質82%
- bucket 1ファイル上限5MB
- session memberは閲覧・追加・削除可能
- signed URLでprivate画像を表示
- `session_images`をRealtime対象にする

## 完全削除

`hard_delete_session(p_session_id)`は、認証済みかつ`created_by = auth.uid()`の作成者だけが、`lifecycle_status = finished`のセッションに対して実行できます。

Storageオブジェクトはフロントから先に削除し、その後RPCでセッションDB行を削除します。`sessions`配下のcascade対象データと最終change_logを削除します。UIでは「削除」と文字入力しないと実行できません。

## 差枚・ゲーム数・counter

v0.3仕様を継続します。現在差枚はderived value、現在持ちメダルの正本は`session_metrics.current_medals`、AT終了獲得枚数は`events.acquired_medals`です。

## Realtime

対象は以下です。

- sessions
- session_metrics
- events
- counter_items
- instructions
- instruction_reactions
- comments
- session_members
- session_images

## テーマ

`light / dark`をlocalStorageへ保存します。ステータス色、終了済み表示、タグ、指示コメント、画像カードも両テーマで可読性を確保します。
