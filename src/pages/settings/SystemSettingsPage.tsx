import { useEffect, useRef, useState } from "react";
import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Database,
  LayoutDashboard,
  MessageSquareText,
  PenLine,
  RefreshCw,
  UsersRound,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCount } from "../../lib/format";
import type { AnalyticsData, CollectionTask } from "../../types";

const API_BASE_URL = import.meta.env.VITE_STORAGE_API_BASE_URL || "http://127.0.0.1:5174";
const ANALYTICS_CACHE_KEY = "xhs-system-analytics-pg-cache-v6";
const STATUS_COLORS: Record<CollectionTask["status"], string> = {
  completed: "#2563eb",
  running: "#0ea5e9",
  queued: "#94a3b8",
  paused: "#f59e0b",
  failed: "#ef4444",
};
const STATUS_LABELS: Record<CollectionTask["status"], string> = {
  completed: "已完成",
  running: "采集中",
  queued: "排队中",
  paused: "已暂停",
  failed: "失败",
};

export function SystemSettingsPage({ onOpenTask, onOpenTaskList, onOpenComments, onOpenUserPool, onOpenUser }: {
  onOpenTask: (taskId: string) => void;
  onOpenTaskList: () => void;
  onOpenComments: () => void;
  onOpenUserPool: () => void;
  onOpenUser: (userId: string) => void;
}) {
  const [initialCache] = useState(readAnalyticsCache);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(initialCache?.data ?? null);
  const [loading, setLoading] = useState(!initialCache);
  const [loadError, setLoadError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [taskPage, setTaskPage] = useState(1);
  const [lastUpdated, setLastUpdated] = useState(() => initialCache ? new Date(initialCache.savedAt) : new Date());
  // 日期范围筛选，默认最近 7 天
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  // 记录初始默认日期，切换日期后不再使用本地缓存
  const initialDates = useRef({ start: startDate, end: endDate });

  useEffect(() => {
    const controller = new AbortController();

    async function loadAnalytics() {
      // 仅首次加载且日期未改变时使用缓存
      const datesChanged = startDate !== initialDates.current.start || endDate !== initialDates.current.end;
      if (refreshKey === 0 && initialCache && !datesChanged) return;

      setLoading(true);
      setLoadError("");
      try {
        const params = new URLSearchParams();
        if (startDate) params.set("startDate", startDate);
        if (endDate) params.set("endDate", endDate);
        const response = await fetch(`${API_BASE_URL}/api/storage/analytics?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`系统数据接口返回 ${response.status}`);
        const data = await response.json() as AnalyticsData;
        if (!isAnalyticsData(data)) throw new Error("系统数据接口结构不完整");
        const savedAt = new Date();
        setAnalytics(data);
        setLastUpdated(savedAt);
        writeAnalyticsCache(data, savedAt);
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(error instanceof Error ? error.message : "云数据库读取失败");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadAnalytics();
    return () => controller.abort();
  }, [initialCache, refreshKey, startDate, endDate]);

  useEffect(() => {
    setTaskPage(1);
  }, [analytics]);

  if (loading && !analytics) {
    return <DataState loading title="正在读取云端 PG 数据" onRetry={() => setRefreshKey((value) => value + 1)} />;
  }
  if (!analytics) {
    return <DataState title="云端数据加载失败" message={loadError} onRetry={() => setRefreshKey((value) => value + 1)} />;
  }
  if (!isAnalyticsData(analytics)) {
    return (
      <DataState
        title="本地缓存版本已失效"
        message="请重新读取云端 PG 数据"
        onRetry={() => {
          window.localStorage.removeItem(ANALYTICS_CACHE_KEY);
          setRefreshKey((value) => value + 1);
        }}
      />
    );
  }

  const statusData = analytics.taskStatuses.map((item) => ({
    status: item.status,
    name: STATUS_LABELS[item.status] ?? item.status,
    value: item.count,
  }));
  const trendData = analytics.taskTrend.map((item) => ({
    ...item,
    label: formatTrendDate(item.date),
  }));
  const completedTasks = analytics.taskStatuses.find((item) => item.status === "completed")?.count ?? 0;
  const failedTasks = analytics.taskStatuses.find((item) => item.status === "failed")?.count ?? 0;
  const settledTasks = completedTasks + failedTasks;
  const successRate = settledTasks ? Math.round((completedTasks / settledTasks) * 100) : 0;
  const runningTasks = analytics.taskStatuses.find((item) => item.status === "running")?.count ?? 0;
  const dataRecords = analytics.summary.posts + analytics.summary.comments;
  const hasData = Object.values(analytics.summary).some((value) => value > 0);
  const taskPageCount = Math.max(1, Math.ceil(analytics.recentTasks.length / 10));
  const safeTaskPage = Math.min(taskPage, taskPageCount);
  const visibleTasks = analytics.recentTasks.slice((safeTaskPage - 1) * 10, safeTaskPage * 10);
  const llm = analytics.llmMetrics;
  const totalTokensK = llm?.totalTokens ? (llm.totalTokens / 1000).toFixed(1) : "0";

  return (
    <section className="audit-dashboard" aria-label="系统数据分析">
      <header className="audit-header">
        <div>
          <div className="audit-title-row">
              <span className="audit-title-icon"><LayoutDashboard size={20} /></span>
            <div>
              <h1>系统数据中心</h1>

            </div>
          </div>
        </div>
        <div className="audit-date-filter">
          <label className="audit-date-label">
            <span>起始</span>
            <input
              type="date"
              className="audit-date-input"
              value={startDate}
              max={endDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <span className="audit-date-sep">—</span>
          <label className="audit-date-label">
            <span>截止</span>
            <input
              type="date"
              className="audit-date-input"
              value={endDate}
              min={startDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
        </div>
        <div className="audit-header-actions">
          <span className="audit-updated">更新于 {formatClock(lastUpdated)}</span>
          <button
            className="audit-icon-button"
            type="button"
            title="刷新系统数据"
            aria-label="刷新系统数据"
            disabled={loading}
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            <RefreshCw size={17} className={loading ? "spin" : undefined} />
          </button>
        </div>
      </header>

      {loadError && <div className="audit-cache-warning">刷新失败，当前继续展示上次从云 PG 读取的缓存数据：{loadError}</div>}

      <div className="audit-metrics">
        <MetricCard
          icon={Activity}
          label="采集任务"
          value={formatCount(analytics.summary.tasks)}
          detail={runningTasks ? `${runningTasks} 个任务正在运行` : "当前无运行中任务"}
          tone="blue"
          actionLabel="查看任务列表"
          onClick={onOpenTaskList}
        />
        <MetricCard
          icon={CheckCircle2}
          label="任务成功率"
          value={`${successRate}%`}
          detail={`${completedTasks} 成功 · ${failedTasks} 失败`}
          tone="cyan"
        />
        <MetricCard
          icon={Database}
          label="数据资产"
          value={formatCount(dataRecords)}
          detail={`${formatCount(analytics.summary.posts)} 帖子 · ${formatCount(analytics.summary.comments)} 评论`}
          tone="indigo"
          actionLabel="查看评论池"
          onClick={onOpenComments}
        />
        <MetricCard
          icon={UsersRound}
          label="用户数据"
          value={formatCount(analytics.summary.users)}
          detail={`${analytics.ipLocations.length} 个地域来源`}
          tone="slate"
          actionLabel="查看用户池"
          onClick={onOpenUserPool}
        />
        <MetricCard
          icon={BrainCircuit}
          label="模型 Token 消耗"
          value={`${totalTokensK}K`}
          detail={llm ? `输入 ${formatCount(llm.totalPromptTokens)} · 输出 ${formatCount(llm.totalCompletionTokens)} · ${formatCount(llm.callCount)} 次调用` : "暂无模型调用数据"}
          tone="violet"
        />
        <article className="audit-metric audit-metric-amber">
          <span className="audit-metric-icon"><Clock3 size={19} /></span>
          <div>
            <p>模型响应耗时</p>
            <strong>{llm ? `${(llm.avgDurationMs / 1000).toFixed(1)}s` : "--"}</strong>
            <span>{llm ? `最快 ${(llm.minDurationMs / 1000).toFixed(1)}s · 最慢 ${(llm.maxDurationMs / 1000).toFixed(1)}s · ${formatCount(llm.callCount)} 次调用` : "暂无调用数据"}</span>
          </div>
        </article>
      </div>

      {!hasData ? (
        <div className="audit-empty">
          <Database size={34} />
          <strong>暂无审计数据</strong>
          <p>完成首个采集任务后，这里将展示系统运行与数据资产情况。</p>
        </div>
      ) : (
        <>
          <div className="audit-primary-grid">
            <ChartPanel title="近 7 日任务趋势" subtitle="按任务创建时间统计" className="audit-trend-panel">
              <ResponsiveContainer width="100%" height={270}>
                <AreaChart data={trendData} margin={{ top: 18, right: 12, left: -22, bottom: 0 }}>
                  <defs>
                    <linearGradient id="auditTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563eb" stopOpacity={0.24} />
                      <stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#e8eef6" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#718096", fontSize: 13 }} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#718096", fontSize: 13 }} />
                  <Tooltip content={<AuditTooltip unit="个任务" />} />
                  <Area type="monotone" dataKey="count" name="任务数" stroke="#2563eb" strokeWidth={2.5} fill="url(#auditTrendFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartPanel>

            <ChartPanel title="任务状态" subtitle={`共 ${analytics.summary.tasks} 个任务`}>
              <div className="audit-status-chart">
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={78} paddingAngle={3} stroke="none">
                      {statusData.map((item) => <Cell key={item.status} fill={STATUS_COLORS[item.status]} />)}
                    </Pie>
                    <Tooltip content={<AuditTooltip unit="个任务" />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="audit-status-total"><strong>{analytics.summary.tasks}</strong><span>全部任务</span></div>
              </div>
              <div className="audit-legend">
                {statusData.map((item) => (
                  <span key={item.status}><i style={{ background: STATUS_COLORS[item.status] }} />{item.name}<strong>{item.value}</strong></span>
                ))}
              </div>
            </ChartPanel>
          </div>

          <div className="audit-secondary-grid">
            <ChartPanel title="渠道数据覆盖" subtitle="按一级渠道对比帖子、评论与用户分布">
              <ChannelDistribution rows={buildChannelCoverage(analytics)} />
            </ChartPanel>

            <ChartPanel title="用户地域分布" subtitle="按用户 IP 属地统计">
              <div className="audit-location-list">
                {analytics.ipLocations.slice(0, 10).map((item, index) => {
                  const max = analytics.ipLocations[0]?.count || 1;
                  return (
                    <div className="audit-location-row" key={item.ip_location}>
                      <span className="audit-location-rank">{String(index + 1).padStart(2, "0")}</span>
                      <div><span>{item.ip_location || "未知"}</span><i><b style={{ width: `${Math.max(8, (item.count / max) * 100)}%` }} /></i></div>
                      <strong>{formatCount(item.count)}</strong>
                    </div>
                  );
                })}
                {!analytics.ipLocations.length && <p className="audit-panel-empty">暂无地域数据</p>}
              </div>
            </ChartPanel>
          </div>

          <div className="audit-ranking-grid">
            <RankingPanel
              icon={PenLine}
              title="发帖作者 TOP"
              subtitle="按已采集帖子数量排序"
              rows={analytics.topAuthors}
              unit="篇"
              onSelect={onOpenUser}
            />
            <RankingPanel
              icon={MessageSquareText}
              title="评论用户 TOP"
              subtitle="按已采集评论次数排序"
              rows={analytics.topCommenters}
              unit="次"
              onSelect={onOpenUser}
            />
          </div>

          <section className="audit-log-panel">
            <div className="audit-panel-heading">
              <div><h2>近期任务记录</h2><p>最新任务事件与异常信息</p></div>
              <span>共 {analytics.recentTasks.length} 条记录</span>
            </div>
            <div className="audit-log-table">
              <div className="audit-log-head"><span>时间</span><span>事件</span><span>任务</span><span>说明</span></div>
              {visibleTasks.map((entry) => (
                <div className="audit-log-row" key={entry.id}>
                  <span>{formatAuditTime(entry.createdAt)}</span>
                  <span className="audit-event"><EventIcon status={entry.status} />{STATUS_LABELS[entry.status] ?? entry.status}</span>
                  <button className="audit-task-link" type="button" title="查看任务详情" onClick={() => onOpenTask(entry.id)}>{entry.keyword}</button>
                  <span title={entry.message}>{entry.message}</span>
                </div>
              ))}
              {!analytics.recentTasks.length && <p className="audit-panel-empty">暂无任务事件记录</p>}
            </div>
            {analytics.recentTasks.length > 10 && (
              <div className="audit-pagination">
                <button type="button" title="上一页" aria-label="上一页" disabled={safeTaskPage === 1} onClick={() => setTaskPage((page) => Math.max(1, page - 1))}>
                  <ChevronLeft size={16} />
                </button>
                <span>第 {safeTaskPage} / {taskPageCount} 页</span>
                <button type="button" title="下一页" aria-label="下一页" disabled={safeTaskPage === taskPageCount} onClick={() => setTaskPage((page) => Math.min(taskPageCount, page + 1))}>
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}

function DataState({ loading = false, title, message, onRetry }: {
  loading?: boolean;
  title: string;
  message?: string;
  onRetry: () => void;
}) {
  return (
    <section className="audit-dashboard">
      <div className="audit-empty">
        {loading ? <RefreshCw size={30} className="spin" /> : <CircleAlert size={30} />}
        <strong>{title}</strong>
        {message && <p>{message}</p>}
        {!loading && <button className="audit-retry-button" type="button" onClick={onRetry}>重新读取云端数据</button>}
      </div>
    </section>
  );
}

function MetricCard({ icon: Icon, label, value, detail, tone, actionLabel, onClick }: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
  tone: "blue" | "cyan" | "indigo" | "slate" | "violet" | "amber";
  actionLabel?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="audit-metric-icon"><Icon size={19} /></span>
      <div><p>{label}</p><strong>{value}</strong><span>{detail}</span></div>
    </>
  );

  return onClick ? (
    <button className={`audit-metric audit-metric-${tone} clickable`} type="button" title={actionLabel} aria-label={actionLabel} onClick={onClick}>
      {content}
    </button>
  ) : (
    <article className={`audit-metric audit-metric-${tone}`}>{content}</article>
  );
}

function ChartPanel({ title, subtitle, className = "", children }: {
  title: string;
  subtitle: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`audit-chart-panel ${className}`}>
      <div className="audit-panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div>
      {children}
    </section>
  );
}

function RankingPanel({ icon: Icon, title, subtitle, rows, unit, onSelect }: {
  icon: typeof Activity;
  title: string;
  subtitle: string;
  rows: Array<{ id: string; name: string; avatar?: string; count: number }>;
  unit: string;
  onSelect: (userId: string) => void;
}) {
  const max = rows[0]?.count || 1;
  return (
    <section className="audit-chart-panel audit-ranking-panel">
      <div className="audit-panel-heading">
        <div><h2>{title}</h2><p>{subtitle}</p></div>
        <span className="audit-ranking-icon"><Icon size={16} /></span>
      </div>
      <div className="audit-ranking-list">
        {rows.map((row, index) => (
          <div
            className="audit-ranking-row clickable"
            key={row.id}
            role="button"
            tabIndex={0}
            title="在用户池中查看"
            onClick={() => onSelect(row.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onSelect(row.id);
            }}
          >
            <span className={`audit-ranking-number rank-${index + 1}`}>{index + 1}</span>
            {row.avatar ? (
              <img className="audit-ranking-avatar" src={row.avatar} alt="" />
            ) : (
              <span className="audit-ranking-avatar">{row.name.trim().slice(0, 1).toUpperCase() || "?"}</span>
            )}
            <div>
              <strong title={row.name}>{row.name}</strong>
              <i><b style={{ width: `${Math.max(8, (row.count / max) * 100)}%` }} /></i>
            </div>
            <span className="audit-ranking-count"><strong>{formatCount(row.count)}</strong>{unit}</span>
          </div>
        ))}
        {!rows.length && <p className="audit-panel-empty">暂无可排行数据</p>}
      </div>
    </section>
  );
}

function ChannelDistribution({ rows }: {
  rows: Array<{ channel: string; posts: number; comments: number; users: number }>;
}) {
  const maximums = {
    posts: Math.max(1, ...rows.map((row) => row.posts)),
    comments: Math.max(1, ...rows.map((row) => row.comments)),
    users: Math.max(1, ...rows.map((row) => row.users)),
  };

  return (
    <div className="audit-channel-table">
      <div className="audit-channel-head"><span>一级渠道</span><span>帖子</span><span>评论</span><span>用户</span></div>
      <div className="audit-channel-body">
        {rows.map((row) => (
          <div className="audit-channel-row" key={row.channel}>
            <strong title={row.channel}>{row.channel}</strong>
            <ChannelMetric value={row.posts} maximum={maximums.posts} tone="posts" />
            <ChannelMetric value={row.comments} maximum={maximums.comments} tone="comments" />
            <ChannelMetric value={row.users} maximum={maximums.users} tone="users" />
          </div>
        ))}
        {!rows.length && <p className="audit-panel-empty">暂无渠道数据</p>}
      </div>
    </div>
  );
}

function ChannelMetric({ value, maximum, tone }: { value: number; maximum: number; tone: string }) {
  return (
    <div className={`audit-channel-metric ${tone}`}>
      <span><i style={{ width: `${Math.max(value ? 8 : 0, (value / maximum) * 100)}%` }} /></span>
      <strong>{formatCount(value)}</strong>
    </div>
  );
}

function AuditTooltip({ active, payload, label, unit = "" }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="audit-tooltip">
      {label ? <strong>{label}</strong> : null}
      {payload.map((item: any) => <span key={item.name} style={{ color: item.color }}>{item.name}：{item.value}{unit}</span>)}
    </div>
  );
}

function EventIcon({ status }: { status: CollectionTask["status"] }) {
  return status === "failed" ? <CircleAlert size={15} /> : <Activity size={15} />;
}

function buildChannelCoverage(data: AnalyticsData) {
  const channels = new Set([
    ...data.channelTasks.map((item) => item.channel),
    ...data.channelPosts.map((item) => item.channel),
    ...data.channelComments.map((item) => item.channel),
    ...data.channelUsers.map((item) => item.channel),
  ]);
  const valueFor = (rows: Array<{ channel: string; count: number }>, channel: string) => rows.find((item) => item.channel === channel)?.count ?? 0;
  return Array.from(channels, (channel) => ({
    channel,
    posts: valueFor(data.channelPosts, channel),
    comments: valueFor(data.channelComments, channel),
    users: valueFor(data.channelUsers, channel),
  }));
}

function formatClock(value: Date) {
  return value.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatTrendDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : `${date.getMonth() + 1}/${date.getDate()}`;
}

function readAnalyticsCache(): { data: AnalyticsData; savedAt: string } | null {
  try {
    const raw = window.localStorage.getItem(ANALYTICS_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as { data?: AnalyticsData; savedAt?: string };
    return cache.data && cache.savedAt && isAnalyticsData(cache.data)
      ? { data: cache.data, savedAt: cache.savedAt }
      : null;
  } catch {
    return null;
  }
}

function isAnalyticsData(value: unknown): value is AnalyticsData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<AnalyticsData>;
  return Boolean(
    data.summary
    && typeof data.summary.tasks === "number"
    && typeof data.summary.posts === "number"
    && typeof data.summary.comments === "number"
    && typeof data.summary.users === "number"
    && Array.isArray(data.taskStatuses)
    && Array.isArray(data.taskTrend)
    && Array.isArray(data.channelTasks)
    && Array.isArray(data.channelPosts)
    && Array.isArray(data.channelComments)
    && Array.isArray(data.channelUsers)
    && Array.isArray(data.ipLocations)
    && Array.isArray(data.topAuthors)
    && Array.isArray(data.topCommenters)
    && Array.isArray(data.recentTasks)
  );
}

function writeAnalyticsCache(data: AnalyticsData, savedAt: Date) {
  window.localStorage.setItem(ANALYTICS_CACHE_KEY, JSON.stringify({ data, savedAt: savedAt.toISOString() }));
}

function formatAuditTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
