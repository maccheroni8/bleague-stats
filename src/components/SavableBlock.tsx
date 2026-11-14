import { useRef, type ReactNode } from "react";
import type { BaseDateSpec } from "../lib/dataBaseDate";
import { ExportImageButton } from "./ExportImageButton";
import { ExportTarget } from "./ExportTarget";

/**
 * 順位表ページのタブ（星取り表・勝敗表・条件別順位表・推移など）の「保存ボタン＋画像として保存できる範囲」。
 * ボタンは範囲の右上に出し、押すとその範囲（見出し・表・基準日）を保存画像の型で保存する（DESIGN.md 393章）。
 * unavailableReason があるときはボタンの代わりにその理由を出す（再生中・期間が長すぎるときなど）
 */
export function SavableBlock({
  filename,
  baseDate,
  className,
  unavailableReason,
  children,
}: {
  filename: string;
  baseDate: BaseDateSpec;
  /** 保存範囲の種類ごとの大きさの指定（index.css の .export-target-… ） */
  className?: string;
  unavailableReason?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="savable-block">
      <div className="savable-bar">
        {unavailableReason ? (
          <p className="savable-reason" role="status">
            {unavailableReason}
          </p>
        ) : (
          <ExportImageButton targetRef={ref} filename={filename} baseDate={baseDate} />
        )}
      </div>
      <ExportTarget ref={ref} className={className} baseDate={baseDate}>
        {children}
      </ExportTarget>
    </div>
  );
}
