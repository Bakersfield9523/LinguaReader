import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Clock, Flame } from 'lucide-react';
import { ReadingDayDB } from '@/lib/db';
import type { ReadingDay } from '@/types';

interface ReadingCalendarProps {
  onClose: () => void;
}

const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const WEEK_LABELS = ['一', '', '三', '', '五', '', '日'];

function formatDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 热力颜色按固定时长阈值分级：
// 0分钟=暗底 | ≤10分钟=最浅绿 | ≤45分钟=第二浅绿 | ≤90分钟=第二深绿 | >90分钟=最深绿
const HEAT_COLORS = ['#3d424a', '#39d353', '#26a641', '#006d32', '#0e4429'];
function getHeatColor(minutes: number): string {
  if (minutes === 0) return HEAT_COLORS[0];
  if (minutes <= 10) return HEAT_COLORS[1];  // 最浅绿：10分钟及以下
  if (minutes <= 45) return HEAT_COLORS[2];  // 第二浅绿：10~45分钟
  if (minutes <= 90) return HEAT_COLORS[3];  // 第二深绿：45~90分钟
  return HEAT_COLORS[4];                      // 最深绿：90分钟以上
}

function formatDuration(minutes: number): string {
  if (minutes === 0) return '0分钟';
  if (minutes < 60) return `${minutes}分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}小时`;
  return `${h}小时${m}分钟`;
}

export function ReadingCalendar({ onClose }: ReadingCalendarProps) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [days, setDays] = useState<Map<string, ReadingDay>>(new Map());
  const [stats, setStats] = useState({ totalDays: 0, totalMinutes: 0, streak: 0, maxMinutes: 0 });
  const [weeklyData, setWeeklyData] = useState<{ label: string; minutes: number }[]>([]);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const heatmapRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    const allDays = await ReadingDayDB.getAll();
    const map = new Map<string, ReadingDay>();
    allDays.forEach(d => map.set(d.date, d));
    setDays(map);
    const s = await ReadingDayDB.getStats();
    setStats(s);
    const weekly = await ReadingDayDB.getWeeklyData();
    const labels = ['一', '二', '三', '四', '五', '六', '日'];
    setWeeklyData(weekly.map((d, i) => ({ label: labels[i], minutes: d.minutes })));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 生成全年热力图
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);
  const startDow = yearStart.getDay() || 7;
  const gridStart = new Date(yearStart);
  gridStart.setDate(yearStart.getDate() - (startDow - 1));

  const weeks: { date: string; minutes: number; inYear: boolean }[][] = [];
  let cursor = new Date(gridStart);
  while (cursor <= yearEnd || weeks.length < 1) {
    const week: { date: string; minutes: number; inYear: boolean }[] = [];
    let hasYearDay = false;
    for (let d = 0; d < 7; d++) {
      const inYear = cursor.getFullYear() === year;
      if (inYear) hasYearDay = true;
      const dateStr = formatDateStr(cursor);
      const data = days.get(dateStr);
      week.push({ date: dateStr, minutes: inYear ? (data?.minutes || 0) : 0, inYear });
      cursor.setDate(cursor.getDate() + 1);
    }
    // 先 push 再判断是否退出，确保最后一周也被包含
    weeks.push(week);
    if (!hasYearDay) break;
  }

  // 月份标签位置
  const monthPositions: { label: string; col: number }[] = [];
  let lastM = -1;
  weeks.forEach((w, wi) => {
    const mid = w[3];
    if (!mid || !mid.inYear) return;
    const m = new Date(mid.date + 'T00:00:00').getMonth();
    if (m !== lastM) {
      monthPositions.push({ label: MONTH_NAMES[m], col: wi });
      lastM = m;
    }
  });

  const weeklyMax = Math.max(...weeklyData.map(d => d.minutes), 1);
  const currentYear = new Date().getFullYear();

  const showTooltip = (day: { date: string; minutes: number }, e: React.MouseEvent) => {
    const el = tooltipRef.current;
    if (!el) return;
    el.style.display = 'block';
    el.querySelector('span')!.textContent = `${day.date} · ${day.minutes > 0 ? `阅读 ${formatDuration(day.minutes)}` : '无记录'}`;
    moveTooltip(e);
  };

  const moveTooltip = (e: React.MouseEvent) => {
    const el = tooltipRef.current;
    const rect = heatmapRef.current?.getBoundingClientRect();
    if (!el || !rect) return;
    const x = Math.min(e.clientX - rect.left + 12, rect.width - 140);
    const y = e.clientY - rect.top - 40;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };

  const hideTooltip = () => {
    const el = tooltipRef.current;
    if (el) el.style.display = 'none';
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
      onClick={onClose}
      style={{ animation: 'none' }}
    >
      <div
        className="bg-[#2a2d33] rounded-2xl border border-white/10 shadow-2xl w-[680px] max-w-[94vw] p-6"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'none' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e5a349" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>
            </svg>
            <h2 className="text-lg font-bold text-white">阅读日历</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-[#343840] rounded-xl p-4 text-center">
            <Clock className="w-5 h-5 text-[#e5a349] mx-auto mb-2" />
            <p className="text-lg font-bold text-white">{formatDuration(stats.totalMinutes)}</p>
            <p className="text-xs text-white/40 mt-1">总阅读时长</p>
          </div>
          <div className="bg-[#343840] rounded-xl p-4 text-center">
            <Flame className="w-5 h-5 text-orange-400 mx-auto mb-2" />
            <p className="text-lg font-bold text-white">{stats.streak}</p>
            <p className="text-xs text-white/40 mt-1">连续阅读天数</p>
          </div>
          <div className="bg-[#343840] rounded-xl p-4 text-center">
            <BarChart3Icon className="w-5 h-5 text-[#e5a349] mx-auto mb-2" />
            <p className="text-lg font-bold text-white">{stats.totalDays}</p>
            <p className="text-xs text-white/40 mt-1">有阅读记录天数</p>
          </div>
        </div>

        {/* 本周阅读 */}
        <div className="bg-[#343840] rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BarChart3Icon className="w-4 h-4 text-[#e5a349]" />
              <span className="text-sm text-white/60">本周阅读</span>
            </div>
            <span className="text-base font-bold text-white">{formatDuration(weeklyData.reduce((s, d) => s + d.minutes, 0))}</span>
          </div>
          <div className="flex items-end gap-2 h-14">
            {weeklyData.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                {d.minutes > 0 && (
                  <span className="text-[8px] text-white/40">{d.minutes >= 60 ? `${Math.floor(d.minutes / 60)}h` : `${d.minutes}m`}</span>
                )}
                <div className="w-full rounded-md bg-[#e5a349]" style={{ height: `${Math.max((d.minutes / weeklyMax) * 36, 3)}px`, opacity: d.minutes > 0 ? 1 : 0.2 }} />
                <span className="text-[9px] text-white/30">{d.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Year + Heatmap */}
        <div className="flex items-center justify-center gap-2 mb-2">
          <button
            onClick={() => setYear(y => y - 1)}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-[#343840] text-white/60 hover:text-white hover:bg-[#404650] text-sm"
          >{'<'}</button>
          <span className="text-sm font-bold text-white w-12 text-center">{year}</span>
          <button
            onClick={() => setYear(y => Math.min(currentYear, y + 1))}
            className={`w-7 h-7 flex items-center justify-center rounded-full bg-[#343840] text-sm ${year >= currentYear ? 'text-white/20 cursor-not-allowed' : 'text-white/60 hover:text-white hover:bg-[#404650]'}`}
            disabled={year >= currentYear}
          >{'>'}</button>
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-white/25">少</span>
            {HEAT_COLORS.slice(1).map((c, i) => (
              <div key={i} className="rounded-full" style={{ width: '8px', height: '8px', backgroundColor: c }} />
            ))}
            <span className="text-[10px] text-white/25">多</span>
          </div>
        </div>

        {/* Heatmap grid — relative container for tooltip positioning */}
        <div ref={heatmapRef} className="relative flex">
          {/* Week labels */}
          <div className="flex flex-col justify-between mr-1.5 py-0" style={{ height: `${7 * 12 + 6 * 2}px` }}>
            {WEEK_LABELS.map((label, i) => (
              <span key={i} className="text-[8px] text-white/25 leading-none" style={{ height: '10px', display: 'flex', alignItems: 'center' }}>{label}</span>
            ))}
          </div>

          <div className="flex-1">
            {/* Month labels — use a positioned container */}
            <div className="relative flex mb-1" style={{ height: '14px' }}>
              {monthPositions.map((m, i) => (
                <span
                  key={i}
                  className="text-[9px] text-white/30 whitespace-nowrap"
                  style={{ position: 'absolute', left: `${m.col * 12}px` }}
                >
                  {m.label}
                </span>
              ))}
            </div>

            {/* Dots */}
            <div className="flex gap-[2px]" onMouseMove={moveTooltip} onMouseLeave={hideTooltip}>
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-[2px]">
                  {week.map((day, di) => {
                    const isToday = day.date === formatDateStr(new Date());
                    if (!day.inYear) return <div key={di} style={{ width: '10px', height: '10px' }} />;
                    return (
                      <div
                        key={di}
                        className="rounded-full"
                        style={{
                          width: '10px',
                          height: '10px',
                          backgroundColor: getHeatColor(day.minutes),
                          boxShadow: isToday ? '0 0 0 1.5px rgba(255,255,255,0.5)' : 'none',
                        }}
                        onMouseEnter={(e) => showTooltip(day, e)}
                        onMouseLeave={hideTooltip}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Floating tooltip — ref-based, no React re-render */}
          <div
            ref={tooltipRef}
            className="absolute pointer-events-none z-10 px-2 py-1.5 rounded-md bg-[#1a1c20] border border-white/10 shadow-lg"
            style={{ display: 'none', whiteSpace: 'nowrap' }}
          >
            <span className="text-[11px] text-white/80" />
          </div>
        </div>
      </div>
    </div>
  );
}

function BarChart3Icon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>
    </svg>
  );
}
