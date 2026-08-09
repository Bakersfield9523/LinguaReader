import { useState, useEffect, useCallback } from 'react';
import { Clock } from 'lucide-react';
import { ReadingDayDB } from '@/lib/db';

interface WeeklyReadingCardProps {
  onClick?: () => void;
}

export function WeeklyReadingCard({ onClick }: WeeklyReadingCardProps) {
  const [weeklyData, setWeeklyData] = useState<{ day: string; minutes: number }[]>([]);
  const [totalMinutes, setTotalMinutes] = useState(0);

  const loadData = useCallback(async () => {
    const weekly = await ReadingDayDB.getWeeklyData();
    const labels = ['一', '二', '三', '四', '五', '六', '日'];
    setWeeklyData(weekly.map((d, i) => ({ day: labels[i], minutes: d.minutes })));
    setTotalMinutes(weekly.reduce((sum, d) => sum + d.minutes, 0));
  }, []);

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 30000);
    return () => clearInterval(timer);
  }, [loadData]);

  const maxMinutes = Math.max(...weeklyData.map(d => d.minutes), 1);

  const formatDuration = (minutes: number) => {
    if (minutes === 0) return '0分钟';
    if (minutes < 60) return `${minutes}分钟`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (m === 0) return `${h}小时`;
    return `${h}小时${m}分钟`;
  };

  return (
    <div
      className="bg-[#1e2125]/90 backdrop-blur-sm rounded-2xl p-4 border border-white/10 cursor-pointer hover:border-white/20 transition-all w-[220px]"
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-[#e5a349]" />
          <span className="text-sm text-white/70">本周阅读</span>
        </div>
        <span className="text-base font-bold text-white">{formatDuration(totalMinutes)}</span>
      </div>

      {/* Bar Chart */}
      <div className="flex items-end gap-1.5 h-10 mb-2">
        {weeklyData.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
            <div
              className="w-full rounded-sm bg-[#e5a349] transition-all"
              style={{
                height: d.minutes > 0 ? `${Math.max((d.minutes / maxMinutes) * 28, 3)}px` : '2px',
                opacity: d.minutes > 0 ? 1 : 0.15,
              }}
            />
          </div>
        ))}
      </div>

      {/* Day Labels */}
      <div className="flex gap-1.5 mb-1">
        {weeklyData.map((d, i) => (
          <div key={i} className="flex-1 text-center">
            <span className={`text-[9px] ${d.minutes > 0 ? 'text-[#e5a349]' : 'text-white/25'}`}>{d.day}</span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <p className="text-[10px] text-white/30 text-center">点击查看完整日历</p>
    </div>
  );
}
