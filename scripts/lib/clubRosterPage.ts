// 当時（2016-17・2017-18）のクラブ公式サイトの選手一覧ページ（`/roster/players/`）を読む部品と、名前の突き合わせ。
// 外のサイトには問い合わせない純粋な処理（検証 `validate:season-photos` が使う）。設計書374-5章。
//
// 一覧ページは1人ごとに `<li class="player">` で、背番号・日本語名・英語名・写真の住所が並んでいる。
// 写真の住所は大半が `https://data.bleague.jp/{クラブ略称}/{年}/{JBA選手番号}/01/player.jpg`（番号は選手IDとは別）。
// クラブごとに置き場所が違うところ（栃木: `/fs/…/player_0_201718.jpg`）は、ページの中の相対の住所をそのまま使う。

export interface ClubRosterEntry {
  /** 背番号（空のこともある） */
  number: string;
  /** 日本語名（ページの表記のまま） */
  ja: string;
  /** 英語名 */
  en: string;
  /** data.bleague.jp の写真なら、その中身。それ以外は null */
  jba: { club: string; label: string; id: string } | null;
  /** 写真の住所（ページに書かれていたまま。相対のこともある） */
  photo: string | null;
}

const JBA_PHOTO = /data\.bleague\.jp\/([a-z0-9]+)\/([0-9-]+)\/(\d+)\/01\/player\.jpg/;

function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

/** 一覧ページのHTMLから、選手の並びを読む */
export function parseClubRosterPage(html: string): ClubRosterEntry[] {
  const blocks = html.split(/<li class="player"/).slice(1);
  const out: ClubRosterEntry[] = [];
  for (const block of blocks) {
    const body = block.split(/<\/li>/)[0] ?? "";
    const ja = /class="name ja">([^<]+)</.exec(body)?.[1];
    if (!ja) continue;
    const jba = JBA_PHOTO.exec(body);
    let photo: string | null = null;
    if (jba) photo = `https://${jba[0]}`;
    else {
      const m = /url\(\s*["']?([^"')\s]+\.(?:jpg|jpeg|png))["']?\s*\)/i.exec(body);
      if (m && /player/i.test(m[1]!)) photo = m[1]!;
    }
    out.push({
      number: decode(/class="num"><p>([^<]*)</.exec(body)?.[1] ?? ""),
      ja: decode(ja),
      en: decode(/class="name en">([^<]*)</.exec(body)?.[1] ?? ""),
      jba: jba ? { club: jba[1]!, label: jba[2]!, id: jba[3]! } : null,
      photo,
    });
  }
  return out;
}

/** 名前の突き合わせ用に、空白・中点・記号をそろえて除く */
export function normalizePersonName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\s　・･·\.．。、,，=＝'’`´-]/g, "")
    .toLowerCase();
}

export type NameMatch =
  | { kind: "match"; playerId: string }
  | { kind: "none" }
  | { kind: "ambiguous"; playerIds: string[] };

/** 候補（そのシーズン・そのチームの選手）の名前から、ページの名前の本人を決める。ちょうど1人のときだけ決まる */
export function matchClubPlayer(pageName: string, candidates: { playerId: string; names: string[] }[]): NameMatch {
  const key = normalizePersonName(pageName);
  if (!key) return { kind: "none" };
  // 外国籍選手は「姓 名」の順で書くクラブがある（「ロシター ライアン」）。空白で2つに分かれる名前は、入れ替えた形も同じ名前とみなす
  const parts = pageName.normalize("NFKC").trim().split(/\s+/);
  const keys = new Set([key]);
  if (parts.length === 2) keys.add(normalizePersonName(`${parts[1]}${parts[0]}`));
  const hit = candidates.filter((c) => c.names.some((n) => keys.has(normalizePersonName(n)))).map((c) => c.playerId);
  if (hit.length === 1) return { kind: "match", playerId: hit[0]! };
  if (hit.length > 1) return { kind: "ambiguous", playerIds: hit };
  return { kind: "none" };
}

/** そのシーズンの一覧ページとみなす保存日時の範囲（YYYYMMDDhhmmss）。7月1日〜翌年6月30日 */
export function clubPageWindow(season: string): { from: string; to: string } {
  const y = Number(season.slice(0, 4));
  return { from: `${y}0701000000`, to: `${y + 1}0630235959` };
}

/** そのシーズンの選手一覧ページの写真として認める住所の「年」の書き方（開幕の年・`2016-17` の形・翌年。保存日時の範囲と合わせて判定） */
export function clubPhotoLabels(season: string): string[] {
  const y = Number(season.slice(0, 4));
  return [String(y), season, String(y + 1)];
}
