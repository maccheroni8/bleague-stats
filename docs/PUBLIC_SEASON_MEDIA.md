# 公開画像のシーズン別切り替え：第1〜第3工程

第1〜第3工程の当初基準はmainの`ee877dc9326745271441cafcf684b1bd8505c402`。
本Worktreeは`a728128ae92124a555dd6d06c092619567b741a7`へ選択的移植済み（末尾に検証記録）。
第1工程は対応表・読み込み・選択を準備。第2工程で宇都宮のヘッダーロゴと選手表へ限定接続する。
保存処理は変更しない。
私的画像、画像サーバー、画像保存ガード、操作ID、保存対象の版管理は含めない。

## 保存場所

- 対応表：`public/media/catalog/{season}.json`
- 画像：`public/media/assets/{sha256}.webp`（ロゴはPNG等も可）
- 対応表のasset.path例：`media/assets/{sha256}.webp`（`public/`は含めない）
- 配信URL例：`/bleague-stats/media/catalog/2025-26.json`
- 現在の写真：`/bleague-stats/data/player-photos/{playerId}.webp`
- 現在のロゴ：`/bleague-stats/data/logos/{teamId}.png`

本番用の対応表・実画像は作成しない。架空の対応表はテスト内だけで組み立てる。第3工程の自作TEST画像はWorktree外に隔離する。
`dataLayout.ts`・統計集計へのimport・保存キーを変更しない。

## 移植した基盤

`shared/mediaCatalog.ts`のMediaAsset／MediaBindingを維持する。
JSONは`parseMediaCatalogText`で構造と参照を検証し、`resolveMedia`で選択する。
実ファイルのSHA-256とルート外参照は`validateMediaFiles(catalog, publicRoot)`で検証できる。
このファイル検証は読み取り専用で、登録・変換・コピーを行わない。

`mediaCatalogLoader`は同時実行中の取得だけを共有し、次回取得では再確認する。
404は`not-found`、通信・本文読み取り失敗は`network`、その他HTTP失敗は`http`、
JSONや対応内容の不正は`invalid-catalog`。複数季の一部失敗時は不完全な台帳を返さない。
Providerに対象seasonを渡した場合だけ取得する。チーム詳細では親構造を固定し、宇都宮だけseasonを渡す。他チームは空配列で取得しない。

## 公開用の選択API

```ts
const selected = selectPublicMedia({ baseUrl, request, state, affiliations });
// selected.source: catalog / current / none
```

`publicMediaSelection.ts`が公開用のフォールバック規則を適用する。
共通resolverの従来APIは変更しない。公開用APIはresolverの別季catalog fallbackを無効にし、
対象の登録画像がない場合は現在の固定画像URLへ戻す。

- season：別入力の確認済み最終所属で選択する。現在の選手マスタから最終所属を推測しない。
- team：ページのteamIdで選択する。
- game：試合時点のteamId・gameDateで適用期間を照合する。チーム所属そのものは呼び出し側で確認する。
- career：currentSeason以前の最新の確認済み代表写真。Providerへ候補となる全シーズンを渡す。
- 適用期間が複数あり日付がない場合など、決められなければ現在画像。
- 未登録、対応表404・通信失敗・登録ミス、未確認の最終所属、代表写真なしも現在画像。
- `current`は`actualSeason: null`・`affiliationVerified: false`。過去季の確認済み写真とは表示しない。
- 台帳のID規則に合わないIDは選択APIではURLを作らず`none`。表示部品は既存PlayerPhoto／TeamLogoへ渡し、従来表示を維持する。

現在画像へ戻した理由はreasonで保持する。登録ミスを正常な空の対応表へ変換しない。
loaderの`issues`も呼び出し側で診断用に保持できる。

```ts
const next = fallbackPublicMediaImage(selected, failedUrl);
```

登録画像の読み込み失敗は現在画像へ一度だけ戻す。HTTP 404を確認できた場合のみ
第3引数に`"not-found"`を渡す。通常のimg onErrorだけでは404・通信エラーの区別はできないため
既定は`asset-load-error`。現在画像自体も取得できない場合は既存の非表示／placeholder仕様を維持する。
古いURLの失敗は無視する。同一URLの別世代の失敗も区別できるよう、次工程の表示部品は要求単位で状態を管理する。

## 第2工程の画面接続

`PublicMediaImage.tsx`のPublicPlayerPhoto／PublicTeamLogoは通常のimgで表示する。
対応表の読み込み中は同寸の空枠とし、読了後の未登録・通信失敗や登録画像の取得失敗では元のPlayerPhoto／TeamLogoを呼ぶ。
元の部品・CSS・画像取得関数は変更しない。要求（season・teamId・playerId・文脈）が変わると
画像の失敗状態を作り直す。古い対応表の結果はhookで破棄する。

`TeamDetailPublicMedia.tsx`がteamId=703のページだけProviderを設ける。
TeamDetailPageのヘッダーと通常／Q別／Shooting共用の選手行だけに接続する。
チーム別の表なので、選手マスタの現在所属ではなくページのteamIdを使用する。
最終所属の入力が必要なシーズン全体の選択は共通表示部品と架空テストで扱い、チーム別の表へ混ぜない。
リーダー写真・他チーム・ランキング・比較・試合・SVGロゴは既存経路を維持する。

保存ボタン・設定は追加しない。PNG保存処理、PlayerPhoto、TeamLogo、dataLayout、CSSはmainと同一。
既存resolverのrightsやcanExportはデータ契約として維持するが、保存処理には接続しない。
canExport=falseが保存時に強制されるとは扱わない。実登録するのは公開サイトと既存保存機能で扱う画像に限る。

## 検証コマンド

```sh
node --experimental-strip-types --test scripts/validate-media.test.ts scripts/public-media.test.ts
npm run typecheck
npm run build
env -u GITHUB_OUTPUT node --experimental-strip-types scripts/build-data.ts plan
node --experimental-strip-types scripts/build-data.ts code-files
```

テストは架空ID・対応表・一時領域の架空バイトだけを使う。外部画像は取得しない。
mainと新WorktreeのallKey・code-files、既存722写真＋30ロゴのパスとSHA-256を比較する。
既存WorktreeのHEAD・未コミット内容・AGENTS.mdも開始時と終了時で比較する。

## 第2工程のブラウザ検証

```sh
node scripts/validate-public-media-browser.mjs
node scripts/validate-public-media-browser.mjs --mobile
node scripts/validate-public-media-browser.mjs --real
node scripts/validate-public-media-browser.mjs --real --mobile
node scripts/validate-public-media-browser.mjs --real --baseline
node scripts/validate-public-media-browser.mjs --real --baseline --mobile
node scripts/compare-public-media-png.mjs BASELINE_ARTIFACTS CURRENT_ARTIFACTS
```

`--real`は実ページを使う。`--baseline`は隣のmain（またはEXPORT_TEST_MAIN）を読み取り専用で使う。
派生JSONは元mainからメモリへ読み込み、画像・元データは各コードのWorktreeから読み取る。
コピー・再生成は行わない。一時サーバーは127.0.0.1限定、既存サーバーは操作しない。
架空画像はメモリ生成し、公開ディレクトリへ保存しない。

PNGとreport.jsonはOSの一時領域へ保存する。比較スクリプトはPNGを再読込して全画素を比較し、
画像URL・class・寸法・読み込み結果、共通データのハッシュも照合する。
宇都宮には保存ボタンがないため、ヘッダー・表はテストから既存renderExportCanvasを呼ぶ。
ランキング個人／チーム・比較個人／チームも同じ既存APIで確認する。保存ボタンを追加したわけではない。

第2工程で確認した結果：
- 第1工程のNodeテスト86件成功。
- 1280px／375pxで宇都宮2025-26の18行、2026-27の14行を確認。
- 通常・1Q・Shooting・復帰、seasonのA→B→A、他チームで対応表を取得しないことを確認。
- mainと接続後で、8種類×2幅のPNGは寸法一致・全画素一致。
- 2026-27等の一部試合詳細404はmainと接続後で同じ。今回の変更ではデータを補わない。
- 対応表は未登録なので、実データでの年代別画像差し替えは未検証。架空データで切り替え・404を確認する。
- iPhone実機の確認は今回行っていない。

## 次工程

1. 公開対象の実画像について、season・teamId・playerId、出典、適用期間を確認する。
2. 少数の確認済み画像・ロゴだけを独立パスへ登録し、既存752画像は上書きしない。
3. 宇都宮2シーズンで登録画像と現在画像への復帰をユーザーが確認する。
4. 保存処理は変更せず、PNG・375px／1280px・iPhoneを回帰確認する。

本工程だけで実画像登録を承認したことにはしない。他チーム・他画面への展開も別工程とする。

## 第2工程の変更ファイルと最終結果

- src/pages/TeamDetailPage.tsx：ヘッダーと共用選手行だけ接続。
- src/components/PublicMediaImage.tsx：通常のimgによる公開画像表示と現在画像への復帰。
- src/components/TeamDetailPublicMedia.tsx：宇都宮だけに適用する境界。
- src/lib/publicMediaImage.browser.test.tsx：架空画像の表示・失敗・切り替え・PNG検証。
- src/lib/publicMediaPage.browser.test.tsx：実ページと比較用PNGの生成。
- scripts/validate-public-media-browser.mjs：隔離したブラウザ検証。
- scripts/lib/chromeViewport.mjs：テスト専用Chromeの実画面幅指定。
- scripts/compare-public-media-png.mjs：変更前後の画素・画像情報・読み取りデータの比較。
- src/lib/publicMediaSelection.ts：接続済みになった旨のコメント更新のみ。
- src/lib/browserMediaCatalogLoader.ts：接続済みになった旨のコメント更新のみ。
- docs/PUBLIC_SEASON_MEDIA.md：本記録。

第1工程の元15ファイルは `/private/tmp/season-media-stage1-backup-9llahqgu/` に構造とSHA-256一覧を保全した。
Node 86件、部品ブラウザ14件×2幅、実ページ8件×2幅が成功。別途main参照版8件×2幅も成功。
型チェック・本番ビルド成功。ビルドには既存の大きなチャンクの警告がある。
allKeyはmainと同じ `b8b50cda8e69d4e17ce1f6a7358dcfe6`、code-filesは57件で一致。
既存722写真＋30ロゴのパス・SHA-256一致。PlayerPhoto／TeamLogo／保存処理／CSS／dataLayoutはmainと一致。
未ステージ・未コミット。main等の既存Worktreeには変更を加えない。

## 第3工程：自作TEST画像による実ページ検証

実際の選手写真・クラブロゴは登録しない。3選手（8589・8497・51000228）と703の
2025-26／2026-27に、文字・円・四角・三角だけのTEST画像8枚を割り当てる。
各画像は240×240のPNGで、TEST・シーズン・ID・NOT A PHOTOを表示する。
実写真の確認状態や利用許可を更新したことにはならない。

### 隔離方法

- `scripts/lib/publicMediaTrialFixtures.mjs`がOS一時領域に独立ディレクトリを新規作成する。
- `media/assets/{sha256}.png`8ファイルと`media/catalog/{season}.json`2ファイル、一覧をその中だけに置く。
- JSON構造・参照・実ファイルのSHA-256を既存検証関数で検査してから配信する。
- `validate-public-media-browser.mjs --trial`の試験用サーバーだけがこの対応表・画像を配信する。
- 本番用`public/media/`は作成しない。アプリ・Vite設定・保存処理は変更しない。
- テスト終了後は専用Chrome・専用サーバーだけを終了する。成果物は一時領域に残す。
- 以前の未コミット23ファイルは`/private/tmp/public-season-stage2-backup-3cr1cz0b/`へSHA-256照合済みで保全。

mainには別作業の未コミット変更があるため、比較用コードとCSSはmainの確定コミット
`ee877dc9326745271441cafcf684b1bd8505c402`から読み取る。
派生データはmainの既存ファイルを読み取り専用でメモリに保持し、共通入力のハッシュを照合する。
元データのコピー・再生成は行わない。

### 再実行

```sh
node --experimental-strip-types scripts/validate-public-media-browser.mjs --trial
node --experimental-strip-types scripts/validate-public-media-browser.mjs --trial --mobile
node --experimental-strip-types scripts/validate-public-media-browser.mjs --trial --baseline
node --experimental-strip-types scripts/validate-public-media-browser.mjs --trial --baseline --mobile
node scripts/compare-public-media-trial-png.mjs BASELINE_ARTIFACTS CURRENT_ARTIFACTS
node scripts/compare-public-media-png.mjs DESKTOP_ARTIFACTS MOBILE_ARTIFACTS
```

新しい実ページテストは各幅14件。通常／1Q／Shootingの3選手とヘッダーロゴの
シーズン切り替え、未登録選手の現在画像、対応表503・通信失敗、画像404、
変更直後の旧TEST画像非表示、A→B→A、古い対応表の失敗を検査する。
404は同じ画像の正常読み込みより先に発生させ、画像のerrorイベントと従来画像への復帰を待つ。
正常読み込み済みの同一URLをあとから404にしても、ブラウザが画像を再利用すると404試験にならない。

保存ボタンは追加せず、実際のTeamDetailPageのヘッダー・表を既存`renderExportCanvas`へ渡す。
生成PNGを再読込し、各TEST画像の固有色が対応する画像矩形内に含まれることを検査する。
mainとの比較では文字・数値・画像の寸法・class・PNG寸法・倍率を照合する。
差し替えた画像矩形の外は全画素一致を要求する。未登録写真もこの比較範囲に含む。
ランキング個人／チーム・比較個人／チームの4種類は画像も含め全画素一致を要求する。

### 実行結果（2026-10-17）

- Node86件、既存表示部品14件×2幅、新しい実ページ14件×2幅が成功（合計142件、再実行分は重複計上しない）。
- 別途、main参照版6件×2幅も成功。
- PNGは1幅につき12種類（宇都宮8種類＋変更対象外4種類）。1280px／375pxの両方で比較。
- 最終比較は画像矩形外0画素差。変更対象外4種類も全画素一致。375px／1280px間の12種類も全画素一致。
- 初回の375pxでは2026-27通常表の罫線交点(x=692,y=2281)だけ、RGB246対247の1画素差が発生した。
  同じコード・同じ入力で再実行すると消失。初回と再実行との差もこの1画素だけで、main参照版の反復は全画素一致。
  初回PNG・失敗記録を保全し、比較の許容値や画像範囲を広げる処置は行っていない。
  この試験では描画の微小な反復差として観測しており、全実行で厳密一致を保証したことにはしない。
- 画像以外の文字・数値・寸法・配置の変更は検出されなかった。
- 型チェック・本番ビルド成功。既存の大きなチャンクの警告あり。
- 本番ビルド9947ファイルを走査し、8画像の実バイト／ハッシュ・試験専用文字列・対応表の混入なし。
- 既存722写真＋30ロゴのパス・SHA-256すべて一致。
- allKeyは`b8b50cda8e69d4e17ce1f6a7358dcfe6`、code-files57件でmainおよび開始時と一致。
- PlayerPhoto・TeamLogo・CSS・dataLayout・保存処理・保存検証スクリプトはmainの基準コミットと一致。
- `npm run validate:export-image`は47件成功、既知のgames-summary導出データ不足による1件のみ失敗。
  データをコピー・再生成して解消していない。PNG実ページ試験は既存mainの導出データを読み取り専用で使用した。
- 高速切り替え試験の要求履歴には、別季の試合IDを含むゲーム詳細404も記録された。
  通常取得完了後のPNG比較とは区別する。試験側のみ追加の失敗・高速切替ケースを行うため、
  main参照版と要求履歴全体が同一とは扱わず、共通して読み取ったファイルのハッシュを照合する。
  統計取得・集計の既存実装には変更を加えていない。

成果物（OSの一時領域。自動削除される可能性あり）：

- 1280px：`/var/folders/t3/36p1w2r97z12716nxr1m71z00000gn/T/public-media-real-new-1280-yk5z5B/`
- 375px最終：`/var/folders/t3/36p1w2r97z12716nxr1m71z00000gn/T/public-media-real-new-375-C8XbTs/`
- 375px初回：`/var/folders/t3/36p1w2r97z12716nxr1m71z00000gn/T/public-media-real-new-375-kiRIdX/`
- main参照1280px：`/var/folders/t3/36p1w2r97z12716nxr1m71z00000gn/T/public-media-real-baseline-1280-eLHi94/`
- main参照375px最終：`/var/folders/t3/36p1w2r97z12716nxr1m71z00000gn/T/public-media-real-baseline-375-3M4Vc5/`
- 各`report.json`に入力ハッシュ・TEST画像一覧・画像位置・取得失敗・対応表要求履歴を保存。
- 各試験用画像の保存先は同レポートの`fixtureDirectory`に記載。

本工程の追加はテスト画像生成・実ページテスト・PNG比較・検証ランナー・本記録だけ。
画面本体の第2工程成果は維持する。実写真登録とiPhone実機確認は未実施。
未ステージ・未コミットで停止し、公開や他画面への拡張には進まない。

最終確認時の外部変更：mainは本作業中に`a728128ae92124a555dd6d06c092619567b741a7`
（256章・個人シーズン成績Q別等）へ進んだ。Codexの本作業ではmainを変更していない。
PNG比較基準は上記ee877dc93のまま。a728128aeの画面との画素比較は未実施で、今後の統合前に再確認が必要。
main更新後もallKey・code-files57件は本Worktreeと一致した。対象WorktreeのHEADはee877dc93のまま維持した。

## 最新mainへの選択的移植・再検証（2026-10-17）

- 新ブランチ：`codex/season-media-public-main`
- 新Worktree：`/Users/sekiguchinaoki/Downloads/10_Claude関連/bleague-stats-season-media-public-main`
- 基準：`a728128ae92124a555dd6d06c092619567b741a7`
- 手元のorigin/main参照：`ee877dc9326745271441cafcf684b1bd8505c402`。fetch・pushは実行していない。
- 旧公開画像Worktree・main・その他のWorktreeは変更しない。

### 保全と移植

旧公開画像Worktreeの未コミット26ファイルを
`/private/tmp/public-season-media-complete-backup-39_6srj1/files/`へ構造を維持して保全し、
全件のSHA-256をコピー前後で照合した。`manifest.json`に26ファイルの一覧・ハッシュ、
開始時の既存WorktreeのHEAD・未コミット内容のハッシュ・752画像のハッシュを記録。
`team-detail.patch`はTeamDetailPageの画像接続部分だけの差分。

新規25ファイルの既存パスとの重複がないこと、原本・バックアップのハッシュが一致することを
個別に検査して移植した。TeamDetailPageは上書きせず、画像接続差分だけを適用した。
直後に26ファイルすべてが保全した成果と一致することを検証した。
旧23ファイルのバックアップも維持している。

移植した26ファイル：

- shared/mediaCatalog.ts
- shared/mediaCatalogJson.ts
- shared/mediaCatalogValidation.ts
- shared/mediaExactMatch.ts
- shared/mediaResolver.ts
- src/lib/mediaCatalogLoader.ts
- src/lib/browserMediaCatalogLoader.ts
- src/lib/mediaCatalogUrls.ts
- src/lib/useMediaCatalog.ts
- src/lib/publicMediaSelection.ts
- src/components/MediaCatalogProvider.tsx
- src/components/PublicMediaImage.tsx
- src/components/TeamDetailPublicMedia.tsx
- src/pages/TeamDetailPage.tsx（画像接続差分のみ）
- scripts/lib/mediaFileValidation.ts
- scripts/validate-media.test.ts
- scripts/public-media.test.ts
- scripts/validate-public-media-browser.mjs
- scripts/lib/chromeViewport.mjs
- scripts/lib/publicMediaTrialFixtures.mjs
- scripts/compare-public-media-png.mjs
- scripts/compare-public-media-trial-png.mjs
- src/lib/publicMediaImage.browser.test.tsx
- src/lib/publicMediaPage.browser.test.tsx
- src/lib/publicMediaSeasonTrial.browser.test.tsx
- docs/PUBLIC_SEASON_MEDIA.md

移植後は、本記録と検証ランナーだけを更新し、追加検証用に
`src/lib/publicMediaMainRegression.browser.test.tsx`を新規追加した。
したがって最終成果は追跡ファイル変更1＋未追跡26＝27ファイル。
アプリ本体・台帳・表示部品への互換修正は不要だった。

依存関係の新規インストールは行わない。新Worktreeのnode_modules内で導入済みパッケージを参照し、
.cache・.vite-temp・dist等の検証生成物は新Worktree内に隔離する。

### mainから維持したもの

a728128aeの18ファイルは、mainの内容をそのまま維持する。
ランキング／個人詳細のピリオド索引によるQ別・延長、前シーズン比較、
全チームScoring %の条件連動、対応する検証・設定・設計書を保持する。
チーム詳細の計算・フィルター・列は変更しない。
保存関連13ファイル（保存API・UI・プレビュー・CSS・PlayerPhoto・TeamLogo・dataLayout等）は
最新mainと実バイト一致。私的画像・画像ガード・保存操作IDは取り込んでいない。

### 検証結果

- 既存画像関連142件成功（Node86、部品14×2幅、実ページ14×2幅）。
- 最新main参照版は別途6×2幅成功。
- 最新main向けに5件×2幅を追加し、10件成功。別途main参照版10件も成功。
  - 個人ランキング1Q、延長、1Qの前季比較
  - 選手詳細の1Q→延長
  - 全チーム得点構成の全期間／直近5試合／ホーム／プレーオフ
- 追加5件は各幅で表の値・表示文言・グラフの形状がmain参照版と完全一致。
- PNGは12種類×2幅。宇都宮の画像矩形以外は全画素一致。
  ランキング個人／チーム・比較個人／チーム4種類は全画素一致。
  375pxと1280px間の12種類も全画素一致。
- 前工程で観測した罫線の1画素差は、本工程では発生しなかった。許容幅を広げる変更なし。
- 通常・1Q・Shooting、2シーズン、未登録／対応表503／通信失敗／画像404、
  A→B→Aと古い対応表の失敗を検証。保存ボタンは追加していない。
- 型チェック成功。本番ビルド成功（既存の大きなチャンク警告あり）。
- dist9947ファイルにTEST画像8枚のハッシュ・バイト・試験用文字列／対応表／追加テストコードの混入なし。
- 既存722写真＋30ロゴは、mainと全パス・SHA-256一致。
- allKey：`b8b50cda8e69d4e17ce1f6a7358dcfe6`。全過去季の保存キーもmainと一致。
- code-files57件でmainと完全一致。今回の追加・変更ファイルは対象外。
- check-layout成功。統計データのコピー・再生成は行わない。
- validate:season-compareは64件成功。
- validate:export-imageは47件成功、games-summary導出データ不足による既知の1件だけ失敗。
  検証用データを新Worktreeへコピーして失敗を隠していない。
- git diff --check成功、ステージ済みファイルなし。

追加表示テストの実行：

```sh
node --experimental-strip-types scripts/validate-public-media-browser.mjs --main-regression
node --experimental-strip-types scripts/validate-public-media-browser.mjs --main-regression --mobile
node --experimental-strip-types scripts/validate-public-media-browser.mjs --main-regression --baseline
node --experimental-strip-types scripts/validate-public-media-browser.mjs --main-regression --baseline --mobile
```

### 主な成果物

- TEST実ページ1280px：`/var/folders/t3/36p1w2r97z12716nxr1m71z00000gn/T/public-media-real-new-1280-NIevQn/`
- TEST実ページ375px：`/var/folders/t3/36p1w2r97z12716nxr1m71z00000gn/T/public-media-real-new-375-yuTszY/`
- main参照1280px：`/var/folders/t3/36p1w2r97z12716nxr1m71z00000gn/T/public-media-real-baseline-1280-dCLya2/`
- main参照375px：`/var/folders/t3/36p1w2r97z12716nxr1m71z00000gn/T/public-media-real-baseline-375-uX1Yu4/`
- main追加表示1280px：`/var/folders/t3/36p1w2r97z12716nxr1m71z00000gn/T/public-media-real-new-1280-84SF9B/report.json`
- main追加表示375px：`/var/folders/t3/36p1w2r97z12716nxr1m71z00000gn/T/public-media-real-new-375-Sb5kGy/report.json`
- PNG比較結果：`/private/tmp/season-public-main-png-desktop.json`・`season-public-main-png-mobile.json`・`season-public-main-png-widths.json`

実写真は未登録。本工程は自動検証であり、ユーザーの目視確認やiPhone実機の再確認を代替しない。
既知の派生データ不足と実写真の公開利用確認は残るが、画像機能の移植による退行は検出されなかった。
mainへの統合候補としてレビューできる状態。未ステージ・未コミットで停止し、merge・push・公開は行わない。

## 最終レビュー：指定4件のみの修正（2026-10-17）

変更前27ファイルを`/private/tmp/public-season-media-review-backup-2g9v3f6_/files/`へ保全し、
全件SHA-256を照合した。既存の外部バックアップ・元Worktreeは変更しない。

1. `shared/mediaResolver.ts`：チーム別でplayerId・season・teamId等が厳密一致する適格画像が1件だけなら、
   適用期間を保持して日付なしでも採用する。複数候補は従来画像へ戻す。試合表示の日付必須条件は変更しない。
2. `src/components/PublicMediaImage.tsx`：読み込み中は写真／ロゴと同じclass・寸法の空spanを表示する。
   現在画像への要求を始めず、読了後の未登録・通信失敗は既存画像へ戻す。未対応IDは従来PlayerPhoto／TeamLogoを再利用し、既存のURL・取得失敗時の挙動を維持する。
3. `src/components/TeamDetailPublicMedia.tsx`と`src/lib/useMediaCatalog.ts`：Providerを常に同じ位置へ置く。
   宇都宮だけseasonを指定し、他チームは空配列でidle、HTTP取得なし。チーム間の切替で親の種類を変えず、子のローカル状態を保つ。
4. テスト：`scripts/public-media.test.ts`、`src/lib/publicMediaImage.browser.test.tsx`、
   `scripts/lib/publicMediaTrialFixtures.mjs`を更新した。TEST画像の全8bindingに期間を付け、実ページでも単独期間画像の表示を検証する。

アプリ本体側の修正は上記4ファイルのみ。その他はテスト3ファイルと本記録の計8ファイル。
保存処理・PlayerPhoto・TeamLogo・TeamDetailPage・CSS・dataLayout・統計データには追加変更なし。

結果：

- 旧142件を新仕様へ整合させ、追加分込み153件が成功（Node89、部品18×2幅、実ページ14×2幅）。
- A→B→Aの旧テストが未解決の要求中にも現在画像が出ることを待っていたため、空枠を待つ形へ更新した。
  古い成功／errorを無視する検証は維持し、再実行後は両幅で18件すべて成功。
- 回帰内容：単独期間／複数期間、ID・季・所属の厳密一致、未確認の拒否、読込中の空枠と同寸配置、
  season変更直後の旧画像・現在画像非表示、宇都宮↔他チームで子タブを保持し他チームでは取得なし、特殊文字IDの従来表示。
- 実画像未登録の実ページを別途8件×2幅で検証（main参照版も同数成功）。
  宇都宮2025-26の18行、2026-27の14行、通常／1Q／Shootingと復帰、他チームの従来画像を確認。
- 未登録時PNG8種類×2幅はmainと全画素一致。TEST画像PNG12種類×2幅は画像矩形以外0画素差。
  変更対象外のランキング・比較4種類も全画素一致。今回1画素差は発生していない。
- 型チェック・本番ビルド成功（既存の大きなチャンク警告のみ）。
- allKeyは`b8b50cda8e69d4e17ce1f6a7358dcfe6`、code-files57件でmainと一致。
- 実写真は登録していない。ユーザーの目視・実機再確認を代替するものではない。

成果物：

- 未登録1280px：`/var/folders/t3/36p1w2r97z12716nxr1m71z00000gn/T/public-media-real-new-1280-pNfF02/`
- 未登録375px：`/var/folders/t3/36p1w2r97z12716nxr1m71z00000gn/T/public-media-real-new-375-9N4Rx8/`
- 期間TEST1280px：`/var/folders/t3/36p1w2r97z12716nxr1m71z00000gn/T/public-media-real-new-1280-d4xZYD/`
- 期間TEST375px：`/var/folders/t3/36p1w2r97z12716nxr1m71z00000gn/T/public-media-real-new-375-OCQvuZ/`
- 比較結果：`/private/tmp/public-media-review-unregistered-{1280,375}.json`・`public-media-review-trial-{1280,375}.json`

未ステージ・未コミットのまま停止する。mainへの反映・公開は行わない。
