import { useEffect, useState } from "react";
import { teamLogoUrl } from "./data";

/**
 * グラフ（SVG）の中の <image> は、画像として保存するとき外部のファイルを読めず、ロゴが抜ける。
 * そこでロゴを data: のURLにして埋め込む（SVG の中に画像そのものが入るので保存画像にも出る）。
 * 読み込めるまでは元のURLのまま（画面の表示は変わらない）。読み込んだ結果はチームごとに使い回す
 */
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

function loadLogoDataUrl(teamId: string): Promise<string | null> {
  const done = cache.get(teamId);
  if (done) return Promise.resolve(done);
  let p = pending.get(teamId);
  if (!p) {
    p = fetch(teamLogoUrl(teamId))
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then(
        (blob) =>
          new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          }),
      )
      .catch(() => null)
      .then((url) => {
        if (url) cache.set(teamId, url);
        pending.delete(teamId);
        return url;
      });
    pending.set(teamId, p);
  }
  return p;
}

/** チームのロゴのURL（読み込めたら data: のURL、まだなら元のURL）を返す関数。読み込めたら画面を描き直す */
export function useTeamLogoSources(teamIds: readonly string[]): (teamId: string) => string {
  const [, setVersion] = useState(0);
  const key = teamIds.join(",");
  useEffect(() => {
    let alive = true;
    const missing = teamIds.filter((id) => !cache.has(id));
    if (missing.length === 0) return;
    void Promise.all(missing.map(loadLogoDataUrl)).then(() => {
      if (alive) setVersion((v) => v + 1);
    });
    return () => {
      alive = false;
    };
    // teamIds の中身（key）が変わったときだけ読み込む
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (teamId) => cache.get(teamId) ?? teamLogoUrl(teamId);
}

/** 動画用: チームのロゴを画像として読み込む（読み込めなかったチームは含めない） */
export async function loadLogoImages(teamIds: readonly string[]): Promise<Map<string, HTMLImageElement>> {
  const urls = await Promise.all(teamIds.map((id) => loadLogoDataUrl(id)));
  const out = new Map<string, HTMLImageElement>();
  await Promise.all(
    teamIds.map(async (id, i) => {
      const url = urls[i];
      if (!url) return;
      const img = new Image();
      img.src = url;
      try {
        await img.decode();
        out.set(id, img);
      } catch {
        /* 読み込めなかったロゴは点で描く */
      }
    }),
  );
  return out;
}
