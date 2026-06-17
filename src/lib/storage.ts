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

  cleanupStaleActiveTasks() {
    const cache = this.loadCache();
    let changed = false;

    // 移除卡在 running/queued 的僵尸任务
    const staleCount = cache.tasks.filter(
      (task) => task.status === "running" || task.status === "queued",
    ).length;

    const tasks = cache.tasks
      .filter((task) => task.status !== "running" && task.status !== "queued")
      .map((task) => {
        // 迁移旧数据：已采集完成但被标记为"失败"的任务 → 修正为"已完成"
        if (task.status === "failed" && task.items.length > 0) {
          const allProcessed = task.items.every(
            (item) =>
              item.status === "completed" || item.status === "failed" || item.status === "skipped",
          );
          if (allProcessed) {
            changed = true;
            return { ...task, status: "completed" as const };
          }
        }
        return task;
      });

    if (staleCount > 0 || changed) {
      this.write({ ...cache, tasks });
    }

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
  async saveTask(task: CollectionTask) {
    await super.saveTask(task);
    await this.syncRemote("/api/storage/task", {
      method: "POST",
      body: JSON.stringify(task),
    });
  }

  async updateTaskStatus(taskId: string, status: CollectionTask["status"], message?: string) {
    const task = await super.updateTaskStatus(taskId, status, message);
    const payload = await this.syncRemote<{ task: CollectionTask | null }>(`/api/storage/task/${encodeURIComponent(taskId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, message }),
    });
    return payload?.task ?? task;
  }

  async deleteTask(taskId: string) {
    const localCache = await super.deleteTask(taskId);
    const remoteCache = await this.syncRemote<LocalCache>(`/api/storage/task/${encodeURIComponent(taskId)}`, {
      method: "DELETE",
    });
    if (remoteCache) {
      this.write(remoteCache);
      return remoteCache;
    }
    return localCache;
  }

  async deletePosts(targets: Array<{ taskId: string; feedId: string }>) {
    const localCache = await super.deletePosts(targets);
    const remoteCache = await this.syncRemote<LocalCache>("/api/storage/posts", {
      method: "DELETE",
      body: JSON.stringify({ targets }),
    });
    if (remoteCache) {
      this.write(remoteCache);
      return remoteCache;
    }
    return localCache;
  }

  async savePost(post: StoredPost) {
    await super.savePost(post);
    await this.syncRemote("/api/storage/post", {
      method: "POST",
      body: JSON.stringify(post),
    });
  }

  async saveComments(comments: StoredComment[]) {
    await super.saveComments(comments);
    await this.syncRemote("/api/storage/comments", {
      method: "POST",
      body: JSON.stringify(comments),
    });
  }

  async saveUser(user: StoredUser) {
    await super.saveUser(user);
    await this.syncRemote("/api/storage/user", {
      method: "POST",
      body: JSON.stringify(user),
    });
  }

  async loadRemoteCache() {
    const remoteCache = await this.syncRemote<LocalCache>("/api/storage/cache");
    // 远程 PG 是唯一数据源，始终以远程数据为准同步到本地
    if (remoteCache) {
      this.write(remoteCache);
      return remoteCache;
    }
    return this.loadCache();
  }

  private async syncRemote<T = unknown>(path: string, init: RequestInit = {}) {
    try {
      const response = await fetch(`${STORAGE_API_BASE_URL}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...init.headers,
        },
      });
      if (!response.ok) {
        throw new Error(`Storage API ${response.status}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      console.warn("PostgreSQL storage sync skipped:", error);
      return null;
    }
  }
}

export const persistence = new ServerBackedPersistenceAdapter();
