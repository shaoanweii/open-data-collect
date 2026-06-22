import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Clock3,
  FileText,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  UserRound,
  UsersRound,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCount, formatDateTime } from "../lib/format";
import type {
  AnalyticsData,
  CollectionTask,
  LocationFilter,
  StoredComment,
  StoredPost,
  StoredUser,
  UserProfileData,
} from "../types";

export type ToastState = {
  id: number;
  status: "success" | "error";
  title: string;
  message: string;
};

export function ToastCard({ toast }: { toast: ToastState }) {
  return (
    <div className={`toast-card ${toast.status}`} role="status" aria-live="polite">
      <span className="toast-dot" />
      <div>
        <strong>{toast.title}</strong>
        <p>{toast.message}</p>
      </div>
    </div>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: number; tone: "green" | "blue" | "gold" | "rose" }) {
  return (
    <article className="metric-card glass">
      <p>{label}</p>
      <strong className={tone}>{formatCount(value)}</strong>
    </article>
  );
}

function Avatar({ src, name }: { src?: string; name?: string }) {
  const initial = (name || "?").trim().slice(0, 1).toUpperCase();
  return src ? <img className="avatar" src={src} alt={name || "用户头像"} /> : <span className="avatar fallback">{initial}</span>;
}

function UserProfileCard({
  user,
  fallback,
  loading,
}: {
  user?: StoredUser;
  fallback: {
    userId?: string;
    nickname?: string;
    avatar?: string;
    ipLocation?: string;
  };
  loading: boolean;
}) {
  const displayName = user?.nickname || fallback.nickname || fallback.userId || "未知用户";
  const homepage = fallback.userId ? `https://www.xiaohongshu.com/user/profile/${fallback.userId}` : "-";

  return (
    <article className="user-profile-card">
      <div className="user-profile-head">
        <Avatar src={user?.avatar || fallback.avatar} name={displayName} />
        <div>
          <strong>用户名称：{displayName}</strong>
          <span>用户ID：{fallback.userId || "-"}</span>
        </div>
      </div>
      <div className="user-field-list">
        <div className="user-field-item">
          <span className="user-field-item-label">主页链接：</span>
          <span className="user-field-item-value">
            {homepage === "-" ? (
              "-"
            ) : (
              <a href={homepage} target="_blank" rel="noreferrer">
                {homepage}
              </a>
            )}
          </span>
        </div>
        <div className="user-field-item">
          <span className="user-field-item-label">个人简介：</span>
          <span className="user-field-item-value">
            {loading ? "正在读取..." : user?.desc || "暂无简介"}
          </span>
        </div>
        <div className="user-field-item">
          <span className="user-field-item-label">IP：</span>
          <span className="user-field-item-value">
            {user?.ipLocation || fallback.ipLocation || "-"}
          </span>
        </div>
      </div>
      <div className="user-stats-grid">
        <span>
          粉丝 <strong>{user?.fansCount || "-"}</strong>
        </span>
        <span>
          关注 <strong>{user?.followsCount || "-"}</strong>
        </span>
        <span>
          获赞与收藏 <strong>{user?.likedAndCollectedCount || "-"}</strong>
        </span>
      </div>
      {user?.interactions?.length ? (
        <div className="user-interactions">
          {user.interactions.map((item) => (
            <span key={`${item.type}-${item.name}`}>
              {item.name || item.type} {item.count || "-"}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

export function FilterGroup<T extends string>({
  title,
  value,
  items,
  tone = "green",
  className,
  onChange,
}: {
  title: string;
  value: T;
  items: T[];
  tone?: "green" | "blue" | "gold" | "rose";
  className?: string;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className={`filter-group tone-${tone} ${className ?? ""}`}>
      <legend>{title}</legend>
      <div className="choice-row">
        {items.map((item) => (
          <button
            className={`choice ${item === value ? "active" : ""}`}
            key={item}
            type="button"
            onClick={() => onChange(item)}
          >
            {item}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function NumberField({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  optional = false,
  onChange,
}: {
  label: string;
  hint?: string;
  value?: number;
  min: number;
  max: number;
  step?: number;
  optional?: boolean;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        type="number"
        value={value ?? ""}
        min={min}
        max={max}
        step={step}
        placeholder={hint || (optional ? "不限" : undefined)}
        onChange={(event) => {
          if (optional && event.target.value === "") {
            onChange(undefined);
            return;
          }
          onChange(Number(event.target.value));
        }}
      />
    </label>
  );
}

function FilterDropdown<T extends string>({
  label,
  value,
  open,
  items,
  itemLabel = (item) => item,
  onToggle,
  onChange,
  onClose,
}: {
  label: string;
  value: string;
  open: boolean;
  items: T[];
  itemLabel?: (item: T) => string;
  onToggle: () => void;
  onChange: (value: T) => void;
  onClose?: () => void;
}) {
  return (
    <div className="filter-dropdown" onMouseLeave={() => { if (open) onClose?.(); }}>
      <button className={open ? "active" : ""} type="button" onClick={onToggle}>
        <span>{label}</span>
        <strong>{value}</strong>
      </button>
      {open && (
        <div className="filter-dropdown-menu">
          {items.map((item) => (
            <button key={item || "all"} type="button" onClick={() => onChange(item)}>
              {itemLabel(item)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DateRangeFilter({
  dateFrom,
  dateTo,
  onChangeFrom,
  onChangeTo,
}: {
  dateFrom: string;
  dateTo: string;
  onChangeFrom: (value: string) => void;
  onChangeTo: (value: string) => void;
}) {
  // 点击输入框时阻止冒泡，确保日期选择器正常弹出
  const stopPropagation = (event: React.MouseEvent) => event.stopPropagation();
  return (
    <div className="date-range-filter">
      <span className="date-range-label">时间范围</span>
      <div className="date-range-control">
        <CalendarDays size={18} />
        <input
          aria-label="开始日期"
          type="date"
          value={dateFrom}
          onClick={stopPropagation}
          onChange={(event) => onChangeFrom(event.target.value)}
        />
        <span className="date-range-separator">至</span>
        <input
          aria-label="结束日期"
          type="date"
          value={dateTo}
          onClick={stopPropagation}
          onChange={(event) => onChangeTo(event.target.value)}
        />
      </div>
    </div>
  );
}

function TaskMiniCard({ task }: { task: CollectionTask }) {
  return (
    <article className="task-mini">
      <div>
        <strong>{task.keyword}</strong>
        <span>{statusText(task.status)}</span>
      </div>
      <p>{task.message}</p>
    </article>
  );
}

export function TaskQueue({
  tasks,
  posts,
  comments,
  users,
  selectedTaskId,
  selectedFeedId,
  onSelectTask,
  onBack,
  onSelectFeed,
  onLoadCommentUser,
  onPause,
  onResume,
  onRetry,
  onDelete,
}: {
  tasks: CollectionTask[];
  posts: StoredPost[];
  comments: StoredComment[];
  users: StoredUser[];
  selectedTaskId: string | null;
  selectedFeedId: string | null;
  onSelectTask: (taskId: string) => void;
  onBack: () => void;
  onSelectFeed: (feedId: string) => void;
  onLoadCommentUser: (taskId: string, userId: string, xsecToken: string) => Promise<StoredUser>;
  onPause: (taskId: string) => void;
  onResume: (taskId: string) => void;
  onRetry: (taskId: string) => void;
  onDelete: (taskId: string) => void;
}) {
  const [openMenuTaskId, setOpenMenuTaskId] = useState<string | null>(null);
  const [logTask, setLogTask] = useState<CollectionTask | null>(null);
  // 每个 task 独立一个 ref，避免 map 中 ref 被覆盖导致菜单点击无效
  const menuRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // 点击菜单外部时关闭菜单
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!openMenuTaskId) return;
      const el = menuRefs.current.get(openMenuTaskId);
      if (el && !el.contains(event.target as Node)) {
        setOpenMenuTaskId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openMenuTaskId]);

  const selectedTask = selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) : null;

  if (selectedTask) {
    return (
      <TaskDetail
        task={selectedTask}
        posts={posts.filter((post) => post.taskId === selectedTask.id)}
        comments={comments.filter((comment) => comment.taskId === selectedTask.id)}
        users={users.filter((user) => user.taskId === selectedTask.id)}
        selectedFeedId={selectedFeedId}
        onBack={onBack}
        onSelectFeed={onSelectFeed}
        onLoadCommentUser={onLoadCommentUser}
      />
    );
  }

  return (
    <section className="data-panel glass task-list-panel">
      <div className="panel-heading">
        <div>
          <h3>任务列表</h3>
        </div>
      </div>

      <div className="task-table">
        <div className="task-table-scroll">
        <div className="task-table-head">
          <span>任务 ID</span>
          <span>采集关键词</span>
          <span>采集渠道</span>
          <span>任务创建时间</span>
          <span>状态</span>
          <span>操作</span>
        </div>
        {!tasks.length && (
          <div className="task-table-empty">
            <Clock3 size={24} />
            <strong>暂无任务</strong>
            <p>创建采集任务后，会在这里显示任务ID、任务名称、创建时间、状态和操作。</p>
          </div>
        )}
        {tasks.map((task) => (
          <div className="task-table-row" key={task.id}>
            <button className="task-id-button" type="button" onClick={() => onSelectTask(task.id)}>
              {shortTaskId(task.id)}
            </button>
            <strong>{task.keyword}</strong>
            <span>{task.channel}</span>
            <span>{formatDateTime(task.createdAt)}</span>
            <span className={`badge status-${task.status}`}>{statusText(task.status)}</span>
            <div className="task-actions" ref={(el) => { if (el) menuRefs.current.set(task.id, el); }}>
              <button
                className="task-actions-trigger"
                type="button"
                onClick={() => setOpenMenuTaskId(openMenuTaskId === task.id ? null : task.id)}
              >
                <MoreHorizontal size={16} />
              </button>
              {openMenuTaskId === task.id && (
                <div className="task-action-menu">
                  <button type="button" onClick={() => { onSelectTask(task.id); setOpenMenuTaskId(null); }}>
                    查看详情
                  </button>
                  <button type="button" onClick={() => { setLogTask(task); setOpenMenuTaskId(null); }}>
                    查看日志
                  </button>
                  {task.status === "running" && (
                    <button type="button" onClick={() => { onPause(task.id); setOpenMenuTaskId(null); }}>
                      暂停采集
                    </button>
                  )}
                  {task.status === "queued" && (
                    <button type="button" onClick={() => { onPause(task.id); setOpenMenuTaskId(null); }}>
                      取消任务
                    </button>
                  )}
                  {task.status === "paused" && (
                    <button type="button" onClick={() => { onResume(task.id); setOpenMenuTaskId(null); }}>
                      继续采集
                    </button>
                  )}
                  {(task.status === "failed" || task.status === "completed" || task.status === "running" || task.status === "queued") && (
                    <button type="button" onClick={() => { onRetry(task.id); setOpenMenuTaskId(null); }}>
                      重新采集
                    </button>
                  )}
                  <button className="danger" type="button" onClick={() => { onDelete(task.id); setOpenMenuTaskId(null); }}>
                    删除任务
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      </div>
      {logTask && <TaskLogModal task={logTask} onClose={() => setLogTask(null)} />}
    </section>
  );
}

function TaskDetail({
  task,
  posts,
  comments,
  users,
  selectedFeedId,
  onBack,
  onSelectFeed,
  onLoadCommentUser,
}: {
  task: CollectionTask;
  posts: StoredPost[];
  comments: StoredComment[];
  users: StoredUser[];
  selectedFeedId: string | null;
  onBack: () => void;
  onSelectFeed: (feedId: string) => void;
  onLoadCommentUser: (taskId: string, userId: string, xsecToken: string) => Promise<StoredUser>;
}) {
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [loadingUserId, setLoadingUserId] = useState<string | null>(null);
  const isFirstFeedChange = useRef(true);
  const prevFeedId = useRef<string | null>(null);
  const postDetailRef = useRef<HTMLElement | null>(null);
  const progress = task.total ? Math.round(((task.completed + task.failed) / task.total) * 100) : 0;
  const activeFeedId = selectedFeedId ?? posts[0]?.feedId ?? task.items[0]?.feedId ?? null;
  const activeQueueItem = activeFeedId ? task.items.find((item) => item.feedId === activeFeedId) : undefined;
  const activePost = activeFeedId ? posts.find((post) => post.feedId === activeFeedId) : undefined;
  const relatedComments = activeFeedId ? comments.filter((comment) => comment.feedId === activeFeedId) : [];
  const activeComment = relatedComments.find((comment) => comment.commentId === selectedCommentId) ?? null;
  const uniqueUserCount = countUniqueUsers(posts, comments, users);
  const activeAuthorLookupId = activePost?.authorId || activeQueueItem?.authorId;
  const activeAuthorUser = activeAuthorLookupId
    ? users.find((user) => user.taskId === task.id && user.userId === activeAuthorLookupId)
    : undefined;
  const activeAuthorAvatar = activePost?.authorAvatar || activeQueueItem?.searchItem.noteCard?.user?.avatar || activeAuthorUser?.avatar;
  const activeAuthorName = activePost?.authorName || activeQueueItem?.authorName || activeAuthorUser?.nickname;
  const activeAuthorId = activePost?.authorId || activeQueueItem?.authorId || activeAuthorUser?.userId;
  const activePostTitle = activePost?.title || activeQueueItem?.title;
  const activeCommentUser = activeComment?.userId
    ? users.find((user) => user.taskId === task.id && user.userId === activeComment.userId)
    : undefined;

  // 点击主贴时自动选中第一条评论
  useEffect(() => {
    if (isFirstFeedChange.current) {
      isFirstFeedChange.current = false;
      prevFeedId.current = activeFeedId;
      return;
    }
    if (activeFeedId !== prevFeedId.current) {
      prevFeedId.current = activeFeedId;
      const firstComment = relatedComments[0];
      if (firstComment) {
        void handleSelectComment(firstComment);
      }
    }
  }, [activeFeedId, relatedComments]);

  async function handleSelectComment(comment: StoredComment) {
    setSelectedCommentId(comment.commentId);
    const profileToken = comment.xsecToken || activeQueueItem?.xsecToken;
    if (!comment.userId || !profileToken) {
      return;
    }
    if (users.some((user) => user.taskId === task.id && user.userId === comment.userId && user.rawPayload)) {
      return;
    }
    setLoadingUserId(comment.userId);
    try {
      await onLoadCommentUser(task.id, comment.userId, profileToken);
    } catch {
      // user_profile is a best-effort supplement; comment data remains usable without it.
    } finally {
      setLoadingUserId(null);
    }
  }

  return (
    <section className="task-detail">
      <div className="task-detail-header glass">
        <button className="back-button-sm" type="button" onClick={onBack}>
          返回任务列表
        </button>
        <div>
          <h3>{task.keyword}</h3>
          <p>
            {shortTaskId(task.id)} · {formatDateTime(task.createdAt)}
          </p>
        </div>
      </div>

      <section className="detail-overview">
        <article className="condition-panel glass">
          <div className="condition-heading">
            <div>
              <h3>采集条件</h3>
            </div>
          </div>

          <div className="condition-chips">
            <span>
              关键词 <strong>{task.keyword}</strong>
            </span>
            <span>
              地区 <strong>{task.filters.location}</strong>
            </span>
            <span>
              类型 <strong>{task.filters.note_type}</strong>
            </span>
            <span>
              时间 <strong>{task.filters.publish_time}</strong>
            </span>
            <span>
              范围 <strong>{task.filters.search_scope}</strong>
            </span>
            <span>
              排序 <strong>{task.filters.sort_by}</strong>
            </span>
            <span>
              评论上限 <strong>{task.options.commentConfig.max_comment_items}</strong>
            </span>
            <span>
              主贴数量 <strong>{task.options.searchLimit ?? "全部"}</strong>
            </span>
          </div>
        </article>

        <article className="dynamic-progress glass">
          <div>
            <h3>采集进度</h3>
            <p>{task.message}</p>
          </div>
          <div className="dynamic-progress-body">
            <div className="progress-bar-wrap">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <span className="progress-percent">{progress}%</span>
            </div>
            <div className="progress-stats">
              <div className="progress-stat">
                <FileText size={16} />
                <span className="progress-stat-label">主贴</span>
                <span className="progress-stat-value">{task.total ? `${task.completed}/${task.total}` : "—"}</span>
              </div>
              <div className="progress-stat">
                <MessageSquareText size={16} />
                <span className="progress-stat-label">评论</span>
                <span className="progress-stat-value">{comments.length}</span>
              </div>
              <div className="progress-stat">
                <UsersRound size={16} />
                <span className="progress-stat-label">用户</span>
                <span className="progress-stat-value">{uniqueUserCount}</span>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section className="task-detail-grid">
        {/* ---- 主贴数据 ---- */}
        <section className="data-block glass">
          <div className="section-title-with-eye">
            <h3>
              主贴数据 <span className="section-count">数量：{task.total || task.items.length}</span>
            </h3>
          </div>

          <div className="post-card-grid">
            {!task.items.length && <p className="muted empty-inline">正在等待主贴查询结果。</p>}
            {task.items.map((item, index) => {
              const post = posts.find((current) => current.feedId === item.feedId);
              const postIpLocation = getPostIpLocation(post);
              const isActive = activeFeedId === item.feedId;
              return (
                <button
                  className={`post-card ${isActive ? "active" : ""}`}
                  key={item.feedId}
                  type="button"
                  onClick={() => {
                    onSelectFeed(item.feedId);
                    window.setTimeout(() => {
                      postDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }, 0);
                  }}
                >
                  <span className={`dot status-${item.status}`} />
                  <div className="post-card-body">
                    <div className="post-card-head">
                      <Avatar src={post?.authorAvatar || item.searchItem.noteCard?.user?.avatar} name={post?.authorName || item.authorName} />
                      <span>{post?.authorName || item.authorName}</span>
                    </div>
                    <strong>
                      标题：{post?.title || item.title}
                    </strong>
                    <div className="post-card-meta">
                      <span>发布日期：{formatDateTime(post?.publishTime)}</span>
                      <span>IP：{postIpLocation}</span>
                    </div>
                    <div className="interaction-grid">
                      <span>点赞 {formatCount(post?.likedCount || item.searchItem.noteCard?.interactInfo?.likedCount)}</span>
                      <span>转发 {formatCount(post?.sharedCount || item.searchItem.noteCard?.interactInfo?.sharedCount)}</span>
                      <span>评论 {formatCount(post?.commentCount || item.searchItem.noteCard?.interactInfo?.commentCount)}</span>
                      <span>收藏 {formatCount(post?.collectedCount || item.searchItem.noteCard?.interactInfo?.collectedCount)}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <div className="data-row">
        {/* ---- 帖子详情 ---- */}
        <section className="data-block glass" ref={postDetailRef}>
          <div className="section-title-with-eye">
            <h3>帖子详情</h3>
          </div>
          <div className="relation-list post-detail-panel">
            {activePost || activeQueueItem ? (
              <article className="post-detail-card">
                <div className="post-detail-author">
                  <Avatar src={activeAuthorAvatar} name={activeAuthorName} />
                  <div>
                    <strong>发帖人：{activeAuthorName || "-"}</strong>
                    <span>用户ID：{activeAuthorId || "-"}</span>
                    <span>
                      帖子链接：
                      {activeFeedId ? (
                        <a href={buildPostUrl(activeFeedId, activeQueueItem?.xsecToken)} target="_blank" rel="noreferrer">
                          {buildPostUrl(activeFeedId, activeQueueItem?.xsecToken)}
                        </a>
                      ) : (
                        "-"
                      )}
                    </span>
                  </div>
                </div>
                <div className="post-detail-fields">
                  <span>发布日期：{formatDateTime(activePost?.publishTime)}</span>
                  <span>IP：{getPostIpLocation(activePost)}</span>
                  <span>点赞：{formatCount(activePost?.likedCount || activeQueueItem?.searchItem.noteCard?.interactInfo?.likedCount)}</span>
                  <span>转发：{formatCount(activePost?.sharedCount || activeQueueItem?.searchItem.noteCard?.interactInfo?.sharedCount)}</span>
                  <span>评论：{formatCount(activePost?.commentCount || activeQueueItem?.searchItem.noteCard?.interactInfo?.commentCount)}</span>
                  <span>收藏：{formatCount(activePost?.collectedCount || activeQueueItem?.searchItem.noteCard?.interactInfo?.collectedCount)}</span>
                  <span>粉丝：{activeAuthorUser?.fansCount || "-"}</span>
                  <span>关注：{activeAuthorUser?.followsCount || "-"}</span>
                  <span>获赞与收藏：{activeAuthorUser?.likedAndCollectedCount || "-"}</span>
                </div>
                <div className="post-detail-text">
                  <strong>{activePostTitle || "未命名帖子"}</strong>
                  <p>{activePost?.desc || "帖子详情读取完成后显示正文。"}</p>
                  {activeAuthorUser?.desc && <small>作者简介：{activeAuthorUser.desc}</small>}
                </div>
              </article>
            ) : (
              <p className="muted empty-inline">点击主贴后查看帖子详情。</p>
            )}
          </div>
        </section>

        {/* ---- 关联评论 ---- */}
        <section className="data-block glass">
          <div className="section-title-with-eye">
            <h3>关联评论</h3>
          </div>
          <div className="relation-list">
            {relatedComments.map((comment) => {
              const parentComment = comment.parentCommentId
                ? relatedComments.find((item) => item.commentId === comment.parentCommentId)
                : undefined;
              const isActive = activeComment?.commentId === comment.commentId;
              // 关联评论头像：优先用评论自带头像，其次查已加载的用户资料
              const commentUser = comment.userId
                ? users.find((u) => u.taskId === task.id && u.userId === comment.userId)
                : undefined;
              const commentAvatar = comment.avatar || commentUser?.avatar;
              return (
              <button
                className={`relation-card comment-select-card ${isActive ? "active" : ""}`}
                key={`${comment.commentId}-${comment.parentCommentId ?? "root"}`}
                type="button"
                onClick={() => void handleSelectComment(comment)}
              >
                <div className="comment-card-head">
                  <Avatar src={commentAvatar} name={comment.nickname || comment.userId} />
                  <span>{comment.nickname || comment.userId || "未知用户"}</span>
                  <time>
                    {comment.parentCommentId ? "回复日期：" : "评论日期："}
                    {formatDateTime(comment.createTime)}
                  </time>
                </div>
                {parentComment && (
                  <blockquote>
                    <span className="reply-label">回复</span> {parentComment.nickname || parentComment.userId || "未知用户"}：{parentComment.content || "无文本内容"}
                  </blockquote>
                )}
                <p>{comment.content || "无文本内容"}</p>
              </button>
            )})}
            {!relatedComments.length && <p className="muted empty-inline">当前主贴暂无评论数据。</p>}
          </div>
        </section>

        {/* ---- 关联用户 ---- */}
        <section className="data-block glass">
          <div className="section-title-with-eye">
            <h3>关联用户</h3>
          </div>
          <div className="relation-list user-profile-panel">
            {activeComment ? (
              <UserProfileCard
                user={activeCommentUser}
                fallback={{
                  userId: activeComment.userId,
                  nickname: activeComment.nickname,
                  avatar: activeComment.avatar,
                  ipLocation: activeComment.ipLocation,
                }}
                loading={loadingUserId === activeComment.userId}
              />
            ) : (
              <p className="muted empty-inline">点击评论后查看评论用户资料。</p>
            )}
          </div>
        </section>
        </div>
      </section>
    </section>
  );
}

function TaskLogModal({ task, onClose }: { task: CollectionTask; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const logs = [...(task.logs ?? [])].reverse();
  const copyText = buildTaskLogText(task);

  async function handleCopy() {
    await navigator.clipboard.writeText(copyText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="log-modal-backdrop" role="dialog" aria-modal="true">
      <section className="log-modal glass">
        <header className="log-modal-head">
          <div>
            <h3>任务日志</h3>
            <p>{shortTaskId(task.id)} · {task.keyword}</p>
          </div>
          <div className="log-modal-actions">
            <button type="button" onClick={() => void handleCopy()}>
              {copied ? "已复制" : "一键复制"}
            </button>
            <button type="button" onClick={onClose}>
              关闭
            </button>
          </div>
        </header>
        <div className="log-modal-list">
          {!logs.length && <p className="muted">暂无日志。</p>}
          {logs.map((log) => (
            <article className={`log-modal-item log-${log.type}`} key={log.id}>
              <header>
                <span>{formatDateTime(log.time)}</span>
                <strong>{log.title}</strong>
              </header>
              <p>{log.message}</p>
              {log.payload !== undefined && <pre>{safePreview(log.payload)}</pre>}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function FailureReasonModal({
  reason,
  onClose,
}: {
  reason: { title: string; error: string };
  onClose: () => void;
}) {
  return (
    <div className="log-modal-backdrop" role="dialog" aria-modal="true">
      <section className="failure-modal glass">
        <header className="log-modal-head">
          <div>
            <h3>失败原因</h3>
            <p>{reason.title}</p>
          </div>
          <div className="log-modal-actions">
            <button type="button" onClick={onClose}>
              关闭
            </button>
          </div>
        </header>
        <pre>{reason.error}</pre>
      </section>
    </div>
  );
}

export function PostTable({
  tasks,
  posts,
  onRetryPost,
  onRetryPosts,
  onDeletePosts,
}: {
  tasks: CollectionTask[];
  posts: StoredPost[];
  onRetryPost: (taskId: string, feedId: string) => void;
  onRetryPosts: (targets: Array<{ taskId: string; feedId: string }>) => void;
  onDeletePosts: (targets: Array<{ taskId: string; feedId: string }>) => void;
}) {
  const [channelFilter, setChannelFilter] = useState("全部");
  const [statusFilter, setStatusFilter] = useState<CollectionTask["items"][number]["status"] | "全部">("全部");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [failureReason, setFailureReason] = useState<{ title: string; error: string } | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [openFilter, setOpenFilter] = useState<"channel" | "date" | "status" | null>(null);
  const [openRowMenu, setOpenRowMenu] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const panelRef = useRef<HTMLElement | null>(null);
  const rows = useMemo(() => buildPostRows(tasks, posts), [tasks, posts]);
  const channels = useMemo(() => ["全部", ...Array.from(new Set(rows.map((row) => row.channel).filter(Boolean)))], [rows]);
  const statusOptions: Array<{ value: CollectionTask["items"][number]["status"] | "全部"; label: string }> = [
    { value: "全部", label: "全部" },
    { value: "completed", label: "成功" },
    { value: "failed", label: "失败" },
    { value: "queued", label: "待采集" },
    { value: "fetching", label: "采集中" },
    { value: "skipped", label: "跳过" },
  ];
  const filteredRows = rows.filter((row) => {
    const matchChannel = channelFilter === "全部" || row.channel === channelFilter;
    const matchStatus = statusFilter === "全部" || row.status === statusFilter;
    const rowDate = row.publishDate || row.createdAt.slice(0, 10);
    const matchDateFrom = !dateFrom || rowDate >= dateFrom;
    const matchDateTo = !dateTo || rowDate <= dateTo;
    const matchDate = matchDateFrom && matchDateTo;
    return matchChannel && matchStatus && matchDate;
  });
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const selectedTargets = selectedRows
    .map((key) => {
      const [taskId, feedId] = key.split(":");
      return { taskId, feedId };
    })
    .filter((target) => target.taskId && target.feedId);
  const allPageSelected = pageRows.length > 0 && pageRows.every((row) => selectedRows.includes(row.rowKey));

  useEffect(() => {
    setPage(1);
    setSelectedRows([]);
  }, [channelFilter, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (!openFilter && !openRowMenu) {
      return;
    }

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (target.closest(".filter-dropdown, .date-range-filter, .row-actions")) {
        return;
      }
      if (panelRef.current?.contains(target)) {
        setOpenFilter(null);
        setOpenRowMenu(null);
        return;
      }
      setOpenFilter(null);
      setOpenRowMenu(null);
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openFilter, openRowMenu]);

  function toggleRow(rowKey: string) {
    setSelectedRows((current) => current.includes(rowKey) ? current.filter((item) => item !== rowKey) : [...current, rowKey]);
  }

  function togglePageRows() {
    if (allPageSelected) {
      setSelectedRows((current) => current.filter((item) => !pageRows.some((row) => row.rowKey === item)));
      return;
    }
    setSelectedRows((current) => Array.from(new Set([...current, ...pageRows.map((row) => row.rowKey)])));
  }

  return (
    <section className="data-panel glass post-data-panel" ref={panelRef}>
      <div className="panel-heading">
        <div>
          <h3>帖子数据</h3>
    
        </div>
      </div>
      <div className="post-table-toolbar">
        <FilterDropdown
          label="渠道"
          value={channelFilter}
          open={openFilter === "channel"}
          items={channels}
          onToggle={() => {
            setOpenRowMenu(null);
            setOpenFilter((current) => (current === "channel" ? null : "channel"));
          }}
          onChange={(value) => { setChannelFilter(value); setOpenFilter(null); }}
          onClose={() => setOpenFilter(null)}
        />
        <DateRangeFilter
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChangeFrom={setDateFrom}
          onChangeTo={setDateTo}
        />
        <FilterDropdown
          label="状态"
          value={statusOptions.find((option) => option.value === statusFilter)?.label || "全部"}
          open={openFilter === "status"}
          items={statusOptions.map((option) => option.value)}
          itemLabel={(value) => statusOptions.find((option) => option.value === value)?.label || String(value)}
          onToggle={() => {
            setOpenRowMenu(null);
            setOpenFilter((current) => (current === "status" ? null : "status"));
          }}
          onChange={(value) => { setStatusFilter(value); setOpenFilter(null); }}
          onClose={() => setOpenFilter(null)}
        />
        <button className={`batch-mode-button ${batchMode ? "active" : ""}`} type="button" onClick={() => {
          setOpenFilter(null);
          setOpenRowMenu(null);
          setBatchMode((current) => !current);
          setSelectedRows([]);
        }}>
          批量操作
        </button>
      </div>
      {batchMode && (
        <div className="batch-action-bar">
          <span>已选择 {selectedRows.length} 条</span>
          <button type="button" disabled={!selectedRows.length} onClick={() => onRetryPosts(selectedTargets)}>
            批量重新采集
          </button>
          <button className="danger" type="button" disabled={!selectedRows.length} onClick={() => onDeletePosts(selectedTargets)}>
            批量删除
          </button>
        </div>
      )}
      <div className="table post-data-table">
        <div className={`posts-table-head ${batchMode ? "selecting" : ""}`}>
          {batchMode && (
            <span>
              <input type="checkbox" checked={allPageSelected} onChange={togglePageRows} aria-label="选择当前页" />
            </span>
          )}
          <span>标题</span>
          <span>作者</span>
          <span>来源渠道</span>
          <span>采集状态</span>
          <span>创建日期</span>
          <span>发布时间</span>
          <span>操作</span>
        </div>
        {!pageRows.length && (
          <div className="table-empty-row">暂无符合条件的帖子数据。</div>
        )}
        {pageRows.map((row) => (
          <div className={`posts-table-row ${batchMode ? "selecting" : ""}`} key={row.rowKey}>
            {batchMode && (
              <span>
                <input
                  type="checkbox"
                  checked={selectedRows.includes(row.rowKey)}
                  onChange={() => toggleRow(row.rowKey)}
                  aria-label={`选择 ${row.title}`}
                />
              </span>
            )}
            <strong>
              <a href={row.postUrl} target="_blank" rel="noreferrer">
                {row.title}
              </a>
            </strong>
            <span className="table-author-cell">
              <Avatar src={row.authorAvatar} name={row.authorName || row.authorId} />
              {row.authorUrl ? (
                <a href={row.authorUrl} target="_blank" rel="noreferrer">
                  {row.authorName || row.authorId || "-"}
                </a>
              ) : (
                row.authorName || row.authorId || "-"
              )}
            </span>
            <span>{row.channel}</span>
            <span className={`badge status-${row.status}`}>{postStatusText(row.status)}</span>
            <span>{formatTableDate(row.createdAt)}</span>
            <span>{formatTableDate(row.publishTime)}</span>
            <span className="row-actions">
              <button className="table-more-button" type="button" onClick={() => {
                setOpenFilter(null);
                setOpenRowMenu((current) => (current === row.rowKey ? null : row.rowKey));
              }}>
                ···
              </button>
              {openRowMenu === row.rowKey && (
                <div className="row-action-menu">
                  {row.status === "failed" && (
                    <button type="button" onClick={() => { setFailureReason({ title: row.title, error: row.error || "暂无失败原因" }); setOpenRowMenu(null); }}>
                      查看失败原因
                    </button>
                  )}
                  <button type="button" onClick={() => { onRetryPost(row.taskId, row.feedId); setOpenRowMenu(null); }}>
                    单独重新采集
                  </button>
                  <button className="danger" type="button" onClick={() => { onDeletePosts([{ taskId: row.taskId, feedId: row.feedId }]); setOpenRowMenu(null); }}>
                    删除
                  </button>
                </div>
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="pagination-bar">
        <button type="button" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
          上一页
        </button>
        <span>
          共 {filteredRows.length} 行 · 第 {safePage} / {totalPages} 页 · 每页 20 行
        </span>
        <button type="button" disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
          下一页
        </button>
      </div>
      {failureReason && (
        <FailureReasonModal reason={failureReason} onClose={() => setFailureReason(null)} />
      )}
    </section>
  );
}

export function CommentTable({ comments, users }: { comments: StoredComment[]; users: StoredUser[] }) {
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(comments.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageComments = comments.slice((safePage - 1) * pageSize, safePage * pageSize);

  if (!comments.length) {
    return <EmptyState icon={MessageSquareText} title="暂无评论样本" text="开启评论采集后，一级和二级评论会拆成独立记录。" />;
  }

  return (
    <section className="data-panel glass" style={{ overflow: "hidden", display: "grid", gridTemplateRows: "auto minmax(0, 1fr) auto" }}>
      <div className="panel-heading">
        <div>
          <h3>评论池</h3>
        </div>
      </div>
      <div className="table" style={{ overflowY: "auto", minHeight: 0 }}>
        <div className="comments-table-head">
          <span>内容</span>
          <span>用户名</span>
          <span>类型</span>
          <span>IP归属地</span>
          <span>评论时间</span>
          <span>所属帖子</span>
        </div>
        {pageComments.map((comment) => (
          <div className="comments-table-row" key={`${comment.commentId}-${comment.parentCommentId ?? "root"}`}>
            <a href={buildPostUrl(comment.feedId)} target="_blank" rel="noreferrer" title="查看帖子">
              {comment.content || "无文本内容"}
            </a>
            <a className="table-author-cell" href={buildAuthorUrl(comment.userId || "")} target="_blank" rel="noreferrer">
              {(() => {
                // 头像优先使用评论自带的 avatar，其次查找已加载的用户资料
                const commentUser = comment.userId
                  ? users.find((u) => u.taskId === comment.taskId && u.userId === comment.userId)
                  : undefined;
                const commentAvatar = comment.avatar || commentUser?.avatar;
                return <Avatar src={commentAvatar} name={comment.nickname || comment.userId} />;
              })()}
              {comment.nickname || comment.userId || "未知用户"}
            </a>
            <span className={`comment-type-badge ${comment.parentCommentId ? "reply" : "comment"}`}>
              {comment.parentCommentId ? "回复" : "评论"}
            </span>
            <span>{comment.ipLocation || "-"}</span>
            <span>{formatTableDate(comment.createTime)}</span>
            <a href={buildPostUrl(comment.feedId)} target="_blank" rel="noreferrer">
              {comment.feedId ? shortTaskId(comment.feedId) : "-"}
            </a>
          </div>
        ))}
      </div>
      <div className="pagination-bar">
        <button type="button" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
          上一页
        </button>
        <span>
          共 {comments.length} 行 · 第 {safePage} / {totalPages} 页 · 每页 20 行
        </span>
        <button type="button" disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
          下一页
        </button>
      </div>
    </section>
  );
}

function UserTable({ users }: { users: StoredUser[] }) {
  if (!users.length) {
    return <EmptyState icon={UserRound} title="暂无用户画像" text="开启补充用户主页后，会展示作者和部分评论用户信息。" />;
  }

  return (
    <section className="data-panel glass">
      <div className="panel-heading">
        <div>
          <h3>用户画像</h3>
          <p>user_profile 的基础资料缓存。</p>
        </div>
      </div>
      <div className="user-grid">
        {users.map((user) => (
          <article className="user-card" key={user.userId}>
            <strong>{user.nickname || user.userId}</strong>
            <span>{user.redId || "未获取小红书号"}</span>
            <p>{user.desc || "暂无简介"}</p>
            <div className="user-card-stats">
              <span>粉丝 {user.fansCount || "-"}</span>
              <span>关注 {user.followsCount || "-"}</span>
              <span>获赞与收藏 {user.likedAndCollectedCount || "-"}</span>
            </div>
            <small>{user.ipLocation || "-"}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

// 渠道数据分析面板：渠道分布、数据量统计、IP属地分布
// 浅色图表配色
const CHANNEL_COLORS: Record<string, string> = {
  "小红书": "#2563eb",
  "抖音": "#0ea5e9",
  "汽车之家": "#3b82f6",
  "懂车帝": "#64748b",
  "易车网": "#94a3b8",
};
const CHANNEL_LIGHT_COLORS = ["#2563eb", "#0ea5e9", "#3b82f6", "#64748b", "#94a3b8", "#38bdf8", "#475569", "#60a5fa"];

export function UserInsight({
  users,
  posts,
  comments,
  tasks,
}: {
  users: StoredUser[];
  posts: StoredPost[];
  comments: StoredComment[];
  tasks: CollectionTask[];
}) {
  const navigate = useNavigate();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_STORAGE_API_BASE_URL || "http://127.0.0.1:5174"}/api/storage/analytics`);
        if (res.ok) {
          setData(await res.json());
        }
      } catch {
        // 服务端不可用时用本地数据兜底
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // 本地兜底聚合（服务端不可用时）
  const stats = useMemo(() => {
    if (data) return data;

    // 从本地内存聚合
    const channelTaskMap: Record<string, number> = {};
    const channelPostMap: Record<string, number> = {};
    const channelUserMap: Record<string, number> = {};
    const channelCommentMap: Record<string, number> = {};
    const ipMap: Record<string, number> = {};

    for (const t of tasks) {
      channelTaskMap[t.channel] = (channelTaskMap[t.channel] || 0) + 1;
    }
    for (const p of posts) {
      channelPostMap["小红书"] = (channelPostMap["小红书"] || 0) + 1;
    }
    for (const u of users) {
      channelUserMap["小红书"] = (channelUserMap["小红书"] || 0) + 1;
      if (u.ipLocation) {
        ipMap[u.ipLocation] = (ipMap[u.ipLocation] || 0) + 1;
      }
    }
    for (const _c of comments) {
      channelCommentMap["小红书"] = (channelCommentMap["小红书"] || 0) + 1;
    }

    return {
      channelTasks: Object.entries(channelTaskMap).map(([channel, count]) => ({ channel, count })),
      channelPosts: Object.entries(channelPostMap).map(([channel, count]) => ({ channel, count })),
      channelComments: Object.entries(channelCommentMap).map(([channel, count]) => ({ channel, count })),
      channelUsers: Object.entries(channelUserMap).map(([channel, count]) => ({ channel, count })),
      ipLocations: Object.entries(ipMap)
        .map(([ip_location, count]) => ({ ip_location, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20),
    };
  }, [data, tasks, posts, comments, users]);

  if (loading) {
    return (
      <section className="data-panel glass" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 320 }}>
        <Loader2 size={28} className="spin" />
      </section>
    );
  }

  // 若无任何数据则展示空状态
  const hasAnyData = stats.channelTasks.length > 0 || stats.channelPosts.length > 0 || stats.channelComments.length > 0 || stats.channelUsers.length > 0 || stats.ipLocations.length > 0;
  if (!hasAnyData) {
    return (
      <section className="data-panel glass" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 320 }}>
        <div style={{ textAlign: "center", color: "var(--muted)" }}>
          <UsersRound size={40} style={{ marginBottom: 12 }} />
          <p>暂无用户画像数据，请先完成采集任务。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="data-panel glass user-insight-panel" style={{ overflowY: "auto", padding: 20 }}>
      <div className="panel-heading">
        <div>
          <h3>渠道数据分析</h3>
        </div>
      </div>

      {/* 概览卡片 */}
      <div className="insight-metric-row">
        <button className="insight-metric-card clickable" type="button" onClick={() => navigate("/job_queue")}>
          <span className="insight-metric-value">{tasks.length}</span>
          <span className="insight-metric-label">采集任务</span>
        </button>
        <button className="insight-metric-card clickable" type="button" onClick={() => navigate("/tiezi-data")}>
          <span className="insight-metric-value">{posts.length}</span>
          <span className="insight-metric-label">主贴数据</span>
        </button>
        <button className="insight-metric-card clickable" type="button" onClick={() => navigate("/comment-data")}>
          <span className="insight-metric-value">{comments.length}</span>
          <span className="insight-metric-label">评论数据</span>
        </button>
        <button className="insight-metric-card clickable" type="button" onClick={() => navigate("/user-pool")}>
          <span className="insight-metric-value">{users.length}</span>
          <span className="insight-metric-label">用户数</span>
        </button>
      </div>

      {/* 图表区域：两列布局 */}
      <div className="insight-charts-grid">
        {/* 渠道任务分布 - 环形图 */}
        <div className="insight-chart-card">
          <h4 className="insight-chart-title">渠道任务分布</h4>
          {stats.channelTasks.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={stats.channelTasks}
                  dataKey="count"
                  nameKey="channel"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  innerRadius={48}
                  label={(entry: any) => `${entry.channel} ${entry.count}`}
                  labelLine={{ stroke: "#94a3b8", strokeWidth: 1 }}
                >
                  {stats.channelTasks.map((entry, index) => (
                    <Cell key={entry.channel} fill={CHANNEL_COLORS[entry.channel] || CHANNEL_LIGHT_COLORS[index % CHANNEL_LIGHT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "rgba(255,255,255,0.95)", borderRadius: 8, border: "1px solid #e4eaf2", fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="muted empty-inline">暂无数据</p>
          )}
        </div>

        {/* 渠道帖子数分布 - 柱状图 */}
        <div className="insight-chart-card">
          <h4 className="insight-chart-title">渠道帖子数分布</h4>
          {stats.channelPosts.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={stats.channelPosts} margin={{ top: 4, right: 16, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="channel" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "rgba(255,255,255,0.95)", borderRadius: 8, border: "1px solid #e4eaf2", fontSize: 12 }}
                  formatter={(value: any) => [`${value} 条`, "帖子数"]}
                />
                <Bar dataKey="count" name="帖子数" radius={[6, 6, 0, 0]} maxBarSize={48}>
                  {stats.channelPosts.map((entry, index) => (
                    <Cell key={entry.channel} fill={CHANNEL_COLORS[entry.channel] || CHANNEL_LIGHT_COLORS[index % CHANNEL_LIGHT_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="muted empty-inline">暂无数据</p>
          )}
        </div>

        {/* 渠道评论数分布 - 柱状图 */}
        <div className="insight-chart-card">
          <h4 className="insight-chart-title">渠道评论数分布</h4>
          {stats.channelComments.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={stats.channelComments} margin={{ top: 4, right: 16, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="channel" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "rgba(255,255,255,0.95)", borderRadius: 8, border: "1px solid #e4eaf2", fontSize: 12 }}
                  formatter={(value: any) => [`${value} 条`, "评论数"]}
                />
                <Bar dataKey="count" name="评论数" radius={[6, 6, 0, 0]} maxBarSize={48}>
                  {stats.channelComments.map((entry, index) => (
                    <Cell key={entry.channel} fill={CHANNEL_COLORS[entry.channel] || CHANNEL_LIGHT_COLORS[index % CHANNEL_LIGHT_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="muted empty-inline">暂无数据</p>
          )}
        </div>

        {/* 渠道用户数分布 - 柱状图 */}
        <div className="insight-chart-card">
          <h4 className="insight-chart-title">渠道用户数分布</h4>
          {stats.channelUsers.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={stats.channelUsers} margin={{ top: 4, right: 16, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="channel" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "rgba(255,255,255,0.95)", borderRadius: 8, border: "1px solid #e4eaf2", fontSize: 12 }}
                  formatter={(value: any) => [`${value} 人`, "用户数"]}
                />
                <Bar dataKey="count" name="用户数" radius={[6, 6, 0, 0]} maxBarSize={48}>
                  {stats.channelUsers.map((entry, index) => (
                    <Cell key={entry.channel} fill={CHANNEL_COLORS[entry.channel] || CHANNEL_LIGHT_COLORS[index % CHANNEL_LIGHT_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="muted empty-inline">暂无数据</p>
          )}
        </div>
      </div>

      {/* IP 属地分布 - 横向柱状图（全宽） */}
      {stats.ipLocations.length > 0 && (
        <div className="insight-chart-card" style={{ marginTop: 16 }}>
          <h4 className="insight-chart-title">用户 IP 属地分布</h4>
          <ResponsiveContainer width="100%" height={Math.max(280, stats.ipLocations.length * 28)}>
            <BarChart data={stats.ipLocations} layout="vertical" margin={{ top: 4, right: 24, left: 40, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontalCoordinatesGenerator={({ height }) => []} />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="ip_location" tick={{ fontSize: 11 }} width={50} />
              <Tooltip
                contentStyle={{ background: "rgba(255,255,255,0.95)", borderRadius: 8, border: "1px solid #e4eaf2", fontSize: 12 }}
                formatter={(value: any) => [`${value} 人`, "用户数"]}
              />
              <Bar dataKey="count" name="用户数" radius={[0, 6, 6, 0]} maxBarSize={22} fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

// 用户池页面：展示所有用户及其关联的帖子数、评论数
export function UserPool({
  users,
  posts,
  comments,
  focusedUserId,
}: {
  users: StoredUser[];
  posts: StoredPost[];
  comments: StoredComment[];
  focusedUserId?: string | null;
}) {
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<"posts" | "comments" | null>(null);
  const [sortKey, setSortKey] = useState<"postCount" | "commentCount" | "fans" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  // 统计每个用户的帖子数和评论数
  const postCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of posts) {
      if (p.authorId) map[p.authorId] = (map[p.authorId] || 0) + 1;
    }
    return map;
  }, [posts]);

  const commentCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of comments) {
      if (c.userId) map[c.userId] = (map[c.userId] || 0) + 1;
    }
    return map;
  }, [comments]);

  // 当前展开用户的帖子列表和评论列表
  const userPosts = useMemo(() => {
    if (!expandedUserId) return [];
    return posts.filter((p) => p.authorId === expandedUserId);
  }, [posts, expandedUserId]);

  const userComments = useMemo(() => {
    if (!expandedUserId) return [];
    return comments.filter((c) => c.userId === expandedUserId);
  }, [comments, expandedUserId]);

  // 排序后的用户列表
  const sortedUsers = useMemo(() => {
    if (!sortKey) return users;
    const sorted = [...users].sort((a, b) => {
      let valA = 0;
      let valB = 0;
      if (sortKey === "postCount") {
        valA = postCountMap[a.userId] || 0;
        valB = postCountMap[b.userId] || 0;
      } else if (sortKey === "commentCount") {
        valA = commentCountMap[a.userId] || 0;
        valB = commentCountMap[b.userId] || 0;
      } else if (sortKey === "fans") {
        valA = parseInt(a.fansCount || "0", 10) || 0;
        valB = parseInt(b.fansCount || "0", 10) || 0;
      }
      return sortDir === "desc" ? valB - valA : valA - valB;
    });
    return sorted;
  }, [users, postCountMap, commentCountMap, sortKey, sortDir]);

  // 切换排序
  function toggleSort(key: "postCount" | "commentCount" | "fans") {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  // 排序变更时重置到第一页
  useEffect(() => {
    setPage(1);
  }, [sortKey, sortDir]);

  useEffect(() => {
    if (!focusedUserId) return;
    const userIndex = users.findIndex((user) => user.userId === focusedUserId);
    if (userIndex < 0) return;

    setSortKey(null);
    setSortDir("desc");
    setPage(Math.floor(userIndex / 20) + 1);
    setExpandedUserId(focusedUserId);
    setExpandedSection(null);

    const timer = window.setTimeout(() => {
      const row = document.getElementById(`user-pool-${focusedUserId}`);
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
      row?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusedUserId, users]);

  // 分页计算
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(sortedUsers.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageUsers = sortedUsers.slice((safePage - 1) * pageSize, safePage * pageSize);

  if (!users.length) {
    return <EmptyState icon={UsersRound} title="暂无用户数据" text="请先完成采集任务，开启补充用户主页后这里会展示所有用户列表。" />;
  }


  return (
    <section className="data-panel glass" style={{ overflow: "hidden", display: "grid", gridTemplateRows: "auto minmax(0, 1fr) auto" }}>
      <div className="panel-heading">
        <div>
          <h3>用户池</h3>
        </div>
      </div>
      <div className="user-list-table" style={{ padding: "4px 0", overflowY: "auto", minHeight: 0 }}>
        <div className="user-list-table-head">
          <span>用户</span>
          <span>渠道</span>
          <button className="sortable-header" type="button" onClick={() => toggleSort("postCount")}>
            帖子数
            {sortKey === "postCount" && (sortDir === "desc" ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
          </button>
          <button className="sortable-header" type="button" onClick={() => toggleSort("commentCount")}>
            评论数
            {sortKey === "commentCount" && (sortDir === "desc" ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
          </button>
          <button className="sortable-header" type="button" onClick={() => toggleSort("fans")}>
            粉丝
            {sortKey === "fans" && (sortDir === "desc" ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
          </button>
          <span>IP</span>
        </div>
        {pageUsers.map((u) => {
          const isExpanded = expandedUserId === u.userId;
          return (
            <div key={u.userId}>
              <div
                id={`user-pool-${u.userId}`}
                className={`user-list-table-row user-pool-row ${isExpanded ? "expanded" : ""} ${focusedUserId === u.userId ? "focused" : ""}`}
                onClick={() => { setExpandedUserId(isExpanded ? null : u.userId); setExpandedSection(null); }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") { setExpandedUserId(isExpanded ? null : u.userId); setExpandedSection(null); } }}
              >
                <div className="user-list-cell-name">
                  <Avatar src={u.avatar} name={u.nickname || u.userId} />
                  <div>
                    <a href={buildAuthorUrl(u.userId)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                      <strong>{u.nickname || u.userId}</strong>
                    </a>
                    <small style={{ color: "#8a98aa" }}>{u.redId || ""}</small>
                  </div>
                </div>
                <span>小红书</span>
                <span>{postCountMap[u.userId] || 0}</span>
                <span>{commentCountMap[u.userId] || 0}</span>
                <span>{u.fansCount || "-"}</span>
                <span>{u.ipLocation || "-"}</span>
              </div>
              {/* 用户详情内嵌面板 */}
              {isExpanded && (
                <div className="user-detail-inline">
                  <div className="user-detail-grid">
                    <div className="user-detail-item">
                      <span className="user-detail-label">用户ID</span>
                      <span className="user-detail-value">{u.userId || "-"}</span>
                    </div>
                    <div className="user-detail-item">
                      <span className="user-detail-label">昵称</span>
                      <span className="user-detail-value">{u.nickname || "-"}</span>
                    </div>
                    <div className="user-detail-item">
                      <span className="user-detail-label">小红书号</span>
                      <span className="user-detail-value">{u.redId || "-"}</span>
                    </div>
                    <div className="user-detail-item">
                      <span className="user-detail-label">IP 属地</span>
                      <span className="user-detail-value">{u.ipLocation || "-"}</span>
                    </div>
                    {/* 帖子数：可点击展开帖子列表 */}
                    <div className="user-detail-item">
                      <span className="user-detail-label">发布帖子</span>
                      <button
                        className={`user-detail-link ${expandedSection === "posts" ? "active" : ""}`}
                        type="button"
                        onClick={() => setExpandedSection(expandedSection === "posts" ? null : "posts")}
                      >
                        {postCountMap[u.userId] || 0} 篇
                      </button>
                    </div>
                    {/* 评论数：可点击展开评论列表 */}
                    <div className="user-detail-item">
                      <span className="user-detail-label">发表评论</span>
                      <button
                        className={`user-detail-link ${expandedSection === "comments" ? "active" : ""}`}
                        type="button"
                        onClick={() => setExpandedSection(expandedSection === "comments" ? null : "comments")}
                      >
                        {commentCountMap[u.userId] || 0} 条
                      </button>
                    </div>
                    <div className="user-detail-item">
                      <span className="user-detail-label">粉丝</span>
                      <span className="user-detail-value">{u.fansCount || "-"}</span>
                    </div>
                    <div className="user-detail-item">
                      <span className="user-detail-label">关注</span>
                      <span className="user-detail-value">{u.followsCount || "-"}</span>
                    </div>
                    <div className="user-detail-item">
                      <span className="user-detail-label">获赞与收藏</span>
                      <span className="user-detail-value">{u.likedAndCollectedCount || "-"}</span>
                    </div>
                    <div className="user-detail-item" style={{ gridColumn: "span 2" }}>
                      <span className="user-detail-label">主页链接</span>
                      <a className="user-detail-value" href={buildAuthorUrl(u.userId)} target="_blank" rel="noreferrer">
                        {buildAuthorUrl(u.userId)}
                      </a>
                    </div>
                    <div className="user-detail-item" style={{ gridColumn: "span 2" }}>
                      <span className="user-detail-label">简介</span>
                      <span className="user-detail-value">{u.desc || "暂无简介"}</span>
                    </div>
                  </div>
                  {/* 帖子列表子面板 */}
                  {expandedSection === "posts" && (
                    <div className="user-detail-sublist">
                      <div className="user-detail-sublist-head">
                        <strong>帖子列表</strong>
                        <span>{userPosts.length} 篇</span>
                      </div>
                      {!userPosts.length && <p className="muted" style={{ padding: "8px 0" }}>暂无帖子数据。</p>}
                      {userPosts.map((p) => (
                        <div className="user-detail-sublist-row" key={p.feedId}>
                          <a href={buildPostUrl(p.feedId)} target="_blank" rel="noreferrer" className="sublist-title">
                            {p.title || "未命名帖子"}
                          </a>
                          <span className="sublist-meta">
                            {p.ipLocation || "-"} · {formatTableDate(p.publishTime)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 评论列表子面板 */}
                  {expandedSection === "comments" && (
                    <div className="user-detail-sublist">
                      <div className="user-detail-sublist-head">
                        <strong>评论列表</strong>
                        <span>{userComments.length} 条</span>
                      </div>
                      {!userComments.length && <p className="muted" style={{ padding: "8px 0" }}>暂无评论数据。</p>}
                      {userComments.map((c) => (
                        <div className="user-detail-sublist-row" key={`${c.commentId}-${c.parentCommentId ?? "root"}`}>
                          <a href={buildPostUrl(c.feedId)} target="_blank" rel="noreferrer" className="sublist-title">
                            {c.content || "无文本内容"}
                          </a>
                          <span className="sublist-meta">
                            {c.parentCommentId ? "回复" : "评论"} · {formatTableDate(c.createTime)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="pagination-bar">
        <button type="button" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
          上一页
        </button>
        <span>
          共 {sortedUsers.length} 行 · 第 {safePage} / {totalPages} 页 · 每页 20 行
        </span>
        <button type="button" disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
          下一页
        </button>
      </div>
    </section>
  );
}

function EmptyState({
  icon: Icon,
  title,
  text,
}: {
  icon: React.ComponentType<{ size?: number }>;
  title: string;
  text: string;
}) {
  return (
    <section className="empty-state glass">
      <Icon size={32} />
      <h3>{title}</h3>
      <p>{text}</p>
    </section>
  );
}

function statusText(status: CollectionTask["status"]) {
  const map: Record<CollectionTask["status"], string> = {
    queued: "待采集",
    running: "采集中",
    completed: "已完成",
    failed: "失败",
    paused: "已暂停",
  };
  return map[status];
}

export function countUniqueUsers(posts: StoredPost[], comments: StoredComment[], users: StoredUser[]) {
  const ids = new Set<string>();
  posts.forEach((post) => {
    if (post.authorId) {
      ids.add(post.authorId);
    }
  });
  comments.forEach((comment) => {
    if (comment.userId) {
      ids.add(comment.userId);
    }
  });
  users.forEach((user) => {
    if (user.userId) {
      ids.add(user.userId);
    }
  });
  return ids.size;
}

function buildPostRows(tasks: CollectionTask[], posts: StoredPost[]) {
  return tasks.flatMap((task) =>
    task.items.map((item) => {
      const post = posts.find((current) => current.taskId === task.id && current.feedId === item.feedId);
      const authorId = post?.authorId || item.authorId;
      return {
        rowKey: `${task.id}:${item.feedId}`,
        taskId: task.id,
        feedId: item.feedId,
        title: post?.title || item.title || "未命名帖子",
        authorName: post?.authorName || item.authorName,
        authorAvatar: post?.authorAvatar,
        authorId,
        channel: task.channel || "小红书",
        status: item.status,
        error: item.error,
        createdAt: task.createdAt,
        publishDate: post?.publishTime ? formatTableDate(post.publishTime) : "",
        publishTime: post?.publishTime,
        postUrl: buildPostUrl(item.feedId, item.xsecToken),
        authorUrl: authorId ? buildAuthorUrl(authorId) : "",
      };
    }),
  );
}

function buildPostUrl(feedId: string, xsecToken?: string) {
  const url = new URL(`https://www.xiaohongshu.com/explore/${feedId}`);
  if (xsecToken) {
    url.searchParams.set("xsec_token", xsecToken);
  }
  return url.toString();
}

function buildAuthorUrl(userId: string) {
  return `https://www.xiaohongshu.com/user/profile/${userId}`;
}

function formatTableDate(value?: string | number) {
  const formatted = formatDateTime(value);
  return formatted === "-" ? "-" : formatted.slice(0, 10);
}

function postStatusText(status: CollectionTask["items"][number]["status"]) {
  const map: Record<CollectionTask["items"][number]["status"], string> = {
    queued: "待采集",
    fetching: "采集中",
    completed: "成功",
    failed: "失败",
    skipped: "跳过",
  };
  return map[status];
}

function itemStatusText(status: CollectionTask["items"][number]["status"]) {
  const map: Record<CollectionTask["items"][number]["status"], string> = {
    queued: "等待",
    fetching: "读取中",
    completed: "完成",
    failed: "失败",
    skipped: "跳过",
  };
  return map[status];
}

function safePreview(payload: unknown) {
  try {
    const text = JSON.stringify(payload, null, 2);
    return text.length > 2400 ? `${text.slice(0, 2400)}\n...` : text;
  } catch {
    return String(payload);
  }
}

function buildTaskLogText(task: CollectionTask) {
  return JSON.stringify(
    {
      task: {
        id: task.id,
        keyword: task.keyword,
        channel: task.channel,
        status: task.status,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
        total: task.total,
        completed: task.completed,
        failed: task.failed,
      },
      logs: [...(task.logs ?? [])].reverse().map((log) => ({
        time: log.time,
        type: log.type,
        title: log.title,
        message: log.message,
        payload: log.payload,
      })),
    },
    null,
    2,
  );
}

export function profileToStoredUser(taskId: string, userId: string, profile: UserProfileData): StoredUser {
  const info = profile.data?.userBasicInfo;
  const stats = normalizeUserProfileStats(profile.data);
  return {
    taskId,
    userId,
    nickname: info?.nickname,
    redId: info?.redId,
    avatar: info?.avatar || extractAvatarUrl(info?.images) || extractAvatarUrl(info?.imageb),
    gender: info?.gender,
    ipLocation: info?.ipLocation,
    desc: info?.desc,
    interactions: profile.data?.interactions,
    fansCount: stats.fansCount,
    followsCount: stats.followsCount,
    likedAndCollectedCount: stats.likedAndCollectedCount,
    rawPayload: profile,
  };
}

function normalizeUserProfileStats(data: UserProfileData["data"]) {
  const interactions = data?.interactions;
  const basicInfo = data?.userBasicInfo;
  const findDirectCount = (...keys: Array<keyof NonNullable<UserProfileData["data"]> | keyof NonNullable<UserProfileData["data"]>["userBasicInfo"]>) => {
    for (const key of keys) {
      const dataValue = data?.[key as keyof NonNullable<UserProfileData["data"]>];
      const basicValue = basicInfo?.[key as keyof NonNullable<UserProfileData["data"]>["userBasicInfo"]];
      const value = toDisplayText(dataValue) || toDisplayText(basicValue);
      if (value) {
        return value;
      }
    }
    return undefined;
  };
  const findCount = (...keywords: string[]) =>
    interactions?.find((item) => {
      const text = `${item.type ?? ""}${item.name ?? ""}`.toLowerCase();
      return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
    })?.count;

  return {
    fansCount: findDirectCount("fansCount") || toDisplayText(findCount("fans", "粉丝")),
    followsCount: findDirectCount("followsCount", "followingCount") || toDisplayText(findCount("follows", "follow", "following", "关注")),
    likedAndCollectedCount:
      findDirectCount("likedAndCollectedCount") || mergeCounts(findDirectCount("likedCount"), findDirectCount("collectedCount")) || toDisplayText(findCount("liked", "likes", "like", "获赞", "点赞", "收藏")),
  };
}

function getPostIpLocation(post?: StoredPost) {
  if (!post) {
    return "-";
  }
  return post.ipLocation || readRawIpLocation(post.rawPayload) || "-";
}

function readRawIpLocation(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  const direct = toDisplayText(record.ipLocation) || toDisplayText(record.ip_location) || toDisplayText(record.ip);
  if (direct) {
    return direct;
  }
  const data = record.data as Record<string, unknown> | undefined;
  const note = data?.note as Record<string, unknown> | undefined;
  return toDisplayText(note?.ipLocation) || toDisplayText(note?.ip_location) || toDisplayText(note?.ip);
}

function toDisplayText(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

function mergeCounts(likedCount?: string, collectedCount?: string) {
  if (likedCount && collectedCount) {
    return `${likedCount} / ${collectedCount}`;
  }
  return likedCount || collectedCount;
}

type ProfileImageValue = string | string[] | Array<{ url?: string; urlDefault?: string; urlPre?: string }> | undefined;

function extractAvatarUrl(value: ProfileImageValue) {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    const first = value.find(Boolean);
    if (typeof first === "string") {
      return first;
    }
    return first?.url || first?.urlDefault || first?.urlPre;
  }
  return undefined;
}

function shortTaskId(taskId: string) {
  return taskId.replace(/^task_/, "#").slice(0, 12);
}

export function errorToMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
