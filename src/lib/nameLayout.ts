/** 名前の表示だけの規則。集計・項目名の定義とは独立させる。 */
export function playerNameUnits(name: string): string[] {
  const parts = name.split("・");
  return parts.map((part, i) => part + (i < parts.length - 1 ? "・" : ""));
}

/**
 * 決まり（地名とクラブ名の間で折り返す）に合わない名前だけ、折り返す位置を直接書く（クラブ名 → 行の単位。つなぐと元の名前になること）。
 * 折り返し位置を変えたいクラブは、ここに足す
 */
export const TEAM_NAME_BREAK_EXCEPTIONS: Readonly<Record<string, readonly string[]>> = {
  東京ユナイテッドバスケットボールクラブ: ["東京ユナイテッド", "バスケットボールクラブ"],
  東京八王子ビートレインズ: ["東京八王子", "ビートレインズ"],
  アースフレンズ東京Z: ["アースフレンズ", "東京Z"],
  さいたまブロンコス: ["さいたま", "ブロンコス"],
  トライフープ岡山: ["トライフープ", "岡山"],
  立川ダイス: ["立川", "ダイス"],
  岐阜スゥープス: ["岐阜", "スゥープス"],
};

/** 現旧の地名を先頭／末尾に持つクラブ名だけ、地名とクラブ名に分ける。例外（TEAM_NAME_BREAK_EXCEPTIONS）はその位置で分ける。 */
export function teamNameUnits(name: string): string[] {
  const exception = TEAM_NAME_BREAK_EXCEPTIONS[name];
  if (exception) return [...exception];
  const places = "北海道|青森|岩手|秋田|山形|仙台|福島|茨城|栃木|宇都宮|群馬|越谷|千葉|東京|渋谷|横浜|川崎|富山|石川|金沢|福井|信州|新潟|静岡|三遠|三河|名古屋|滋賀|京都|大阪|神戸|西宮|兵庫|奈良|和歌山|島根|広島|山口|香川|愛媛|徳島|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|琉球";
  const prefix = name.match(new RegExp(`^(${places})`))?.[0];
  if (prefix && prefix.length < name.length) return [prefix, name.slice(prefix.length)];
  const suffix = name.match(new RegExp(`(${places})$`))?.[0];
  return suffix && suffix.length < name.length ? [name.slice(0, -suffix.length), suffix] : [name];
}

/** 実際の列幅で最長の単位を測る。保存時は複製側の固定幅で呼び直す。 */
export function fitNameText(el: HTMLElement): void {
  el.style.removeProperty("font-size");
  el.classList.remove("name-text-wrap");
  // 1行のまま見せる名前（表の名前の欄。lineFirst）: 画面はそのまま。保存画像だけ、入りきらないときに字を小さくし、
  // 読める大きさ（12px）に収まらないときは単位（地名とクラブ名の間）で2行に折り返す
  if (el.classList.contains("name-text-line")) {
    if (!el.closest(".export-rendering")) return;
    const view = el.ownerDocument.defaultView!;
    const base = parseFloat(view.getComputedStyle(el).fontSize);
    const available = el.clientWidth;
    const needed = el.scrollWidth;
    if (available <= 0 || needed <= available) return;
    const size = Math.floor((base * (available - 0.5) / needed) * 100) / 100;
    if (size >= LINE_FIT_MINIMUM_PX) {
      el.style.fontSize = `${size}px`;
      return;
    }
    el.classList.add("name-text-wrap");
  }
  const width = el.getBoundingClientRect().width;
  if (width <= 0) return;
  const view = el.ownerDocument.defaultView!;
  const base = parseFloat(view.getComputedStyle(el).fontSize);
  const minimum = view.matchMedia("(max-width: 560px)").matches ? 10 : 12;
  const longest = Math.max(0, ...Array.from(el.children, (child) => child.getBoundingClientRect().width));
  if (longest > width) {
    const size = Math.max(Math.min(base, minimum), Math.floor((base * (width - 0.5) / longest) * 100) / 100);
    el.style.fontSize = `${size}px`;
  }
}

/** 1行のまま縮める名前（lineFirst）の下限。これより小さくなるときは2行に折り返す */
const LINE_FIT_MINIMUM_PX = 12;

export function fitNamesIn(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(".name-text").forEach(fitNameText);
}
