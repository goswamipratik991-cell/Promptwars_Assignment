import { Bar, BarChart, ReferenceArea, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import type { Finding } from '../../shared/types';

interface RangeBarProps {
  finding: Finding;
}

export function RangeBar({ finding }: RangeBarProps) {
  const val = finding.numeric_value;
  const min = finding.range_min;
  const max = finding.range_max;

  if (val === null || val === undefined || (min === null && max === null)) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums py-2">
        <span className="h-1.5 w-24 bg-slate-200 rounded-sm inline-block" />
        <span>No numeric scale</span>
      </div>
    );
  }

  // Determine clean horizontal scale
  const lowBound = min ?? 0;
  const highBound = max ?? Math.max(val * 1.4, lowBound * 2);
  const span = Math.max(highBound - lowBound, 1);

  const domainMin = Math.min(lowBound - span * 0.45, val - span * 0.15);
  const domainMax = Math.max(highBound + span * 0.45, val + span * 0.15);

  const markerColor =
    finding.status === 'POTENTIALLY_URGENT'
      ? '#B91C1C'
      : finding.status === 'ABNORMAL_MILD' || finding.status === 'ABNORMAL_SIGNIFICANT'
        ? '#B45309'
        : '#15803D';

  const data = [{ name: finding.name, value: val }];

  return (
    <div className="w-full max-w-[240px]" aria-label={`Range bar for ${finding.name}`}>
      <div className="h-9 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 6, right: 8, bottom: 6, left: 8 }}>
            <XAxis type="number" domain={[domainMin, domainMax]} hide />
            <YAxis type="category" dataKey="name" hide />
            {min !== null && max !== null && (
              <ReferenceArea x1={min} x2={max} fill="#DCFCE7" fillOpacity={0.9} stroke="#86EFAC" strokeWidth={1} />
            )}
            {min === null && max !== null && (
              <ReferenceArea x1={domainMin} x2={max} fill="#DCFCE7" fillOpacity={0.9} stroke="#86EFAC" strokeWidth={1} />
            )}
            {min !== null && max === null && (
              <ReferenceArea x1={min} x2={domainMax} fill="#DCFCE7" fillOpacity={0.9} stroke="#86EFAC" strokeWidth={1} />
            )}
            <Bar dataKey="value" barSize={6} fill="transparent" isAnimationActive={false} />
            <ReferenceLine
              x={val}
              stroke={markerColor}
              strokeWidth={3}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-between text-[11px] font-mono tabular-nums text-slate-500 px-1 -mt-1">
        <span>{min !== null ? min : '0'}</span>
        <span className="font-semibold text-slate-700">You: {val}</span>
        <span>{max !== null ? max : `${min}+`}</span>
      </div>
    </div>
  );
}
