import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FileText,
  Lightbulb,
  ListChecks,
  MessageSquareText,
  Search,
  Settings,
  UserRound,
} from "lucide-react";
import { apiClient } from "./lib/api";
import { retryCollectionItem, runCollectionTask } from "./lib/collector";
import { persistence } from "./lib/storage";
import { CollectPage } from "./pages/collect/CollectPage";
import { CommentDataPage } from "./pages/comments/CommentDataPage";
import { CluePoolPage } from "./pages/clue-pool/CluePoolPage";
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

type ViewKey = "collect" | "tasks" | "posts" | "comments" | "users" | "clue_pool" | "userpool";

const defaultFilters: SearchFilters = {
  location: "同城",
  note_type: "不限",
  publish_time: "一周内",
  search_scope: "不限",
  sort_by: "最新",
};

const defaultOptions: CollectOptions = {
  searchLimit: undefined,
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

  useEffect(() => {
    void persistence.loadRemoteCache().then((remoteCache) => {
      setTasks(remoteCache.tasks);
      setPosts(remoteCache.posts);
      setComments(remoteCache.comments);
      setUsers(remoteCache.users);
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

    setIsRunning(true);
    navigate("/job_queue");
    setSelectedTaskId(null);
    setSelectedFeedId(null);
    setNotice("任务启动中");
    showToast("success", "创建成功", "已进入任务队列，正在查询主贴数量");

    void runCollectionTask(trimmedKeyword, channel, filters, options, {
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
    const nextCache = await persistence.deleteTask(taskId);
    setTasks(nextCache.tasks);
    setPosts(nextCache.posts);
    setComments(nextCache.comments);
    setUsers(nextCache.users);
    setSelectedTaskId((current) => (current === taskId ? null : current));
    setSelectedFeedId(null);
    showToast("success", "任务已删除", "已同步删除该任务的本地采集数据");
  }

  async function handleUpdateTaskStatus(taskId: string, status: CollectionTask["status"]) {
    const message = status === "paused" ? "任务已暂停" : "任务已恢复";
    const task = await persistence.updateTaskStatus(taskId, status, message);
    if (!task) {
      showToast("error", "操作失败", "没有找到这个任务");
      return;
    }
    setTasks((prev) => prev.map((item) => (item.id === taskId ? task : item)));
    showToast("success", status === "paused" ? "已暂停" : "已恢复", message);
  }

  // 重试失败的任务，使用原条件重新采集
  async function handleRetryTask(taskId: string) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      showToast("error", "重试失败", "没有找到这个任务");
      return;
    }

    setIsRunning(true);
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
            onResume={(taskId) => void handleUpdateTaskStatus(taskId, "running")}
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
        {view === "users" && <SystemSettingsPage users={users} posts={posts} comments={comments} tasks={tasks} />}
        {view === "userpool" && <UserPoolPage users={users} posts={posts} comments={comments} />}
        {view === "clue_pool" && <CluePoolPage />}
      </main>
    </div>
  );
}
