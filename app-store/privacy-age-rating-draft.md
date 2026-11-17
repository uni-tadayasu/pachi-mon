# App Privacy・年齢レーティングの確認用下書き

この文書は実装から分かる範囲の整理です。App Store Connectへ回答済みではありません。第三者サービスの実運用・保持期間・公開地域を含め、所有者が最終回答を確定します。「データを収集しない」はオンライン機能の実装に一致しません。

## App Privacyの候補

| 情報 | 実装での扱い | Appleの分類を検討する際の候補 |
| --- | --- | --- |
| プレイヤーID、表示名、認証トークンのハッシュ | 本人認証・配布・交換のためサーバーで保存 | User ID。表示名は画面名として扱う。用途はApp Functionality、本人IDとの関連あり |
| 配布対象・配布記録・配布設定、交換部屋・提示個体・確定受取記録 | オンライン機能を成立・復旧させるためサーバーで保存 | Gameplay Content。用途はApp Functionality、本人IDとの関連あり |
| 冒険の進行、手持ち、ローカル設定 | 原則端末内に保存。交換で提示した個体等は別途送信 | 端末内だけの処理はAppleの収集定義とは別。オンラインへ実際に送る部分は上記に含める |
| IP、ネットワークメタデータ、ホスティングログ | 接続サービス、STUN/TURN、ホスティングが処理し得る | 保存と利用の実態を確認。IPの用途に応じた分類が必要で、未確認のまま「収集なし」にしない |
| 広告識別子、広告追跡 | 現行アプリコードに広告SDK・広告追跡の実装は見当たらない | Trackingの最終回答は第三者の実態も確認する |

AppleのWebViewに関する説明では、アプリ内WebViewによるデータ通信も申告対象です。匿名IDでも「収集なし」とは限りません。名前を必須の実名として収集する実装ではありませんが、ユーザーが入力する表示名の扱いを確認してください。

ネイティブの `PrivacyInfo.xcprivacy` とApp Store ConnectのApp Privacy回答は役割が異なります。Manifestを同梱しただけでストア上の回答が完了するわけではありません。

### 削除と保管

- アプリ内から本人認証付き `DELETE /api/me` を開始します。
- 本人のオンラインidentity、表示名、トークンハッシュ、本人の配布データ、運営所有者との紐付け等を削除します。
- 相手が受け取りを完了できるよう、他者の確定交換結果は匿名化した参照で保持する場合があります。
- 旧運営配布の受取IDなど、一意性と二重受取防止のために残す参照の例外は公開ポリシーを確認します。
- 削除後は端末側の自動登録・同期を止めます。オフラインの冒険記録は削除しません。
- PeerJS／STUN／TURN、ホスティングのログ保持期間は初回作成時点で未確認です。数値を創作しません。
- 本番の削除API更新と実機確認が完了してから審査へ提出してください。

公開予定ポリシー: `https://www.kasai-solutions-inc.com/privacy.html`  
公開予定サポート: `https://www.kasai-solutions-inc.com/support.html`

現在のサポート案内はGitHub Issueです。連絡用メールアドレスは未確認のため作っていません。機密を扱う連絡のために公開投稿しかない状態が適切か、所有者が提出前に確認してください。

## 年齢レーティングの候補

最終年齢値は選択した回答からAppleが決定します。4+などの値を先に確約しません。

| 質問領域 | 実装から分かること／確認事項 |
| --- | --- |
| ファンタジーの暴力 | パチモン同士の戦闘・攻撃エフェクトがある。頻度は実際のゲーム内容を見て回答 |
| 写実的な暴力・流血 | 現行の一般ゲーム機能ではそのための表現は確認していない。全素材を提出前に確認 |
| 性的表現・薬物等 | 全素材・文章を見て確認する。未検査を検査済みとして回答しない |
| 賭博・現金の賞品 | 現行ゲームに現金を賭ける機能は確認していない |
| メッセージ・チャット | 自由文チャット、音声通話は実装していない。対戦相手の表示名や個体名は表示される |
| ユーザー生成コンテンツ | 表示名・ニックネーム等が他ユーザーに見える。質問の定義と必要な投稿対策を確認 |
| Webへのアクセス | サポート等の外部リンクがある。アプリ内で無制限に閲覧する設計ではないが、実際の遷移を確認 |
| Kidsカテゴリ | 未確定。子ども向けカテゴリの追加条件を確認せずに選択しない |

## 暗号輸出

HTTPS／WSS、WebRTCの暗号化通信、SHA-256等を利用します。Appleの除外条件に該当するかは最終未確定です。現在のInfo.plistでは `ITSAppUsesNonExemptEncryption` の回答を省略し、CIも勝手にfalseを補いません。App Store Connectで暗号輸出への回答が求められたら、実装を照合して正しく申告してください。

## 公式資料

- [App Privacy詳細とWebViewの扱い](https://developer.apple.com/app-store/app-privacy-details/)
- [App Privacyの管理](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy)
- [アカウント削除](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [年齢レーティング](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating)
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [暗号輸出コンプライアンスの概要](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/)
