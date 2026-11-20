import { useEffect, useId, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  RANKING_PRESET_NAME_MAX,
  RANKING_PRESET_STORAGE_KEY,
  deleteRankingPreset,
  loadRankingPresets,
  rankingPresetMatches,
  rankingPresetQuery,
  rankingPresetStorageAvailable,
  rankingPresetUrl,
  renameRankingPreset,
  saveRankingPresets,
  upsertRankingPreset,
  type RankingPreset,
} from "../lib/rankingPresets";
import "../figures/FigurePresets.css";

/** 一覧の1行の操作中の状態（名前の変更・削除の確認）。削除は「削除する／やめる」を選ぶまで消さない */
type RowEdit = { id: string; kind: "rename"; name: string } | { id: string; kind: "delete" };

/**
 * ランキングの検索条件の保存（ボタン1つ。押すと開く）。中に「いまの条件を保存」（名前を付けて保存）と、保存した条件の一覧（押すとその条件で開く。
 * 名前の変更・URLのコピー・削除は各行から）をまとめる。保存先はこのブラウザ（localStorage）。図解の「図の設定」と同じ作り
 */
export function RankingPresets() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(false);
  const [presets, setPresets] = useState<RankingPreset[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [rowEdit, setRowEdit] = useState<RowEdit | null>(null);
  const [message, setMessage] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const panelId = useId();
  useEffect(() => {
    setAvailable(rankingPresetStorageAvailable());
    setPresets(loadRankingPresets());
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === RANKING_PRESET_STORAGE_KEY) setPresets(loadRankingPresets());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const current = rankingPresetQuery(params);
  const persist = (next: RankingPreset[]) => {
    if (!saveRankingPresets(next)) {
      setAvailable(false);
      setMessage("保存できませんでした。このブラウザでは保存を使えません。");
      return false;
    }
    setPresets(next);
    return true;
  };
  const submitSave = () => {
    if (saving === null) return;
    const name = saving.trim();
    if (!name) {
      setMessage("名前を入力してください。");
      return;
    }
    const { list, saved } = upsertRankingPreset(presets, { name, query: current });
    if (persist(list)) {
      setMessage(`「${saved.name}」を保存しました。`);
      setSaving(null);
    }
  };
  const submitRename = () => {
    if (rowEdit?.kind !== "rename") return;
    const name = rowEdit.name.trim();
    if (!name) {
      setMessage("名前を入力してください。");
      return;
    }
    if (persist(renameRankingPreset(presets, rowEdit.id, name))) {
      setMessage("名前を変更しました。");
      setRowEdit(null);
    }
  };
  const remove = (p: RankingPreset) => {
    if (persist(deleteRankingPreset(presets, p.id))) {
      setMessage(`「${p.name}」を削除しました。`);
      setRowEdit(null);
    }
  };
  const copy = async (p: RankingPreset) => {
    const url = rankingPresetUrl(window.location.href, location.pathname, p);
    try {
      await navigator.clipboard.writeText(url);
      setManualUrl("");
      setMessage("URLをコピーしました。");
    } catch {
      setManualUrl(url);
      setMessage("コピーできませんでした。下のURLを選んでコピーしてください。");
    }
  };
  const apply = (p: RankingPreset) => {
    setRowEdit(null);
    setMessage("");
    // ハッシュの URL を、保存した条件で置き換える（リーグ・シーズンも保存した条件のまま）
    window.location.hash = `${location.pathname}${p.query ? `?${p.query}` : ""}`;
  };
  return (
    <div className="figure-presets" role="group" aria-label="検索条件の保存">
      <button type="button" className="figure-presets-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
        検索条件の保存<span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="figure-presets-panel" id={panelId}>
          {saving === null ? (
            <button
              type="button"
              className="figure-presets-save"
              disabled={!available}
              title={available ? undefined : "このブラウザでは保存できません"}
              onClick={() => {
                setMessage("");
                setSaving("");
              }}
            >
              いまの条件を保存
            </button>
          ) : (
            <form
              className="figure-presets-edit"
              onSubmit={(e) => {
                e.preventDefault();
                submitSave();
              }}
            >
              <label>
                名前
                <input type="text" value={saving} maxLength={RANKING_PRESET_NAME_MAX} autoFocus onChange={(e) => setSaving(e.target.value)} />
              </label>
              <button type="submit">保存する</button>
              <button type="button" onClick={() => setSaving(null)}>
                やめる
              </button>
            </form>
          )}
          {presets.length === 0 ? (
            <p className="figure-presets-empty">{available ? "保存した条件はまだありません。" : "このブラウザでは保存を使えません。"}</p>
          ) : (
            <ul className="figure-presets-list">
              {presets.map((p) => {
                const edit = rowEdit?.id === p.id ? rowEdit : null;
                const matched = rankingPresetMatches(p, params);
                return (
                  <li key={p.id} className="figure-presets-item">
                    {edit?.kind === "rename" ? (
                      <form
                        className="figure-presets-edit"
                        onSubmit={(e) => {
                          e.preventDefault();
                          submitRename();
                        }}
                      >
                        <label>
                          名前
                          <input type="text" value={edit.name} maxLength={RANKING_PRESET_NAME_MAX} autoFocus onChange={(e) => setRowEdit({ ...edit, name: e.target.value })} />
                        </label>
                        <button type="submit">変更する</button>
                        <button type="button" onClick={() => setRowEdit(null)}>
                          やめる
                        </button>
                      </form>
                    ) : edit?.kind === "delete" ? (
                      <div className="figure-presets-edit">
                        <span>「{p.name}」を削除しますか？</span>
                        <button type="button" className="figure-presets-danger" onClick={() => remove(p)}>
                          削除する
                        </button>
                        <button type="button" onClick={() => setRowEdit(null)}>
                          やめる
                        </button>
                      </div>
                    ) : (
                      <>
                        <button type="button" className={`figure-presets-apply${matched ? " active" : ""}`} aria-pressed={matched} onClick={() => apply(p)}>
                          {p.name}
                        </button>
                        <span className="figure-presets-actions">
                          <button
                            type="button"
                            onClick={() => {
                              setMessage("");
                              setRowEdit({ id: p.id, kind: "rename", name: p.name });
                            }}
                          >
                            名前を変更
                          </button>
                          <button type="button" onClick={() => copy(p)}>
                            URLをコピー
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setMessage("");
                              setRowEdit({ id: p.id, kind: "delete" });
                            }}
                          >
                            削除
                          </button>
                        </span>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {manualUrl && <input className="figure-presets-url" readOnly value={manualUrl} aria-label="コピーするURL" onFocus={(e) => e.currentTarget.select()} />}
          {message && (
            <p className="figure-presets-message" role="status">
              {message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
