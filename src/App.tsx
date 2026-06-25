import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FileText,
  Lightbulb,
  ListChecks,
  MessageSquareText,
  RefreshCw,
  Search,
  Settings,
  Target,
  UserRound,
  X,
} from "lucide-react";
import { apiClient } from "./lib/api";
import { retryCollectionItem, runCollectionTask } from "./lib/collector";
import { persistence } from "./lib/storage";
import { taskControl } from "./lib/task-control";
import { CollectPage } from "./pages/collect/CollectPage";
import { CommentDataPage } from "./pages/comments/CommentDataPage";
import { CluePoolPage } from "./pages/clue-pool/CluePoolPage";
import { IncubationPoolPage } from "./pages/incubation/IncubationPoolPage";
import { PostDataPage } from "./pages/posts/PostDataPage";
import { SystemSettingsPage } from "./pages/settings/SystemSettingsPage";
import { TaskQueuePage } from "./pages/tasks/TaskQueuePage";
import { UserPoolPage } from "./pages/user-pool/UserPoolPage";
import {
  ToastCard,
  countUniqueUsers,
  errorToMessage,
  profileToStoredUser,
  type ToastState,
} from "./components/page-shared";
import type {
  CollectionTask,
  CollectOptions,
  SearchFilters,
  StoredComment,
  StoredPost,
  StoredUser,
} from "./types";

type ViewKey = "collect" | "tasks" | "posts" | "comments" | "users" | "clue_pool" | "incubation" | "userpool";
type PendingCollectionRequest = {
  keyword: string;
  channel: string;
  filters: SearchFilters;
  options: CollectOptions;
};

type LoginDialogState = {
  status: "loading" | "waiting" | "success" | "error";
  message: string;
  image?: string;
  request: PendingCollectionRequest;
};

// 默认筛选条件使用小红书搜索页默认值（不触发浏览器点击交互）
const defaultFilters: SearchFilters = {
  location: "不限",
  note_type: "不限",
  publish_time: "不限",
  search_scope: "不限",
  sort_by: "综合",
};

const defaultOptions: CollectOptions = {
  searchLimit: 20,
  includeUserProfiles: true,
  maxDetailConcurrency: 1,
  requestDelayMs: 1500,
  commentConfig: {
    max_comment_items: 10,
    click_more_replies: false,
    max_replies_threshold: 10,
    scroll_speed: "normal",
  },
};

const navItems: Array<{ key: ViewKey; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { key: "collect", label: "采集主题", icon: Search },
  { key: "tasks", label: "任务队列", icon: ListChecks },
  { key: "posts", label: "帖子数据", icon: FileText },
  { key: "comments", label: "评论池", icon: MessageSquareText },
  { key: "userpool", label: "用户池", icon: UserRound },
  { key: "users", label: "系统设置", icon: Settings },
  { key: "clue_pool", label: "线索池", icon: Lightbulb },
  { key: "incubation", label: "建档线索", icon: Target },
];

// 路径到视图的映射
const pathToViewMap: Record<string, ViewKey> = {
  "/": "collect",
  "/job_queue": "tasks",
  "/data-collect": "collect",
  "/tiezi-data": "posts",
  "/comment-data": "comments",
  "/open-users": "users",
  "/systems-data": "users",
  "/user-pool": "userpool",
  "/clue-pool": "clue_pool",
  "/incubation": "incubation",
};

function pathToView(pathname: string): ViewKey {
  return pathToViewMap[pathname] ?? "collect";
}

// 视图到路径的映射，供导航使用
function viewToPath(view: ViewKey): string {
  const map: Record<ViewKey, string> = {
    collect: "/data-collect",
    tasks: "/job_queue",
    posts: "/tiezi-data",
    comments: "/comment-data",
    users: "/systems-data",
    userpool: "/user-pool",
    clue_pool: "/clue-pool",
    incubation: "/incubation",
  };
  return map[view] ?? "/";
}

export function App() {
  const startupCache = useMemo(() => persistence.cleanupStaleActiveTasks(), []);
  const cache = startupCache.cache;
  const location = useLocation();
  const navigate = useNavigate();
  const view = pathToView(location.pathname);
  const [keyword, setKeyword] = useState("");
  const [channel, setChannel] = useState("小红书");
  const [filters, setFilters] = useState<SearchFilters>(defaultFilters);
  const [options, setOptions] = useState<CollectOptions>(defaultOptions);
  const [notice, setNotice] = useState("输入关键词后创建采集任务");
  const [isRunning, setIsRunning] = useState(false);
  const [tasks, setTasks] = useState<CollectionTask[]>(cache.tasks);
  const [posts, setPosts] = useState<StoredPost[]>(cache.posts);
  const [comments, setComments] = useState<StoredComment[]>(cache.comments);
  const [users, setUsers] = useState<StoredUser[]>(cache.users);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);
  const [focusedUserId, setFocusedUserId] = useState<string | null>(null);
  const [loginDialog, setLoginDialog] = useState<LoginDialogState | null>(null);
  const loginFlowIdRef = useRef(0);
  const uniqueUserCount = useMemo(() => countUniqueUsers(posts, comments, users), [posts, comments, users]);
  const [toast, setToast] = useState<ToastState | null>(
    startupCache.removedCount
      ? {
          id: Date.now(),
          status: "success",
          title: "已清理卡住任务",
          message: `已删除 ${startupCache.removedCount} 个中断的任务`,
        }
      : null,
  );

  function showToast(status: ToastState["status"], title: string, message: string) {
    const id = Date.now();
    setToast({ id, status, title, message });
    window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, 2600);
  }

  // 首次加载：尝试从 PG 恢复数据；若 PG 不可达或本地已有数据则信任 localStorage
  useEffect(() => {
    void persistence.loadRemoteCache().then((remoteCache) => {
      setTasks(remoteCache.tasks);
      setPosts(remoteCache.posts);
      setComments(remoteCache.comments);
      setUsers(remoteCache.users);
    }).catch(() => {
      // PG 不可达，使用 localStorage 兜底数据（已在初始化时加载）
    });
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function handleCreateTask() {
    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword) {
      setNotice("请输入关键词");
      showToast("error", "创建失败", "请输入关键词后再创建任务");
      return;
    }

    const request = snapshotCollectionRequest(trimmedKeyword, channel, filters, options);
    void prepareTaskWithLogin(request);
  }

  async function prepareTaskWithLogin(request: PendingCollectionRequest) {
    setIsRunning(true);
    setNotice("正在检查采集账号登录状态");
    showToast("success", "正在检查登录", "确认账号状态后再创建采集任务");

    try {
      const login = await apiClient.checkLoginStatus({
        _timeout: 15000,
        _timeoutMessage: "采集服务登录状态接口 15 秒无响应，请先重启 xiaohongshu-mcp",
      });
      if (login.is_logged_in) {
        startCollectionTask(request);
        return;
      }

      await openLoginQrFlow(request);
    } catch (error) {
      setIsRunning(false);
      setNotice(errorToMessage(error));
      showToast("error", "登录检查失败", errorToMessage(error));
    }
  }

  async function openLoginQrFlow(request: PendingCollectionRequest) {
    const flowId = loginFlowIdRef.current + 1;
    loginFlowIdRef.current = flowId;
    setIsRunning(true);
    setNotice("等待采集账号登录");
    setLoginDialog({
      status: "loading",
      message: "正在获取登录二维码",
      request,
    });

    try {
      const qrCode = await apiClient.getLoginQrCode({
        _timeout: 30000,
        _timeoutMessage: "获取登录二维码超时，请确认采集服务浏览器链路正常",
      });
      if (flowId !== loginFlowIdRef.current) {
        return;
      }
      if (qrCode.is_logged_in) {
        setLoginDialog({
          status: "success",
          message: "登录成功，正在启动采集任务",
          request,
        });
        startCollectionTask(request);
        return;
      }

      const image = normalizeQrImage(qrCode.img || qrCode.qr_code);
      if (!image) {
        throw new Error("二维码接口未返回图片");
      }

      setLoginDialog({
        status: "waiting",
        message: "请扫码完成登录",
        image,
        request,
      });

      const loggedIn = await pollLoginStatus(flowId, parseLoginTimeout(qrCode.timeout));
      if (flowId !== loginFlowIdRef.current) {
        return;
      }
      if (!loggedIn) {
        throw new Error("二维码已超时，请重新获取二维码");
      }

      setLoginDialog({
        status: "success",
        message: "登录成功，正在启动采集任务",
        image,
        request,
      });
      startCollectionTask(request);
    } catch (error) {
      if (flowId !== loginFlowIdRef.current) {
        return;
      }
      setIsRunning(false);
      setNotice("登录未完成");
      setLoginDialog({
        status: "error",
        message: errorToMessage(error),
        request,
      });
      showToast("error", "登录失败", errorToMessage(error));
    }
  }

  async function pollLoginStatus(flowId: number, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    let lastMessage = "";

    while (Date.now() < deadline) {
      await delay(2500);
      if (flowId !== loginFlowIdRef.current) {
        return false;
      }

      try {
        const login = await apiClient.checkLoginStatus({
          _timeout: 10000,
          _timeoutMessage: "登录状态接口暂时无响应",
        });
        if (login.is_logged_in) {
          return true;
        }
        lastMessage = "请扫码完成登录";
      } catch (error) {
        lastMessage = errorToMessage(error);
      }

      setLoginDialog((current) =>
        current && current.status === "waiting" && flowId === loginFlowIdRef.current
          ? { ...current, message: lastMessage }
          : current,
      );
    }

    return false;
  }

  function cancelLoginFlow() {
    loginFlowIdRef.current += 1;
    setLoginDialog(null);
    setIsRunning(false);
    setNotice("输入关键词后创建采集任务");
  }

  function startCollectionTask(request: PendingCollectionRequest) {
    setIsRunning(true);
    setLoginDialog(null);
    navigate("/job_queue");
    setSelectedTaskId(null);
    setSelectedFeedId(null);
    setNotice("任务启动中");
    showToast("success", "创建成功", "已进入任务队列，正在查询主贴数量");

    void runCollectionTask(request.keyword, request.channel, request.filters, request.options, {
      onTaskUpdate: (task) => {
        setTasks((prev) => [task, ...prev.filter((item) => item.id !== task.id)]);
        setNotice(task.message);
      },
      onPostSaved: (post) => {
        setPosts((prev) => [post, ...prev.filter((item) => item.feedId !== post.feedId)]);
      },
      onCommentsSaved: (nextComments) => {
        setComments((prev) => [...nextComments, ...prev].slice(0, 2000));
      },
      onUserSaved: (user) => {
        setUsers((prev) => [user, ...prev.filter((item) => item.userId !== user.userId)]);
      },
    })
      .then((task) => {
        if (task.message === "任务已删除") {
          return;
        }
        if (task.status === "paused") {
          showToast("success", "任务已暂停", task.message);
          return;
        }
        if (task.status === "failed") {
          showToast("error", "采集失败", task.message);
        } else if (task.failed > 0) {
          showToast("success", "采集完成（含部分失败）", task.message);
        } else {
          showToast("success", "采集完成", task.message);
        }
      })
      .catch((error) => {
        showToast("error", "创建失败", errorToMessage(error));
      })
      .finally(() => {
        setIsRunning(false);
      });
  }

  function updateFilter<K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function updateOption(patch: Partial<CollectOptions>) {
    setOptions((current) => ({ ...current, ...patch }));
  }

  function updateCommentConfig(patch: Partial<CollectOptions["commentConfig"]>) {
    setOptions((current) => ({
      ...current,
      commentConfig: {
        ...current.commentConfig,
        ...patch,
      },
    }));
  }

  async function handleDeleteTask(taskId: string) {
    taskControl.delete(taskId);
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setPosts((prev) => prev.filter((p) => p.taskId !== taskId));
    setComments((prev) => prev.filter((c) => c.taskId !== taskId));
    setUsers((prev) => prev.filter((u) => u.taskId !== taskId));
    setSelectedTaskId((curr) => (curr === taskId ? null : curr));
    setSelectedFeedId(null);
    showToast("success", "任务已删除", "PG 同步中...");
    // 后台写 PG，不阻塞 UI
    persistence.deleteTask(taskId).then(() => {
      showToast("success", "任务已删除", "PG 已同步删除");
    }).catch(() => {
      showToast("error", "删除失败", "PG 同步超时，本地已删除");
    });
  }

  async function handleUpdateTaskStatus(taskId: string, status: CollectionTask["status"]) {
    const message = status === "paused" ? "任务已暂停" : "任务已恢复";
    if (status === "paused") taskControl.pause(taskId);
    setTasks((prev) =>
      prev.map((item) =>
        item.id === taskId ? { ...item, status, message: message ?? item.message } : item,
      ),
    );
    showToast("success", status === "paused" ? "已暂停" : "已恢复", "PG 同步中...");
    persistence.updateTaskStatus(taskId, status, message).then(() => {
      showToast("success", status === "paused" ? "已暂停" : "已恢复", message);
    }).catch(() => {
      showToast("error", "操作失败", "PG 同步超时，本地已更新");
    });
  }

  // 重试失败的任务，使用原条件重新采集
  async function handleRetryTask(taskId: string) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      showToast("error", "重试失败", "没有找到这个任务");
      return;
    }

    setIsRunning(true);
    taskControl.begin(taskId);
    navigate("/job_queue");
    setSelectedTaskId(null);
    setSelectedFeedId(null);
    setNotice("任务重试中");
    showToast("success", "重新采集中", `正在用原条件重试：${task.keyword}`);

    void runCollectionTask(task.keyword, task.channel, task.filters, task.options, {
      onTaskUpdate: (nextTask) => {
        setTasks((prev) => [nextTask, ...prev.filter((item) => item.id !== nextTask.id)]);
        setNotice(nextTask.message);
      },
      onPostSaved: (post) => {
        setPosts((prev) => [post, ...prev.filter((item) => item.feedId !== post.feedId)]);
      },
      onCommentsSaved: (nextComments) => {
        setComments((prev) => [...nextComments, ...prev].slice(0, 2000));
      },
      onUserSaved: (user) => {
        setUsers((prev) => [user, ...prev.filter((item) => item.userId !== user.userId)]);
      },
    }, taskId)
      .then((result) => {
        if (result.message === "任务已删除") {
          return;
        }
        if (result.status === "paused") {
          showToast("success", "任务已暂停", result.message);
          return;
        }
        if (result.status === "failed") {
          showToast("error", "重试失败", result.message);
        } else if (result.failed > 0) {
          showToast("success", "重试完成（含部分失败）", result.message);
        } else {
          showToast("success", "重试完成", result.message);
        }
      })
      .catch((error) => {
        showToast("error", "重试失败", errorToMessage(error));
      })
      .finally(() => {
        setIsRunning(false);
      });
  }

  async function handleLoadCommentUser(taskId: string, userId: string, xsecToken: string) {
    const existing = users.find((user) => user.taskId === taskId && user.userId === userId);
    if (existing?.rawPayload) {
      return existing;
    }

    const profile = await apiClient.getUserProfile({
      user_id: userId,
      xsec_token: xsecToken,
    });
    const user = profileToStoredUser(taskId, userId, profile);
    await persistence.saveUser(user);
    setUsers((prev) => [user, ...prev.filter((item) => !(item.taskId === taskId && item.userId === userId))]);
    return user;
  }

  async function handleRetryPost(taskId: string, feedId: string) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      showToast("error", "重采集失败", "没有找到这个任务");
      return;
    }

    showToast("success", "已开始重采集", "正在重新读取这条主贴");
    try {
      taskControl.begin(taskId);
      await retryCollectionItem(task, feedId, {
        onTaskUpdate: (nextTask) => {
          setTasks((prev) => [nextTask, ...prev.filter((item) => item.id !== nextTask.id)]);
          setNotice(nextTask.message);
        },
        onPostSaved: (post) => {
          setPosts((prev) => [post, ...prev.filter((item) => item.feedId !== post.feedId)]);
        },
        onCommentsSaved: (nextComments) => {
          setComments((prev) => [...nextComments, ...prev].slice(0, 2000));
        },
        onUserSaved: (user) => {
          setUsers((prev) => [user, ...prev.filter((item) => item.userId !== user.userId)]);
        },
      });
    } catch (error) {
      showToast("error", "重采集失败", errorToMessage(error));
    }
  }

  async function handleRetryPosts(targets: Array<{ taskId: string; feedId: string }>) {
    if (!targets.length) {
      showToast("error", "批量重采集失败", "当前筛选结果里没有失败帖子");
      return;
    }

    showToast("success", "批量重采集中", `正在重新采集 ${targets.length} 条失败主贴`);
    let successCount = 0;
    let failedCount = 0;

    for (const target of targets) {
      const cacheTask = persistence.loadCache().tasks.find((item) => item.id === target.taskId);
      const task = cacheTask || tasks.find((item) => item.id === target.taskId);
      if (!task) {
        failedCount += 1;
        continue;
      }

      try {
        await retryCollectionItem(task, target.feedId, {
          onTaskUpdate: (nextTask) => {
            setTasks((prev) => [nextTask, ...prev.filter((item) => item.id !== nextTask.id)]);
            setNotice(nextTask.message);
          },
          onPostSaved: (post) => {
            setPosts((prev) => [post, ...prev.filter((item) => item.feedId !== post.feedId)]);
          },
          onCommentsSaved: (nextComments) => {
            setComments((prev) => [...nextComments, ...prev].slice(0, 2000));
          },
          onUserSaved: (user) => {
            setUsers((prev) => [user, ...prev.filter((item) => item.userId !== user.userId)]);
          },
        });
        successCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    showToast(
      failedCount ? "error" : "success",
      "批量重采集完成",
      failedCount ? `成功 ${successCount} 条，失败 ${failedCount} 条` : `成功 ${successCount} 条`,
    );
  }

  async function handleDeletePosts(targets: Array<{ taskId: string; feedId: string }>) {
    if (!targets.length) {
      showToast("error", "删除失败", "请先选择帖子数据");
      return;
    }

    const nextCache = await persistence.deletePosts(targets);
    setTasks(nextCache.tasks);
    setPosts(nextCache.posts);
    setComments(nextCache.comments);
    setUsers(nextCache.users);
    showToast("success", "已删除帖子数据", `已删除 ${targets.length} 条帖子及关联评论缓存`);
  }

  return (
    <div className="app-shell">
      {toast && <ToastCard toast={toast} />}
      {loginDialog && (
        <LoginQrModal
          state={loginDialog}
          onCancel={cancelLoginFlow}
          onRetry={() => void openLoginQrFlow(loginDialog.request)}
        />
      )}
      <aside className="sidebar">
        <nav className="nav" aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`nav-item ${view === item.key ? "active" : ""}`}
                key={item.key}
                type="button"
                onClick={() => navigate(viewToPath(item.key))}
                title={item.label}
              >
                <Icon size={22} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="main">
        <header className="topbar" />

        {view === "collect" && (
          <CollectPage
            keyword={keyword}
            channel={channel}
            filters={filters}
            options={options}
            isRunning={isRunning}
            onKeywordChange={setKeyword}
            onChannelChange={setChannel}
            onCreateTask={handleCreateTask}
            onUpdateFilter={updateFilter}
            onUpdateOption={updateOption}
            onUpdateCommentConfig={updateCommentConfig}
          />
        )}

        {view === "tasks" && (
          <TaskQueuePage
            tasks={tasks}
            posts={posts}
            comments={comments}
            users={users}
            selectedTaskId={selectedTaskId}
            selectedFeedId={selectedFeedId}
            onSelectTask={(taskId) => {
              setSelectedTaskId(taskId);
              setSelectedFeedId(null);
            }}
            onBack={() => {
              setSelectedTaskId(null);
              setSelectedFeedId(null);
            }}
            onSelectFeed={setSelectedFeedId}
            onLoadCommentUser={handleLoadCommentUser}
            onPause={(taskId) => void handleUpdateTaskStatus(taskId, "paused")}
            onResume={(taskId) => void handleRetryTask(taskId)}
            onRetry={(taskId) => void handleRetryTask(taskId)}
            onDelete={(taskId) => void handleDeleteTask(taskId)}
          />
        )}
        {view === "posts" && (
          <PostDataPage
            tasks={tasks}
            posts={posts}
            onRetryPost={handleRetryPost}
            onRetryPosts={handleRetryPosts}
            onDeletePosts={handleDeletePosts}
          />
        )}
        {view === "comments" && <CommentDataPage comments={comments} users={users} />}
        {view === "users" && (
          <SystemSettingsPage
            key="pg-analytics-v6"
            onOpenTask={(taskId) => {
              setSelectedTaskId(taskId);
              setSelectedFeedId(null);
              navigate("/job_queue");
            }}
            onOpenTaskList={() => {
              setSelectedTaskId(null);
              setSelectedFeedId(null);
              navigate("/job_queue");
            }}
            onOpenComments={() => navigate("/comment-data")}
            onOpenUserPool={() => {
              setFocusedUserId(null);
              navigate("/user-pool");
            }}
            onOpenUser={(userId) => {
              setFocusedUserId(userId);
              navigate("/user-pool");
            }}
          />
        )}
        {view === "userpool" && (
          <UserPoolPage
            users={users}
            posts={posts}
            comments={comments}
            focusedUserId={focusedUserId}
          />
        )}
        {view === "clue_pool" && (
          <CluePoolPage
            onOpenUser={(userId) => {
              setFocusedUserId(userId);
              navigate("/user-pool");
            }}
            onNavigateToPost={(feedId) => {
              setSelectedFeedId(feedId);
              navigate("/tiezi-data");
            }}
          />
        )}
        {view === "incubation" && (
          <IncubationPoolPage
            onOpenUser={(userId) => {
              setFocusedUserId(userId);
              navigate("/user-pool");
            }}
            onNavigateToPost={(feedId) => {
              setSelectedFeedId(feedId);
              navigate("/tiezi-data");
            }}
          />
        )}
      </main>
    </div>
  );
}

function LoginQrModal({
  state,
  onCancel,
  onRetry,
}: {
  state: LoginDialogState;
  onCancel: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="log-modal-backdrop" role="dialog" aria-modal="true">
      <section className="login-modal glass">
        <header className="log-modal-head">
          <div>
            <h3>采集账号登录</h3>
            <p>{state.request.keyword}</p>
          </div>
          <div className="log-modal-actions">
            {state.status === "error" && (
              <button type="button" onClick={onRetry}>
                <RefreshCw size={16} />
                重新获取
              </button>
            )}
            <button type="button" onClick={onCancel} title="关闭">
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="login-modal-body">
          {state.image ? (
            <img className="login-qr-image" src={state.image} alt="小红书登录二维码" />
          ) : (
            <div className="login-qr-placeholder">
              {state.status === "loading" ? <RefreshCw className="spin" size={28} /> : <X size={28} />}
            </div>
          )}
          <strong>{state.message}</strong>
          <span>
            {state.status === "waiting"
              ? "登录成功后将自动创建采集任务"
              : state.status === "success"
                ? "正在进入任务队列"
                : "请保持采集服务运行"}
          </span>
        </div>
      </section>
    </div>
  );
}

function snapshotCollectionRequest(
  keyword: string,
  channel: string,
  filters: SearchFilters,
  options: CollectOptions,
): PendingCollectionRequest {
  return {
    keyword,
    channel,
    filters: { ...filters },
    options: {
      ...options,
      commentConfig: { ...options.commentConfig },
    },
  };
}

function normalizeQrImage(image?: string) {
  if (!image) {
    return undefined;
  }
  if (image.startsWith("data:") || image.startsWith("http://") || image.startsWith("https://")) {
    return image;
  }
  return `data:image/png;base64,${image}`;
}

function parseLoginTimeout(timeout?: string) {
  if (!timeout) {
    return 4 * 60 * 1000;
  }

  const text = timeout.trim();
  if (/^\d+$/.test(text)) {
    return Number(text) * 1000;
  }

  const minute = Number(text.match(/(\d+)m/)?.[1] ?? 0);
  const second = Number(text.match(/(\d+)s/)?.[1] ?? 0);
  const parsedMs = (minute * 60 + second) * 1000;
  return parsedMs > 0 ? parsedMs : 4 * 60 * 1000;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
