import type { CollectionTask, StoredComment, StoredPost, StoredUser } from "../types";

const STORAGE_KEY = "xhs-insight-local-cache-v1";
const STORAGE_API_BASE_URL = import.meta.env.VITE_STORAGE_API_BASE_URL || "http://127.0.0.1:5174";

export interface LocalCache {
  tasks: CollectionTask[];
  posts: StoredPost[];
  comments: StoredComment[];
  users: StoredUser[];
}

export interface PersistenceAdapter {
  saveTask(task: CollectionTask): Promise<void>;
  updateTaskStatus(taskId: string, status: CollectionTask["status"], message?: string): Promise<CollectionTask | null>;
  deleteTask(taskId: string): Promise<LocalCache>;
  deletePosts(targets: Array<{ taskId: string; feedId: string }>): Promise<LocalCache>;
  savePost(post: StoredPost): Promise<void>;
  saveComments(comments: StoredComment[]): Promise<void>;
  saveUser(user: StoredUser): Promise<void>;
  loadCache(): LocalCache;
  loadRemoteCache(): Promise<LocalCache>;
  cleanupStaleActiveTasks(): { cache: LocalCache; removedCount: number };
  clear(): Promise<void>;
}

export class LocalPersistenceAdapter implements PersistenceAdapter {
  async saveTask(task: CollectionTask) {
    const cache = this.loadCache();
    const nextTasks = [task, ...cache.tasks.filter((item) => item.id !== task.id)].slice(0, 50);
    this.write({ ...cache, tasks: nextTasks });
  }

  async updateTaskStatus(
    taskId: string,
    status: CollectionTask["status"],
    message?: string,
  ): Promise<CollectionTask | null> {
    const cache = this.loadCache();
    let updatedTask: CollectionTask | null = null;
    const tasks = cache.tasks.map((task) => {
      if (task.id !== taskId) {
        return task;
      }

      updatedTask = {
        ...task,
        status,
        message: message ?? task.message,
      };
      return updatedTask;
    });

    this.write({ ...cache, tasks });
    return updatedTask;
  }

  async deleteTask(taskId: string) {
    const cache = this.loadCache();
    const nextCache = {
      tasks: cache.tasks.filter((task) => task.id !== taskId),
      posts: cache.posts.filter((post) => post.taskId !== taskId),
      comments: cache.comments.filter((comment) => comment.taskId !== taskId),
      users: cache.users.filter((user) => user.taskId !== taskId),
    };

    this.write(nextCache);
    return nextCache;
  }

  async deletePosts(targets: Array<{ taskId: string; feedId: string }>) {
    const cache = this.loadCache();
    const keys = new Set(targets.map((target) => `${target.taskId}:${target.feedId}`));
    const tasks = cache.tasks.map((task) => {
      const removedItems = task.items.filter((item) => keys.has(`${task.id}:${item.feedId}`));
      if (!removedItems.length) {
        return task;
      }

      const completedRemoved = removedItems.filter((item) => item.status === "completed").length;
      const failedRemoved = removedItems.filter((item) => item.status === "failed").length;
      return {
        ...task,
        total: Math.max(0, task.total - removedItems.length),
        completed: Math.max(0, task.completed - completedRemoved),
        failed: Math.max(0, task.failed - failedRemoved),
        items: task.items.filter((item) => !keys.has(`${task.id}:${item.feedId}`)),
        logs: [
          {
            id: `log_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            time: new Date().toISOString(),
            type: "task" as const,
            title: "删除帖子数据",
            message: `删除 ${removedItems.length} 条帖子数据`,
            payload: removedItems.map((item) => ({ feedId: item.feedId, title: item.title })),
          },
          ...(task.logs ?? []),
        ].slice(0, 500),
      };
    });
    const nextCache = {
      tasks,
      posts: cache.posts.filter((post) => !keys.has(`${post.taskId}:${post.feedId}`)),
      comments: cache.comments.filter((comment) => !keys.has(`${comment.taskId}:${comment.feedId}`)),
      users: cache.users,
    };

    this.write(nextCache);
    return nextCache;
  }

  async savePost(post: StoredPost) {
    const cache = this.loadCache();
    const posts = [post, ...cache.posts.filter((item) => item.feedId !== post.feedId)].slice(0, 500);
    this.write({ ...cache, posts });
  }

  async saveComments(comments: StoredComment[]) {
    const cache = this.loadCache();
    const existingKeys = new Set(comments.map((item) => `${item.commentId}:${item.parentCommentId ?? ""}`));
    const kept = cache.comments.filter(
      (item) => !existingKeys.has(`${item.commentId}:${item.parentCommentId ?? ""}`),
    );
    this.write({ ...cache, comments: [...comments, ...kept].slice(0, 2000) });
  }

  async saveUser(user: StoredUser) {
    const cache = this.loadCache();
    const users = [user, ...cache.users.filter((item) => item.userId !== user.userId)].slice(0, 1000);
    this.write({ ...cache, users });
  }

  loadCache(): LocalCache {
    const fallback: LocalCache = {
      tasks: [],
      posts: [],
      comments: [],
      users: [],
    };

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
    } catch {
      return fallback;
    }
  }

  async loadRemoteCache() {
    return this.loadCache();
  }

  // 仅移除启动时可能遗留的"正在运行"状态任务（app 异常关闭的场景）
  cleanupStaleActiveTasks() {
    const cache = this.loadCache();
    const staleCount = cache.tasks.filter(
      (task) => task.status === "running",
    ).length;
    if (staleCount === 0) {
      return { cache, removedCount: 0 };
    }
    const tasks = cache.tasks.map((task) =>
      task.status === "running"
        ? { ...task, status: "queued" as const, message: "上次运行中离开，已重置为排队" }
        : task,
    );
    this.write({ ...cache, tasks });
    return { cache: { ...cache, tasks }, removedCount: staleCount };
  }

  async clear() {
    window.localStorage.removeItem(STORAGE_KEY);
  }

  protected write(cache: LocalCache) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  }
}

class ServerBackedPersistenceAdapter extends LocalPersistenceAdapter {
  // PG 为主数据源，localStorage 为镜像缓存
  // 写操作：PG 写入 → localStorage 镜像 → 返回 PG 确认后的数据
  // 读操作：PG 加载 → localStorage 镜像 → 返回 PG 数据
  // PG 不可达时降级到 localStorage（离线兜底）

  // 页面加载：localStorage 为准；PG 数据仅作为冷启动种子
  async loadRemoteCache() {
    const localCache = this.loadCache();
    // localStorage 有数据时信任本地（避免 PG 旧数据覆盖本地操作）
    if (localCache.tasks.length > 0 || localCache.posts.length > 0) {
      return localCache;
    }
    // 本地为空（首次访问），从 PG 拉取
    const remoteCache = await this.syncRemote<LocalCache>("/api/storage/cache");
    if (remoteCache) {
      this.write(remoteCache);
      return remoteCache;
    }
    return localCache;
  }

  // ========== 写操作：PG 先写，成功后镜像到 localStorage ==========

  async saveTask(task: CollectionTask) {
    const ok = await this.syncRemote("/api/storage/task", {
      method: "POST",
      body: JSON.stringify(task),
    });
    if (ok) {
      await super.saveTask(task); // PG 写入成功后镜像到 localStorage
    } else {
      await super.saveTask(task); // PG 不可达时降级到本地
    }
  }

  async updateTaskStatus(taskId: string, status: CollectionTask["status"], message?: string) {
    const payload = await this.syncRemote<{ task: CollectionTask | null }>(
      `/api/storage/task/${encodeURIComponent(taskId)}/status`,
      { method: "PATCH", body: JSON.stringify({ status, message }) },
    );
    if (payload?.task) {
      // PG 返回最新任务数据，镜像到 localStorage
      await super.saveTask(payload.task);
      return payload.task;
    }
    // PG 不可达，降级到本地
    return super.updateTaskStatus(taskId, status, message);
  }

  async deleteTask(taskId: string) {
    // PG DELETE 返回完整的 cache（已在 PG 中删除）
    const remoteCache = await this.syncRemote<LocalCache>(
      `/api/storage/task/${encodeURIComponent(taskId)}`,
      { method: "DELETE" },
    );
    if (remoteCache) {
      // PG 删除成功，全量镜像到 localStorage
      this.write(remoteCache);
      return remoteCache;
    }
    // PG 不可达，降级到本地删除
    return super.deleteTask(taskId);
  }

  async deletePosts(targets: Array<{ taskId: string; feedId: string }>) {
    const remoteCache = await this.syncRemote<LocalCache>(
      "/api/storage/posts",
      { method: "DELETE", body: JSON.stringify({ targets }) },
    );
    if (remoteCache) {
      this.write(remoteCache);
      return remoteCache;
    }
    return super.deletePosts(targets);
  }

  async savePost(post: StoredPost) {
    const ok = await this.syncRemote("/api/storage/post", {
      method: "POST",
      body: JSON.stringify(post),
    });
    if (ok) {
      await super.savePost(post);
    } else {
      await super.savePost(post);
    }
  }

  async saveComments(comments: StoredComment[]) {
    const ok = await this.syncRemote("/api/storage/comments", {
      method: "POST",
      body: JSON.stringify(comments),
    });
    if (ok) {
      await super.saveComments(comments);
    } else {
      await super.saveComments(comments);
    }
  }

  async saveUser(user: StoredUser) {
    const ok = await this.syncRemote("/api/storage/user", {
      method: "POST",
      body: JSON.stringify(user),
    });
    if (ok) {
      await super.saveUser(user);
    } else {
      await super.saveUser(user);
    }
  }

  // ========== 工具方法 ==========

  private async syncRemote<T = unknown>(path: string, init: RequestInit = {}, timeoutMs = 5000): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${STORAGE_API_BASE_URL}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { "Content-Type": "application/json", ...init.headers },
      });
      clearTimeout(timer);
      if (!response.ok) {
        throw new Error(`Storage API ${response.status}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      clearTimeout(timer);
      if ((error as Error).name === "AbortError") {
        console.warn(`PG 请求超时 (${timeoutMs}ms): ${init.method || "GET"} ${path}`);
      } else {
        console.warn("PG 请求失败，降级到 localStorage:", error);
      }
      return null;
    }
  }
}

export const persistence = new ServerBackedPersistenceAdapter();
