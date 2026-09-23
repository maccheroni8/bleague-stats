/**
 * 年間優勝マーク（順位表）。絵文字は環境ごとに見た目が変わり、サイトの他の記号（★☆ー）と
 * 質感が揃わないため、線画のSVGにしている。色はcurrentColorで、呼び出し側のCSSで決める
 */
export function CrownIcon({ size = 14, title = "年間優勝" }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="img"
      aria-label={title}
      className="crown-icon"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <title>{title}</title>
      <path d="M2.5 12.5 1.5 5l4 3L8 3l2.5 5 4-3-1 7.5z" />
      <path d="M3 14.5h10" />
    </svg>
  );
}
