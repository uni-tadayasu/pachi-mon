# パチモンをApp Storeへ提出する手順

このリポジトリは、ゲーム資産を同梱するiPhone／iPad用のSwift・WKWebViewアプリと、GitHub Actionsで検証・署名・アップロードする仕組みを含みます。アプリの対象OSはiOS／iPadOS 16以降、提出用のビルドにはXcode 26以降・iOS 26 SDK以降を使用します。最低対応OSとビルドSDKの要件は別です。

## 現在の状態と、完了の意味

- Apple Developer／App Store Connectへのログイン、会員資格、App ID、アプリレコード、証明書、API keyは、この実装作業では確認できていません。
- 初回作成時に編集用実行環境が利用不能になったため、ファイルをGitHubへ保存してGitHub Actionsで検証する構成です。実際のコンパイル・テスト結果はActionsの各実行と結果ファイルを参照してください。コードが存在することをビルド成功と同一視しません。
- オンラインアカウント削除のサーバー実装は別途本番への反映が必要です。初回作成時点では本番更新は未完了です。アップロード処理は公開APIが `accountDeletionSupported: true` を返すまで停止します。
- `iOS validation` は署名せずにシミュレーターで検証します。
- `iOS App Store upload` は必要なApple設定、本番サーバー、検証結果が揃ったときだけ署名済みIPAを送信します。
- アップロードコマンドの正常終了、Apple側のビルド処理、TestFlight配信、App Reviewへの提出、審査承認、一般公開はそれぞれ別段階です。**このワークフローは審査提出・一般公開を自動実行しません。**

Apple側の接続・設定不足で送信できない場合、Actions Summaryへ不足する設定名と「未送信」を表示します。パスワード、秘密鍵、P12をチャットや公開リポジトリへ貼り付けないでください。

## 1. Apple側で用意するもの

1. 有効なApple Developer Program会員資格を用意し、Account Holderが必要な契約を確認・承諾します。Apple公式の年額は99 USDで、実際の金額は登録地域の画面で確認します。
2. Certificates, Identifiers & Profilesで、明示的なApp IDを登録します。初期Bundle IDは `com.kasaisolutions.pachimon` です。他のIDを使う場合は、下記Repository variableとApple側の登録を一致させます。
3. App Store Connectの「アプリ」でiOSアプリのレコードを作成します。表示名は候補「パチモン」、主言語は日本語です。SKUは所有者が任意に一意の値を設定します。名称の利用可否や数値のApple IDはApple側で確定します。
4. **Apple Distribution証明書と対応する秘密鍵**をP12として安全に書き出し、強いパスワードを設定します。証明書のCERだけでは署名できません。
5. 同じBundle ID・Team・配布証明書に対応する **App Store Connect用Provisioning Profile** を作成・ダウンロードします。Development、Ad Hoc、Enterprise用は使いません。
6. App Store Connectの「ユーザとアクセス → 統合 → App Store Connect API → チームキー」で、アップロード権限のあるTeam API keyを用意します。Key ID、Issuer ID、ダウンロードしたP8秘密鍵を安全に保管します。秘密鍵のダウンロードは一度だけです。

CIは手動配布署名を使用します。API keyだけで署名証明書やProfileを自動発行する構成ではありません。MacのキーチェーンからP12を書き出す方法のほか、証明書のCSRを作成した安全なPCで、その秘密鍵とAppleの証明書からP12を作る方法もあります。いずれの場合も、対応する秘密鍵が必須です。

## 2. GitHubへ設定する項目

対象リポジトリの `Settings → Secrets and variables → Actions` を開きます。

### Repository secrets

| 名前 | 内容 |
| --- | --- |
| `IOS_DISTRIBUTION_P12_BASE64` | 配布証明書と秘密鍵を含むP12ファイルのBase64 |
| `IOS_DISTRIBUTION_P12_PASSWORD` | そのP12のパスワード |
| `IOS_PROVISIONING_PROFILE_BASE64` | App Store Connect用 `.mobileprovision` のBase64 |
| `ASC_KEY_ID` | Team API keyの10文字のKey ID |
| `ASC_ISSUER_ID` | Team API keyのIssuer ID（UUID） |
| `ASC_PRIVATE_KEY_BASE64` | `AuthKey_…p8` 秘密鍵ファイルのBase64 |

### Repository variables

| 名前 | 初期値／内容 |
| --- | --- |
| `APPLE_TEAM_ID` | **必須**。Apple Developerの10文字のTeam ID |
| `IOS_BUNDLE_ID` | 未設定なら `com.kasaisolutions.pachimon` |
| `IOS_MARKETING_VERSION` | 未設定なら `1.0.0` |
| `IOS_XCODE_VERSION` | 未設定なら `26.2`。GitHubのmacos-15ランナーに実際に入っている26以降のバージョンを指定 |

Base64は暗号化ではありません。ファイルの内容を一行の文字列へ変えたもので、そのまま秘密として扱います。以下は自分のPCでクリップボードへコピーする例です。コピーした値は対応するGitHub Secretへ直接保存します。

Windows PowerShell:

```powershell
Set-Clipboard -Value ([Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path '.\Distribution.p12').Path)))
```

macOS:

```bash
base64 -i Distribution.p12 | pbcopy
```

ProfileとP8にも、ファイル名を置き換えて同じ操作を行います。ファイル・秘密値はコミットしません。

## 3. 本番のアカウント削除APIを反映する

アプリのオンライン機能は次の既存通信サービスを使用します。

`https://pachi-mon-admin-hub.hisa-0128-1996.chatgpt.site/api`

GitHubリポジトリ内の `server/server.mjs` を更新しただけでは、別管理されている稼働中の通信サービスは更新されません。既存サーバーのデプロイ経路を使って同じDB・設定を保ったまま更新します。更新手順は `server/README.md` を参照してください。

送信前のゲートは次を確認します。

```text
GET /api/status
ok: true
accountDeletionSupported: true
```

この確認は公開statusに対する読み取りだけです。プレイヤーIDや秘密鍵を送信しません。サーバー更新未反映・ネットワーク失敗・不正応答の場合、署名IPAのアップロードを行いません。

公開前には実際のテスト用オンラインアカウントを使い、アプリ内の削除がサーバー側でも完了することを確認してください。statusの機能宣言だけでは、削除フロー全体の実機確認を代替できません。

## 4. GitHub Actionsを実行する

### 署名せずに検証

Pull Requestまたはmain以外のブランチへのpushで `iOS validation` が起動します。Actionsから手動実行もできます。

実行内容:

1. Xcode 26以降・iOS 26 SDK以降を確認。
2. ネイティブbridgeとアカウント削除のJavaScript／サーバーテストを実行。
3. `node scripts/prepare-ios.mjs` でゲーム資産を `ios/PachiMon/Resources/Web` へ同梱。
4. 実際のiOS SimulatorのWKWebViewで、暗号API、保存、画像／canvas、ネイティブメニュー等をテスト。
5. 実PeerJS brokerとWebRTCデータチャネルの往復通信を別ステップでテスト。

ライブ通信テストは外部サービス・ネットワークへ依存します。失敗したときは失敗として記録し、成功や未実行への読み替えはしません。`xcresult`とログはActions artifactに7日間保存します。

### 署名してApp Store Connectへ送信

mainへのpush、または `iOS App Store upload → Run workflow → main` で起動します。

- Apple設定が不足しているmain pushでは、検証のみ進め、アップロードはスキップして不足する名前を表示します。
- 手動実行でApple設定が不足している場合、設定チェックは失敗として表示します。
- main以外を指定したアップロード実行は拒否します。
- 署名前にProfileの有効期限、Team、Bundle ID、配布方式、P12秘密鍵と証明書の対応を検証します。
- 一時Keychainを作成してarchive／exportし、Appleの `altool` で検証・送信します。
- 秘密鍵、P12、一時Keychain、今回インストールしたProfileは終了時に削除または元に戻します。
- 成功時は署名済みIPAを7日間のActions artifactとして保存します。秘密鍵はartifactに含めません。

ビルド番号は、このアップロードワークフローのrun numberとattemptから `major.minor.patch` を生成します。run 1／attempt 1は `1.0.1`、run 100は `1.99.1`、run 101は `2.0.1` です。各区分を4桁・2桁・2桁以内に収めます。既存アプリにすでに大きいビルド番号を送った場合やワークフローを作り直した場合は、番号の連続性を確認してください。既存の送信済みビルド番号は再使用できません。

## 5. TestFlightで実機を確認する

App Store Connectでアップロードしたビルドが表示され、処理が完了したか確認します。暗号輸出に関する追加回答が必要になる場合があります。

このゲームはHTTPS／WSSとWebRTCの暗号化通信、SHA-256を使用します。`ITSAppUsesNonExemptEncryption = false` の自動設定や、輸出規制の回答を推測で行っていません。Appleの質問と実装を照合し、所有者が正確な申告を行ってください。

実機での確認事項は `APP_STORE_RELEASE_CHECKS.md` を参照してください。少なくともiPhoneとiPad、Wi-Fiとモバイル回線をまたぐ対戦・交換、オフライン起動、保存／復元、バックグラウンド復帰、音声、削除を確認します。外部TestFlight配信にはAppleのベータ審査が必要になる場合があります。

## 6. Safari版からの引き継ぎ

Safari版のWebサイトとアプリは保存領域が異なります。インストールするだけで既存セーブ・運営権限は移りません。

1. Safari版の設定で **冒険記録** を書き出します。これはパーティー・進行等のセーブJSONです。
2. Safari版の設定で **プレイヤー情報** も別に書き出します。これはオンラインID／認証情報です。
3. アプリ側で冒険記録を読み込みます。
4. アプリ側でプレイヤー情報を復元します。
5. 元の進行とオンラインIDを確認した後、移行を完了と判断します。

プレイヤー情報のファイルには本人として操作できる認証情報が入っています。他人へ送ったり、公開Issueへ添付したりしないでください。冒険記録だけを復元しても、オンラインIDや運営権限は復元されません。

## 7. ストア情報を確定して審査へ提出する

`app-store/` は日本語の提出用下書きです。APIへ自動送信するデータではありません。

- アプリ名、説明、キーワード、価格、配信地域を確定する。
- 年齢レーティングの質問へ実内容に沿って回答する。
- 公開プライバシーポリシー・サポートページの実URLを確認する。
- サーバー保存・第三者通信を含めてApp Privacyを回答する。
- 実際のアプリ画面からスクリーンショットを用意する。
- レビュー連絡先と、必要なテスト方法を非公開のApp Review欄へ設定する。
- 適切なビルドを選択し、App Store Connectから審査へ提出する。

想定URLは次です。**実際に公開・到達可能かは提出時に確認してください。**

- プライバシー: `https://www.kasai-solutions-inc.com/privacy.html`
- サポート: `https://www.kasai-solutions-inc.com/support.html`
- サイト: `https://www.kasai-solutions-inc.com/`

## 公式資料

- [Apple SDK最低要件](https://developer.apple.com/news/upcoming-requirements/?id=04282026a)
- [Apple Developer登録](https://developer.apple.com/help/account/membership/program-enrollment)
- [新規アプリ登録](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app)
- [App Store Connect用Profile](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/)
- [Team API key](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api)
- [ビルドのアップロード](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)
- [App Reviewへの提出](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app/)
- [App Privacy](https://developer.apple.com/app-store/app-privacy-details/)
- [アカウント削除](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [スクリーンショット仕様](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
- [CFBundleVersion](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/CoreFoundationKeys.html)
- [GitHubでのApple署名](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)
- [macOS 15 Arm64ランナー収録環境](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-arm64-Readme.md)
- [checkoutの公式リリース](https://github.com/actions/checkout/releases)
- [setup-nodeの公式リリース](https://github.com/actions/setup-node/releases)
- [upload-artifactの公式リリース](https://github.com/actions/upload-artifact/releases)
