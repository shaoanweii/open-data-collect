import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import {
  BrainCircuit,
  Building2,
  CarFront,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ExternalLink,
  FileText,
  MapPin,
  MessageSquare,
  RefreshCw,
  Send,
  Square,
  Target,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import { formatCount, formatDateTime } from "../../lib/format";

const API_BASE_URL = import.meta.env.VITE_STORAGE_API_BASE_URL || "http://127.0.0.1:5174";

// ---- 类型 ----

type Rating = "high" | "medium" | "low" | "none";
type IncubationFilterKey = "rating" | "type" | "follow";

const RATING_FILTER_OPTIONS: Array<{ value: Rating; label: string }> = [
  { value: "high", label: "高价值" },
  { value: "medium", label: "中意向" },
  { value: "low", label: "低意向" },
  { value: "none", label: "无价值" },
];

const FOLLOW_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "new", label: "未跟进" },
  { value: "following", label: "跟进中" },
  { value: "replied", label: "已回复" },
  { value: "converted", label: "已成交" },
  { value: "lost", label: "已流失" },
];

interface AnalysisResult {
  id: string;
  userId: string;
  nickname: string;
  avatar?: string | null;
  redId?: string | null;
  desc?: string | null;
  ipLocation: string;
  sourceChannels?: string[];
  sourceSubChannels?: string[];
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
  llmOriginLog?: { input?: unknown; output?: unknown };
  dataCutoffAt?: string;
  createdAt: string;
  model: string;
  postCount: number;
  commentCount: number;
  followUp?: FollowUpState;
}

interface FollowUpState {
  replyCount?: number;
  hasReplied?: boolean;
  converted?: boolean;
  status?: string;
  statusLabel?: string;
  lastFollowedAt?: string | null;
  nextFollowAt?: string | null;
  owner?: string | null;
  note?: string | null;
}

interface UserProfile {
  nickname: string;
  redId?: string | null;
  gender?: string | null;
  ipLocation?: string | null;
  description?: string | null;
  avatar?: string | null;
  sourceChannels?: string[];
  sourceSubChannels?: string[];
  fansCount?: string | null;
  followsCount?: string | null;
  likedAndCollectedCount?: string | null;
}

interface PostItem {
  taskId: string;
  feedId: string;
  sourceChannel?: string | null;
  sourceSubChannel?: string | null;
  title?: string;
  desc?: string;
  authorName?: string;
  authorAvatar?: string | null;
  likedCount?: string;
  sharedCount?: string;
  commentCount?: string;
  collectedCount?: string;
  ipLocation?: string;
  publishTime?: string | number;
}

interface CommentItem {
  taskId: string;
  feedId: string;
  sourceChannel?: string | null;
  sourceSubChannel?: string | null;
  commentId: string;
  parentCommentId?: string;
  content?: string;
  nickname?: string;
  avatar?: string | null;
  ipLocation?: string;
  commentTime?: string | number;
  likeCount?: string;
}

interface IncubationDetail {
  analysis: AnalysisResult | null;
  profile: UserProfile;
  posts: PostItem[];
  comments: CommentItem[];
  followUp?: FollowUpState;
  followEvents?: Array<{ id: string; type: string; content: string; occurredAt: string; createdAt: string }>;
}

type LeadRow = AnalysisResult;

type IncubationPoolPageProps = {
  onOpenUser: (userId: string) => void;
  onNavigateToPost: (feedId: string) => void;
};

// ---- 辅助函数 ----

function ratingLabel(rating?: Rating) {
  const map: Record<Rating, string> = { high: "高价值", medium: "中意向", low: "低意向", none: "无价值" };
  return map[rating ?? "none"];
}

function ratingBadgeClass(rating?: Rating) {
  return `rating-badge rating-${rating || "none"}`;
}

function joinValues(values?: string[]) {
  return values?.filter(Boolean).join(" / ") || "待分析";
}

function buildPostUrl(feedId: string) {
  return `https://www.xiaohongshu.com/explore/${feedId}`;
}

function formatSourceChannels(channels?: string[], subChannels?: string[]) {
  const primary = channels?.filter(Boolean).length ? channels.filter(Boolean).join("、") : "未记录";
  return subChannels?.filter(Boolean).length ? `${primary} / ${subChannels.filter(Boolean).join("、")}` : primary;
}

// ---- 页面组件 ----

export function IncubationPoolPage({ onOpenUser, onNavigateToPost }: IncubationPoolPageProps) {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<IncubationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [followSaving, setFollowSaving] = useState(false);
  const [openFilter, setOpenFilter] = useState<IncubationFilterKey | null>(null);
  const [ratingFilters, setRatingFilters] = useState<Set<Rating>>(new Set());
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set());
  const [followFilters, setFollowFilters] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const filterAreaRef = useRef<HTMLDivElement>(null);
  const closeFilterTimerRef = useRef<number | null>(null);
  const pageSize = 20;

  function cancelFilterClose() {
    if (closeFilterTimerRef.current !== null) {
      window.clearTimeout(closeFilterTimerRef.current);
      closeFilterTimerRef.current = null;
    }
  }

  function scheduleFilterClose() {
    cancelFilterClose();
    closeFilterTimerRef.current = window.setTimeout(() => {
      setOpenFilter(null);
      closeFilterTimerRef.current = null;
    }, 180);
  }

  // 加载线索列表
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const resp = await fetch(`${API_BASE_URL}/api/clues/incubation`, { signal: controller.signal });
        if (!resp.ok) throw new Error(`接口返回 ${resp.status}`);
        const data = await resp.json();
        setLeads(data.leads || []);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, []);

  // 加载所选用户详情
  useEffect(() => {
    if (!selectedUserId) return;
    const controller = new AbortController();
    async function load() {
      setDetailLoading(true);
      try {
        const resp = await fetch(`${API_BASE_URL}/api/clues/incubation/${encodeURIComponent(selectedUserId!)}`, {
          signal: controller.signal,
        });
        if (!resp.ok) throw new Error(`接口返回 ${resp.status}`);
        setDetail(await resp.json());
      } catch (err) {
        if (!controller.signal.aborted) setDetail(null);
      } finally {
        if (!controller.signal.aborted) setDetailLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [selectedUserId]);

  useEffect(() => {
    if (!openFilter) return undefined;
    function handlePointerDown(event: MouseEvent) {
      if (!filterAreaRef.current?.contains(event.target as Node)) {
        setOpenFilter(null);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [openFilter]);

  async function updateFollowUp(userId: string, patch: Partial<FollowUpState> & { eventType?: string; content?: string; markFollowed?: boolean }) {
    setFollowSaving(true);
    try {
      const resp = await fetch(`${API_BASE_URL}/api/clues/incubation/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!resp.ok) throw new Error(`接口返回 ${resp.status}`);
      const data = await resp.json();
      const followUp = data.followUp as FollowUpState;
      setLeads((items) => items.map((item) => (item.userId === userId ? { ...item, followUp } : item)));
      setDetail((current) => {
        if (!current) return current;
        return {
          ...current,
          followUp,
          analysis: current.analysis ? { ...current.analysis, followUp } : current.analysis,
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "跟进状态保存失败");
    } finally {
      setFollowSaving(false);
    }
  }

  // 过滤与分页
  const typeOptions = useMemo(() => {
    return Array.from(new Set(leads.map((lead) => lead.userType || "未拥车").filter(Boolean)))
      .sort()
      .map((value) => ({ value, label: value }));
  }, [leads]);
  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      if (ratingFilters.size > 0 && !ratingFilters.has(lead.rating)) return false;
      if (typeFilters.size > 0 && !typeFilters.has(lead.userType || "未拥车")) return false;
      if (followFilters.size > 0 && !followFilters.has(followFilterValue(lead.followUp))) return false;
      return true;
    });
  }, [followFilters, leads, ratingFilters, typeFilters]);
  useEffect(() => {
    setPage(1);
  }, [followFilters, ratingFilters, typeFilters]);
  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageLeads = filteredLeads.slice((safePage - 1) * pageSize, safePage * pageSize);
  const metrics = useMemo(() => {
    const high = leads.filter((lead) => lead.rating === "high").length;
    const following = leads.filter((lead) => isFollowing(lead.followUp)).length;
    const converted = leads.filter((lead) => isConverted(lead.followUp)).length;
    const conversionRate = leads.length ? `${Math.round((converted / leads.length) * 100)}%` : "0%";
    return { total: leads.length, high, following, conversionRate };
  }, [leads]);

  return (
    <section className="incubation-workbench">
      <header className="incubation-header">
        <div>
          <h1>建档线索池</h1>
        </div>
      </header>

      {error && <div className="clue-notice error" role="alert">{error}</div>}

      {loading ? (
        <div className="incubation-loading">
          <RefreshCw size={28} className="spin" />
          <p>加载建档线索中...</p>
        </div>
      ) : !leads.length ? (
        <div className="incubation-empty">
          <BrainCircuit size={40} />
          <h2>暂无建档线索</h2>
          <p>请在「潜客线索池」中选中任务并执行「开始全量评级」，评级完成后线索将自动进入建档线索池。</p>
        </div>
      ) : (
        <>
          <div className="incubation-metrics">
            <IncubationMetric icon={UsersRound} label="线索总数" value={metrics.total} detail="已完成建档" />
            <IncubationMetric icon={Target} label="高质量线索数" value={metrics.high} detail="高价值线索" tone="primary" />
            <IncubationMetric icon={MessageSquare} label="跟进中数量" value={metrics.following} detail="有跟进动作" />
            <IncubationMetric icon={TrendingUp} label="转化率" value={metrics.conversionRate} detail="已成交 / 总线索" tone="success" />
          </div>

          <div className="incubation-main-grid">
            {/* ---- 左侧：线索列表 ---- */}
            <div className="incubation-list-panel">
              <div className="incubation-panel-title">
                <div>
                  <h2>已评级线索</h2>
                  <p>按最近评级时间展示，当前筛选 {filteredLeads.length} 条</p>
                </div>
              </div>
              <div className="incubation-list-head" ref={filterAreaRef}>
                <span>用户</span>
                <span>来源</span>
                <FilterHead
                  label="线索意向度"
                  activeCount={ratingFilters.size}
                  open={openFilter === "rating"}
                  onToggle={() => setOpenFilter((value) => (value === "rating" ? null : "rating"))}
                  options={RATING_FILTER_OPTIONS}
                  selected={ratingFilters}
                  onSelect={(value) => toggleSetValue(setRatingFilters, value as Rating)}
                  onClear={() => setRatingFilters(new Set())}
                  onCancelClose={cancelFilterClose}
                  onRequestClose={scheduleFilterClose}
                />
                <FilterHead
                  label="类型"
                  activeCount={typeFilters.size}
                  open={openFilter === "type"}
                  onToggle={() => setOpenFilter((value) => (value === "type" ? null : "type"))}
                  options={typeOptions}
                  selected={typeFilters}
                  onSelect={(value) => toggleSetValue(setTypeFilters, value)}
                  onClear={() => setTypeFilters(new Set())}
                  onCancelClose={cancelFilterClose}
                  onRequestClose={scheduleFilterClose}
                />
                <FilterHead
                  label="跟进"
                  activeCount={followFilters.size}
                  open={openFilter === "follow"}
                  onToggle={() => setOpenFilter((value) => (value === "follow" ? null : "follow"))}
                  options={FOLLOW_FILTER_OPTIONS}
                  selected={followFilters}
                  onSelect={(value) => toggleSetValue(setFollowFilters, value)}
                  onClear={() => setFollowFilters(new Set())}
                  onCancelClose={cancelFilterClose}
                  onRequestClose={scheduleFilterClose}
                />
              </div>
              <div className="incubation-list-scroll">
                {pageLeads.map((lead) => (
                  <button
                    key={lead.userId}
                    type="button"
                    className={`incubation-list-row ${selectedUserId === lead.userId ? "active" : ""}`}
                    onClick={() => setSelectedUserId(lead.userId)}
                  >
                    <div className="incubation-row-user">
                      <IncubationAvatar src={lead.avatar} name={lead.nickname || lead.userId} />
                      <span>
                        <strong>{lead.nickname || lead.userId}</strong>
                        <small><MapPin size={11} />{lead.ipLocation || "IP 未知"}</small>
                      </span>
                    </div>
                    <span className="clue-source-channel" title={formatSourceChannels(lead.sourceChannels, lead.sourceSubChannels)}>{formatSourceChannels(lead.sourceChannels, lead.sourceSubChannels)}</span>
                    <span className={ratingBadgeClass(lead.rating)}>{ratingLabel(lead.rating)}</span>
                    <span className="incubation-row-type">{lead.userType || "未拥车"}</span>
                    <span className="incubation-row-follow">{followUpLabel(lead.followUp)}</span>
                  </button>
                ))}
              </div>
              <div className="pagination-bar">
                <button type="button" disabled={safePage <= 1} onClick={() => setPage((v) => Math.max(1, v - 1))}>
                  上一页
                </button>
                <span>共 {filteredLeads.length} 条 · 第 {safePage}/{totalPages} 页</span>
                <button type="button" disabled={safePage >= totalPages} onClick={() => setPage((v) => Math.min(totalPages, v + 1))}>
                  下一页
                </button>
              </div>
            </div>

            {/* ---- 右侧：360° 详情 ---- */}
            <IncubationDetailPanel
              detail={detail}
              loading={detailLoading}
              selectedUserId={selectedUserId}
              saving={followSaving}
              onUpdateFollowUp={updateFollowUp}
              onOpenUser={onOpenUser}
              onNavigateToPost={onNavigateToPost}
            />
          </div>
        </>
      )}
    </section>
  );
}

// ---- 360° 详情面板 ----

function IncubationDetailPanel({
  detail,
  loading,
  selectedUserId,
  saving,
  onUpdateFollowUp,
  onOpenUser,
  onNavigateToPost,
}: {
  detail: IncubationDetail | null;
  loading: boolean;
  selectedUserId: string | null;
  saving: boolean;
  onUpdateFollowUp: (userId: string, patch: Partial<FollowUpState> & { eventType?: string; content?: string; markFollowed?: boolean }) => void;
  onOpenUser: (userId: string) => void;
  onNavigateToPost: (feedId: string) => void;
}) {
  const [reachOutOpen, setReachOutOpen] = useState(false);

  if (!selectedUserId) {
    return (
      <aside className="incubation-detail-panel incubation-detail-empty">
        <Target size={34} />
        <strong>请选择一个线索</strong>
        <p>在左侧列表中选择已评级的用户查看 360° 画像</p>
      </aside>
    );
  }

  if (loading) {
    return (
      <aside className="incubation-detail-panel incubation-detail-empty">
        <RefreshCw size={28} className="spin" />
        <strong>加载中...</strong>
      </aside>
    );
  }

  if (!detail) {
    return (
      <aside className="incubation-detail-panel incubation-detail-empty">
        <BrainCircuit size={34} />
        <strong>详情加载失败</strong>
        <p>请稍后重试</p>
      </aside>
    );
  }

  const { analysis, profile, posts, comments } = detail;
  const dealer = analysis?.dealerRecommendation;
  const vehicleInterest = [...(analysis?.brands || []), ...(analysis?.carSeries || [])].join(" / ") || "待分析";
  const followUp = detail.followUp || analysis?.followUp;
  const replyCount = followUp?.replyCount ?? 0;
  const sourceText = formatSourceChannels(profile.sourceChannels || analysis?.sourceChannels, profile.sourceSubChannels || analysis?.sourceSubChannels);

  return (
    <aside className="incubation-detail-panel">
      {/* 用户基础信息 */}
      <header className="incubation-detail-head">
        <IncubationAvatar src={profile.avatar || analysis?.avatar} name={profile.nickname || analysis?.nickname || selectedUserId} large />
        <div>
          <h2>{profile.nickname}</h2>
          <p>{profile.redId ? `小红书号 ${profile.redId}` : `用户 ID ${selectedUserId}`} · {profile.ipLocation || analysis?.ipLocation || "IP 未知"} · {sourceText}</p>
        </div>
        <button className="clue-user-link" type="button" onClick={() => onOpenUser(selectedUserId)}>用户池</button>
        <span className={ratingBadgeClass(analysis?.rating)}>{ratingLabel(analysis?.rating)}</span>
      </header>

      <div className="incubation-detail-scroll">
        <div className="incubation-follow-grid">
          <FollowUpCard icon={MessageSquare} label="回复次数" value={`${replyCount} 次`} detail={followUp?.hasReplied ? "已产生回复" : "暂无回复"} />
          <FollowUpCard icon={CheckCircle2} label="是否回复" value={followUp?.hasReplied ? "已回复" : "未回复"} detail="客户互动状态" />
          <FollowUpCard icon={TrendingUp} label="是否转化" value={isConverted(followUp) ? "已成交" : "未成交"} detail={followUpLabel(followUp)} />
        </div>

        <div className="incubation-follow-actions">
          <button
            type="button"
            disabled={saving}
            onClick={() => onUpdateFollowUp(selectedUserId, { status: "following", eventType: "status", content: "标记为跟进中" })}
          >
            标记跟进中
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onUpdateFollowUp(selectedUserId, { status: "replied", replyCount: replyCount + 1, hasReplied: true, eventType: "reply", content: "记录一次客户回复" })}
          >
            记录一次回复
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onUpdateFollowUp(selectedUserId, { status: "converted", converted: true, eventType: "converted", content: "标记为已成交" })}
          >
            标记已成交
          </button>
        </div>

        {/* 统计概览 */}
        <div className="incubation-detail-stats">
          <span><strong>{profile.fansCount || "-"}</strong>粉丝</span>
          <span><strong>{profile.followsCount || "-"}</strong>关注</span>
          <span><strong>{profile.likedAndCollectedCount || "-"}</strong>获赞/收藏</span>
          <span><strong>{profile.ipLocation || "-"}</strong>IP 属地</span>
          <span><strong>{sourceText}</strong>来源渠道</span>
          <span><strong>{analysis?.postCount ?? posts.length}</strong>帖子</span>
          <span><strong>{analysis?.commentCount ?? comments.length}</strong>评论</span>
        </div>

        {/* 评级结果 */}
        {analysis && (
          <section className="clue-detail-section">
            <div className="clue-section-heading">
              <div><h3>模型语义分析</h3><p>评级于 {formatDateTime(analysis.createdAt)}</p></div>
              <span className={ratingBadgeClass(analysis.rating)}>{ratingLabel(analysis.rating)}</span>
            </div>
            <div className="clue-intelligence-grid">
              <IntelligenceItem icon={Target} label="线索等级" value={ratingLabel(analysis.rating)} />
              <IntelligenceItem icon={UsersRound} label="用户类型" value={analysis.userType || "未拥车"} />
              <IntelligenceItem icon={Target} label="置信度" value={`${((analysis.confidence || 0) * 100).toFixed(0)}%`} />
              <IntelligenceItem icon={CarFront} label="需求类型" value={joinValues(analysis.intentTypes)} />
              <IntelligenceItem icon={FileText} label="关注点" value={joinValues(analysis.concerns)} />
              <IntelligenceItem icon={CarFront} label="意向品牌/车系" value={vehicleInterest} />
              <IntelligenceItem icon={Target} label="提及竞品" value={joinValues(analysis.competitors)} />
              <IntelligenceItem icon={Building2} label="推荐经销商" value={dealer?.store_name || dealer?.ip_location || "待门店库匹配"} />
            </div>
          </section>
        )}

        {/* 销售策略 */}
        {analysis?.summary && (
          <section className="clue-detail-section">
            <div className="clue-section-heading">
              <div><h3>销售 Agent 建联策略</h3></div>
              <button type="button" className="clue-reachout-btn" onClick={() => setReachOutOpen(true)}>
                <MessageSquare size={12} /> Agent 一键触达
              </button>
            </div>
            {(() => {
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
              return <div className="incubation-strategy" dangerouslySetInnerHTML={{ __html: marked.parse(parts.join("\n\n")) as string }} />;
            })()}
          </section>
        )}

        {/* 评级证据 */}
        {analysis?.evidence?.length ? (
          <section className="clue-detail-section">
            <div className="clue-section-heading"><div><h3>评级证据</h3></div></div>
            <div className="clue-evidence-list">
              {analysis.evidence.slice(0, 6).map((item, i) => (
                <div key={i}><p>{item.quote || item.reason}</p><span>{item.reason}</span></div>
              ))}
            </div>
          </section>
        ) : null}

        {/* 用户帖子 */}
        <section className="clue-detail-section">
          <div className="clue-section-heading"><div><h3>近期帖子</h3><p>最近 {Math.min(posts.length, 10)} 条</p></div></div>
          {posts.length ? (
            <div className="incubation-post-list">
              {posts.slice(0, 10).map((p) => (
                <a key={`${p.taskId}-${p.feedId}`} className="incubation-post-item" href={buildPostUrl(p.feedId)} target="_blank" rel="noreferrer">
                  <div>
                    <strong>{p.title || "无标题"}</strong>
                    <p>{p.desc || "无描述"}</p>
                  </div>
                  <span className="incubation-post-meta">
                    {formatSourceChannels(p.sourceChannel ? [p.sourceChannel] : [], p.sourceSubChannel ? [p.sourceSubChannel] : [])}
                    {p.likedCount ? `❤ ${p.likedCount}` : ""}
                    <span>{formatDateTime(p.publishTime)}</span>
                    <ExternalLink size={12} />
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <p className="clue-empty-inline">暂无帖子数据</p>
          )}
        </section>

        {/* 用户评论 */}
        <section className="clue-detail-section">
          <div className="clue-section-heading"><div><h3>近期评论</h3><p>最近 {Math.min(comments.length, 20)} 条</p></div></div>
          {comments.length ? (
            <div className="clue-recent-comments">
              {comments.slice(0, 20).map((c) => (
                <div key={`${c.commentId}-${c.parentCommentId ?? "root"}`} className="clue-comment-item">
                  <div className="incubation-comment-head">
                    <IncubationAvatar src={c.avatar || profile.avatar} name={c.nickname || profile.nickname} />
                    <span>
                      <strong>{c.nickname || profile.nickname}</strong>
                      <small>{formatSourceChannels(c.sourceChannel ? [c.sourceChannel] : [], c.sourceSubChannel ? [c.sourceSubChannel] : [])}</small>
                    </span>
                  </div>
                  <p className="clue-comment-content">{c.content || "无文本内容"}</p>
                  <div className="clue-comment-meta">
                    <span>{formatDateTime(c.commentTime)} · {c.ipLocation || "IP 未知"}</span>
                    <button className="clue-reply-button" type="button" disabled={!c.feedId} onClick={() => c.feedId && onNavigateToPost(c.feedId)}>
                      <Send size={12} /> 回复
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="clue-empty-inline">暂无评论数据</p>
          )}
        </section>
      </div>
      {reachOutOpen && (
        <div className="clue-log-overlay" onClick={() => setReachOutOpen(false)}>
          <div className="clue-log-modal" onClick={(e) => e.stopPropagation()}>
            <div className="clue-log-head">
              <strong>AI 一键触达 - {profile.nickname}</strong>
              <button type="button" className="clue-log-close" onClick={() => setReachOutOpen(false)}>&times;</button>
            </div>
            <div className="clue-reachout-body">
              {posts.length > 0 && (
                <section>
                  <h4>用户帖子 ({posts.length})</h4>
                  <div className="clue-reachout-list">
                    {posts.map((post, i) => (
                      <div key={post.feedId || i} className="clue-reachout-item">
                        <div className="clue-reachout-item-main">
                          <p className="clue-reachout-item-title">{post.title || "无标题"}</p>
                          {post.desc && <p className="clue-reachout-item-desc">{post.desc.slice(0, 120)}{post.desc.length > 120 ? "..." : ""}</p>}
                          <span className="clue-reachout-item-meta">{formatSourceChannels(post.sourceChannel ? [post.sourceChannel] : [], post.sourceSubChannel ? [post.sourceSubChannel] : [])} · {formatDateTime(post.publishTime) || "时间未知"}</span>
                        </div>
                        <button type="button" className="clue-reachout-action" disabled title="API 待接入">
                          <MessageSquare size={12} /> 发布评论
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {comments.length > 0 && (
                <section>
                  <h4>用户评论 ({comments.length})</h4>
                  <div className="clue-reachout-list">
                    {comments.map((comment, i) => (
                      <div key={`${comment.commentId}-${i}`} className="clue-reachout-item">
                        <div className="clue-reachout-item-main">
                          <p className="clue-reachout-item-desc">{comment.content || "无文本内容"}</p>
                          <span className="clue-reachout-item-meta">{formatSourceChannels(comment.sourceChannel ? [comment.sourceChannel] : [], comment.sourceSubChannel ? [comment.sourceSubChannel] : [])} · {formatDateTime(comment.commentTime) || "时间未知"} · {comment.ipLocation || "IP 未知"}</span>
                        </div>
                        <button type="button" className="clue-reachout-action" disabled={!comment.feedId} onClick={() => comment.feedId && onNavigateToPost(comment.feedId)}>
                          <Send size={12} /> 回复
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {!posts.length && !comments.length && (
                <p className="clue-log-empty">暂无帖子或评论数据</p>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

// ---- 辅助小组件 ----

function IntelligenceItem({ icon: Icon, label, value }: { icon: typeof Target; label: string; value: string }) {
  return (
    <div className="intelligence-item">
      <span className="intelligence-label"><Icon size={13} />{label}</span>
      <span className="intelligence-value">{value || "—"}</span>
    </div>
  );
}

function IncubationMetric({
  icon: Icon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: typeof Target;
  label: string;
  value: number | string;
  detail: string;
  tone?: "default" | "primary" | "success";
}) {
  return (
    <article className={`incubation-metric tone-${tone}`}>
      <span><Icon size={18} /></span>
      <div>
        <p>{label}</p>
        <strong>{typeof value === "number" ? formatCount(value) : value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function FollowUpCard({ icon: Icon, label, value, detail }: { icon: typeof MessageSquare; label: string; value: string; detail: string }) {
  return (
    <article className="incubation-follow-card">
      <span><Icon size={16} /></span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function IncubationAvatar({ src, name, large = false }: { src?: string | null; name?: string; large?: boolean }) {
  return src
    ? <img className={`clue-avatar ${large ? "large" : ""}`} src={src} alt="" />
    : <span className={`clue-avatar fallback ${large ? "large" : ""}`}>{(name || "?").trim().slice(0, 1).toUpperCase() || "?"}</span>;
}

function FilterHead<T extends string>({
  label,
  activeCount,
  open,
  onToggle,
  options,
  selected,
  onSelect,
  onClear,
  onCancelClose,
  onRequestClose,
}: {
  label: string;
  activeCount: number;
  open: boolean;
  onToggle: () => void;
  options: Array<{ value: T; label: string }>;
  selected: Set<T>;
  onSelect: (value: T) => void;
  onClear: () => void;
  onCancelClose: () => void;
  onRequestClose: () => void;
}) {
  return (
    <span className="clue-status-filter incubation-filter-head" onMouseEnter={onCancelClose} onMouseLeave={onRequestClose}>
      <button className={activeCount > 0 ? "active" : ""} type="button" onClick={onToggle}>
        {activeCount > 0 ? `${label} ${activeCount}` : label}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="clue-status-filter-menu">
          {options.map((item) => (
            <button key={item.value} type="button" onClick={() => onSelect(item.value)}>
              {selected.has(item.value) ? <CheckSquare size={14} /> : <Square size={14} />}
              {item.label}
            </button>
          ))}
          <div className="clue-status-filter-actions">
            <button type="button" onClick={onClear}>清除筛选</button>
          </div>
        </div>
      )}
    </span>
  );
}

function followUpLabel(followUp?: FollowUpState) {
  if (isConverted(followUp)) return "已成交";
  if (followUp?.statusLabel) return followUp.statusLabel;
  if (followUp?.status === "replied" || followUp?.status === "已回复") return "已回复";
  if (isFollowing(followUp)) return "跟进中";
  if (followUp?.status === "lost" || followUp?.status === "已流失") return "已流失";
  return "未跟进";
}

function isFollowing(followUp?: FollowUpState) {
  return Boolean(followUp?.hasReplied || (followUp?.replyCount ?? 0) > 0 || followUp?.status === "following" || followUp?.status === "replied" || followUp?.status === "跟进中");
}

function isConverted(followUp?: FollowUpState) {
  return Boolean(followUp?.converted || followUp?.status === "converted" || followUp?.status === "已成交");
}

function followFilterValue(followUp?: FollowUpState) {
  if (isConverted(followUp)) return "converted";
  if (followUp?.status === "lost" || followUp?.status === "已流失") return "lost";
  if (followUp?.status === "replied" || followUp?.status === "已回复" || followUp?.hasReplied || (followUp?.replyCount ?? 0) > 0) return "replied";
  if (followUp?.status === "following" || followUp?.status === "跟进中") return "following";
  return "new";
}

function toggleSetValue<T>(setter: (updater: (prev: Set<T>) => Set<T>) => void, value: T) {
  setter((prev) => {
    const next = new Set(prev);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    return next;
  });
}
