# パチモンの通信交換API

## ソロ冒険の共有フィールド（v55）

世界のプレイヤーの位置は `world_presence` に保存し、Workerの実行先が違っても同じエリアの参加者を取得します。
既存のプレイヤー登録・Bearer認証を使います。位置はゲーム内のマップIDとマス座標だけで、端末の位置情報は使いません。

| 操作 | API | 内容 |
| --- | --- | --- |
| 表示・移動・周辺取得 | `POST /api/world/presence` | `{map,x,y,facing,avatar,status}` |
| フィールド退出 | `DELETE /api/world/presence` | 本人の表示を削除し、未確定のお誘いを取り消す |
| 近くの相手を誘う | `POST /api/world/invitations` | `{targetId,kind,roomCode,requestId}` |
| お誘いの確認 | `GET /api/world/invitations/:id` | 送信者・受信者のみ取得可能 |
| 参加・断る | `POST /api/world/invitations/:id/respond` | 受信者だけが `{accept:true}` または `{accept:false}` を送る |
| お誘いの取消 | `POST /api/world/invitations/:id/cancel` | 送信者だけが `{}` を送る |
| 対戦の本人証明 | `POST /api/world/trainer-pass` | `{sessionId,side}` から10分間の署名付き証明を作成 |
| 相手の本人証明確認 | `POST /api/world/trainer-pass/verify` | `{sessionId,side,pass}` を検証し、現在の役割を返す |

`facing` は `down/left/right/up`、送信する `avatar` は `male/female`、`status` は `idle/busy` です。
マップと座標は232エリアの範囲内に制限されます。位置の更新は同じプレイヤーにつき最大4回/秒です。
`presence` の応答には `self`、同じマップの近い順で最大80人の `players`、本人が関係する最大20件の `invitations`、
`serverTime`、`ttlMs:15000`、`pollAfterMs:500` を含みます。15秒以上更新のないプレイヤーは表示対象から外れます。

プレイヤーの表示は `{id,name,isAdmin,avatar,map,x,y,facing,status,updatedAt}` です。
運営権限は既存の `admin_owner` だけで判断し、現在の運営には名前「謎のトレーナー カサイ」と `avatar:kasai` を返します。
クライアントから名前・運営フラグ・カサイのアバターを送って役割を変更することはできません。

お誘いは同じマップでマンハッタン距離3マス以内、両者 `idle` の場合に作成でき、60秒で期限切れになります。
ルームを準備してお誘いを送る間は送信者を `idle` に保ち、受信者が参加を選んだ後に対戦・交換へ移行します。
受信者の確認ダイアログ中に `busy` へ変わっても返事できますが、受諾時には新しい位置と距離を再確認します。
同じ `requestId` の再送は同じお誘いを返します。どちらかが別のマップへ移動したり退出したりすると未確定のお誘いを終了します。
通常のプレイヤー同士の直接招待リンクは引き続き利用できます。

お誘いの形式は `{id,requestId,kind,roomCode,state,from,to,createdAt,expiresAt,updatedAt}`、
`state` は `pending/accepted/declined/cancelled/expired` です。`from/to` にサーバー確認済みの `{id,name,isAdmin,avatar}` が入ります。
交換ルームは送信者が作成した空きルームかを確認し、誘われた相手が承諾してからだけ参加できるよう予約します。
対戦ルームの通信自体は既存のPeerJSを使用します。D1はPeerJSルームの所有者を検証しないため、対戦開始時の本人表示には
既存の `DUEL_SIGNING_KEY` を使った `trainer-pass` を併用します。証明は対戦セッション・側・期限と結び付き、検証時に現在の運営登録を再確認します。
署名キーが未設定の場合は `503 TRAINER_NOT_CONFIGURED` を返し、クライアントは通常の対戦を継続できます。

公開時は `drizzle/0002_world.sql` を既存のD1へ追加し、マイグレーションの連番へ登録します。
運営登録、配布、既存の交換記録を作り直す必要はありません。`server.mjs` はこれまでどおりSitesの `worker/index.js` へ同期してください。

検証: `node --test server/tests/world.test.mjs server/tests/server.test.mjs server/tests/trades.test.mjs`

交換ルームの待機終了処理には `POST /api/trades/:id/cancel` へ
`{waitingOnly:true,expectedRevision:<最後に取得した版番号>}` を送ります。
作成者本人のルームが未参加・未変更の場合だけ取り消します。直前に相手が参加した場合は取り消さず、
現在の `trade` をそのまま返すため、クライアントは交換画面・受取確認を継続します。

## 通信交換

既存のプレイヤー登録トークンで認証し、6文字のコードで2人が参加します。
ルームは15分で期限切れになります。確定後の交換記録は期限切れにならず、
端末の保存に失敗しても同じ受取記録を取得できます。

| 操作 | API | 送信内容 |
| --- | --- | --- |
| 作成 | `POST /api/trades` | `{requestId}`（UUID、再送時も同じ値） |
| コードで参加 | `POST /api/trades/join` | `{code}` |
| 進行中・未受取の交換 | `GET /api/trades/active` | なし |
| 状態確認 | `GET /api/trades/:id` | なし |
| パチモンを提示 | `POST /api/trades/:id/offer` | `{revision, monster}` |
| 確認 | `POST /api/trades/:id/confirm` | `{revision}` |
| 確定前の中止 | `POST /api/trades/:id/cancel` | `{}` |
| 端末への保存完了 | `POST /api/trades/:id/ack` | `{}` |

すべての応答に `trade` が含まれます。進行中の交換がない場合の `active` は
`trade: null` です。交換対象を変えると版番号が増え、双方の確認が解除されます。
同じ版のお互いの提示内容を2人とも確認した場合だけ、D1のトランザクションで確定します。
中止と確定が競合しても、一方の結果だけが保存されます。

`receipt` は確定後だけ返り、`id`、`outgoingUid`、`outgoing`、`incoming`、
`revision` を含みます。`id` は `trade:<ルームUUID>` です。受け取る個体のUIDは
ルームと受取側から決まる一意の値へ変え、種類・レベル・経験値・HP・PP・名前・色違いを保ちます。
クライアントは元の提示個体との一致を確認し、受取記録と交換結果を同じセーブ書込みで保存した後に
`ack` を送ります。受取記録を適用済みなら再送時に交換を繰り返しません。

運営専用の幻、フート、受取ID・カスタム能力・カスタム技を持つ個体は交換できません。
通常の260種を対象とし、野生のアルヴェリオンと最初の相棒も含みます。
サーバーはゲームの種族カタログから生成したHP・経験値・PPの上限と、許可された保存項目を検証します。
冒険データは端末にあるため、過去のオフラインプレイの真正性を証明する仕組みではありません。

## 運営登録の表示・解除（v32）

ゲーム側は、`GET /api/status` が `adminExists: false` を返した場合だけキー入力を表示します。
登録済み・取得中・取得失敗時は非表示で、復旧フラグや旧8連打経路でも表示しません。
現運営は管理画面の確認を経て登録を解除できます。

`GET /api/admin/config` は、認証済みの現運営に設定と `adminRegistration: {playerId, claimedAt}` を返します。
`POST /api/admin/release` には `{confirmed: true, expectedRegistration: {playerId, claimedAt}}` を送ります。
認証と確認した登録の両方が一致する時だけ条件付きで削除し、遅延リクエストが別の登録を解除することを防ぎます。
解除してもプレイヤー情報・設定・配布記録は保持します。解除後、次の状態取得で通常の登録が可能になります。

この更新は既存の `admin_owner` を使用し、追加のDBマイグレーションや環境変数変更は不要です。
Sitesの既存ソースへ `server.mjs` を `worker/index.js` として同期し、検証後に再公開します。
本番の運営登録を解除して動作テストする必要はありません。

## 運営の復元API（v29互換）

旧版の復元要求 `POST /api/admin/claim` の `{"key": "...", "recover": true}` は互換性のため維持します。
v32の一般プレイヤー向け画面には、この要求を送るキー入力経路を表示しません。
運営キー（`ADMIN_CLAIM_KEY`）が正しければ、`ADMIN_RECOVERY_OWNER_ID`・`ADMIN_RECOVERY_ORIGIN` がなくても、
すでにいる運営からこのプレイヤーへ運営の席を移します。キー照合・プレイヤー認証・試行回数の制限・同時成功1人の条件は変わりません。
`recover` のない通常の登録は、運営がいれば `409 ADMIN_ALREADY_EXISTS` のままです。
この動作を使うには、下の手順で最新の `server.mjs` を公開し直してください。

## 更新・検証

1. 既存の `0000_admin.sql` を変更せず、`drizzle/0001_trades.sql` を追加します。
2. Sitesのソースへは `server.mjs` を `worker/index.js` としてコピーします。
   交換カタログは同じファイル内に含まれ、追加の実行時モジュールはありません。
3. Sitesの `drizzle/meta/_journal.json` に `0001_trades` の次の連番を追記し、
   既存のDBバインディングを維持してパッケージを作成・公開します。
   新しいDBや運営設定は作り直しません。
4. ゲームリポジトリでは `node --test server/tests/server.test.mjs server/tests/trades.test.mjs` を実行します。
   `trades.test.mjs` は両マイグレーションとゲームの `index.html` を参照し、通常種のカタログ一致も検証します。
   Sitesの単独ソースへコピーして検証する場合は、テストのWorker参照とゲームカタログ参照のパスを合わせます。

対象チェックは認証、他人のルームへの操作拒否、コード推測の回数制限、作成・参加の競合、
両者確認、提示変更時の確認解除、確定・中止の競合、期限切れ、保存前の未受取復旧、
確認・受取完了の再送、通常260種のデータ検証です。
