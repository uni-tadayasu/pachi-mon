# パチモンの通信交換API

## 運営の秘密部屋テンプレート（v75）

`drizzle/0008_room_templates.sql` が `world_rooms.template_id` を追加します。既存の部屋は `hall` で、家具・入口・更新版は保持します。Sitesのマイグレーションジャーナルには連番8で登録します。

`GET /api/world/rooms/catalog` の `templates` と部屋の応答に `templateId`・`floorMask` を含めます。運営3役職の各本人は `PATCH /api/world/rooms/:ownerId` に `{revision,templateId,name,decorations}` を送れます。IDは `hall`（王座の大広間）、`sanctum`（星環の八角堂）、`wings`（双翼の回廊）の3つです。一般プレイヤーは `templateId` を送信しません。

家具の全マスが選択した床の内側にあること、中央通路・対戦ステージ・別の家具に重ならないことを検証します。新しい間取りに収まらない家具がある要求は、部屋を変更せず拒否します。版番号、現在の運営登録時刻、ライブ対戦のロックを比較して更新します。一般プレイヤーへの変更後も選択済みの運営用テンプレートと表示範囲外の家具を保管し、再登録時に復元します。位置同期も有効な床のマスだけ受け付けます。

## 3人の運営登録・解除（v62）

メイン運営・サブ運営・サブサブ運営を各1枠、合計3人登録できます。`drizzle/0006_sub_admin.sql` は既存の `admin_owner` を保持したまま、`sub_admin_owner`、共通の権限判定用ビュー `admin_members`、登録時刻の連番表と重複防止トリガーを追加します。適用済みのマイグレーション・プレイヤー・配布記録は変更しません。`0007_third_admin.sql` が3番目の固定席を追加し、共通ビューと重複防止を3枠へ拡張します。Sitesでは既存のジャーナルへ順番に追記し、適用済みの `0006` は変更しません。

| 操作 | API | 内容 |
| --- | --- | --- |
| 運営端末一覧 | `GET /api/admin/devices` | 現在の運営だけが取得。端末の名前・ID・役割・登録時刻と上限3枠を返す |
| 登録先の確認 | `GET /api/admin/devices?playerId=...` | 登録済みプレイヤーの名前とIDを確認。権限は変更しない |
| サブ運営・サブサブ運営を追加 | `POST /api/admin/devices` | メイン運営のみ。`{playerId,role:"sub" または "sub-sub",confirmed:true}` |
| サブ運営・サブサブ運営を解除 | `POST /api/admin/devices/revoke` | メイン運営のみ。`{playerId,claimedAt,confirmed:true}`。確認した登録が一致する場合に解除 |
| 自分の運営登録を解除 | `POST /api/admin/release` | 現在の自分の登録に対して既存の確認・比較更新を行う |

サブ運営・サブサブ運営も、配布・能力設定・専用の仲間・フィールドの運営表示・専用部屋・署名付き参加証・リアルタイム対戦の運営機能を使えます。役職の追加・他端末の登録解除はメイン運営だけが行えます。権限の変更はサーバーで毎回判定し、古い管理画面・遅延した登録や配布要求から操作できないようにします。

メイン運営が自分の登録を解除すると、残るサブ運営を優先し、いなければサブサブ運営を同じトランザクションでメイン運営へ引き継ぎます。登録時刻と操作IDを照合し、途中で別のサブ運営へ変更された場合は古い確認を拒否します。

プレイヤーのプロフィール・フィールド・部屋の所有者・署名付き本人確認・リアルタイム対戦の参加者は、DBの席から `adminRole:main/sub/sub-sub/null` を返します。メインは `avatar:kasai` と「謎のトレーナー カサイ」、サブは `avatar:sub-admin` と「サカイ」、サブサブは `avatar:sub-sub-admin` と「イサカ」です。3人とも `isAdmin:true` です。`/me` などのプレイヤー情報と運営端末一覧は、登録した名前を `name` に保持し、役職の名前を `displayName` に返します。フィールド・部屋・署名付き本人確認・リアルタイム対戦・交換の公開プロフィールには役職の名前を使い、登録解除後は通常の名前に戻ります。名前の編集でも役職の表示名は変わらず、元の名前は失われません。部屋の新規作成時に名前を省略すると、役職に合わせて「カサイ／サカイ／イサカのひみつ部屋」を使い、既存の部屋名は変更しません。位置同期で受け付けるアバターは従来の `male/female` だけで、運営の役割・専用の姿をクライアントから自己申告することはできません。

一般の初回キー登録は、すべての席が空いている場合だけ可能です。`adminExists` は1枠でも埋まっていれば `true`、`adminRegistration` は呼び出した本人の登録を返します。一般プレイヤー向けのサブ運営登録フォームはありません。登録解除後もプレイヤーID・通常の部屋・保存済みの設定・配布記録は保持します。

`GET /api/world/rooms?kind=kasai` は3人の運営の部屋を返し、`GET /api/world/rooms/kasai?playerId=...` は指定した運営の部屋を返します。部屋の訪問とリアルタイム対戦は対象のプレイヤーIDに結び付け、サブ運営への訪問がメイン運営の部屋へ向かわないようにします。

## 壁のひみつ部屋とカサイ本人との対戦（v59）

`drizzle/0003_rooms.sql` は、公開する部屋 `world_rooms`、挑戦セッション `kasai_challenges`、
一人一回の受取記録 `kasai_rewards` を追加します。既存のプレイヤー・運営・配布・交換記録は維持します。
部屋と試練のAPIはすべて既存のBearer認証が必要です。

### 部屋

| 操作 | API | 送信内容・応答 |
| --- | --- | --- |
| アイテムと間取り | `GET /api/world/rooms/catalog` | `{catalog,layouts,serverTime}` |
| 作れる壁 | `GET /api/world/rooms/walls?map=village` | `{walls:[{x,y,facings}],serverTime}` |
| フィールドの入口 | `GET /api/world/rooms?map=village` | `{rooms,serverTime}` |
| 自分の部屋 | `GET /api/world/rooms/mine` | `{room:null または部屋,serverTime}` |
| カサイの部屋 | `GET /api/world/rooms/kasai` | 現在の運営が作成した部屋。運営未登録・部屋未作成なら `room:null` |
| 部屋を見る・訪問する | `GET /api/world/rooms/:ownerPlayerId` | 認証済みなら誰でも取得可能 |
| 部屋を作る | `POST /api/world/rooms` | `{map,x,y,facing,name?}` |
| 部屋を移転する | `POST /api/world/rooms/:ownerPlayerId/relocate` | `{revision,map,x,y,facing}`。持ち主のみ |
| 模様替え | `PATCH /api/world/rooms/:ownerPlayerId` | `{revision,name?,decorations?}`。持ち主のみ |

部屋は運営・一般プレイヤーともひとり一つで、入口は移転できます。同じ入口への作成再送は既存の部屋を返します。
画面のAボタンから壁を調べ、部屋がなければ作成、あれば移転の確認へ進みます。作成・移転は最新の接続位置と向きがその壁の前に一致する場合だけ受け付けます。
壁の座標 `(x,y)` に対し、`facing` はプレイヤーが壁を見る向きです。
例: `up` なら壁の下 `(x,y+1)` が入口前・退出後の位置になります。
232エリアの実際の `#`・`B` タイルから作成可能な壁と向きを生成しており、
歩ける接近位置がない壁、既存の出入口に隣接する壁、人物の前は対象外です。
同じ壁への作成はD1の一意制約で競合を防ぎます。現在のマップでは最大378候補なので、
一覧の上限400件ですべての入口が収まります。入室に招待や持ち主の承認は不要です。

部屋の形式:

```js
{
  id: 'P0123456789abcdef',
  mapId: 'room:P0123456789abcdef',
  owner: {id, name, isAdmin, avatar},
  kind: 'secret', // 現在の運営の部屋だけ 'kasai'
  name, entrance: {map, x, y, facing, returnX, returnY},
  width, height, spawn: {x, y}, exit: {x, y},
  protected: [{x, y, width, height}],
  decorations: [{id, itemId, x, y, rotation}],
  revision, createdAt, updatedAt
}
```

`decorations[].id` は部屋内で重複しない1〜40文字の英数字・`_`・`-`、`itemId` はカタログのIDです。
カタログは `plant/lamp/stool/table/sofa/shelf/bed/aquarium/crystal/plush/rug/banner` の12種類です。
各項目の `width/height/solid` を描画・当たり判定にも使います。回転は数値の `0/90/180/270` のみで、
90度・270度は縦横の占有マスを入れ替えます。最大32個、ラグを含めて占有マスの重なりは禁止です。
保存は送信した `revision` との比較更新で行い、別タブの編集・運営の交代が競合すると `409 ROOM_CHANGED` を返します。

通常の部屋は18×16、登場位置 `(9,12)`、退出位置 `(9,14)`。
配置できる床は `x=1..16, y=2..13`、中央の `x=8,9` は通り道として空けます。
カサイの部屋は24×20、登場位置 `(12,16)`、退出位置 `(12,18)`。
配置できる床は `x=1..22, y=2..17` で、中央の `x=11,12` と舞台 `x=8..15,y=2..7` を空けます。
対戦中の運営本人の待機位置は `(12,4)`・下向きです。常設のCPUカサイは配置しません。アイテムは占有するすべてのマスが配置可能な床に収まる必要があります。

部屋の参照APIは読み取りだけを行い、カサイの部屋を自動作成しません。運営も通常の作成APIで自分が向いた有効な壁を選びます。
風待ちの里の固定入口・予約壁はありません。既存の部屋は消さず、移転しても同じID・部屋名・家具を保持します。
移転後の入口一覧は新しい壁だけを返すため、旧入口のマークは消えます。前の運営の部屋も削除せず、通常の部屋として残ります。
役割変更で間取りが変わった場合は、現在の間取りで安全に置けるアイテムだけを表示します。

`POST /api/world/presence` は `room:<ownerPlayerId>` にも対応します。
その部屋がD1に存在することを確認し、現在の役割に応じた間取りで座標範囲を検証します。
未作成の部屋IDを送って、架空の共有フィールドを作ることはできません。

### カサイ本人とのリアルタイム対戦

新規のカサイ戦は実際に接続中の運営本人との通信対戦です。CPUは操作せず、運営がいない場合は開始できません。運営の部屋が未作成なら `KASAI_ROOM_UNAVAILABLE` を返し、部屋を勝手に生成しません。
同じ通常フィールドで15秒以内に更新された位置が3マス以内、双方が待機中であることを開始時に確認します。
運営本人は自分を誘えません。`kasai_live_members` のプレイヤーごとの一意制約で、二重の対戦参加を防ぎます。

| 操作 | API | 送信内容 |
| --- | --- | --- |
| 自分の対戦を確認・接続を維持 | `GET /api/world/kasai/live` | `{session:null または自分の対戦,serverTime}` |
| 対戦を申し込む | `POST /api/world/kasai/live` | `{requestId,party,storageCount,roomId?}` |
| 指定対戦を確認 | `GET /api/world/kasai/live/:id` | 参加者だけが取得可能 |
| 入場を確認 | `POST /api/world/kasai/live/:id/arrive` | `{party?}`。運営の初回入場は実際の手持ち必須 |
| 挑戦者が話しかける | `POST /api/world/kasai/live/:id/talk` | `{}` |
| 運営が許可・辞退 | `POST /api/world/kasai/live/:id/answer` | `{accept:true または false}` |
| 双方が行動を選ぶ | `POST /api/world/kasai/live/:id/actions` | `{round,orders,requestId}` |
| 挑戦者が退出 | `POST /api/world/kasai/live/:id/leave` | `{}` |
| 元の場所への復帰確認 | `POST /api/world/kasai/live/:id/ack` | `{}`。閉じた対戦だけ |
| 勝利報酬の明示的な受取 | `POST /api/world/kasai/live/:id/claim` | `{storageCount}` |

`session` は `{id,role,state,roomId,challenger,kasai,deadlineAt,reason,returnPosition,stagePosition,arrived,battle,round,submitted,rewardEligible,rewardClaimed,rewardDelivered,revision,serverTime}` です。
`role` は `challenger` または `kasai`、`arrived` と `submitted` は `[挑戦者,運営]` の真偽値です。
`submitted` に他方の未解決の行動内容は含めません。部屋のデータは `/world/rooms/:roomId` で取得します。

状態は `staging` → `permission` → `battle` → `result` → `closed` です。
申し込みが成立すると、双方の元のフィールド・座標・向きを保存し、挑戦者を `(12,16)` 上向き、運営を `(12,4)` 下向きへ移します。
運営は挑戦者が退出するまで対戦後も同じ場所で待ちます。移動・通常の退出・部屋の編集・移転をサーバーでも制限します。
初回入場時の実際の手持ちを固定し、双方のHP・PPと通常の状態異常を回復します。レベル・育成・技・フートの独自能力・持ち物・色違い・永続する呪いは保持します。

申し込み成立から60秒以内に、両者が入場し、挑戦者が運営の近くで話しかけなければ、双方を元のフィールドへ戻します。
話しかけると運営へ許可を求め、運営が許可した場合だけ対戦を開始します。運営は入場待ち中にも辞退できます。
参加者の接続更新が30秒途切れた場合、または運営権限が移った場合も、双方を元の場所へ戻して参加枠を解放します。
タイムアウト処理は書込み時にも最新の状態・接続時刻を再確認し、既に成立した会話や接続更新を古い判定で取り消しません。

`server/kasai-live-engine.mjs` は通常の人間同士の対戦モデルと同じソースから生成します。
行動は両側の正当な入力が揃ったときだけ解決し、ターンと版番号の条件付き更新で並行リクエストでも一度だけ進みます。
片方が交代を必要としない強制交代フェーズだけ、その側の空の行動 `[]` を自動確定できます。技・交代の選択をCPUが代行することはありません。
`world_presence.input_at` で移動POSTの上限を管理し、接続確認のGETが位置更新を429にすることを防ぎます。
入退室をまたいで遅れた位置更新は参加セッションIDも同じSQLで確認し、元の場所への復帰を上書きしません。

勝者はサーバーの共通対戦結果で判定します。挑戦者が勝った後の `/claim` だけが、一度限りのLv.70・性別ランダムのキラシードの受取記録を作ります。
ひかえが192体なら記録を作らず `KASAI_STORAGE_FULL` を返します。`rewardClaimed` は受取記録が存在すること、`rewardDelivered` は端末保存後のACK済みを示します。
退出・復帰確認の後でも、`GET /world/kasai/reward` は未受取の勝利があれば `pendingLiveSessionId` を返します。
この記録から明示的に `/live/:id/claim` を呼び直せます。証明済みの通信対戦の勝利には受取期限を設けません。
通常のGETやオンライン人数の取得で、新しい報酬を自動配布することはありません。

### 部屋の移転

運営も一般プレイヤーも、`world_rooms.owner_id` の主キーで部屋は一人一つです。
`POST /api/world/rooms/:ownerId/relocate` に `{revision,map,x,y,facing}` を送ると、同じ部屋の入口を移転できます。
本人が移転先の壁の前に立ち、その壁を向いている最新の位置情報が必要です。部屋のID・名前・家具は維持し、版番号だけ進めます。
他人の入口、通常の出入口、設置できない壁へは移せません。一般プレイヤーは運営用に予約された壁へ移せません。
古い版番号は `ROOM_CHANGED`、壁の前にいない場合は `ROOM_NOT_NEARBY`、別の部屋がある場合は `ROOM_ENTRANCE_OCCUPIED` で拒否します。
カサイとの対戦への参加中は、模様替えと移転を `KASAI_LIVE_BUSY` で拒否します。

### 発行済みの旧ソロ挑戦の復旧

以下は更新前に発行済みのCPU戦の復旧専用です。新規の `POST /world/kasai/challenges` は `KASAI_LIVE_REQUIRED` で拒否し、本人との通信対戦へ案内します。
既存の対戦ID・トークンと勝利記録は保持し、期限内の操作記録の再送は引き続き検証できます。


| 操作 | API | 送信内容・応答 |
| --- | --- | --- |
| 運営の手持ちを同期 | `POST /api/world/kasai/party` | `{party}`。現在の運営だけが変更可能 |
| 現在の手持ちを確認 | `GET /api/world/kasai/party` | `{party,playerId,updatedAt,serverTime}`。未同期なら `party:null` |
| 発行済み挑戦のトークン再取得 | `POST /api/world/kasai/challenges` | `{requestId,roomId,party,storageCount}` |
| 結果の確認と報酬受取 | `POST /api/world/kasai/challenges/:id/complete` | `{token,actions,storageCount}` |
| 挑戦を中止 | `POST /api/world/kasai/challenges/:id/cancel` | `{token}` |
| 受取状況・明示的な復旧 | `GET /api/world/kasai/reward` | `{receipt:null または受取記録,serverTime}` |
| 端末保存完了 | `POST /api/world/kasai/reward/ack` | `{receiptId}` |

準備の `requestId` はUUID、`roomId` は現在の運営のプレイヤーIDです。
運営本人は開始・結果確定・受取復旧・ACKを `403 KASAI_SELF_BATTLE` で拒否します。
古い自己対戦の記録も、相手の部屋の持ち主と挑戦者が同じなら、運営交代後も新たに報酬を受け取れません。
役割変更が書込み直前に起きた場合もD1側の条件で拒否し、既に所有している個体・受取記録は削除しません。
古い挑戦の中止は運営本人でもできます。

開始時は15秒以内の位置更新があり、カサイの部屋内で `(12,4)` からマンハッタン距離3以内である必要があります。
準備の応答は `{challenge:{id,roomId,seed,rulesVersion,party,opponents,expiresAt,state},token,rewardClaimed,serverTime}`。
`token` を `challenge` に合わせてからクライアントの `startKasaiBattle` に渡します。
トークンは `DUEL_SIGNING_KEY` から決定的に生成するため、応答を失っても同じ `requestId` で再取得できます。
有効期限は30分、更新後は新しいCPU挑戦を発行しません。

`server/kasai-replay.mjs` はクライアントと同じデータ・Engineを、動的評価を使わない静的なモジュールとして保持します。
`scripts/sync-kasai-replay.cjs` で生成し、`--check` でクライアントとの一致を検証できます。
サーバーの種、開始時の仲間、最大512件の操作を再生して、実際に勝利まで到達した場合だけ報酬を作ります。
許可する操作は `{type:'move',index}`、`{type:'switch',index}`、`{type:'replace',index}`、`{type:'struggle'}` です。
`won:true` だけの申告、途中で終わる記録、不正操作、終了後に続く操作は受理しません。
カサイのチームは、現在の運営が同期した実際の手持ち1〜6体です。種類・レベル・並び順・技の順番・育成配分・持ち物・色違い・性別・フートの独自能力を保存します。
挑戦開始時点の手持ちを `opponents_json` に複製し、途中で運営が手持ちを変更しても進行中のバトルと検証には同じ編成を使います。
現在のルールは `kasai-solo-v74` です。互換性のある発行済み挑戦は保存された手持ちの複製で検証します。旧 `kasai-solo-v57` の未完了挑戦は新しい種族能力で再生せず、期限切れにして再開始を案内します。完了済みの結果・受領記録と明示的なv56互換フローは維持します。新規対戦は上記のライブAPIを利用します。
双方のHP・PPと通常の状態異常は開始時に全回復します。永続する呪いは維持します。
更新前の `kasai-solo-v56` かつ `opponents_json IS NULL` の記録だけは、有効期限内なら当時の固定チーム・乱数規則で結果を検証できます。

通常の仲間のレベル・成長・持ち物などは、端末の冒険データをEngineの保存形式で検証したものです。
過去のオフラインプレイの真正性を証明する仕組みではありません。
配布IDを持つ仲間は本人の配布記録・現在の運営権限・勝利報酬を追加確認し、
独自能力のフートは配布された能力と技の範囲を確認します。

勝利報酬は `{id,grantId,species:'floravelle',level:70,gender,createdAt,ackedAt,delivered}`。
`id` と `grantId` はともに `kasai-reward:<playerId>`、性別はサーバーが初回だけ `male/female` を選び保存します。
勝利の確定と一度限りの受取記録を同じD1トランザクションで保存します。再送・再戦でも個体情報は変わりません。
保存後のACKも一度だけ記録し、`delivered:true` は既に保存済みの報酬として扱います。
古いセーブへ戻した場合も、配送済みの記録から新しい個体を作り直さないでください。

ひかえが192体の場合は、パーティーに空きがあっても `409 KASAI_STORAGE_FULL` で受取を止めます。
このとき受取記録は作らず、通常の `/me` の配布キューにも入れません。
空きを作った後に本人が明示的に受取を再試行でき、未完了の挑戦は元の30分期限まで利用できます。
送信された `storageCount` は整数・上限を検証しますが、サーバーは端末の実際のセーブを読み取れません。
クライアントでも受取操作直前とセーブ書込み直前に192体未満を確認してください。
`GET /reward` は状況表示・明示的な復旧用で、自動配布のトリガーにしません。

既存の `/api/duel-pass` は、本人の `kasai-reward:<playerId>` にも署名できます。
v3の証明は保存済みの勝利報酬を確認し、現在の運営であることを要求しません。
通信対戦では既存のキラシードと同じ標準Lv.50の能力を返します。キラシードの既存の交換制限は維持しています。

公開時は `0003_rooms.sql`・`0004_kasai_party.sql`・`0005_kasai_live.sql` をD1のマイグレーションとして適用し、
`server/server.mjs`・**`server/kasai-replay.mjs`・`server/kasai-live-engine.mjs`** をWorkerへ同期してください。
入口モジュールが `worker/index.js` なら、リプレイモジュールは `worker/kasai-replay.mjs`、人間同士の対戦モジュールは `worker/kasai-live-engine.mjs` に置きます。
`0005` は既存の勝利報酬を全件保持し、旧挑戦と通信対戦のどちらか一方を受取元として記録できるようにします。

検証:

```sh
node scripts/sync-kasai-replay.cjs --check
node --test server/tests/rooms.test.mjs server/tests/world.test.mjs server/tests/server.test.mjs server/tests/trades.test.mjs server/tests/kasai-live.test.mjs
```

## ソロ冒険の共有フィールド（v55）

世界のプレイヤーの位置は `world_presence` に保存し、Workerの実行先が違っても同じエリアの参加者を取得します。
既存のプレイヤー登録・Bearer認証を使います。位置はゲーム内のマップIDとマス座標だけで、端末の位置情報は使いません。

| 操作 | API | 内容 |
| --- | --- | --- |
| 表示・移動・周辺取得 | `POST /api/world/presence` | `{map,x,y,facing,avatar,status}` |
| ステージ別オンライン人数 | `GET /api/world/population` | 最新15秒以内の実プレイヤー数。本人も含む |
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

`population` は `{rows:[{map,count,name?,kind?}],total,serverTime,ttlMs:15000}` を返します。
人数が正のステージのみ含み、静的な232エリアと保存済みの秘密部屋を集計します。
部屋の行だけ部屋名 `name` と `kind:secret/kasai` を付け、所有権の変更も現在の運営登録から判定します。
全体人数は行の人数の合計で、近隣表示の80人上限には制限されません。同じプレイヤーIDは一度だけ数えます。
位置の更新がちょうど15秒前の人、削除された部屋、不明なマップは除きます。
認証必須・`Cache-Control:no-store` の読み取り専用APIで、取得によってオンライン時間を延長せず、滞在中のプレイヤー一覧・名前・認証トークンを返しません。

プレイヤーの表示は `{id,name,isAdmin,avatar,map,x,y,facing,status,updatedAt}` です。
運営権限は `admin_members` で判断します。メインには名前「謎のトレーナー カサイ」と `avatar:kasai`、サブには「サカイ」と `avatar:sub-admin`、サブサブには「イサカ」と `avatar:sub-sub-admin` を返します。元のプレイヤー名はDBに保持し、登録解除後の通常プロフィールに戻します。
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
