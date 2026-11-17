# パチモンの通信交換API

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


## iOS版とアカウント削除（2026-11-17）

`DELETE /api/me` を追加しました。`Authorization: Bearer <本人のトークン>` とJSON
`{"confirmation":"DELETE","playerId":"本人のプレイヤーID"}`が必要です。
別IDでの要求は409、未認証は401、不足した確認は400です。すでに削除済みの
トークンによる同じ要求は200を返し、応答を失った後も安全に再試行できます。
トークン・ID・確認文字列をアクセスログへ出さないでください。

- 本人のplayers行、認証hash、名前、本人のgrants、admin_owner、本人IDを含むrate_limitsを削除します。
- 進行中交換を中止し、相手のロックを解除します。確定済みの相手の受取データは維持します。
- 交換相手と配布作成者の参照には認証できない共通行を使用します。管理プレイヤー一覧・全体配布からは除外します。
- 双方が削除された交換は削除します。他者が保有する配布受取IDは、二重配布防止のため改名しません。
- トランザクション全体に失敗した場合、元のアカウント・交換を維持します。
- アプリ側は削除成功後に `pachi-online-disabled-v1=1` を保存して自動登録を停止します。
  既知のIDは `/register` ではなく `/me` で認証し、別端末で削除されたアカウントを自動再作成しません。

### デプロイ対象

既存の `0000_admin.sql` と `0001_trades.sql` が必要です。**追加のDBマイグレーションはありません。**
既存のSites側Workerに、このリポジトリの `server/server.mjs` を `worker/index.js` として
反映して公開してください。DBバインディング、既存の運営キー、既存の署名キーを保持します。
クライアント側の `admin-console.js` と公開 `privacy.html` / `support.html` も反映します。
Worker未更新の状態では削除APIは利用できないため、App Store提出前に公開先での動作確認が必要です。

iOSは許可したAPIだけをネイティブURLSession経由で呼び出すため、Origin追加は不要です。
Web版のCORS許可リストは維持し、OPTIONSにDELETEを追加しました。

### 検証

```sh
node --test server/tests/server.test.mjs server/tests/trades.test.mjs server/tests/account-deletion.test.mjs
node --test scripts/check-admin-client.cjs scripts/check-account-deletion.cjs
```

本人認証、他人の削除拒否、応答喪失後の再試行、未確定交換の解除、確定済み受取維持、
双方削除時の掃除、同じrequestIdの匿名化競合、運営削除、トランザクション失敗時の復元、
削除後の自動登録防止、遅延した旧profile応答、ネイティブAPI/バックアップ経路を検証します。

### 公開状況と提出前の確認

2026-11-17のこの実装時点で、公開通信Workerへの反映は未完了です。GitHubへコードを追加しても、
Sites上の既存通信サービスは自動では更新されません。App Storeのアップロード前に上記の反映を行い、
公開の `GET /api/status` 応答に `accountDeletionSupported: true` が含まれることを確認してください。
このマーカーのない旧Workerに対する削除要求はエラーとして扱い、クライアントは認証情報を消しません。
さらにテスト用の本人アカウントで、削除・再試行・旧トークンの無効化まで確認してください。
公開前に自動判定できない第三者サービスのログ保持期間等は、ストアのプライバシー回答で確認が必要です。
