# bleague-stats

B.LEAGUE（B.PREMIER優先）の個人用スタッツサイト。詳細設計は下記を参照。

@docs/DESIGN.md

## 作業の心得

- 実装前に、設計書2-1章のJSON API（`v2_genius_contexts`）を実際に叩いて構造を確認すること
  （Phase 1着手前の必須タスク。ブラウザ経由だとMixed Content制限で確認できないので、
  Node.js等のサーバーサイド環境から検証する）
- 「無料」「自動更新」が絶対条件。DBは使わず、JSON静的ファイル＋GitHub Pages＋GitHub Actions
  が基本方針
- スクレイピングは個人利用の範囲に留める。リクエスト間隔を最低2〜3秒空け、並列アクセスしない
  （設計書2章）
- 機能要件はティアA（確実）／B（要追加調査）／C（難易度高・試験実装）で整理されている
  （設計書3章・12章）。まずティアAから実装し、ティアCは「実装してみて精度が低ければ縮小・
  撤退する」前提で後半フェーズに回す
- 試合終了後14日間は該当試合を再チェックし、スタッツ修正（公式記録の後日訂正）に対応する
  （設計書8章）。この差分検知・再集計の仕組みはPhase 1から組み込む
- 実装フェーズの順序は設計書10章の通り。着手前に必ずこのCLAUDE.mdと@docs/DESIGN.mdを読むこと
- `aggregate.ts`または`formulas.ts`のロジックを変更した場合、必ず全シーズン（過去バックフィル分
  含む）で`npm run aggregate`を再実行してからコミットすること。現在シーズンのみの再集計で
  済ませない。日次のGitHub Actionsワークフロー（`update-stats.yml`）が集計するのは現在シーズンの
  みのため、過去シーズンはロジック変更のたびに手動で再集計しない限り自動では同期されない
- スタッツの計算式は、NBA/Basketball-Reference・Bリーグ公式が実際に使っている正式な計算式を
  優先する。簡易版（近似式）を使う場合は、実装前に必ずユーザーに一言断ってから進めること。
  黙って簡易版を採用しない
- 過去シーズンのバックフィル作業（欠落試合の追加取得等）では`npm run scrape:roster`を
  実行しないこと。`scrape-roster.ts`は指定した年の現在の全クラブロースターを
  `players-master.json`に無条件反映する実装のため、過去年を指定すると現役選手の
  所属チームが過去の値に後退してしまう（設計書70-5章の事故事例を参照）
- 【未対応タスク】PlayersListPage.tsx・TeamsListPage.tsx・GameDetailPage.tsx・
  SchedulePage.tsxに、PlayerDetailPage.tsx/TeamDetailPage.tsx/RankingsPage.tsxで
  実装済みのページ状態保持（usePageState、ブラウザバック時にフィルタ・タブ選択が維持
  される仕組み）を未適用。同じ理由（フィルタ項目が多い）で価値があるため、着手する際は
  pageStateCache.tsの既存パターンをそのまま流用する
- 【未対応タスク・要調査】`scripts/lib/legacyGameDetail.ts`の`legacyPeriodScores()`が、
  一部のlegacy取得試合（2016-17〜2019-20シーズン）で`Game.MaxPeriod`を実際は延長戦なのに
  `4`のまま誤って報告するケースがある（DESIGN.md 84-3章、Phase H9で発見）。この誤報告により
  `reconstructOnCourt`が終盤のラインナップスティントを正規時間終了時刻で打ち切ってしまい、
  結果的に`endSec < startSec`という負の区間長のスティントが発生する（2016-17シーズン557試合中
  42件で確認済み）。Phase H9では新機能側にだけ対症療法（負の区間長のスティントをスキップ）を
  入れて回避したが、根本原因（`Game.MaxPeriod`がどういう条件で誤報告されるか）は未調査のまま。
  **既存の「よく使われるラインナップ」機能（`scripts/aggregate.ts`の`processLineups`、
  `acc.secondsPlayed += stint.endSec - stint.startSec`）にも同種のガードが無く、同じ負の
  区間長により出場時間・純得失点・Net Rating（推定）が一部のlegacyシーズンOT試合で
  わずかに不正確になっている可能性が高い**。着手する際は、まず該当ScheduleKey
  （2016-17シーズンの例: 297, 360, 401等）の生データで`Game.MaxPeriod`の実際の値を確認し、
  legacyデータでのOT検出をより信頼できる方法（PlayByPlaysの実際の経過時間範囲、
  `HomeTeamScore05`以降の非ゼロ判定等）に置き換えることを検討する
