# サブ運営 サカイ — フィールド用ドット絵

## 素材と参照

- `assets/sub-admin-overworld-v62.png`: ユーザーが提示した紫色の長髪、編み込みと銀色の髪飾り、黒いロングコートとブーツの人物を参照して、組み込み画像生成ツールで制作した透過PNG。1086 × 1448px、RGBA、1,268,145バイト。
- 生成結果のPNGをそのまま複製している。画素、色、アルファチャンネルの編集、再圧縮は行っていない。
- 元画像と配布画像のSHA-256はともに `1248e2355b08ba7a874a4b28a6be88d24928be095e4ea50b6fcb74d66d8e58e9`。
- `assets/sub-admin-overworld-v62.json` は表示用の切り出し矩形、足元アンカー、共通縮尺の基準を記録する。
- 3列 × 4行の12フレーム。行は下・左・右・上、列は待機・歩行1・歩行2。

## 描画

`LT.TravellerArt.get('sub-admin', facing, frame, id, resolution)` が96 × 128pxのCanvasを返す。`resolution >= 2` では192 × 256px。`facing` は `down`・`left`・`right`・`up`、`frame` は0〜2。`id` による衣装の色替えは行わない。

シートの余白と歩行時の接地点を測定し、全フレームを幅228px・高さ338pxの固定矩形で切り出す。列の左端は94・424・758px、行の上端は20・382・740・1097px。各フレームの足元アンカーはJSONに記録した定数を使い、出力の足元基準122px（高密度表示では244px）に合わせる。髪・コート・ブーツを含む可視輪郭が切り出し範囲に収まることを確認している。

全フレームで幅200px・高さ325pxを共通の縮尺基準にする。姿勢ごとの輪郭サイズに応じた拡大縮小は行わず、歩行中の体格を保つ。表示時は既存の旅人と同じ接地影とドット処理を使用する。高密度表示も元のPNGから描画し、96 × 128pxの出力を引き伸ばさない。

`traveller-art.js` はJSONと同じ定数を持つため、ゲーム初期化に追加のJSON取得は不要。通常のアバター選択肢は男女のままとし、特殊アバターの一覧に `sub-admin` を追加する。サブ運営の権限判定とアバター指定は呼び出し側のサーバー認証済みプロフィールに従う。既存のカサイ用画像・切り出し・描画処理は変更しない。

## 検証

- サブ運営の4方向 × 3フレーム × 2解像度、計24枚を描画。
- 4方向それぞれで3つの歩行フレームが異なる画像になること、透過の余白が保たれること、頭髪・コート・ブーツが描画面の四辺で切れないことを確認。
- 切り出し矩形と足元アンカーの整合性、12フレームのメタデータを検証。
- 既存の主人公男女・カサイ・休憩所・ショップ・守護者・会話NPCの4方向 × 3フレーム × 2解像度、計168枚は、変更前との画素ハッシュがすべて一致。
- 5つの旅人アトラスの読み込み成功、失敗数0を確認。
- `scripts/check-world-detail.cjs --snapshots=<出力先>` で、全12姿勢を通常解像度と高密度で並べた確認用画像を出力できる。

## 生成経緯

ユーザーが提示した参照人物の外観を維持した、トップダウンRPG用の4方向歩行シートとして生成した。参照画像の紫の長髪、編み込み、銀色の装飾、黒いコートとブーツを反映し、透明背景に独立した12姿勢を配置している。

## 画像生成プロンプト

組み込みのImageGenを使用し、背景透過を指定。参照1はユーザーの提示画像、参照2は既存のカサイの歩行シート（画風・配置のみ）です。

```text
Use case: style-transfer. Asset type: production transparent pixel-art overworld walking sprite atlas for the browser RPG Pachi Monsters. Image 1 is the sole character-design reference: an adult woman with very long vivid violet-purple hair, a side braid and small silver hair ornament, side-swept fringe, black high-neck top, fitted black long coat/dress with silver piping and buckles, hexagonal silver belt buckle, and black tall boots. Image 2 is ONLY the rendering-style and atlas-layout reference: match its charming small 16-bit RPG proportions, fine square pixel detail, crisp dark outlines, readable silhouette, and four-direction walking sheet. Do not include or copy Image 2's teal-haired man or his clothes. Create a NEW atlas of the purple-haired woman with exactly 12 full-body frames, arranged in an evenly spaced 3-column by 4-row grid. Row order top to bottom is FRONT facing down, LEFT profile facing left, RIGHT profile facing right, BACK facing up. Column order left to right is standing idle, left-foot step, right-foot step. Both walking phases must be visibly distinct, with subtle arm movement and long hair and coat motion. Each frame must use the same body scale and stable foot baseline within its own cell, with generous transparent margins; all hair, boots, and coat hems must remain fully inside its cell. Use a truly transparent alpha background; no backdrop, no ground shadow, no labels, no letters, no numbers, no drawn grid, no checkerboard. Preserve the purple hair, side braid, black long coat, silver trim, belt and boots consistently from the woman's reference. The entire delivered image is only the usable 12-frame sprite sheet.
```
