# パチモン iOS 提出前の確認記録

このチェック表は実施結果の記録用です。空欄は未確認を意味します。GitHub Actionsの成功はシミュレーターでの結果であり、実機・携帯回線・Appleの審査を代替しません。

## 提出情報

| 項目 | 記録 |
| --- | --- |
| 対象commit | `22ac035c1bf26245bda9f4fdf4334824094ca041`（PR #24、CI checkout: `b8278e28d8dceeecebe0d9271e675d045748d890`） |
| Marketing version / build | Simulator設定: `1.0.0` / `1`。配布用の署名済みビルドは未作成 |
| Bundle ID / Apple app numeric ID | 未確認 |
| Apple会員資格・契約 | 未確認 |
| iOS validationのURLと結論 | [Run 44052196023](https://github.com/uni-tadayasu/pachi-mon/actions/runs/44052196023) — **success**（2026-11-17 JST） |
| 署名・アップロードrunのURLと結論 | 未送信または結果未転記 |
| App Store Connect処理結果 | 未確認 |
| 本番 accountDeletionSupported | 初回作成時点でサーバー更新未反映 |
| 公開privacy/supportのURL | 到達確認待ち |

## 自動検証の実施結果

上記runはXcode 26.2、iPhoneOS SDK 26.2、iOS 26.2のiPhone SE（第3世代）Simulator（arm64）で実行しました。サーバーテスト42件、アカウント削除のクライアントテスト5件、ネイティブbridgeの契約テストが成功しました。ゲーム資産は613ファイル・53.69 MiBを同梱しました。

| iOSテスト | 結果 |
| --- | --- |
| 同梱ゲーム・Secure Context・localStorage・乱数/UUID/SHA-256・画像/canvas・RTC | 成功 |
| ネイティブメニューからプライバシーポリシーを開く | 成功 |
| 実PeerJS brokerとWebRTCを使う双方向データ送受信 | 成功 |

XCTestは3件、失敗0件です。[ログ・xcresultのartifact](https://github.com/uni-tadayasu/pachi-mon/actions/runs/44052196023/artifacts/14314204850)は2026-11-24までの7日間保存です。以下の実機欄とApple側の署名・アップロード欄は、このSimulator結果だけでは完了にしません。

## 実機で確認すること

- [ ] iPhoneの対象最小OSと現在のOSで起動できる。
- [ ] iPadで起動し、操作ボタン・画面・メニューが欠けない。
- [ ] 機内モードで新しい一人用冒険と保存済み冒険を開始できる。
- [ ] 方向キーとアクションの同時押し、名前入力、キーボード表示中の操作が正常。
- [ ] BGM／効果音をON・OFFでき、着信・画面ロック・バックグラウンド移行後に適切に復帰する。
- [ ] アプリ再起動後に最新のセーブが残る。
- [ ] 冒険記録をFilesへ書き出して読み込める。共有キャンセルを保存成功と誤表示しない。
- [ ] Safari版の冒険記録とプレイヤー情報を別々に移し、IDと進行が復元される。
- [ ] アプリ同士、アプリとSafari版で6文字コードの対戦が開始・完了する。
- [ ] Wi-Fiとモバイル回線をまたぐ対戦でデータチャネルが成立する。
- [ ] 相手の切断・ロック・回線切替を、停止や保存破損なく扱える。
- [ ] 通信交換が両者確認後に一度だけ確定し、途中終了後も受け取りを復旧できる。
- [ ] 運営専用個体が一般プレイヤーへ不正に配られない。
- [ ] アプリ内からオンラインアカウントを削除でき、失敗時に削除完了と表示しない。
- [ ] 削除後に自動でオンラインアカウントを再作成せず、オフライン冒険は残る。
- [ ] プライバシー／サポート／ライセンス全文へアプリ内から到達できる。
- [ ] 長時間の探索・図鑑・戦闘でメモリ不足や落ちる症状がない。

## App Store Connectで確定すること

- [ ] 正しい販売者・Team・Bundle ID・SKU・アプリレコードを選んでいる。
- [ ] App PrivacyはUser ID／Gameplay Contentなど実際の保存・利用に一致する。
- [ ] PeerJS、STUN/TURN、ホスティングのログ・保持期間について公開ポリシーと申告を確認した。
- [ ] 年齢レーティング、ニックネーム等のユーザー入力の扱いを確認した。
- [ ] 暗号輸出に関する質問へ実装に沿って回答した。
- [ ] 価格・配信地域・公開方法を所有者が確定した。
- [ ] スクリーンショットは実際に動いているこのバージョンから取得した。
- [ ] Apple公式の現在の必須iPhone表示サイズと、iPad 13インチの画像を用意した。
- [ ] サポートページに有効な連絡手段があり、個人情報や秘密を公開投稿させない。
- [ ] App Reviewの非公開連絡先を入力し、対戦・交換の試し方を説明した。
- [ ] アイコン・画像・音楽・名称の使用権を確認し、必要なライセンス通知を含めた。
- [ ] 送信ビルドを選択して審査提出し、Apple側の状態を実際に確認した。

## 結果の記録方法

端末名、OS、ビルド、再現手順、期待結果、実結果を記録します。失敗は未解決のままチェックしません。秘密鍵、プレイヤー認証JSON、第三者の個人情報を公開IssueやActions artifactへ添付しないでください。

参考: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)、[スクリーンショット仕様](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)、[App Privacy](https://developer.apple.com/app-store/app-privacy-details/)。
