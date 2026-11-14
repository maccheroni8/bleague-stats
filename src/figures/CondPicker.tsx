import { useMemo } from 'react';
import { NumberTextInput } from '../components/NumberTextInput';
import {
  condNumberKind, condOptionGroups, OPP_RATE_KEY, parseRateInput, type CondEnv, type CondSpec,
} from '../lib/figureCondWinPct';
import { NUMBER_CONDITION_DEFAULTS } from '../lib/conditionalCondition';
import './CondPicker.css';

/**
 * 条件付きの勝率の「条件」を選ぶ欄（図解の散布図・ベン図で共通）。選べる条件は条件別順位表と同じ。
 * 相手の勝率は「●以上」「●未満」を数字で、外国籍の人数・得点・失点は「●人」「●点」を数字で入れる
 */
export function CondPicker({ env, spec, label, onChange }: { env: CondEnv; spec: CondSpec; label: string; onChange: (next: CondSpec) => void }) {
  const groups = useMemo(() => condOptionGroups(env), [env]);
  const numberKind = condNumberKind(env, spec);
  return <span className="cond-picker">
    <label>{label}の条件
      <select value={spec.key} onChange={e => {
        const key = e.target.value;
        if (key === OPP_RATE_KEY) { onChange({ key, oppMode: spec.oppMode ?? 'ge', oppRate: spec.oppRate ?? 0.6 }); return; }
        const next: CondSpec = { key };
        const kind = condNumberKind(env, next);
        onChange(kind ? { key, n: spec.n ?? NUMBER_CONDITION_DEFAULTS[kind] } : next);
      }}>
        {groups.map(g => <optgroup key={g.label} label={g.label}>{g.options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</optgroup>)}
      </select>
    </label>
    {spec.key === OPP_RATE_KEY && <>
      <label>相手の勝率
        <NumberTextInput kind="number" className="cond-picker-number" aria-label={`${label}の相手の勝率`} value={String(Number((spec.oppRate ?? 0.6).toFixed(4)))}
          onCommit={text => { const rate = parseRateInput(text); if (rate !== null) onChange({ ...spec, oppRate: rate }); }} />
      </label>
      <label>以上／未満
        <select value={spec.oppMode ?? 'ge'} onChange={e => onChange({ ...spec, oppMode: e.target.value === 'lt' ? 'lt' : 'ge' })}>
          <option value="ge">以上</option><option value="lt">未満</option>
        </select>
      </label>
    </>}
    {numberKind && <label>{numberKind === 'count' ? '人数' : '点数'}（{numberKind === 'count' ? '人' : '点'}）
      <NumberTextInput kind="count" className="cond-picker-number" aria-label={`${label}の${numberKind === 'count' ? '人数' : '点数'}`} value={String(spec.n ?? NUMBER_CONDITION_DEFAULTS[numberKind])}
        onCommit={text => { const n = Math.floor(Number(text)); if (Number.isFinite(n) && n >= 0) onChange({ ...spec, n }); }} />
    </label>}
  </span>;
}
