import { TrendingUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TrendSeries } from '../../shared/types';
import { fetchTrends } from '../lib/api';

interface TrendsViewProps {
  onGoToUpload: () => void;
}

export function TrendsView({ onGoToUpload }: TrendsViewProps) {
  const [series, setSeries] = useState<TrendSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAnalyte, setSelectedAnalyte] = useState<string>('');

  useEffect(() => {
    let active = true;
    fetchTrends()
      .then((data) => {
        if (!active) return;
        setSeries(data);
        if (data.length > 0) {
          setSelectedAnalyte(data[0].analyte);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const currentSeries = series.find((s) => s.analyte === selectedAnalyte) ?? series[0];

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500">
        Loading longitudinal trends for your session...
      </div>
    );
  }

  if (series.length === 0) {
    return (
      <div className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-10 text-center space-y-4">
        <TrendingUp className="h-8 w-8 text-teal-700 mx-auto" />
        <h2 className="text-lg font-semibold text-slate-900">No Lab Trends Recorded Yet</h2>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          Analyze two or more reports over time in this session to compare analytes like Haemoglobin, Glucose, or Potassium against their printed reference ranges.
        </p>
        <button
          type="button"
          onClick={onGoToUpload}
          className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
        >
          Analyze a Report
        </button>
      </div>
    );
  }

  const latestRefMin = currentSeries?.points.find((p) => p.range_min !== null)?.range_min ?? null;
  const latestRefMax = currentSeries?.points.find((p) => p.range_max !== null)?.range_max ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Longitudinal Analyte Trends</h1>
          <p className="text-sm text-slate-600">
            Track repeated measurements across reports analyzed during this anonymous session.
          </p>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-slate-600 mr-2">Select Analyte:</span>
          <select
            value={currentSeries?.analyte ?? ''}
            onChange={(e) => setSelectedAnalyte(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900"
          >
            {series.map((s) => (
              <option key={s.analyte} value={s.analyte}>
                {s.analyte} ({s.points.length} reading{s.points.length > 1 ? 's' : ''})
              </option>
            ))}
          </select>
        </label>
      </div>

      {currentSeries && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-5">
          <div className="flex items-baseline justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {currentSeries.analyte} ({currentSeries.unit || 'unitless'})
              </h2>
              {latestRefMin !== null && latestRefMax !== null && (
                <p className="text-xs text-slate-500 font-mono">
                  Shaded Reference Band: {latestRefMin} – {latestRefMax} {currentSeries.unit}
                </p>
              )}
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={currentSeries.points} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#475569' }} />
                <YAxis tick={{ fontSize: 12, fill: '#475569' }} domain={['auto', 'auto']} />
                <Tooltip />
                {latestRefMin !== null && latestRefMax !== null && (
                  <ReferenceArea y1={latestRefMin} y2={latestRefMax} fill="#DCFCE7" fillOpacity={0.55} />
                )}
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#0F766E"
                  strokeWidth={2.5}
                  dot={{ r: 5, fill: '#0F766E' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto border-t border-slate-100 pt-4">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-2 pr-4 font-medium">Report Date</th>
                  <th className="py-2 pr-4 font-medium text-right">Value</th>
                  <th className="py-2 pr-4 font-medium">Printed Range</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {currentSeries.points.map((pt, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-700">{pt.date}</td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {pt.value} {pt.unit}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-600">{pt.reference_range}</td>
                    <td className="py-2 text-xs font-medium text-slate-700">{pt.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
