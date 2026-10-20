# bleague-stats

B.LEAGUE（B.PREMIER優先）の個人用スタッツサイト。設計と各機能の経緯は`docs/DESIGN.md`に
章番号付きで記録している（全体で約1万行あるため、作業に関係する章を章番号やキーワードで
検索して読む。下の各項目の「設計書N章」はこのファイルの章番号）

## 設計書の主な章（`docs/DESIGN.md`）

- 2章: データソース（bleague.jp JSON API）とスクレイピングの制約
- 5章: データモデル（保存するJSONの構造）
- 8章: 自動更新フロー（GitHub Actions）。8-5 30分チェックと深夜実行／8-6 外部cron起動／
  8-7 深夜の問い合わせ対象の絞り込み／8-8 取り込み開始はティップオフ+2時間（時刻未定は13:00開始とみなす）／
  8-9 問い合わせの待ち時間の上限・再試行と、取得の失敗で取り込みを止めない形、30分おきの日程の取得は当日・前日だけ
  （14日分の見直しは深夜だけ）で、当日のページに載った試合の試合日のずれはその場で直す
- 16章: 新競技規則（2026-27先行適用）とファウル種別コード。16-7 公式の記録が新表記（ActionCD1=91〜94。旧24→91/92、旧25→93/94）へ移行した対応（`shared/foulCodes.ts`） 16-8 ファウルの列の分け方（2026-27以降だけの表はTF1・TF2・FLAG・DISR、2025-26以前を含む表はUFOUL・TFの合計。`src/lib/ruleChange.ts`の`foulColumnsSplit`）
- 216章: 移籍した選手の分母（USG%・%-share・ORtg/DRtg・PER）は、条件の有無によらず「所属期間ごとの、所属した各チームの合計」（`shared/transferredTeamTotals.ts`。集計と画面で同じ関数）
- 35章・38章・129章: スポーツナビ（Yahoo PBP）の取得・UI反映・2026-27対応
- 51章・101章: シーズン別ロースター・選手マスタ（ポジション・身長体重の扱い）
- 52章・84章: 外国籍選手の同時出場人数（オンザコート）
- 94章: 登録区分（3区分への統一、帰化選手の扱い）
- 87章・88章・89章・127章・128章・229章: 順位表（同率タイブレーク・ワイルドカード・マジックナンバー・
  ポストシーズン名称。229章: 直接対決は行われた試合だけで使う・ワイルドカード順位はプールだけで判定し直す〔`wildcardRank`、読む側は `wildcardRank ?? rank`〕・
  全体順位は公式でない参考の並び・条件別順位表の「条件なし」は順位表の全体順位と同じ並び。タイブレークは `shared/standingsRank.ts`、検証は `npm run validate:standings-tiebreak`）
- 95章・99章: 選択中の条件のタイトル・画像ファイル名への反映
- 105章: フィルタUI（NBA Stats型）。105-15・105-17 画像出力
- 143章: クォーター別・前後半別の記録と1試合平均。143-3 順位の付け方（同じ値は同じ順位・次は飛ばす）、
  143-4 歴代記録の順位のバッチ（`aggregate-league-rankings.ts`・`aggregate-league-player-rankings.ts`。206章以降はデプロイのときに作る）
- 212章: 延長戦のPBPの並び（時系列に並べ直す共通関数。読み込みの出口で適用）。213〜215章: ランキングの拡張（地区の絞り込み・方針）と、ルーキーの判定（選手ページの所属履歴の取得・規程 第5条〔新人選手〕に準じた判定・検証）。**海外のプロ経験がある選手は `shared/rookieOverseasExceptions.ts` の例外の一覧でルーキーから外す**（215-8章。NCAAは海外リーグに数えない。確認済みの一覧・毎シーズンの候補は `validate:rookie-eligibility`。キー不変）。217章: ルーキーの絞り込み（登録区分の4つ目の選択肢。ランキングのシーズン成績・全選手スタッツ。`cls=rookie`、`src/lib/rookieFilter.ts`）。218章: ランキング（シーズン成績）の前シーズン比較（`cmp=1`。前季の値・順位・差。集計は `usePlayerSeasonRanking`・`useTeamSeasonRanking` を前季にも使う。スタッツの条件・ルーキーは今季だけ。`src/lib/seasonCompare.ts`）
- 219章: 試合ログの土台（延長の本数 `overtimes`・選手の最終点差 `finalMargin`。古いデータには無いので `src/lib/gameFacts.ts` を通して読む）と、1試合行の索引（`data/{season}/player-game-index.json.gz`・`team-game-index.json.gz`。
  形式は `shared/gameIndex.ts`、読む部品は `src/lib/gameIndex.ts`・`gameIndexLoad.ts`。ルーキーは索引に無く `rookie-eligibility.json` と突き合わせる。検証は `npm run validate:game-index`）。
  段階4でポジションを出すときは、補った値に既存どおり「＊」（`profileMark.ts`）
- 220章: ランキングの1試合記録の条件（段階4。**画面だけの変更でキー不変**）。条件なし（かつ上位20位のファイルで出せる表示）は今のファイルのまま、条件・ルーキー・ポジション・スタッツの条件・個人のワースト・前後半5分の特別試合を除く指定のときだけ索引を読む。
  集計は `src/lib/gameRecordQuery.ts`（純粋な部分）、条件・URLは `gameRecordConditions.ts`（`res`・`ven`・`opp`・`ot`・`fm`・`mg`・`dv`・`div`・`sp`）。昇順（少ない方から並べる）は特別な試合4試合を既定で除く。
  個人のワーストは成功率6項目＋EFF・+/-（少ない順）とTOV（多い順）だけ。同率の展開は全体で最大100行。検証は `npm run validate:game-record-query`
- 221章: 得点の流れ（`shared/gameFlow.ts`。最大のラン・勝ち越し弾・同点弾・決勝弾。**PBPの得点イベントは、同じ秒の並びの逆転があるので、必ずこの関数の中の補正〔累計得点の昇順〕を通す**。`pbpOrder.ts` は変えない）、
  アシストペアの試合ごとの行（`data/{season}/assist-pairs.json.gz`、`shared/assistPairs.ts`。並びはIDの昇順に固定）、索引の新しい列（選手: アシストされた得点・勝負所18列／チーム: 最大のラン5列）、
  上位20位のファイル（個人の2つ）を作る元は索引（行を戻す部分は `shared/gameIndexRead.ts`。保存キーの対象）、2016-17のPTSOFFTOはタグの表記違い（「ポイントフロムターンオーバ」）を数えて算出できる、
  ランキングの新しい種類「勝負所」「アシストペア」（`src/lib/clutchQuery.ts`）と被アシスト率（%PTS ASTED。1試合は20点以上・通算は1,000点以上）。検証は `npm run validate:game-flow`・`validate:clutch-query`
- 222章: 段階5の確認後の修正。前季比較の差は MIN を時間（+3:15）、％を「+1.7%」で出す。「決勝点」は **「決勝弾」**（勝ち越し弾・同点弾とそろえた）。個人ランキングの **「現役」**（今季のB.PREMIERの名簿の選手。`act=1`、`src/lib/activePlayers.ts`。通算記録・歴代の1試合記録・勝負所の通算・アシストペアの1試合と通算だけ。
  通算記録は `league-player-career-top.json` の `byActive`）。アシストペアの初期表示はシーズン。検証は `npm run validate:active-filter`。選手名の表記: 単一のシーズンの表はそのシーズンの表記、複数のシーズンをまたぐ表は選手マスタの今の登録名、空白は半角1つにそろえる（`shared/playerName.ts`、`src/lib/currentPlayerNames.ts`。`validate:player-names`）
- 223章: ランキング > 個人 > **「達成記録」**（`k=thr`。**索引だけ・画面だけの変更でキー不変**。`src/lib/thresholdQuery.ts`・`thresholdParams.ts`、`PlayerThresholdRanking.tsx`）。「項目がしきい値以上（以下）の試合」を共通の条件にして、達成試合数（`tu=count`。通算・シーズン、達成率の並びの掲載基準は通算＝出場100試合以上〈ポストシーズンは20試合以上〉・シーズン＝所属チームの試合数の85%）・
  連続記録（`tu=streak`。条件に当てはまる試合だけを順に見て続いた試合数。レギュラーとポストシーズンは別。B.PREMIERの名簿外のシーズンをはさむと途切れる〔`player-careers.json` の seasons〕。1選手1行・継続中・`cur=1`）・達成時の年齢（`tu=age`。最年少＝初めて達成、最年長＝最後に達成）。
  しきい値は1試合記録のスタッツの条件（`sc`・`sm`）の流用に「2桁の部門数」（ダブルダブル2・トリプルダブル3）を足したもの。前後半5分の特別試合は既定で数えない（`sp=1`）。シュート単位の連続（FT・3Pの連続成功）は、段階3（在コート基準）の作り直しと同じpushにまとめる（保存キー対象の変更が要るのは段階3だけ。224-7章）。検証は `npm run validate:threshold-query`
- 224章: ランキング > 個人 > **「On/Off・組み合わせ」**（`k=lu`。**画面だけの変更でキー不変**。`src/lib/lineupRanking.ts`・`lineupParams.ts`・`useLineupData.ts`、`PlayerLineupRanking.tsx`）。選手のOn/Off差（出場中と、その選手が出場した試合の不在時の NetRtg・ORtg・DRtg）・同じチームの2人・3人のNetRtg（`lt=onoff|duo|trio`、指標 `lm`、範囲 `lr`〔シーズン／通算〕）。
  チーム詳細のラインナップ検索と同じ数え方で、チームの出場区間（`team-stints`。2020-21以降。2016-17〜2019-20は理由つきで選べない）を**画面で計算**する。**計算の核は `shared/onCourtTotals.ts`**（選手が出ている間の自チーム・相手の数え上げの合計。段階3で集計から import できる形。いまは集計から読まれないのでキー対象外）。
  1選手×1チームで1行（移籍した選手はチームごと）、組み合わせは「組の全員が当てはまる」登録区分・ポジション・現役・ルーキー。下限＝max(100ポゼッション, チームの全ポゼッション×割合〔On/Off 15%・組み合わせ5%、スライダー〕)。個人詳細のオンコート/オフコートとは別の数え方（値が違うことがある。段階3の課題）。検証は `npm run validate:lineup-ranking`
- 225章: ランキング > 個人 > 1試合記録の **Q別・前後半・延長**（URL `q`。`shared/periodIndex.ts` の導出データ `player-period-index.json.gz`・`team-period-index.json.gz`。**作成は保存キーの対象**〔`scripts/aggregate-period-index.ts`・`scripts/lib/periodIndexBuild.ts`・`shared/periodIndex.ts`。形式は変えない〕、読む側・画面は `src/lib/periodIndex.ts`・`gameRecordPeriod.ts` で対象外）。
  値はシーズン成績のQ別と同じ関数（`buildPlayerBoxscores` 等）で作る。1Q〜4Q・延長の5区間だけ持ち、前半・後半は足す（チームのポゼッションだけは別に持つ）。ワースト・被アシスト率は区間では選べない。+/- は公式のQ別の値がある2022-23以降だけ。前後半5分の特別な試合は区間の行を持たない。
  **シーズン成績のQ別を導出データに切り替える**画面の差し替え（データはそろえてある）は別の段階。検証は `npm run validate:period-index`
- 226章: カテゴリタブ **Periods**（`CATEGORY_LABELS.periods`）: 全チームスタッツ（`tab=periods`）・チーム詳細のシーズン別成績／シチュエーション別成績・日程結果のラインスコア。**画面だけの変更でキー不変**。値は `TeamGameLog` の `periodPoints`（1Q〜4Q）で、延長は「試合の得点−4Qまでの合計」（`src/lib/teamPeriodScoring.ts`。`team-period-index` は検証の突き合わせ先）。
  1Q〜4Q・前半・後半・OT（平均は延長のあった試合だけで割る。OT G）、視点＝自チーム（得点）／opp（失点）／+/-。日程結果は「自チーム-相手」、延長は2延長以上の試合が表示中にあれば OT1・OT2…、無ければ「OT」。前後半5分の特別な試合は区間の列から除く。検証は `npm run validate:team-period-scoring`
- 227章: 軽い修正のまとめ。時間は「分:秒」（MINの入力は「20」「20:15」「20.5」）、日程ページ（開いたとき今日の位置・中止の試合は灰色の「中止」バッジ）、
  中止になった試合は公式の日程の「試合中止」のカード（リンクなし）を検出して `schedule.json` の `cancelledGames` に移す（`scripts/lib/scheduleCancelled.ts`。`npm run validate:schedule-cancelled`）。型は保存キー対象外の `shared/scheduleCancelled.ts`
- 228章: **結果だけの試合**（ボックススコアが公式に無い試合・不戦勝／不戦敗。`schedule.json` の `resultOnlyGames`、型は `shared/resultOnlyGames.ts`）。**勝敗・得失点・順位（teams.json の wins/losses・順位表・星取り表・勝敗表・日程・条件別順位表）にだけ数え、スタッツ・試合ログ・ランキング・記録には入れない**
  （`gamesPlayed` は変えない。勝敗の試合数＝勝＋敗とスタッツの試合数が1試合違うチーム・シーズンは、ヘッダーに「（スタッツは59試合）」、勝敗の横に「※」、`ResultOnlyNote` の注記）。
  不戦勝は日程のカード（リンクなし・「不戦勝／不戦敗」）から、ボックススコアなしは「試合日から7日たっても生データが無く、試合ページに得点がある」試合から、夜間・フル収集・`--check-stale` で自動で載る。生データが取り込まれたら外れる。
  勝敗・得失点を計算する画面を足すときは、試合ログだけでなく結果だけの試合（`src/lib/resultOnlyGames.ts`）も足すか判断する。公式の順位表との突き合わせ（勝敗・得失点に加えて地区順位・ワイルドカード順位。229章）は `node --experimental-strip-types scripts/verify-official-standings.ts`（手で実行）。検証は `npm run validate:result-only-games`
- 230章: 試合詳細ページの選手の並び（出場交代・ボックススコア・シューティングで共通。スタメン上固定・出場時間の長い順・同じなら元の並び・出場なしは末尾。`src/lib/boxscoreOrder.ts`。**画面だけの変更でキー不変**）
- 231章: **STOCKS（STL＋BLK）**。読むとき足して出す（保存する列は増やさない）。Traditional の BLK の右。個人のシーズン表（`SEASON_TRADITIONAL_COLUMNS`）・試合のボックススコア・全選手スタッツ・チーム・ランキング（シーズン成績・1試合記録・通算）・記録タブ・キャリアハイ・比較・達成記録・用語集。`PLAYER_GAME_RECORD_STATS` に足したので**全シーズンの作り直しが1回**。ゲームリーダー・ホームのリーダー・ヘッダーのタイルには入れない
- 232章: 試合詳細のキースタッツ。新カード「テンポと効率」（ORtg は対向バー1行、POSS・PACE は試合全体の値として数値だけで1行。DRtg・NetRtg は推定式では ORtg の言い換えなので出さない。値はボックススコアの Advanced の合計行と同じ推定式で、実際のポゼッションは使わない。延長は POSS が延長分を含み PACE は40分換算）。**キースタッツの TOV% は標準式（TOV÷(FGA+0.44FTA+TOV)）に統一**（以前は TO÷POSS）。Four Factors のラベルは OREB%・FT Rate。**画面だけの変更でキー不変**
- 233章: **チームの表の Scoring**（チーム詳細の比較・日程結果・シチュエーション別成績、比較ページのチーム）。%3PM・%3PA・%2PM・%2PA は「FGAに占める割合」（全チームスタッツ・ランキングと同じ式）、%PTS・%FGM・%FGA・%FTM・%FTA は列ごと外す（チームでは常に100%）。差し替えは `src/lib/teamBoxscoreColumns.ts` の `teamBoxscoreColumnsFor`（`BoxscoreTable.tsx` の列定義は変えない。試合詳細のボックススコアは今のまま）。**画面だけの変更でキー不変**
- 234章: **比較の表**（比較ページ・チーム詳細・個人詳細の比較タブで共通の `ComparisonTable`）。比べているすべての対象で値が「-」の項目は行ごと出さない（片方にだけ値があれば残す。`defsWithAnyValue`）。G の横に勝敗（「6（3-3）」。G と同じ試合の勝敗で、結果だけの試合 `resultOnlyGames` は入らない。`ComparisonStatDef.suffix`で、強調の判定には使わない）。値の列は中央寄せ。検証は `npm run validate:compare-table`。**画面だけの変更でキー不変**
- 235章: **比較に足した項目**（チーム: Advanced の FTR・OR%〔強調あり〕、Misc の BENCH／STARTER PTS・日本人／外国籍・帰化・アジア PTS、Scoring の PITP%・FBP%・2ND PTS%・PTSOFFTO%・%BENCH／%STARTER／%日本人／%外国籍等 PTS・%PAINT2M〜%MID2A・%3P・%PoutP・%FT・%OPA〔%PinP・%IPA は PITP%・%PAINT2A と同じ値なので236章で外した〕。個人: FTR・DD2・TD3）。チームは試合ログの合計（`sumTeamGameLogs`）を**全チームスタッツと同じ列の式**に渡して出す（`compareShared.ts` の `teamLogTotalsDefs`。選手マスタは読まない。リーグ平均は `teamTotalsFromBoxTotals`、ベンチ得点・登録区分別は「-」）。結果だけの試合を公式の勝敗に含むチーム・シーズンは G の勝敗の横に「※」（`resultOnlyCompareNote`）。**画面だけの変更でキー不変**
- 236章: **同じ値の項目は1つの名前にまとめる**。%PinP→PITP%、%IPA→%PAINT2A（チーム詳細のシーズン別成績・比較から外した。値は全シーズンで一致を確認、URL・保存状態に旧名は残っていない）。名前の決め方は「作業の心得」の項目名の方針。名前だけが違う同じ値の項目の洗い出し（得点／PTS・REB／TR・ORB%／OR%／OREB% など）は一覧を報告済みで、統一は決定待ち。**画面だけの変更でキー不変**
- 237章: **項目名の統一（段階1）**。項目ごとに「略称」と「日本語名」を1組決め、`src/lib/statNames.ts` の `STAT_NAMES` 1か所から使う（略称＝表の列の見出し・比較の行・キースタッツ・タイル。日本語名＝ランキングのタイトルと項目の選択・記録タブのカード・用語集の見出し〔略称を括弧で併記〕・ツールチップ・保存画像のタイトル）。
  旧い別表記（REB・TO・PF・OREB%・Usage%・NETRtg・oppPTS …）は `STAT_ALIASES`。**保存キーの対象のファイルは書き換えず、検証 `npm run validate:stat-names` で列の定義との一致を保証する**。**画面だけの変更でキー不変**
- 238章: **チーム比較のテンポ（POSS・PACE）は強調しない**。POSS の列に比較用の値が無く、全対象が0＝同値として先頭の列が強調されていた不具合を機に、テンポは多いほうが良いものではないので POSS・PACE とも強調しないことにした
  （`compareShared.ts` の `COMPARE_NO_HIGHLIGHT` に `poss`・`pace`。個人の比較の PACE も強調しなくなる）。+/- の視点では POSS・PACE とも「-」にして行ごと出さない（`TEAM_COMPARE_NO_DIFF`）。
  `validate:compare-table` に、強調する項目の値が表の値と同じ大小であること・POSS/PACE の扱いの確認を足した。**画面だけの変更でキー不変**
- 239章: **保存画像の共通の型**（段階2。ランキング13か所・比較2か所。**画面だけの変更でキー不変**）。背景は常に白（複製側の `data-theme` をライトに固定）・上端にブレックスの紺の帯・見出し中央揃え・余白32px・幅は種類ごとに固定・3倍。
  フッターは左「データの基準日：YYYY/MM/DD時点」（`src/lib/dataBaseDate.ts`。表の試合区分で終わった試合の最新日。歴代は最新シーズン）・右アカウント名。ランキングの保存のとき「写真／ロゴ あり・なし」「上位20名・10名」を選べる（`ExportImageButton`・`RankedList` の `exportTeam`・`exportKeepSub`）。
  大見出しは「{シーズン}シーズン {項目}ランキング」・比較は「A vs B」（`ConditionTitle` は半角スペースでだけ折り返す）。比較の項目名は保存画像で略称の下に日本語名。スマホのPC表記・PC幅での保存は段階3。アシストペア・組み合わせの名前は「・」と空白でだけ折り返す（行数で切らない。`breakAtDot`）。保存画像の注記は長い画面だけ要点に縮める（`.export-hide`＝画面だけ・`.export-only`＝保存画像だけ）。検証は `npm run validate:export-image`
- 240章: **ランキング・比較の画面を保存画像の型にそろえる**（段階2の続き。**画面だけの変更でキー不変**）。画像として保存する範囲は `ExportTarget`（`src/components/ExportTarget.tsx`）で包む（PC幅は `.export-wide`＝保存画像と同じ文字の大きさ・列の幅。表の下に基準日。`BaseDateSpec`＝`exportFormat.ts`）。
  CSS は `.export-wide`（画面と保存画像で共通の型）と `.export-rendering`（画像だけ: 帯・余白・白い背景・アカウント名・幅の固定・注記の要点・写真なし／上位10名）に分け、画面では帯・アカウント名を出さない。
  チームカラーの線は `--team-color` で渡し、ダークは白を混ぜて明るくする。比較のロゴ・写真・所属チーム名は比較ページの画面にも出す。項目名の下の日本語名は比較ページ・チーム詳細・個人詳細の比較タブ（`jaNames`）。保存画像を比べるときは、html2canvas が文字の基準線を画面の文書の高さの端数で丸める点に注意（240-3章）
- 241章: **スマホ幅から保存してもPC表記・PC幅の画像**（保存画像の段階3。**画面だけの変更でキー不変**）。保存の間だけ `useMediaQuery` が広い画面（1280px）の答えを返し（`withForcedViewportWidth`・`useMediaQuery.ts`。画面の描き直しと html2canvas の複製と元に戻すまでを1つの同期処理で行い、広い表記は画面に描かれない）、
  html2canvas の `windowWidth` も 1280px にする（`lib/exportImage.ts`）。iPhone・iPad だけ、canvas の面積の上限（16,777,216）に収まるよう倍率を自動で下げ（`fitExportScale`）、共有シート（`navigator.share`）で「写真に保存」できる。パソコン・Android はダウンロードのまま。
  **`useMediaQuery` の外（`window.innerWidth` など）で画面幅を見る処理を保存の枠の中の部品に足さない**（保存の画像だけ表記が崩れる）。html2canvas を上げるときは、スマホ幅から保存した画像が崩れないかを確かめる（241-2章）
- 242章: **iPhone・iPad の保存は2回押す**（1回目で画像を作り、2回目の「写真に保存」で共有シート。共有の結果は待たない〔iOS では返らないことがあり「出力中...」のまま止まった〕）。
  画像を作る段階（基準日・複製・描画・PNG化）は時間の上限30秒で、超えた・失敗したときは止まった段階つきのエラーを出し、残った html2canvas の iframe を外す（`runWithinDeadline`・`prepareExportImage`）。**画面だけの変更でキー不変**
- 243章: **保存の調べるための記録**。URL に `debug=export` があるときだけ、画面の下に保存の処理の記録（段階・経過時間・端末の判定・寸法と倍率・経路・エラー・終わった理由）を出す（`exportDebugLog.ts`・`ExportDebugPanel.tsx`。ページが読み込み直されても localStorage に残る）。ボタンの文字は段階ごと（「表を複製中…」など）。**画面だけの変更でキー不変**
- 244章: **エラーの文・「写真に保存」の案内は目立たせて画面の中ほどへ寄せる**（ボタンの下の小さな1行が記録の枠の下に隠れていた）。原因を絞る試し方（debug=export と一緒のときだけ。247章で `exp=keepimg` だけを残した）と、写し取った側（html2canvas の iframe）の待ちの様子の記録。**画面だけの変更でキー不変**
- 245章: **保存のときは <img> を写し取らず、写し取ったあと（onclone）で同じ位置に戻す**（iPhone では写し取った iframe の中の <img> が load を引き止め、html2canvas が先へ進まなかった）。戻す <img> には画面の naturalWidth・naturalHeight を持たせ、絵は html2canvas が読み込み直す（描き方は前と同じ）。保存の枠の中の部品の構造を変えるときは、`planImageSlots` の位置のたどり方（html2canvas の写し取りの決まり）に合うかを、保存画像の比較で確かめる。**画面だけの変更でキー不変**
- 246章: **iPhone・iPad の保存は、できた画像を画面いっぱいに出す**（`ExportImagePreview.tsx`。「写真に保存」〔押した処理の中で共有シート〕・「閉じる」・長押しで「"写真"に追加」の案内。長い画像は表示の中でスクロール。閉じても画面は保存前のまま）。パソコン・Android はダウンロードのまま。**画面だけの変更でキー不変**
- 247章: 画像の表示の「写真に保存」「閉じる」と長押しの案内は**画面の下に固定**（画像の範囲と重ならない・下端は最低34px空ける）。試し方は `keepimg` だけ残した。**画面だけの変更でキー不変**
- 248章: ランキング（シーズン成績）の個人・チームで、表示が「平均」のとき**割った試合数**（「6試合」）を**名前の下の行**に添える（個人は「チーム・ポジション・6試合・Rookie」、チームは「7試合」だけ。写真なしの保存画像は名前の横。`RankedList` の `gamesOf`、チームの列の `Column.scalesWithGames`。割合・DD2/TD3・合計・強制ターンオーバーは添えない）。**画面だけの変更でキー不変**
- 249章: ランキング（個人・シーズン成績）の掲載基準に「◯%以上達成可能」のチェック（`ach=1`）。達成可能＝（今の出場試合数＋チームの残り試合数）÷（チームの今までの試合数＋残り試合数）が出場率以上。残り試合数は `playoff-race.json` の `remaining`（終わったシーズンは今の掲載基準と同じ結果）。タイトルの下の行は指定したときだけ「出場率85%以上達成可能」。**画面だけの変更でキー不変**
- 250章: 比較の表は、試投数（FGA・2PA・3PA・FTA・PAINT2A・MID2A）と内訳・構成比（%3PA・PITP%・BENCH PTS・%3P 等）も**多いほうを塗る**（opp は反転）。塗らないのは POSS・PACE・チームの MIN・G（`compareShared.ts` の `COMPARE_NO_HIGHLIGHT`）。**画面だけの変更でキー不変**
- 251章: 順位表の列「**対戦相手の強さ**」（これまでに対戦した相手の今季の勝率を対戦試合数で重み付けした平均と、リーグ内の順位）。結果だけの試合も含む。「直近成績」の「対戦相手の加重平均勝率」（試合時点の勝率の単純平均）とは別の計算。`src/lib/opponentStrength.ts`・`npm run validate:opponent-strength`。**画面だけの変更でキー不変**
- 252章: クラブの複数選択の表示（日程・星取り表・条件別順位表の「対象クラブ」、全選手スタッツの「クラブ」。ボタン・チップ・タイトルの下の行）は、地区のクラブが全部選ばれていれば「東地区」、ほとんどなら「東地区（群馬を除く）」、個別は「東地区、広島」。`summarizeClubSelection`（`divisionGroups.ts`）・`clubSelectionLabels`・`npm run validate:club-selection`。クラブの複数選択を足すときはこの関数を通す。**画面だけの変更でキー不変**
- 253章: **公式データで選手IDか氏名が空の選手の行**（5858の三河 #22・505621の神戸 #1。生データ・集計は直さない。集計は選手IDが空の行を数えないので個人スタッツに入らず、チーム合計とずれる）は、試合を読み込む `fetchGame` で仮の名前「#22（氏名不明）」・仮のID（`unknown-…`。`src/lib/unknownPlayer.ts`）を付けて画面に出す（リンク・写真なし）。誰か分かった行は `shared/boxscoreNameFills.ts` の一覧（5858の三河 #22＝セドリック・シモンズ）でその選手として出す（集計からは読まない。個人スタッツには入らない。集計にも入れると全過去シーズンの作り直しが起きる。253-4章）。試合詳細などのページは `PageErrorBoundary` で包み、想定外のエラーでもアプリ全体は白くならない。**画面だけの変更でキー不変**
- 277章: **出場していない選手の行に成績が付いている試合**（2016-17 の試合ID 101。DNP の選手9人にPF1。**公式記録の誤りとして記録・生データは直さない・見張りの一覧には入れない**）。players.json の PF が試合ログより1多い原因（集計は出場時間0の行の成績も足す。「出場時間0の行は数えない」への直しは、次に作り直しが起きる作業のときにまとめる候補。273-6章）。`npm run validate:dnp-rows` が、全試合の生データでこの種の行を探す（許可済みの例外は `scripts/validate-dnp-rows.ts` の `ALLOWED`＝この1試合だけ。新しく見つかったら失敗。例外を増やすときは277章に記録）。**画面・保存キーは変えていない**
- 256章: **Q別・前後半・延長の集計の土台**（延長の追加・全チームの表の区間別・On-Court Foreign と Scoring % の絞り込み）。決定（延長はまとめる・分母は延長に出た／あった試合・掲載基準3試合・OC 0〜OC 4）と段階。段階0（個人のシーズン成績Q別を索引〔`src/lib/seasonPeriod.ts`〕に切り替え＋延長、Scoring % の絞り込み）は**キー不変**。キーが変わる変更は段階1の1回のpushにまとめる。検証は `npm run validate:season-period`。段階3の画面（On-Court Foreign の絞り込み・opp・区間と表、Scoring % の区間、チーム詳細のオンザコート別の合計の試合区分・区間・1試合平均。`src/lib/teamForeignCourt.ts`）は256-9章・**キー不変**・`npm run validate:team-foreign-court`
- 257章: **シーズン別の写真・ロゴ**（Codex 作を統合。宇都宮のチーム詳細のヘッダーのロゴと選手表だけ）。対応表 `public/media/catalog/{season}.json`・画像 `public/media/assets/`（`data/` の外なので**登録してもキー不変**）。未登録・失敗は今の写真・ロゴに戻す。対応表を置いていないシーズンは取りに行かない（`vite.config.ts` の `__MEDIA_CATALOG_SEASONS__`・`hasMediaCatalog`）。写真はまだ未登録、登録の道具も未作成。**チーム詳細（`TeamDetailPage.tsx`）は Claude Code の担当**（Codex の保存ガードは採用しない）。**画面だけの変更でキー不変**
- 259章: チーム詳細ラインナップタブの**5人組の表を条件（試合区分・区間・合計／平均）に連動**させる（2020-21以降は出場区間〔team-stints〕から足し直す。2019-20以前は5人組の表だけ合算・試合全体で固定）。「よく使われる」の時間の基準は区間の長さに比例（`lineupMinAvgSeconds`）、試合数は条件に合うチームの試合数の15%。`src/lib/lineupsByCondition.ts`・`npm run validate:lineups-by-condition`。**画面だけの変更でキー不変**
- 260章: クラブレコードの**最多連勝・最多連敗のトップ10**（シーズン内・2連以上・長さごとに1行で「他◯回」・続いている連続は「継続中」。連敗はレギュラーシーズンだけで、進行中のシーズンも対象）。`src/lib/streakRecords.ts`・`StreakRecordCard.tsx`・`npm run validate:streak-records`。シーズン記録のワースト（最少勝利数・最多敗戦数・最低勝率）は、終わったシーズンだけ（`src/lib/regularSeasonComplete.ts`）。**画面だけの変更でキー不変**
- 261章: **順位表の「最多連勝」「最多連敗」の列**と、チームスタッツのカテゴリタブ**「Streaks」**（各チーム・各シーズンの最長の連勝・連敗、期間、ホーム・アウェー別）。クラブレコード・順位表・勝敗表・Streaks は同じ部品（`streakRecords.ts` の `seasonStreakSummary` など）。**結果だけの試合（不戦勝など）も連勝・連敗に数え**、含む連続には注釈。カテゴリタブの名前は保存キーの対象の `categoryLabels.ts` を触らず `streaksTab.ts` に置く。262章: チーム詳細 > チームスタッツのカテゴリタブにも「Streaks」（そのクラブの全シーズンの表と、選んだシーズンの2連以上の連勝・連敗の一覧）。**画面だけの変更でキー不変**
- 263章: チームの %3PM・%2PM の分母を FGM に（3PM÷FGM・2PM÷FGM。%3PA・%2PA は FGA のまま。選手の %3PM〔個人÷チーム全体〕は別の指標）。**画面だけの変更でキー不変**
- 264章: ランキング（個人・シーズン成績）の割合の項目の右隣に**関連スタッツ**（3P% なら 3PM・3PA。PC幅は列、スマホ幅は名前の下の行の末尾。平均／合計に連動）。`src/lib/rankingRelatedStats.ts`・`RankedList` の `related`・`npm run validate:ranking-related`。割合の項目を足すときは対応表（`RELATED_BY_KEY`）も足すか判断する。**画面だけの変更でキー不変**
- 265章: ランキング > チーム > 1試合記録に **Q別・前後半・延長**（URL `q`。項目は共通の一覧・「得失点差」を足す・古い `stat=q1:mostPts` は読み替え・来場者数／逆転／最大のランは区間では選べない・スタッツの条件は区間の値）。チームのピリオド別の索引を結び付ける（`src/lib/teamPeriodGames.ts`）。成功率の最低試投数は区間の長さに合わせて下げる（基準の数は決定待ち）。検証は `npm run validate:team-period-record`。**画面だけの変更でキー不変**
- 266章: 成功率の基準を成功数にそろえる（チームの1試合記録＝FG 11・2P 8・3P 4・FT 15、個人のシーズン＝FG%・2P% は1試合平均の FGM 1.5・2PM 1.0。3P%・FT% は公式の基準のまま。区間は長さに合わせて下げる）。チームの区間のワーストは選べない。**画面だけの変更でキー不変**。267章: 個人の1試合記録（ランキング・選手一覧の記録・キャリアハイ・上位20位のファイル）も成功数基準（FG 5・2P 5・3P 3・FT 8。区間は長さに合わせて下げる。`PLAYER_PCT_MIN_MADE`・`periodMinimum.ts`）。**`shared/playerGameRecords.ts` を変えたのでキーが変わる（全シーズンの作り直し1回）**
- 271章: 順位表の **「年間スケジュール」タブ**（`tab=annual`。`src/components/AnnualSchedule.tsx`・`src/lib/annualSchedule.ts`・`shared/annualSchedule.ts`）。大会日程は `data/annual-calendar.json`（元データ・保存キー対象外）。EASL は深夜ジョブが自動更新（`scripts/scrape-annual-schedule.ts`、失敗時は前回を保持して最後に失敗通知）、**天皇杯・オールスターは手で更新**（手順は271-7章）。`scripts/lib/dataLayout.ts` に登録したため導入時のデプロイで全シーズンの作り直しが1回。検証は `npm run validate:annual-schedule`
- 274章: チーム詳細 > チームスタッツ > **シーズン別成績に Q別・前後半・延長**（Traditional・Advanced・Misc・Scoring・On-Court Foreign・Scoring %。区間を選んだときだけ全在籍シーズンの索引を読む。`src/lib/teamSeasonPeriod.ts`）。**BSR＝相手のBLK・EFF は索引から出せる**ので、シチュエーション別成績の「-」も埋めた（`teamPeriodEffTotal`）。検証は `npm run validate:team-season-period`。**画面だけの変更でキー不変**
- 275章: **手入力のボックススコア**（`meta.source` が `manual:` の試合。2017-18 の1810だけ。公式に無い試合を basketballnavi の試合合計で補う。ピリオド別の行・PBP・Summaries が無いので、`periodIndexBuild.ts` は区間の値を持たず、`validate-period-index`・`validate-game-index` は `scripts/lib/manualBoxscores.ts` の一覧で除く。試合詳細に注記。保存キーが変わる）。**ピリオド別の行が無い試合はチームの区間の値がすべて -1**（Q別の画面から外れる。Periods タブは試合ログのクォーター別得点なので入る）。Forced TOV の分類は `shared/forcedTurnover.ts`。チームの索引に OFF FOUL・CHARGE（`TEAM_PERIOD_FOUL_COLUMNS`。古い索引は「-」）。PBP由来の平均・在コート系・ラインナップの時間が1810の分だけ薄まる件は「在コート基準の再集計」と一緒に扱う
- 279章: **保存画像と画面の長い名前**。選手名は「・」までの単位で左から詰めて折り返す。単位が入らないときだけ縮小（PC・保存12px／スマホ10pxまで）。チーム名は地名とクラブ名の間（語順は維持）。`NameText.tsx`・`src/lib/nameLayout.ts`、文字列を渡すランキングも共通の型を通し、保存の複製側で再計測。**画面だけ・キー不変**
- 206章: 集計結果（導出データ）はコミットせず、デプロイのときに元データから作る（データの仕分け、`npm run build:data`、キャッシュ）
- 155章: ペイント内外（Mid-range）は公式の区分（インサイドペイント／アウトサイドペイント）で数える

## 作業の心得

- bleague.jpのJSON API（`v2_genius_contexts`、設計書2-1章）はブラウザ経由だとMixed Content
  制限で確認できない。データ構造を確かめるときはNode.js等のサーバーサイド環境から叩く
- 「無料」「自動更新」が絶対条件。DBは使わず、JSON静的ファイル＋GitHub Pages＋GitHub Actions
  が基本方針
- スクレイピングは個人利用の範囲に留める。リクエスト間隔を最低2〜3秒空け、並列アクセスしない
  （設計書2章）。bleague.jp への問い合わせは必ず `scripts/lib/throttle.ts` の createThrottledFetch を通す
  （ホストごとにプロセス全体で直列・最低間隔を共有。1回30秒の上限、5xx・通信の失敗だけ10秒待って1回再試行、4xxは再試行しない。
  設計書8-9）。夜間・30分おきの実行では、日程・ボックススコアの取得に失敗しても手元のデータのままコミットを続け、
  最後にジョブを失敗にして通知する（ジョブが失敗で終わっても、データの変更をコミットした回はデプロイする。変更の無い回はデプロイしない）
- 機能はティアA（確実）／B（要追加調査）／C（難易度高・試験実装）で整理されている（設計書3章・
  12章）。ティアCの機能は、精度が基準に届かなければ縮小・非表示にする前提で扱う
- 試合終了後21日間は該当試合を再チェックし、スタッツ修正（公式記録の後日訂正）に対応する
  （設計書8章）
- **データの持ち方（設計書206章）**: `data/` のファイルは、コミットに残す**元データ（A）**と、デプロイのときに元データから作る**導出データ（B）**に
  分かれる。仕分けは `scripts/lib/dataLayout.ts` が正。
  - A（コミットする）: 試合の生データ（`games/`・B.ONEは `one/games/`）、スポーツナビの記録（`yahoo/`）、日程（`schedule.json`）、選手マスタ・
    1月15日の固定（`season-profiles`）・在籍中の選手名簿（`current-roster`）・当時の名簿とポジション・地区・クラブの実績・賞・規則・選手履歴・
    見張りの一覧と前回の版・選手写真・ロゴ
  - B（コミットしない。`.gitignore` 済み）: シーズンごとの `players`・`teams`・`player-games/`・`team-games/`・`lineups/`・`team-stints/`・`games-summary` など
    と、全シーズンをまたぐ `seasons`・`player-careers`・`league-team-rankings`・`league-player-rankings`・`league-player-game-records` など
  - **集計や式（`aggregate.ts`・`formulas.ts`・`shared/` など）を変えたときは、再集計も導出データのコミットも要らない。** 次のデプロイが、変わったコードで
    作り直す（過去のシーズンは、集計のコードが変わると保存キーが変わり、そのデプロイで全シーズンを作り直す。時間は余分にかかる）。
    手元で画面や数値を確かめるときは `npm run build:data`（全シーズン＋全体、約1分）、`npm run build:data -- --season 2026-27`（そのシーズンと全体）を使う。
    `npm run dev` は、導出データが無ければ起動前に自動で作る
  - 過去シーズンの保存キーは、そのシーズンの元データ（バイト）・シーズンをまたいで読む元データ（`.json.gz` は展開したJSONの**内容**。gzipのバイトだけが違っても変わらない）・集計のコードから作る。**`current-roster` は含めない**（読むのは進行中のシーズンだけ）。`players-master` などが変わると過去シーズンは作り直しになる（設計書206-4章。マスタをシーズンごとに絞る案は見送り）。確認は `npm run validate:season-key`
  - 新しい種類のファイルを `data/` に足すときは、`dataLayout.ts` に A か B かを書き、B なら `.gitignore` の「導出データ」の並びも直す
    （`npm run build:data -- print-gitignore` の出力に置き換える）。`npm run build:data -- check-layout` が、仕分け漏れと `.gitignore` のずれを検出する
    シーズンごとの導出データを足したときは、`npm run dev` の自動作成（`--if-missing`）が、`SEASON_DERIVED_ENTRIES` のすべての有無で作成済みかを見るので、`dataLayout.ts` に書くだけでよい
    （作られないシーズンがあるものだけ `SEASON_OPTIONAL_DERIVED_ENTRIES` に書く。設計書219-7章）。**保存キーの対象のコードを変えると全シーズンの作り直しが起きる**ので、画面だけの変更は `shared/gameIndex.ts` など
    キーの対象（`npm run build:data -- code-files`）に触れない場所に置き、コミットの前にそのファイルが `code-files` に入っていないことを確かめる（`shared/gameIndex.ts`・`shared/gameIndexRead.ts` はキーの対象。画面側の索引の部品は `src/lib/gameIndex.ts`・`clutchQuery.ts`・`gameRecordQuery.ts` など）
  - 導出データを読む手元用のスクリプト（`scrape-club-honors.ts`・`scrape-wayback-profiles.ts`・`backfill-legacy-player-photos.ts`）は、先に `npm run build:data` を実行する
  - 更新ジョブ（`update-stats.yml`）は元データだけをコミットする。1月15日の固定の直前にだけ、今のシーズンの導出データを作る（コミットされない）。
    デプロイの導出データの作成が失敗すると、公開サイトは前の版のまま残り、実行の失敗として通知される
- コミットの前に、ビルド（`npm run build`）に加えて `npm run typecheck`（スクリプト用と画面側の両方）を実行し、
  エラー0件を確認する（2026-09-26）。集計・データの持ち方に関わる変更では、`npm run build:data` が通ること（導出データはコミットされない）と
  `npm run build:data -- check-layout` が通ることも確かめる（206章）
- **コミットの前に、全validateを通す**（2026-10-20 から正式な決まり。設計書278章）: `npm run build:data` のあとに `npm run validate:all`（`package.json` の `validate:` で始まるもの全部を順に流す。
  約12分。1本でも失敗すれば終了コード1で、失敗した検証の出力の末尾が出る）。一部だけ流すときは `-- --only dnp-rows,stat-names`、外すときは `-- --skip 名前`（名前は `validate:` を除いた部分）。
  **外している検証は無い**。「手で実行」と書いてある検証（`rookie-eligibility`・`pbp-order` など）も、データだけで動き（外のサイトに問い合わせない）、全体の実行時間に影響が小さいので含める
  （どれも2026-10-20時点で通る）。**`validate:` の名前で新しい検証を足せば、自動で一覧に入る**。外す必要が出たら `validate-all.ts` の対象から外し、その理由をここに書く。
  検証だけ・設計書だけの変更で、検証が触る範囲のコードを変えていないときも、決まりどおり流す（時間がかかるので、流せなかったときは報告に「流していない」と書く）。毎日の更新（30分おき・深夜）では流さない
- ステージ済みの `data/` に導出データ・仕分け外のファイルが混ざっていないかを確かめる `check-staged` は、**pre-commit フック（`.githooks/pre-commit`）が
  コミットのたびに自動で実行する**（`npm install` の `prepare` が `git config core.hooksPath .githooks` を設定する。クローンし直したあとも `npm install` で有効になる。
  CI では設定も実行もしない）。**`--no-verify` でフックを飛ばさない。** フックが失敗したら、ステージを直す前に、失敗の原因（どのファイルが混ざったか）を報告してから対処する
- `.github/workflows/` のファイルを変えたときは、**pushの前に** `actionlint .github/workflows/*.yml` を通し、エラー0件にする（未導入なら `brew install actionlint`。
  `npm run typecheck` と同じく、コミット前の確認に含める）。書き方が無効だと、そのワークフローの定期実行・外部（cron-job.org）からの起動がすべて止まる
  （2026-10-05に、ジョブ直下の `env` で `runner` コンテキストを使って、データ更新が約4時間止まった。actionlint はこれを検出する。設計書205章）。
  pushの後も、実行一覧（`gh run list --workflow <ファイル名>`）に、push起因の「workflow file issue」の失敗が出ていないかを確認する
- 公開サイトがどのコミットの内容かは、HTMLのmetaタグで確かめる（画面には出ていない。設計書198章）。
  `curl -s https://maccheroni8.github.io/bleague-stats/ | grep -o '<meta name="build-[^>]*>'` で、`build-commit`（ビルドしたコミット）と
  `build-time`（ビルド時刻）が出る。`git log -1 --format=%H` や `git log origin/main -1` のコミットと見比べ、公開サイトが古いコミットなら、
  デプロイ（`Deploy to GitHub Pages`）の実行を見る。データだけを確かめるときは、`/data/{シーズン}/games-summary.json.gz` などの
  `last-modified` と中身を見る（ブラウザのキャッシュは約12分）
- データに新しい項目を加えるときは、その項目が無い古いデータでも画面が動く形にする（デプロイ直後に、ブラウザのキャッシュなどで古いデータが
  読まれることがあるため。設計書167章。導出データはデプロイのたびに作り直すのでリポジトリには古い版が残らないが、この理由は変わらない）
- 画面の文言（説明文・ツールチップ・列の説明・エラー文）には、関数名・設計書の章番号・ファイル名など、サイトを見る人に
  関係の無い記述を書かない（経緯は設計書とコードのコメントに残す。設計書133章）
- スマホ幅（560px以下）では、ページのタイトル・見出し（h1〜h4）以外のチーム名はすべて略称、選手名はすべて名字だけにする
  （表・グラフのラベル・試合の一覧・記録の一覧・注記の文中・チームの選択肢を含む）。チーム名は `ResponsiveTeamName`
  か `src/lib/teamLabel.ts` の `useTeamLabel`・`useTeamText`（文中）、選手名は `ResponsivePlayerName` か `src/lib/playerLabel.ts` の
  `usePlayerLabel` を通す。同じ一覧の中で名字が重なる選手はフルネームのまま（一覧の名前を `among` か `PlayerNamePool` で渡す）。
  旧名称のシーズン（栃木ブレックス・サンロッカーズ渋谷）は当時の略称（栃木・SR渋谷）。過去のシーズンの記録の行は、今の名称ではなく
  そのシーズンの名称を出し（`teamNameInSeason`）、今の所属リーグは添えない。選手を選ぶ選択肢の選手名はフルネームのまま
  （設計書151章）
- 表の列見出し・比較の項目名にカーソルを合わせたときの説明文は、`src/lib/statDescriptions.ts` の辞書1か所で定義する
  （列定義や各ページに説明文を書かない。項目を足したら辞書にも足す。設計書136章）
- **項目名の方針**（設計書236・237章。名前は `src/lib/statNames.ts` の辞書1か所が正。項目を足したら辞書に略称と日本語名を足し、`npm run validate:stat-names` を通す）: ①同じ値になる項目は、画面ごとに別の名前で出さず**1つの名前にまとめる**（項目を足す前に、既にある項目と値が同じでないかを確かめる。
  全チームスタッツ・チーム詳細・全選手スタッツ・個人詳細・ランキング・記録・比較・スタッツの条件・用語集のすべてで同じ名前）。
  ②名前は**同じ並び（同じ分母・同じ種類）の項目にそろえる**（総得点に対する割合は PITP%・FBP%・2ND PTS%・PTSOFFTO%、FGAに対する割合は %PAINT2M・%PAINT2A・%MID2M・%MID2A）。
  ③まとめる前に、定義が同じか全シーズンで値を確かめる（`npm run validate:compare-table` の実データの確認）。④外す名前が URL・保存状態に残っているなら、残す名前に読み替えて開けるようにする。
  補数（%OPA＝100−%PAINT2A）や定数倍（PITP＝2×PAINT2M）の関係は、同じ値ではないので別項目として残す
- 時間（MIN・出場時間・平均出場時間など）の表示は、小数の分（28.5）や「28分」ではなく、**「分:秒」（28:30）に統一する**（表・ランキング・比較・前シーズン比較・
  タイトル・画像保存・ツールチップのすべて。差は「+3:15」）。平均は秒に丸めてから出し、並べ替え・判定は今までどおり値（分・秒）で行う。
  秒からは `formatMinutesFromSeconds`（`boxscoreAggregate.ts`）、分（小数）からは `formatMinutesColon`・`formatSignedMinutesColon`（`src/lib/minutesFormat.ts`）を使い、
  `formatDecimal` に「分」を付けて出さない。スタッツの条件（`statConditions.ts`）のMINの入力は「20」（=20:00）・「20:15」・「20.5」のどれも受け付け、単位・タイトル・チップは常に「分:秒」（「MIN 20:15以上」。URLには入力した文字列のまま）。`format.ts`・`boxscoreAggregate.ts` は保存キーの対象なので、時間の書式の関数を足すときはキーの対象外のファイルに置く
  （`minutesFormat.ts`。足したときに全過去シーズンの作り直しが起きない）。基準の説明文の「合計300分以上」のような整数の分の言い回しは対象外
- スタッツの計算式は、NBA/Basketball-Reference・Bリーグ公式が実際に使っている正式な計算式を
  優先する。簡易版（近似式）を使う場合は、実装前に必ずユーザーに一言断ってから進めること。
  黙って簡易版を採用しない
- 過去シーズンのバックフィル作業（欠落試合の追加取得等）では`npm run scrape:roster`を
  実行しないこと。`scrape-roster.ts`は指定した年の現在の全クラブロースターを
  `players-master.json`に無条件反映する実装のため、過去年を指定すると現役選手の
  所属チームが過去の値に後退してしまう（設計書70-5章の事故事例を参照）
- 個人一覧・チーム一覧・ランキングのタブ・フィルタはURLのクエリに持つ（`src/lib/urlState.ts` の `useUrlState`。変えても履歴は増やさない。
  設計書163章）。この3ページに新しいフィルタを足すときは、usePageState ではなく useUrlState とキーを足す。
  【未対応タスク】GameDetailPage.tsxには、ページ状態保持（usePageState）が未適用のまま
- 【対応済み・2026-10-17】2016-17〜2019-20の延長戦で、在コートの復元のピリオド数が `quarterScores` の長さ（4）のままで延長が抜けていた件（`legacyPeriodScores()` の `Game.MaxPeriod`、
  負の区間長のスティント）は、`onCourtPeriodCount`（`shared/onCourt.ts`）を全シーズンで「quarterScores の数とPBPの最大のピリオドの大きい方」にして直した（設計書256-6章。
  旧シーズンの延長戦92試合すべてで、PBPの延長の数は集計行の延長と一致）。`quarterScores` 自体（試合ファイル）は今も延長を含まないので、ピリオド別の得点は `gamePeriodScores` を使う
- 実際のポゼッション（段階1は設計書204章で実装済み: `team-stints/` と `lineupStints[].countsByPeriod`。2020-21以降）。段階2（よく使われるラインナップ・ラインナップ検索の
  ORtg・DRtg・NetRtgを実際のポゼッションにし、「推定」を外す。2016-17〜2019-20は「ORtg（推定）」の見出し・表の下の1行・用語集で推定と分かるようにする）と、
  段階3（%系・USG%・選手のAST%・On-Court Foreign〈個人・opp〉）は、あとで進める（旧シーズンの延長戦の在コートは設計書256-6章で直した）。段階3は、224章で作った計算の核（`shared/onCourtTotals.ts`）を集計から使い、個人詳細のオン/オフを出場区間の値に揃えるかも決める。シュート単位の連続記録（FT・3Pの連続成功）も同じ作り直しにまとめる。ピリオド別の +/-（Q別・前後半。公式の値が無い2016-17〜2021-22。設計書225-9章）も、この作り直しで行う
- 【未対応タスク】在コート基準の再集計（設計書137章・139章）: 在コート区間ごとにチームのPTS・FGM・FGA・3PM・3PA・FTM・FTA・TOV・
  ポゼッションを数えて試合ログに保存し、選手の%系（%PTS・%FGM・%3PM等）・USG%・ラインナップの実ポゼッション・選手のAST%（NBA式、
  分子はFGMにつながったアシストのみ）・個人のOn-Court Foreign（本人を含む人数。除外ルールはチームと同じ処理の中で揃え、
  検算は「選手全員の秒数の合計＝チームの秒数×5」。設計書141章）をまとめて入れる。出場時間の比による近似式は使わない。
  同じタイミングで、チーム詳細 On-Court Foreign の opp 視点（相手チームのコート上の外国籍の人数。設計書183章）も入れる
  （試合ごとの「人数別の在コート秒数」〔自チーム・相手〕は `TeamGameLog.foreignCourtSeconds`・`opponentForeignCourtSeconds` とチームのピリオド別の索引に入れ済み。設計書256-6章）
- **PBP（`raw.PlayByPlays`）の並び（設計書212章）**: 2020-21以降の延長戦では、公式のPBPの配列が時系列にならない（延長が第1〜第4ピリオドのブロックに混ざる。
  `No` 順でも時系列にならない）。PBPを時系列で使う処理（得点の推移・リードの入れ替わり・最大ラン・決勝弾など）は、`shared/pbpOrder.ts` の
  `withChronologicalPlayByPlays`（または `chronologicalPlayByPlays`）の出力を使う。試合を読み込む2か所（集計用の `readAllGames`、画面の `fetchGame`）では適用済み。
  **取り込み（`scrape-boxscore.ts` の変更検知）と見張りの一覧（`gameWatch.ts`）の経路には、並べ替えを入れない**（保存済みの生データとAPIの返り値を比べるため。
  それらは `readGameFile` を使う）。配列順のまま「最後の得点イベント」などを見ない。確認は `npm run validate:pbp-order`（手で実行。CIには入れない）
- 公式の記録の誤り（交代の記録の欠け・並びの食い違いなど）を見つけたら、`npm run watchlist -- add <試合ID> --season ... --reason "..." [--check ...]` で
  見張りの一覧（`data/game-watchlist.json`）に入れる。夜間実行が60日間取り直し、公式のスタッツ修正で変わったら、ジョブの通知とデータのコミットの本文
  （「見張り：…」の行）に出る（設計書202章）。一覧の状態が「修正あり」「修正なし」「解消」になった試合は、結果を報告してから放っておいてよい
- 歴代記録の順位（`league-team-rankings.json`・`league-player-rankings.json`）は導出データ（B）で、デプロイのたびに作り直す（設計書143-4・206章）。
  バッチや `aggregate.ts` のロジックを変えても、手動で作り直してコミットする必要は無い
- 順位は「同じ値は同じ順位、次は飛ばす（1位・2位・2位・4位）」に揃えている（設計書143-3）。新しく順位を出すときもこの形にする
- 5カテゴリタブ間で同じ項目は重複させない。EFF・+/-はトラディショナル、eFG%・TS%はアドバンスドに
  置く。列定義は7系統（`BoxscoreTable.tsx`のCOLUMNS_BY_TAB、`playerSeasonBoxscore.ts`の
  SEASON_BOX_COLUMNS、`PlayersListPage.tsx`のローカル定義、`TeamDetailPage.tsx`の
  TEAM_SEASON_*_COLUMNS、`teamStatsColumns.ts`のbuild*Columns）に分かれているため、タブ構成を
  変えるときは全系統に反映する
- 【将来の検討課題】5カテゴリタブ（トラディショナル/アドバンスド/Misc/スコアリング/
  シューティング）の列定義が7系統に分散している（シューティングのみ`shotTypeEntityColumns`
  として共通化済み）。今回の重複解消は7箇所全てに反映したが、今後同じタブ構成に変更を
  加えるたびに同じ手間が発生する。将来的には7系統を段階的に共通化することを検討したい
- 【将来の検討課題】選手写真は1人につき1枚のみ保存する設計（`data/player-photos/{playerId}.webp`）のため、
  過去の試合のゲームリーダー等で、当時の所属チームではなく現在の所属チームのユニフォーム写真が
  表示される（例: 移籍済み選手の過去試合で新所属先のユニフォームが出る）。シーズンごとに写真を
  保存する運用にすれば解決するが、保存容量が増えるため、実害の大きさを見て判断する（2026-09-23）。仕組みは257章で用意済み（宇都宮のチーム詳細だけ・写真は未登録）
- 【保留】`scripts/lib/teamLogoCodes.ts`のTEAM_LOGO_CODESは、B.PREMIER30クラブ
  （現行26クラブ＋過去在籍4クラブ）分のみ登録済み。B.ONE所属クラブ（`ONE_TEAM_DIVISIONS`の
  25クラブ）のうち716・718（信州・神戸、B.PREMIERと共通のTeamID）以外の22クラブは
  ロゴコード未調査。B.ONEのクラブ一覧・詳細ページ自体がフロントエンドに未実装のため
  実害は無いが、着手する際はbleague.jp/club_detail/?TeamID=を個別に確認してコードを
  特定すること（2026-09-14時点）
- 【保留】条件別順位表の「二桁リード/ビハインドした試合」条件は保留中。条件選択のたびに
  全チーム分の生データ（数十MB）を取得するコストが重いため、バックエンドで事前集計し
  試合単位のフラグとして永続化する方式を含めて、実現方法を別途検討する
- 登録区分のUI・集計・表示は「全選手/日本人/外国籍・帰化・アジア」の3区分で統一し、
  `src/lib/classificationFilter.ts`の`classificationGroup()`を通す（日本人かどうかはリーグ登録国籍で
  確実に判定できるため、classificationがシーズン非依存でも、シーズンをまたいだ帰化等の区分変化は
  問題にならない。設計書94章）。4値のclassificationフィールドはデータ層に残している。
  `playerClassificationOverrides.ts`（帰化選手/アジア特別枠の手動上書きリスト）は、
  「日本人と誤判定されるのを防ぐ」目的のみで維持する（ファジーカス選手のようにnationalityが
  「日本」表記になる帰化選手を、正しく「外国籍・帰化・アジア」側に分類するため）
- 【未対応・原因不明】2024-25シーズンの「全チームスタッツ」ページを開くと、
  `data/2024-25/team-games/2486.json.gz`・`696.json.gz`の取得が404になる（2026-09-24確認）。
  両チームとも2024-25の`teams.json`には含まれておらず、どの処理が問い合わせているかは未調査。
  表示への実害は無い
- 各シーズンの身長・体重・ポジションは `data/season-profiles.json` の当時の値を使う（2025-26 までは Wayback から1回だけ取得、
  2026-27 以降は夜間実行が1月15日時点の値で固定。固定済みは上書きしない）。Wayback の取得（`scrape-wayback-profiles.ts`）は再実行しない
  （DESIGN.md 148章）
- シーズン終了後は、`scrape-season-rosters.ts --from YYYY --to YYYY`を再実行して`season-positions.json`を
  アーカイブする必要がある（デフォルトの`--to`のままだと、終了したシーズンでも現在値が表示され続ける）。
  再実行後は、コミットするのは `season-positions.json` だけでよい（そのシーズンの導出データは、元データの内容が変わるので次のデプロイが作り直す。
  手元で確かめるなら `npm run build:data -- --season YYYY-YY`。DESIGN.md 101章・206章）
