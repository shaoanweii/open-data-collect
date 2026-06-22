import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import {
  BrainCircuit,
  Building2,
  CarFront,
  Check,
  CheckSquare,
  ChevronDown,
  Clock3,
  Copy,
  ExternalLink,
  FileText,
  MapPin,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  Square,
  Target,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { formatCount, formatDateTime } from "../../lib/format";

const API_BASE_URL = import.meta.env.VITE_STORAGE_API_BASE_URL || "http://127.0.0.1:5174";

type TimeValue = string | number;
type LeadFilter = "all" | "pending" | "frequent";
type LeadSort = "activity" | "recent";
type Rating = "high" | "medium" | "low" | "none";

type LeadComment = {
  commentId: string;
  feedId?: string;
  parentCommentId?: string;
  content?: string;
  ipLocation?: string;
  createTime?: TimeValue;
};

type ClueAnalysis = {
  rating: Rating;
  confidence: number;
  hasPurchaseIntent: boolean;
  userType: string;
  intentTypes: string[];
  concerns: string[];
  brands: string[];
  carSeries: string[];
  competitors: string[];
  summary: string;
  evidence: Array<{ type?: string; id?: string; quote?: string; reason?: string }>;
  salesStrategy: {
    contact_angle?: string;
    key_points?: string[];
    suggested_message?: string;
    avoid?: string[];
  };
  dealerRecommendation: {
    ip_location?: string;
    store_name?: string | null;
    recommendation_basis?: string;
  };
  llmOriginLog?: {
    input?: unknown;
    output?: unknown;
  };
  dataCutoffAt?: string;
  createdAt: string;
  model: string;
};

type LeadCandidate = {
  id: string;
  name: string;
  avatar?: string;
  ipLocation?: string;
  redId?: string;
  desc?: string;
  postCount: number;
  commentCount: number;
  activityCount: number;
  latestComment?: LeadComment;
  latestAt?: TimeValue;
  comments: LeadComment[];
  posts: Array<{ taskId: string; feedId: string; title?: string; desc?: string; publishTime?: TimeValue }>;
  analysis?: ClueAnalysis | null;
  dataCutoffAt?: string;
};

type ScopeTask = { id: string; keyword: string; channel: string; status: string; createdAt: string };
type AnalysisJob = {
  id: string;
  taskId?: string;
  status: "queued" | "running" | "completed" | "failed";
  totalUsers: number;
  completedUsers: number;
  failedUsers: number;
  processedUsers: number;
  progress: number;
  message?: string;
  error?: string;
};

export function CluePoolPage({ onOpenUser, onNavigateToPost }: {
  onOpenUser: (userId: string) => void;
  onNavigateToPost: (feedId: string) => void;
}) {
  const [tasks, setTasks] = useState<ScopeTask[]>([]);
  const [candidates, setCandidates] = useState<LeadCandidate[]>([]);
  // 分析范围：只有「开始全量评级」时提交，不触发页面查询
  const [analyzeScope, setAnalyzeScope] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<LeadFilter>("all");
  const [sort, setSort] = useState<LeadSort>("activity");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [job, setJob] = useState<AnalysisJob | null>(null);
  // 任务下拉菜单状态
  const [tasksOpen, setTasksOpen] = useState(false);
  const tasksDropdownRef = useRef<HTMLDivElement>(null);
  // 批量选择模式
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  // 追踪正在评级的用户 ID，用于即时交互反馈
  const [analyzingUserIds, setAnalyzingUserIds] = useState<Set<string>>(new Set());
  const batchActiveRef = useRef(false); // 批量评级触发标记

  // 点击外部关闭下拉
  const closeDropdown = useCallback(() => setTasksOpen(false), []);
  useEffect(() => {
    if (!tasksOpen) return;
    function handler(e: MouseEvent) {
      if (tasksDropdownRef.current && !tasksDropdownRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [tasksOpen, closeDropdown]);

  // 分析范围切换（不触发页面查询）
  function toggleAnalyzeScope(id: string) {
    setAnalyzeScope((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAllAnalyzeScope() {
    setAnalyzeScope(new Set());
  }

  // 批量选择
  function toggleBatchSelected(id: string) {
    setBatchSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAllBatch() {
    setBatchSelected((prev) =>
      prev.size === visibleCandidates.length
        ? new Set()
        : new Set(visibleCandidates.map((c) => c.id)),
    );
  }
  function exitBatchMode() {
    setBatchMode(false);
    setBatchSelected(new Set());
  }
  function batchRate() {
    if (batchSelected.size === 0) return;
    batchActiveRef.current = true;
    void requestAnalysis([...batchSelected]);
  }

  const selectedTasksLabel = useMemo(() => {
    if (analyzeScope.size === 0) return "全部采集任务";
    if (analyzeScope.size === 1) {
      return tasks.find((t) => t.id === [...analyzeScope][0])?.keyword || "1 个任务";
    }
    return `${analyzeScope.size} 个任务`;
  }, [analyzeScope, tasks]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchJson<{ tasks: ScopeTask[] }>(`${API_BASE_URL}/api/clues/scopes`, { signal: controller.signal })
      .then((payload) => setTasks(payload.tasks))
      .catch((reason) => { if (!controller.signal.aborted) setError(errorMessage(reason)); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    // 页面始终加载全部候选线索，不在下拉选择任务时重新查询
    void fetchJson<{ candidates: LeadCandidate[] }>(`${API_BASE_URL}/api/clues/candidates`, { signal: controller.signal })
      .then((payload) => setCandidates(payload.candidates))
      .catch((reason) => { if (!controller.signal.aborted) setError(errorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return;
    let disposed = false;
    const timer = window.setInterval(() => {
      void fetchJson<{ job: AnalysisJob }>(`${API_BASE_URL}/api/clues/jobs/${job.id}`)
        .then(async (payload) => {
          if (disposed) return;
          setJob(payload.job);
          if (["completed", "failed"].includes(payload.job.status)) {
            window.clearInterval(timer);
            await refreshCandidates(setCandidates);
            setAnalyzingUserIds(new Set());
          }
        })
        .catch((reason) => { if (!disposed) setError(errorMessage(reason)); });
    }, 1200);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [job]);

  // 批量评级完成后自动退出批量模式
  useEffect(() => {
    if (analyzingUserIds.size > 0) return;
    if (!batchActiveRef.current) return;
    batchActiveRef.current = false;
    exitBatchMode();
  }, [analyzingUserIds]);

  const visibleCandidates = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return candidates
      .filter((candidate) => {
        if (filter === "pending" && candidate.analysis) return false;
        if (filter === "frequent" && candidate.activityCount < 3) return false;
        if (!keyword) return true;
        return [candidate.name, candidate.id, candidate.redId, candidate.ipLocation]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(keyword));
      })
      .sort((a, b) => sort === "activity"
        ? b.activityCount - a.activityCount
        : dateValue(b.latestAt) - dateValue(a.latestAt));
  }, [candidates, filter, query, sort]);

  useEffect(() => {
    if (!visibleCandidates.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !visibleCandidates.some((candidate) => candidate.id === selectedId)) {
      setSelectedId(visibleCandidates[0].id);
    }
  }, [selectedId, visibleCandidates]);

  const selected = visibleCandidates.find((candidate) => candidate.id === selectedId) ?? null;
  const frequentUsers = [...candidates]
    .filter((candidate) => candidate.commentCount > 0)
    .sort((a, b) => b.commentCount - a.commentCount || dateValue(b.latestAt) - dateValue(a.latestAt))
    .slice(0, 5);
  const highCount = candidates.filter((candidate) => candidate.analysis?.rating === "high").length;
  const mediumCount = candidates.filter((candidate) => candidate.analysis?.rating === "medium").length;
  const ratedCount = candidates.filter((candidate) => candidate.analysis).length;
  const pendingCount = candidates.length - ratedCount;
  const isAnalyzing = job ? ["queued", "running"].includes(job.status) : false;

  async function requestAnalysis(userIds: string[] = []) {
    setError("");
    if (userIds.length > 0) {
      setAnalyzingUserIds((prev) => new Set([...prev, ...userIds]));
    }
    const scopeTaskId = analyzeScope.size === 0 ? null : [...analyzeScope].join(",");
    try {
      const payload = await fetchJson<{ job: AnalysisJob }>(`${API_BASE_URL}/api/clues/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: scopeTaskId, userIds }),
      });
      setJob(payload.job);
    } catch (reason) {
      setError(errorMessage(reason));
      setAnalyzingUserIds(new Set());
    }
  }

  return (
    <section className="clue-workbench">
      <header className="clue-header">
        <div><h1>潜客线索池</h1><p>基于云端采集数据与模型语义分析进行潜客评级</p></div>
        <div className="clue-header-actions">
          <div className="clue-scope-dropdown" ref={tasksDropdownRef}>
            <button
              className="clue-scope-trigger"
              type="button"
              disabled={isAnalyzing}
              onClick={() => setTasksOpen((v) => !v)}
            >
              <span>{selectedTasksLabel}</span>
              <ChevronDown size={14} className={tasksOpen ? "open" : ""} />
            </button>
            {tasksOpen && (
              <div className="clue-scope-menu">
                <button
                  className={analyzeScope.size === 0 ? "selected" : ""}
                  type="button"
                  onClick={selectAllAnalyzeScope}
                >
                  <span className="clue-scope-check">
                    {analyzeScope.size === 0 ? <Check size={13} /> : <span className="clue-check-empty" />}
                  </span>
                  全部采集任务
                </button>
                {tasks.map((task) => (
                  <button
                    key={task.id}
                    className={analyzeScope.has(task.id) ? "selected" : ""}
                    type="button"
                    onClick={() => toggleAnalyzeScope(task.id)}
                  >
                    <span className="clue-scope-check">
                      {analyzeScope.has(task.id) ? <Check size={13} /> : <span className="clue-check-empty" />}
                    </span>
                    {task.keyword}
                  </button>
                ))}
                {analyzeScope.size > 0 && (
                  <button
                    className="clue-scope-clear"
                    type="button"
                    onClick={selectAllAnalyzeScope}
                  >
                    清除
                  </button>
                )}
              </div>
            )}
          </div>
          <button className="clue-analyze-button" type="button" disabled={isAnalyzing || !candidates.length} onClick={() => void requestAnalysis()}>
            {isAnalyzing ? <RefreshCw size={17} className="spin" /> : <BrainCircuit size={17} />}
            {isAnalyzing ? "评级进行中" : "开始全量评级"}
          </button>
        </div>
      </header>

      {error && <div className="clue-notice error" role="alert">{error}</div>}
      {job && <AnalysisProgress job={job} />}

      <div className="clue-metrics">
        <ClueMetric tone="primary" icon={Target} label="高价值潜客" value={highCount} detail="强意向且需求明确" />
        <ClueMetric tone="accent" icon={CarFront} label="中意向线索" value={mediumCount} detail="有意向但仍在比较" />
        <ClueMetric icon={BrainCircuit} label="已完成评级" value={ratedCount} detail="结果已写入云 PG" />
        <ClueMetric icon={Clock3} label="待评级用户" value={pendingCount} detail={`当前范围共 ${candidates.length} 位`} />
      </div>

      <section className="clue-frequency-band">
        <div className="clue-section-heading">
          <div><h2>高频发评用户排行榜</h2><p>按评论次数排序，展示最近一次发评动态</p></div>
          <span className="clue-ranking-total">TOP {frequentUsers.length}</span>
        </div>
        <div className="clue-frequency-head"><span>名次</span><span>用户</span><span>评论数</span><span>发帖数</span><span>最近发评</span></div>
        <div className="clue-frequency-list">
          {frequentUsers.map((candidate, index) => (
            <button className={candidate.id === selectedId ? "active" : ""} type="button" key={candidate.id} onClick={() => setSelectedId(candidate.id)}>
              <span className={`clue-rank rank-${index + 1}`}>{String(index + 1).padStart(2, "0")}</span>
              <span className="clue-frequency-user"><LeadAvatar lead={candidate} /><span className="clue-frequency-name"><strong>{candidate.name}</strong><small>{candidate.ipLocation || "IP 未知"}</small></span></span>
              <span className="clue-frequency-count"><strong>{candidate.commentCount}</strong> 条</span>
              <span className="clue-frequency-posts">{candidate.postCount} 篇</span>
              <span className="clue-frequency-latest"><strong>{formatShortDate(candidate.latestComment?.createTime)}</strong><small>{candidate.latestComment?.content || "无文本内容"}</small></span>
            </button>
          ))}
          {!frequentUsers.length && <p className="clue-empty-inline">暂无用户评论数据</p>}
        </div>
      </section>

      <div className="clue-toolbar">
        <div className="clue-tabs" role="tablist" aria-label="线索筛选">
          <button className={filter === "all" ? "active" : ""} type="button" onClick={() => setFilter("all")}>潜在线索</button>
          <button className={filter === "pending" ? "active" : ""} type="button" onClick={() => setFilter("pending")}>待评级</button>
          <button className={filter === "frequent" ? "active" : ""} type="button" onClick={() => setFilter("frequent")}>高频互动</button>
        </div>
        <div className="clue-toolbar-actions">
          {!batchMode ? (
            <button
              className="clue-batch-toggle"
              type="button"
              onClick={() => setBatchMode(true)}
            >
              <CheckSquare size={15} /> 批量选择
            </button>
          ) : (
            <button
              className="clue-batch-toggle active"
              type="button"
              onClick={exitBatchMode}
            >
              取消
            </button>
          )}
          <label className="clue-search"><Search size={16} /><input value={query} placeholder="搜索用户、ID、IP" onChange={(event) => setQuery(event.target.value)} /></label>
          <select aria-label="线索排序" value={sort} onChange={(event) => setSort(event.target.value as LeadSort)}>
            <option value="activity">互动次数优先</option><option value="recent">最近互动优先</option>
          </select>
        </div>
      </div>

      <div className="clue-main-grid">
        <section className="clue-queue-panel">
          {batchMode && (
            <div className="clue-batch-bar">
              <button className="clue-batch-select-all" type="button" onClick={toggleAllBatch}>
                {batchSelected.size === visibleCandidates.length ? <CheckSquare size={15} /> : <Square size={15} />}
                全选 ({visibleCandidates.length})
              </button>
              <span className="clue-batch-count">已选 {batchSelected.size} 位用户</span>
              {analyzingUserIds.size > 0 && [...batchSelected].some((id) => analyzingUserIds.has(id)) ? (
                <button className="clue-batch-rate" type="button" disabled>
                  <RefreshCw size={15} className="spin" /> 评级中...
                </button>
              ) : (
                <button className="clue-batch-rate" type="button" disabled={batchSelected.size === 0 || isAnalyzing} onClick={batchRate}>
                  <BrainCircuit size={15} /> 批量评级
                </button>
              )}
            </div>
          )}
          <div className={`clue-queue-head${batchMode ? " batch" : ""}`}>
            {batchMode && <span className="clue-queue-check" />}
            <span>用户</span><span>行为</span><span>最近互动</span><span>状态</span>
          </div>
          <div className={`clue-queue-list${batchMode ? " batch" : ""}`}>
            {visibleCandidates.map((candidate) => {
              const isSelected = batchSelected.has(candidate.id);
              return (
                <button
                  className={candidate.id === selectedId ? "active" : ""}
                  type="button"
                  key={candidate.id}
                  onClick={() => batchMode ? toggleBatchSelected(candidate.id) : setSelectedId(candidate.id)}
                >
                  {batchMode && (
                    <span className="clue-queue-check">
                      {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                    </span>
                  )}
                  <span className="clue-queue-user"><LeadAvatar lead={candidate} /><span><strong>{candidate.name}</strong><small><MapPin size={12} />{candidate.ipLocation || "未知"}</small></span></span>
                  <span className="clue-behavior"><strong>{candidate.activityCount}</strong><small>{candidate.postCount} 帖 · {candidate.commentCount} 评</small></span>
                  <span className="clue-last-active"><strong>{formatShortDate(candidate.latestAt)}</strong><small>{candidate.latestComment?.content || "暂无评论内容"}</small></span>
                  <span className="clue-status-cell">
                    <RatingBadge rating={candidate.analysis?.rating} />
                  </span>
                </button>
              );
            })}
            {!loading && !visibleCandidates.length && <div className="clue-empty"><UsersRound size={30} /><strong>暂无匹配线索</strong></div>}
            {loading && <div className="clue-empty"><RefreshCw size={26} className="spin" /><strong>正在读取云 PG</strong></div>}
          </div>
        </section>

        <LeadDetail lead={selected} onOpenUser={onOpenUser} onReevaluate={(userId) => void requestAnalysis([userId])} disabled={isAnalyzing} analyzingThis={analyzingUserIds.has(selected?.id ?? "")} onNavigateToPost={onNavigateToPost} />
      </div>
    </section>
  );
}

function AnalysisProgress({ job }: { job: AnalysisJob }) {
  return (
    <section className={`clue-analysis-progress ${job.status}`} aria-live="polite">
      <div><span><BrainCircuit size={17} /><strong>{job.message || "正在处理评级任务"}</strong></span><b>{job.progress}%</b></div>
      <div className="clue-progress-track"><i style={{ width: `${job.progress}%` }} /></div>
      <p>已处理 {job.processedUsers} / {job.totalUsers} 位用户 · 成功 {job.completedUsers} · 失败 {job.failedUsers}</p>
      {job.error && <small>{job.error}</small>}
    </section>
  );
}

function ClueMetric({ icon: Icon, label, value, detail, tone = "default" }: {
  icon: typeof UsersRound; label: string; value: number; detail: string; tone?: "default" | "primary" | "accent";
}) {
  return <article className={`tone-${tone}`}><span><Icon size={18} /></span><div><p>{label}</p><strong>{formatCount(value)}</strong><small>{detail}</small></div></article>;
}

function LeadDetail({ lead, onOpenUser, onReevaluate, disabled, analyzingThis, onNavigateToPost }: {
  lead: LeadCandidate | null;
  onOpenUser: (userId: string) => void;
  onReevaluate: (userId: string) => void;
  disabled: boolean;
  analyzingThis: boolean;
  onNavigateToPost: (feedId: string) => void;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const [reachOutOpen, setReachOutOpen] = useState(false);
  if (!lead) return <aside className="clue-detail-panel clue-detail-empty"><Target size={34} /><strong>请选择潜在线索</strong></aside>;
  const analysis = lead.analysis;
  const log = analysis?.llmOriginLog;
  const dealer = analysis?.dealerRecommendation;
  const vehicleInterest = [...(analysis?.brands || []), ...(analysis?.carSeries || [])].join(" / ") || "待分析";

  return (
    <aside className="clue-detail-panel">
      <header className="clue-detail-head">
        <LeadAvatar lead={lead} large />
        <div><h2>{lead.name}</h2><p>{lead.redId ? `小红书号 ${lead.redId}` : `用户ID ${lead.id}`}</p></div>
        <button className="clue-user-link" type="button" onClick={() => onOpenUser(lead.id)}>用户池</button>
      </header>
      <div className="clue-detail-scroll">
        <div className="clue-detail-stats"><span><strong>{lead.postCount}</strong>发布帖子</span><span><strong>{lead.commentCount}</strong>发表评论</span><span><strong>{lead.ipLocation || "-"}</strong>IP 属地</span></div>

      <section className="clue-detail-section">
        <div className="clue-section-heading">
          <div><h3>最近一次互动</h3><p>{formatDate(lead.latestAt)}</p></div>
          <a
            className="clue-dm-button"
            href={lead.redId ? `https://www.xiaohongshu.com/user/profile/${lead.redId}` : "#"}
            target="_blank"
            rel="noopener noreferrer"
            title={lead.redId ? `打开 ${lead.name} 的小红书主页` : "缺少小红书号，无法跳转"}
            onClick={(e) => { if (!lead.redId) e.preventDefault(); }}
          >
            <Send size={13} /> 一键私信
            <ExternalLink size={11} />
          </a>
        </div>
        <blockquote>{lead.latestComment?.content || "暂无评论内容，最近行为来自发帖。"}</blockquote>
      </section>

      <section className="clue-detail-section">
        <div className="clue-section-heading">
          <div><h3>销售Agent评级</h3><p>{analysis ? `评级于 ${formatDateTime(analysis.createdAt)} · 数据截止 ${formatDateTime(analysis.dataCutoffAt)}` : "尚未执行模型评级"}</p></div>
          <RatingBadge rating={analysis?.rating} />
        </div>
        <div className="clue-intelligence-grid">
          <IntelligenceItem icon={Target} label="线索等级" value={ratingLabel(analysis?.rating)} />
          <IntelligenceItem icon={UsersRound} label="用户类型" value={analysis?.userType || "未拥车"} />
          <IntelligenceItem icon={CarFront} label="需求类型" value={joinValues(analysis?.intentTypes)} />
          <IntelligenceItem icon={FileText} label="关注点" value={joinValues(analysis?.concerns)} />
          <IntelligenceItem icon={CarFront} label="意向品牌 / 车系" value={vehicleInterest} />
          <IntelligenceItem icon={Target} label="提及竞品" value={joinValues(analysis?.competitors)} />
          <IntelligenceItem icon={Building2} label="推荐经销商区域" value={dealer?.store_name || dealer?.ip_location || "待门店库匹配"} />
        </div>
      </section>

      <section className="clue-detail-section">
        <div className="clue-section-heading">
          <div><h3>销售Agent建联策略</h3></div>
          {analysis && (
            <button type="button" className="clue-reachout-btn" onClick={() => setReachOutOpen(true)}>
              <MessageSquare size={12} /> Agent 一键触达
            </button>
          )}
        </div>
        {analysis ? (() => {
          const parts: string[] = [];
          if (analysis.summary) parts.push(`### 结论摘要\n${analysis.summary}`);
          if (analysis.salesStrategy?.contact_angle) parts.push(`### 建联切入点\n${analysis.salesStrategy.contact_angle}`);
          const pts = analysis.salesStrategy?.key_points;
          if (Array.isArray(pts) && pts.length > 0) parts.push(`### 沟通重点\n${pts.map((v: string) => `- ${v}`).join("\n")}`);
          if (analysis.salesStrategy?.suggested_message) parts.push(`### 推荐话术\n${analysis.salesStrategy.suggested_message}`);
          const dr = analysis.dealerRecommendation;
          if (dr?.recommendation_basis) {
            const dealerItems: string[] = [];
            if (dr.ip_location) dealerItems.push(`- 区域：${dr.ip_location}`);
            if (dr.store_name) dealerItems.push(`- 门店：${dr.store_name}`);
            dealerItems.push(`- 依据：${dr.recommendation_basis}`);
            parts.push(`### 推荐经销商\n${dealerItems.join("\n")}`);
          }
          const md = parts.join("\n\n");
          return <div className="clue-strategy-text" dangerouslySetInnerHTML={{ __html: marked.parse(md) as string }} />;
        })() : (
          <div className="clue-strategy-placeholder"><BrainCircuit size={20} /><span>等待语义分析生成销售建联策略</span></div>
        )}
      </section>

      {analysis?.evidence?.length ? (
        <section className="clue-detail-section">
          <div className="clue-section-heading"><div><h3>评级证据</h3></div></div>
          <div className="clue-evidence-list">{analysis.evidence.slice(0, 4).map((item, index) => <div key={`${item.id || "evidence"}-${index}`}><p>{item.quote || item.reason}</p><span>{item.reason}</span></div>)}</div>
        </section>
      ) : null}

        <section className="clue-detail-section clue-recent-comments-section">
          <div className="clue-section-heading"><div><h3>近期评论</h3><p>最近 {Math.min(lead.comments.length, 5)} 条</p></div></div>
          <div className="clue-recent-comments">
            {lead.comments.slice(0, 5).map((comment) => (
              <div key={`${comment.commentId}-${comment.parentCommentId ?? "root"}`} className="clue-comment-item">
                <p className="clue-comment-content">{comment.content || "无文本内容"}</p>
                <div className="clue-comment-meta">
                  <span>{formatDateTime(comment.createTime)} · {comment.ipLocation || "IP 未知"}</span>
                  <button
                    className="clue-reply-button"
                    type="button"
                    disabled={!comment.feedId}
                    title={comment.feedId ? "跳转到对应帖子" : "帖子信息缺失"}
                    onClick={() => comment.feedId && onNavigateToPost(comment.feedId)}
                  >
                    <Send size={12} /> 回复
                  </button>
                </div>
              </div>
            ))}
            {!lead.comments.length && <p className="clue-empty-inline">暂无评论数据</p>}
          </div>
        </section>
      </div>

      <footer className="clue-detail-actions">
        <button
            className="primary"
            type="button"
            disabled={disabled || analyzingThis}
            onClick={() => onReevaluate(lead.id)}
          >
            {analyzingThis ? (
              <><RefreshCw size={16} className="spin" /> 评级中...</>
            ) : (
              <><RefreshCw size={16} /> {lead.analysis ? "重新评级" : "评级"}</>
            )}
          </button>
        <button type="button" disabled title="等待孵化线索池"><UserPlus size={16} />转入孵化池</button>
        <button className="clue-log-button" type="button" onClick={() => setLogOpen(true)}>
          <FileText size={14} /> 查看log
        </button>
      </footer>
      {logOpen && (
        <div className="clue-log-overlay" onClick={() => setLogOpen(false)}>
          <div className="clue-log-modal" onClick={(e) => e.stopPropagation()}>
            <div className="clue-log-head">
              <strong>LLM 原始日志</strong>
              <button type="button" className="clue-log-close" onClick={() => setLogOpen(false)}>&times;</button>
            </div>
            <div className="clue-log-body">
              {log?.input != null ? (
                <details open>
                  <summary>
                    <span><b>传入模型的数据</b> (input)</span>
                    <button type="button" className="clue-log-copy" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(JSON.stringify(log.input, null, 2)); }}>
                      <Copy size={12} /> 复制
                    </button>
                  </summary>
                  <pre>{JSON.stringify(log.input, null, 2)}</pre>
                </details>
              ) : (
                <p className="clue-log-empty">暂无传入数据，请重新评级该用户</p>
              )}
              {log?.output != null ? (
                <details open>
                  <summary>
                    <span><b>模型输出的数据</b> (output)</span>
                    <button type="button" className="clue-log-copy" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(JSON.stringify(log.output, null, 2)); }}>
                      <Copy size={12} /> 复制
                    </button>
                  </summary>
                  <pre>{JSON.stringify(log.output, null, 2)}</pre>
                </details>
              ) : (
                <p className="clue-log-empty">暂无模型输出，请重新评级该用户</p>
              )}
            </div>
          </div>
        </div>
      )}
      {reachOutOpen && (
        <div className="clue-log-overlay" onClick={() => setReachOutOpen(false)}>
          <div className="clue-log-modal" onClick={(e) => e.stopPropagation()}>
            <div className="clue-log-head">
              <strong>AI 一键触达 - {lead.name}</strong>
              <button type="button" className="clue-log-close" onClick={() => setReachOutOpen(false)}>&times;</button>
            </div>
            <div className="clue-reachout-body">
              {lead.posts.length > 0 && (
                <section>
                  <h4>用户帖子 ({lead.posts.length})</h4>
                  <div className="clue-reachout-list">
                    {lead.posts.map((post, i) => (
                      <div key={post.feedId || i} className="clue-reachout-item">
                        <div className="clue-reachout-item-main">
                          <p className="clue-reachout-item-title">{post.title || "无标题"}</p>
                          {post.desc && <p className="clue-reachout-item-desc">{post.desc.slice(0, 120)}{post.desc.length > 120 ? "..." : ""}</p>}
                          <span className="clue-reachout-item-meta">{formatDateTime(post.publishTime) || "时间未知"}</span>
                        </div>
                        <button type="button" className="clue-reachout-action" disabled title="API 待接入">
                          <MessageSquare size={12} /> 发布评论
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {lead.comments.length > 0 && (
                <section>
                  <h4>用户评论 ({lead.comments.length})</h4>
                  <div className="clue-reachout-list">
                    {lead.comments.map((comment, i) => (
                      <div key={`${comment.commentId}-${i}`} className="clue-reachout-item">
                        <div className="clue-reachout-item-main">
                          <p className="clue-reachout-item-desc">{comment.content || "无文本内容"}</p>
                          <span className="clue-reachout-item-meta">{formatDateTime(comment.createTime) || "时间未知"} · {comment.ipLocation || "IP 未知"}</span>
                        </div>
                        <button type="button" className="clue-reachout-action" disabled title="API 待接入">
                          <Send size={12} /> 回复
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {!lead.posts.length && !lead.comments.length && (
                <p className="clue-log-empty">暂无帖子或评论数据</p>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function IntelligenceItem({ icon: Icon, label, value }: { icon: typeof Target; label: string; value: string }) {
  return <div><span><Icon size={15} />{label}</span><strong title={value}>{value}</strong></div>;
}

function RatingBadge({ rating }: { rating?: Rating }) {
  return <span className={`clue-analysis-state rating-${rating || "pending"}`}>{ratingLabel(rating)}</span>;
}

function LeadAvatar({ lead, large = false }: { lead: LeadCandidate; large?: boolean }) {
  return lead.avatar
    ? <img className={`clue-avatar ${large ? "large" : ""}`} src={lead.avatar} alt="" />
    : <span className={`clue-avatar fallback ${large ? "large" : ""}`}>{lead.name.trim().slice(0, 1).toUpperCase() || "?"}</span>;
}

async function refreshCandidates(setter: (value: LeadCandidate[]) => void) {
  const payload = await fetchJson<{ candidates: LeadCandidate[] }>(`${API_BASE_URL}/api/clues/candidates`);
  setter(payload.candidates);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `请求失败 (${response.status})`);
  return payload as T;
}

function ratingLabel(rating?: Rating) {
  return rating === "high" ? "高价值" : rating === "medium" ? "中意向" : rating === "low" ? "低意向" : rating === "none" ? "无价值" : "待评级";
}

function joinValues(values?: string[]) {
  return values?.length ? values.join("、") : "待分析";
}

function dateValue(value?: TimeValue) {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatDate(value?: TimeValue) {
  const ts = dateValue(value);
  if (!ts) return "-";
  const d = new Date(ts);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function formatShortDate(value?: TimeValue) {
  const ts = dateValue(value);
  if (!ts) return "-";
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
