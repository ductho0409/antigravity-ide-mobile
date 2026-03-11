import type { FunctionalComponent } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { TrendingUp } from 'lucide-preact';
import { showToast, PageHeader, TechCard } from './utils';
import { useTranslation } from '../../i18n';
import { authFetch } from '../../hooks/useApi';

interface AnalyticsData {
    totals: {
        screenshots: number;
        errors: number;
        commands: number;
    };
    totalUptime: string;
    dailyStats: Record<string, { screenshots?: number; errors?: number; commands?: number }>;
}

export const AnalyticsPage: FunctionalComponent = () => {
    const { t } = useTranslation();
    const [data, setData] = useState<AnalyticsData | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const loadAnalytics = async (): Promise<void> => {
        try {
            const res = await authFetch('/api/admin/analytics');
            const d = await res.json() as AnalyticsData;
            setData(d);
        } catch { showToast(t('analytics.toast.loadError'), 'error'); }
    };

    useEffect(() => { loadAnalytics(); }, []);

    // Render grouped multi-bar chart
    useEffect(() => {
        if (!canvasRef.current || !data?.dailyStats) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const rect = canvas.parentElement?.getBoundingClientRect();
        canvas.width = (rect?.width || 600) * 2;
        canvas.height = 400;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Get last 7 days
        const days: string[] = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            days.push(d.toISOString().slice(0, 10));
        }

        const barWidth = Math.floor((canvas.width - 80) / days.length / 3);
        const maxVal = Math.max(1, ...days.flatMap(d => {
            const s = data.dailyStats[d] || {};
            return [s.screenshots || 0, s.errors || 0, s.commands || 0];
        }));

        const chartH = canvas.height - 60;
        const colors = ['#34d399', '#f87171', '#fbbf24'];
        const labels = [t('analytics.chart.screenshots'), t('analytics.chart.errors'), t('analytics.chart.commands')];

        days.forEach((day, i) => {
            const s = data.dailyStats[day] || {};
            const vals = [s.screenshots || 0, s.errors || 0, s.commands || 0];
            const groupX = 60 + i * ((canvas.width - 80) / days.length);

            vals.forEach((v, j) => {
                const h = (v / maxVal) * (chartH - 20);
                const x = groupX + j * (barWidth + 2);
                ctx.fillStyle = colors[j];
                ctx.fillRect(x, chartH - h + 10, barWidth, h);
                if (v > 0) {
                    ctx.fillStyle = '#999';
                    ctx.font = '16px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(String(v), x + barWidth / 2, chartH - h + 4);
                }
            });

            // Day label
            ctx.fillStyle = '#999';
            ctx.font = '16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(day.slice(5), groupX + (barWidth * 2), chartH + 28);
        });

        // Legend
        labels.forEach((l, i) => {
            const lx = 60 + i * 100;
            ctx.fillStyle = colors[i];
            ctx.fillRect(lx, canvas.height - 18, 12, 12);
            ctx.fillStyle = '#999';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(l, lx + 16, canvas.height - 7);
        });
    }, [data, t]);

    const totals = data?.totals;

    return (
        <div>
            <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-8">
                <PageHeader label={t('analytics.label')} title={t('analytics.title')} description={t('analytics.description')} />
                <div class="flex gap-2 shrink-0">
                    <button class="inline-flex items-center gap-2 px-4 py-2 font-mono text-[12px] font-bold tracking-widest uppercase border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors cursor-pointer" onClick={loadAnalytics}>{t('common.refresh')}</button>
                </div>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-[1px] bg-[var(--border-color)] border border-[var(--border-color)] mb-5">
                <div class="bg-[var(--surface-color)] p-5 relative">
                    <div class="crosshair"></div>
                    <div class="stat-number">{totals?.screenshots ?? '—'}</div>
                    <div class="text-xs text-[var(--text-secondary)] mt-1 font-mono uppercase tracking-wider">{t('analytics.stat.screenshots')}</div>
                </div>
                <div class="bg-[var(--surface-color)] p-5 relative">
                    <div class="crosshair"></div>
                    <div class="stat-number !text-[var(--error)]">{totals?.errors ?? '—'}</div>
                    <div class="text-xs text-[var(--text-secondary)] mt-1 font-mono uppercase tracking-wider">{t('analytics.stat.errors')}</div>
                </div>
                <div class="bg-[var(--surface-color)] p-5 relative">
                    <div class="crosshair"></div>
                    <div class="stat-number">{totals?.commands ?? '—'}</div>
                    <div class="text-xs text-[var(--text-secondary)] mt-1 font-mono uppercase tracking-wider">{t('analytics.stat.commands')}</div>
                </div>
                <div class="bg-[var(--surface-color)] p-5 relative">
                    <div class="crosshair"></div>
                    <div class="stat-number !text-[var(--success)]">{data?.totalUptime ?? '—'}</div>
                    <div class="text-xs text-[var(--text-secondary)] mt-1 font-mono uppercase tracking-wider">{t('analytics.stat.uptime')}</div>
                </div>
            </div>

            <TechCard>
                <div class="section-label mb-5 flex items-center gap-1.5">
                    <TrendingUp size={14} /> {t('analytics.chart.title')}
                </div>
                <div class="flex gap-3 mb-3 text-[11px]">
                    <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm bg-[#34d399]" /> {t('analytics.chart.screenshots')}</span>
                    <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm bg-[#f87171]" /> {t('analytics.chart.errors')}</span>
                    <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm bg-[#fbbf24]" /> {t('analytics.chart.commands')}</span>
                </div>
                <canvas ref={canvasRef} class="w-full" style="height: 200px" />
            </TechCard>
        </div>
    );
};
