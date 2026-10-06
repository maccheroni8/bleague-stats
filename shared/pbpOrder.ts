// 公式のPBP（PlayByPlays）を、時系列（ピリオド・残り時間の順）に並べ直す共通の関数（DESIGN.md 212章）。
//
// 2020-21以降の延長戦（B.ONE含む。延長のある試合のうち192/196試合）では、公式のPBPの配列が時系列にならない:
// 延長（第5ピリオド以降）のイベントが、第(ピリオド−1)%4+1ピリオドのブロックの中に、残り時間順で混ざっている
// （第5ピリオドは第1ピリオド、第6ピリオドは第2ピリオドの中）。`No` 順に並べても時系列にならない（2020-21以降は全試合）。
// 延長の無い試合と、2016-17〜2019-20は、配列がそのまま時系列。
//
// PBPを時系列で使う処理（得点の推移・リードの入れ替わり・最大ラン・決勝点など）は、この関数の出力を使う。
// 試合を読み込む2か所（集計用の `readAllGames`＝scripts/lib/storage.ts、画面の `fetchGame`＝src/lib/data.ts）で適用済みなので、
// そこから受け取った試合のPBPは時系列になっている。**取り込み（scrape-boxscore.ts の変更検知）と見張りの一覧（gameWatch.ts）の
// 経路には入れない**（保存済みの生データとAPIの返り値を比べるため。並べ替えると、全試合が「変更あり」になる）。
//
// メモリ上でだけ並べ直す（保存するファイルは変えない）。すでに時系列の試合は、同じオブジェクトをそのまま返す。
// 並びのキーは (経過秒, ピリオド, 配列の元の位置)。同じ秒の中の並びは、配列の元の順を保つ
// （残り時間の解像度が1秒しかなく、同じ秒の「交代→得点→交代」などは配列の順が発生順と一致するため。shared/onCourt.ts 参照）。
// 前のピリオドの終わり（0:00）と次のピリオドの始め（10:00・5:00）は経過秒が同じなので、ピリオドの小さい方を先にする。

import type { PlayByPlayEvent, StoredGame } from "./types.ts";

const REGULAR_PERIOD_SECONDS = 10 * 60;
const OT_PERIOD_SECONDS = 5 * 60;

function periodDurationSeconds(period: number): number {
  return period <= 4 ? REGULAR_PERIOD_SECONDS : OT_PERIOD_SECONDS;
}

function periodStartSeconds(period: number): number {
  let total = 0;
  for (let p = 1; p < period; p += 1) total += periodDurationSeconds(p);
  return total;
}

/** 試合開始からの経過秒。残り時間が読めないイベントは、そのピリオドの終わり（残り0:00）として扱う（shared/onCourt.ts と同じ） */
function elapsedSecondsOf(ev: PlayByPlayEvent): number {
  const m = /^(\d+):(\d{2})$/.exec(ev.RestTime ?? "");
  const remaining = m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  return periodStartSeconds(ev.Period) + periodDurationSeconds(ev.Period) - remaining;
}

/** (経過秒, ピリオド) の昇順に並んでいるか（同じ値は並んでいるとみなす） */
export function isChronologicalPlayByPlays(events: readonly PlayByPlayEvent[]): boolean {
  let prevElapsed = -Infinity;
  let prevPeriod = -Infinity;
  for (const ev of events) {
    const elapsed = elapsedSecondsOf(ev);
    if (elapsed < prevElapsed || (elapsed === prevElapsed && ev.Period < prevPeriod)) return false;
    prevElapsed = elapsed;
    prevPeriod = ev.Period;
  }
  return true;
}

/** PBPを時系列に並べ直した配列（元の配列は変えない）。すでに時系列なら、同じ配列をそのまま返す */
export function chronologicalPlayByPlays(events: PlayByPlayEvent[]): PlayByPlayEvent[] {
  if (isChronologicalPlayByPlays(events)) return events;
  return events
    .map((ev, index) => ({ ev, index, elapsed: elapsedSecondsOf(ev) }))
    .sort((a, b) => a.elapsed - b.elapsed || a.ev.Period - b.ev.Period || a.index - b.index)
    .map((x) => x.ev);
}

/** PBPを時系列に並べ直した試合（メモリ上だけ）。すでに時系列の試合・PBPが無い試合は、同じ試合をそのまま返す */
export function withChronologicalPlayByPlays<G extends StoredGame>(game: G): G {
  const events = game.raw?.PlayByPlays;
  if (!events) return game;
  const sorted = chronologicalPlayByPlays(events);
  if (sorted === events) return game;
  return { ...game, raw: { ...game.raw, PlayByPlays: sorted } };
}
