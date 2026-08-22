// 外部サイト（bleague.jp公式）へのリンクURLを組み立てる薄いヘルパー。サイト内リンク
// （react-routerのLink）とは別に「Bリーグ公式の選手ページへ遷移できるように」という要望への
// 対応。src/components/ExternalLinkIcon.tsxと組み合わせて使う。

/** Bリーグ公式の選手詳細ページ（roster_detail）のURL */
export function bleaguePlayerUrl(playerId: string): string {
  return `https://www.bleague.jp/roster_detail/?PlayerID=${playerId}`;
}
