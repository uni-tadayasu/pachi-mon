# サブサブ運営 イサカ — フィールド用ドット絵

## 素材と参照

- `assets/sub-sub-admin-overworld-v62.png`: ユーザーの添付した金髪・白系のロングコート・濃緑の腰帯・黒いブーツの人物を参照し、組み込みのImageGenで制作した透過PNG。1086 × 1448px、RGBA、1,525,114バイト。
- 生成したPNGの画素・色・透過・圧縮を変更せず、原本のバイト列をそのままゲームへ収録。
- SHA-256: `315f9bd6be4ceeacdae95002fef9b354e6d9681d9b1070609b7edb0711c09109`。
- `assets/sub-sub-admin-overworld-v62.json` に切り出し矩形・足元アンカー・共通縮尺と原本のハッシュを記録。
- 3列 × 4行の12姿勢。列は待機・歩行1・歩行2、行は下・左・右・上。腕組みの参照ポーズを、操作キャラクターの待機と歩行に合わせて変更。

## 描画と権限

`LT.TravellerArt.get('sub-sub-admin', facing, frame, id, resolution)` で通常96 × 128px、高密度192 × 256pxのCanvasを生成します。元画像から幅220px・高さ350pxの固定矩形を切り出し、幅180px・高さ336pxの共通縮尺基準で描画します。各方向・姿勢の身体中心と接地位置を合わせ、出力の足元基準は122pxです。

既存のサブ運営の紫髪、メイン運営のカサイとは別のアトラスです。一般のアバター選択に追加せず、サーバーが返す `isAdmin:true` と `adminRole:sub-sub` に従って本人・他端末・人物紹介へ表示します。一般プレイヤーの保存データへ専用の姿を記録せず、権限解除後は通常のアバターへ戻ります。

## 検証

`scripts/check-world-detail.cjs` は、原本ハッシュ、4方向 × 3姿勢 × 2解像度の24表示、透過の余白、画像の切れ、接地位置、各歩行姿勢の違いを検証します。`--snapshots=<出力先>` を指定すると、実際のゲーム描画処理による `sub-sub-admin-v62.png` を出力します。

## 画像生成プロンプト

背景透過を指定。参照1はユーザーの提示した金髪の人物、参照2は既存カサイの歩行シート（画風・配置のみ）です。

```text
Use case: style-transfer. Asset type: production transparent pixel-art overworld walking sprite atlas for the browser RPG Pachi Monsters. Image 1 is the sole character-design reference: an adult man with shoulder-length wavy golden blond hair swept partly back into a small half tie, green eyes, a cream/ivory long coat with gold trim and angular lapels over a charcoal high-neck outfit, a dark desaturated green waist sash with a small gold diamond clasp, dark trousers and dark boots with gold trim. Image 2 is ONLY the pixel-rendering style and 3-column by 4-row sprite atlas layout reference. Match its charming small 16-bit RPG proportions, fine square pixel detail, crisp dark outlines and readable silhouette. Do not copy Image 2's teal-haired character or clothes. Create a NEW sheet containing exactly 12 full-body frames of the blond man, on a truly transparent alpha background. Evenly spaced three columns and four rows: row 1 front facing DOWN, row 2 profile facing LEFT, row 3 profile facing RIGHT, row 4 back facing UP. Column 1 idle, column 2 LEFT-foot walking step with opposite arm swing, column 3 RIGHT-foot walking step with opposite arm swing. The two walk phases must be genuinely opposite strides, not duplicates. Arms may rest naturally for idle and swing for walking; do not preserve the crossed-arm portrait pose. The hair, ivory coat and dark green waist sash must remain consistent in every direction. Keep the same body dimensions and stable foot baseline in each cell, generous transparent separation, and the entire hair, coat and boots within each frame. Full image is only the usable 12-frame sprite atlas, no labels, text, numbers, grid lines, scenery, ground shadow, checkerboard or extra people.
```
