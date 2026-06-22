import { apiClient } from "./api";
import { persistence } from "./storage";
import { TaskControlError, taskControl } from "./task-control";
import type {
  CollectionTask,
  CollectOptions,
  FeedComment,
  FeedDetailData,
  QueueItem,
  SearchFilters,
  SearchRequest,
  StoredComment,
  StoredPost,
  StoredUser,
  UserProfileData,
} from "../types";

interface CollectorCallbacks {
  onTaskUpdate: (task: CollectionTask) => void;
  onPostSaved: (post: StoredPost) => void;
  onCommentsSaved: (comments: StoredComment[]) => void;
  onUserSaved: (user: StoredUser) => void;
}

const FEED_DETAIL_MAX_ATTEMPTS = 3;
const FEED_DETAIL_RETRY_DELAY_MS = 2000;

export async function runCollectionTask(
  keyword: string,
  channel: string,
  filters: SearchFilters,
  options: CollectOptions,
  callbacks: CollectorCallbacks,
  existingTaskId?: string,
) {
  // 如果传入已有任务id则复用，否则创建新任务
  let task: CollectionTask;
  if (existingTaskId) {
    const now = new Date().toISOString();
    task = {
      id: existingTaskId,
      keyword,
      channel,
      filters,
      options,
      status: "running",
      createdAt: now,
      total: 0,
      completed: 0,
      failed: 0,
      message: "任务重试中",
      items: [],
      errors: [],
      startedAt: now,
      logs: [{
        id: `log_${Date.now()}`,
        time: now,
        type: "task",
        title: "任务重试",
        message: "使用原条件重新采集",
      }],
    };
  } else {
    task = createTask(keyword, channel, filters, options);
  }
  const taskSignal = taskControl.begin(task.id);
  callbacks.onTaskUpdate(task);
  await persistence.saveTask(task);

  try {
    taskControl.assertActive(task.id, taskSignal);
    task = patchTask(task, {
      status: "running",
      startedAt: new Date().toISOString(),
      message: "准备采集环境",
    });
    task = addLog(task, "task", "任务启动", "准备采集环境");
    callbacks.onTaskUpdate(task);

    const login = await apiClient.checkLoginStatus({
      signal: taskSignal,
      _timeout: 15000,
      _timeoutMessage:
        "采集服务浏览器链路 15 秒无响应，请重启 xiaohongshu-mcp；如需看到浏览器窗口，请用 -headless=false 启动采集服务",
    });
    taskControl.assertActive(task.id, taskSignal);
    if (!login.is_logged_in) {
      throw new Error("当前采集账号未登录，请先在采集服务中完成登录后重试");
    }

    task = patchTask(task, { message: "正在查询主贴数量" });
    // 去掉默认筛选条件，避免 MCP 浏览器点击交互失败
    const cleanFilters: Record<string, string> = {};
    if (filters.sort_by !== "综合") cleanFilters.sort_by = filters.sort_by;
    if (filters.location !== "不限") cleanFilters.location = filters.location;
    if (filters.publish_time !== "不限") cleanFilters.publish_time = filters.publish_time;
    if (filters.note_type !== "不限") cleanFilters.note_type = filters.note_type;
    if (filters.search_scope !== "不限") cleanFilters.search_scope = filters.search_scope;
    const searchRequest: Record<string, unknown> = {
      keyword,
      ...(Object.keys(cleanFilters).length > 0 ? { filters: cleanFilters } : {}),
      ...(options.searchLimit ? { limit: options.searchLimit } : {}),
    };
    task = addLog(task, "search", "搜索请求", "POST /api/v1/analysis/search", searchRequest);
    callbacks.onTaskUpdate(task);

    const search = await apiClient.searchFeeds(searchRequest as unknown as SearchRequest, { signal: taskSignal });
    taskControl.assertActive(task.id, taskSignal);
    // 通过 noteCard 和 id/xsecToken 判断有效帖子，不依赖 modelType（可能随时间变化）
    const items = search.feeds
      .filter((item) => {
        const noteCard = item.noteCard as Record<string, unknown> | undefined;
        const hasNoteCard = noteCard && (noteCard.displayTitle || noteCard.title || noteCard.desc);
        const id = item.id;
        const xsecToken = item.xsecToken || item.xsec_token;
        return hasNoteCard && id && xsecToken;
      })
      .map<QueueItem>((item) => ({
        feedId: item.id ?? "",
        xsecToken: item.xsecToken || item.xsec_token || "",
        title: item.noteCard?.displayTitle || "未命名帖子",
        authorName: item.noteCard?.user?.nickname || item.noteCard?.user?.nickName || "未知作者",
        authorId: item.noteCard?.user?.userId,
        status: "queued",
        searchItem: item,
      }));

    task = patchTask(task, {
      rawSearch: search,
      items,
      total: items.length,
      message: items.length ? `本次查询到 ${items.length} 条主贴，准备开始采集` : "本次查询没有获取到主贴",
    });
    task = addLog(task, "search", "搜索返回", `本次查询到 ${items.length} 条主贴`, {
      count: search.count,
      note_count: items.length,
      feeds: search.feeds,
    });
    callbacks.onTaskUpdate(task);

    if (items.length === 0) {
      task = patchTask(task, {
        status: "completed",
        finishedAt: new Date().toISOString(),
      });
      callbacks.onTaskUpdate(task);
      await persistence.saveTask(task);
      return task;
    }

    // 逐条采集，并在每次循环前检查是否被暂停
    for (const item of items) {
      taskControl.assertActive(task.id, taskSignal);
      // 检查任务是否被用户暂停
      const currentCache = persistence.loadCache();
      const currentTask = currentCache.tasks.find((t) => t.id === task.id);
      if (currentTask?.status === "paused") {
        // 将剩余未处理条目标记为 queued，任务标记为 paused 退出
        for (const remaining of items.slice(items.indexOf(item))) {
          task = updateItem(task, remaining.feedId, { status: "queued" });
        }
        task = patchTask(task, {
          status: "paused",
          message: `任务已暂停，剩余 ${items.length - items.indexOf(item)} 条待处理`,
        });
        task = addLog(task, "task", "任务暂停", `用户暂停，剩余 ${items.length - items.indexOf(item)} 条未处理`);
        callbacks.onTaskUpdate(task);
        await persistence.saveTask(task);
        return task;
      }

      task = await processItem(task, item.feedId, options, callbacks, taskSignal);
      taskControl.assertActive(task.id, taskSignal);
      if (options.requestDelayMs > 0) {
        await sleep(options.requestDelayMs, taskSignal, task.id);
      }
    }

    // 多批次任务：部分条目失败不影响整体状态，任务始终标记为已完成
    task = patchTask(task, {
      status: "completed",
      finishedAt: new Date().toISOString(),
      message: task.failed > 0 ? `完成 ${task.completed} 条，失败 ${task.failed} 条` : "采集完成",
    });
    task = addLog(
      task,
      task.failed > 0 ? "error" : "task",
      "任务结束",
      task.failed > 0 ? `完成 ${task.completed} 条，失败 ${task.failed} 条` : "采集完成",
    );
    callbacks.onTaskUpdate(task);
    await persistence.saveTask(task);
    taskControl.complete(task.id);
    return task;
  } catch (error) {
    if (error instanceof TaskControlError) {
      if (error.action === "deleted") {
        taskControl.complete(task.id);
        return patchTask(task, { status: "paused", message: "任务已删除" });
      }

      task = patchTask(task, {
        status: "paused",
        message: "任务已暂停",
      });
      task = addLog(task, "task", "任务暂停", "用户暂停任务，已停止当前采集流程");
      callbacks.onTaskUpdate(task);
      await persistence.saveTask(task);
      return task;
    }

    task = patchTask(task, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      message: errorToMessage(error),
      errors: [...task.errors, errorToMessage(error)],
    });
    task = addLog(task, "error", "任务失败", errorToMessage(error));
    callbacks.onTaskUpdate(task);
    await persistence.saveTask(task);
    taskControl.complete(task.id);
    return task;
  }
}

export async function retryCollectionItem(task: CollectionTask, feedId: string, callbacks: CollectorCallbacks) {
  const currentItem = task.items.find((item) => item.feedId === feedId);
  if (!currentItem) {
    throw new Error("没有找到这条主贴");
  }

  let nextTask = task;
  if (currentItem.status === "failed") {
    nextTask = patchTask(nextTask, { failed: Math.max(0, nextTask.failed - 1) });
  }
  if (currentItem.status === "completed") {
    nextTask = patchTask(nextTask, { completed: Math.max(0, nextTask.completed - 1) });
  }

  nextTask = updateItem(nextTask, feedId, { status: "queued", error: undefined });
  nextTask = addLog(nextTask, "task", "重新采集", `重新采集主贴：${currentItem.title || feedId}`, {
    feedId,
    title: currentItem.title,
    xsecToken: currentItem.xsecToken,
  });
  callbacks.onTaskUpdate(nextTask);
  await persistence.saveTask(nextTask);

  taskControl.begin(nextTask.id);
  const retrySignal = taskControl.signal(nextTask.id);
  const result = await processItem(nextTask, feedId, nextTask.options, callbacks, retrySignal);

  // 重采集完成后，若所有条目均已处理完毕则标记为已完成
  const allDone = result.items.every(
    (item) => item.status === "completed" || item.status === "failed" || item.status === "skipped",
  );
  if (allDone) {
    const finalTask = patchTask(result, { status: "completed" });
    callbacks.onTaskUpdate(finalTask);
    await persistence.saveTask(finalTask);
    taskControl.complete(finalTask.id);
    return finalTask;
  }

  taskControl.complete(result.id);
  return result;
}

function createTask(keyword: string, channel: string, filters: SearchFilters, options: CollectOptions): CollectionTask {
  const now = new Date().toISOString();
  return {
    id: `task_${Date.now()}`,
    keyword,
    channel,
    filters,
    options,
    status: "queued",
    createdAt: now,
    total: 0,
    completed: 0,
    failed: 0,
    message: "任务已创建",
    items: [],
    errors: [],
    logs: [
      {
        id: `log_${Date.now()}`,
        time: now,
        type: "task",
        title: "任务已创建",
        message: "等待查询主贴数量",
      },
    ],
  };
}

async function processItem(
  task: CollectionTask,
  feedId: string,
  options: CollectOptions,
  callbacks: CollectorCallbacks,
  signal?: AbortSignal,
) {
  taskControl.assertActive(task.id, signal);
  let nextTask = updateItem(task, feedId, { status: "fetching" });
  const currentIndex = nextTask.completed + nextTask.failed + 1;
  nextTask = patchTask(nextTask, {
    message: `本次查询到 ${nextTask.total} 条主贴，正在采集第 ${currentIndex} 条`,
  });
  nextTask = addLog(nextTask, "post", "开始读取主贴", `第 ${currentIndex} 条主贴：${queueItemTitle(nextTask, feedId)}`);
  callbacks.onTaskUpdate(nextTask);

  const queueItem = nextTask.items.find((item) => item.feedId === feedId);
  if (!queueItem) {
    return nextTask;
  }

  try {
    taskControl.assertActive(nextTask.id, signal);
    const detailRequest = {
      feed_id: queueItem.feedId,
      xsec_token: queueItem.xsecToken,
      load_all_comments: options.commentConfig.max_comment_items > 10,
      comment_config: options.commentConfig,
    };
    nextTask = addLog(nextTask, "post", "主贴详情请求", `第 ${currentIndex} 条主贴详情请求`, detailRequest);
    callbacks.onTaskUpdate(nextTask);

    const retryResult = await requestFeedDetailWithRetry(
      nextTask,
      detailRequest,
      currentIndex,
      queueItem,
      callbacks,
      signal,
    );
    nextTask = retryResult.task;
    const detail = retryResult.detail;
    taskControl.assertActive(nextTask.id, signal);

    const post = toStoredPost(nextTask.id, detail, queueItem);
    const comments = toStoredComments(nextTask.id, detail);

    await persistence.savePost(post);
    callbacks.onPostSaved(post);

    nextTask = addLog(nextTask, "post", "主贴详情返回", `第 ${currentIndex} 条主贴读取完成：${post.title}`, detail);

    if (comments.length) {
      for (const commentIndex of getProgressCheckpoints(comments.length)) {
        nextTask = patchTask(nextTask, {
          message: `本次查询到 ${nextTask.total} 条主贴，正在整理第 ${currentIndex} 条主贴的第 ${commentIndex} 个评论 / 共 ${comments.length} 个评论`,
        });
        callbacks.onTaskUpdate(nextTask);
        await sleep(0, signal, nextTask.id);
        taskControl.assertActive(nextTask.id, signal);
      }
      nextTask = addLog(
        nextTask,
        "comment",
        "评论读取结果",
        `第 ${currentIndex} 条主贴获取到 ${comments.length} 个评论`,
        comments.slice(0, 20),
      );
    }

    await persistence.saveComments(comments);
    callbacks.onCommentsSaved(comments);

    if (options.includeUserProfiles) {
      const users = collectUserProfileTargets(detail, queueItem).slice(0, 12);
      for (const [index, target] of users.entries()) {
        taskControl.assertActive(nextTask.id, signal);
        nextTask = patchTask(nextTask, {
          message: `本次查询到 ${nextTask.total} 条主贴，正在读取第 ${currentIndex} 条主贴的第 ${
            index + 1
          } 个用户 / 共 ${users.length} 个用户`,
        });
        callbacks.onTaskUpdate(nextTask);

        try {
          const profileRequest = {
            user_id: target.userId,
            xsec_token: target.xsecToken,
          };
          nextTask = addLog(nextTask, "user", "用户资料请求", `第 ${index + 1} 个用户资料请求：${target.userId}`, profileRequest);
          callbacks.onTaskUpdate(nextTask);

          const profile = await apiClient.getUserProfile(
            {
              user_id: target.userId,
              xsec_token: target.xsecToken,
            },
            { signal },
          );
          taskControl.assertActive(nextTask.id, signal);
          const user = toStoredUser(nextTask.id, target.userId, profile);
          await persistence.saveUser(user);
          callbacks.onUserSaved(user);
          nextTask = addLog(nextTask, "user", "用户资料返回", `第 ${index + 1} 个用户读取完成：${user.nickname || target.userId}`, profile);
        } catch (error) {
          nextTask = addLog(nextTask, "error", "用户资料失败", `${target.userId}: ${errorToMessage(error)}`);
        }
      }
    }

    nextTask = updateItem(nextTask, feedId, {
      status: "completed",
      detail,
    });
    nextTask = patchTask(nextTask, {
      completed: nextTask.completed + 1,
      message:
        nextTask.completed + nextTask.failed + 1 >= nextTask.total
          ? `本次查询到 ${nextTask.total} 条主贴，正在整理结果`
          : `本次查询到 ${nextTask.total} 条主贴，正在采集第 ${
              nextTask.completed + nextTask.failed + 2
            } 条`,
    });
  } catch (error) {
    if (error instanceof TaskControlError) {
      throw error;
    }

    const message = errorToMessage(error);
    nextTask = updateItem(nextTask, feedId, {
      status: "failed",
      error: message,
    });
    nextTask = patchTask(nextTask, {
      failed: nextTask.failed + 1,
      errors: [...nextTask.errors, `${feedId}: ${message}`],
      message,
    });
    nextTask = addLog(nextTask, "error", "主贴读取失败", `${feedId}: ${message}`);
  }

  callbacks.onTaskUpdate(nextTask);
  await persistence.saveTask(nextTask);
  return nextTask;
}

function patchTask(task: CollectionTask, patch: Partial<CollectionTask>) {
  return { ...task, ...patch };
}

function addLog(task: CollectionTask, type: CollectionTask["logs"][number]["type"], title: string, message: string, payload?: unknown) {
  return {
    ...task,
    logs: [
      {
        id: `log_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        time: new Date().toISOString(),
        type,
        title,
        message,
        payload,
      },
      ...(task.logs ?? []),
    ].slice(0, 500),
  };
}

function queueItemTitle(task: CollectionTask, feedId: string) {
  return task.items.find((item) => item.feedId === feedId)?.title || feedId;
}

function updateItem(task: CollectionTask, feedId: string, patch: Partial<QueueItem>) {
  return {
    ...task,
    items: task.items.map((item) => (item.feedId === feedId ? { ...item, ...patch } : item)),
  };
}

async function requestFeedDetailWithRetry(
  task: CollectionTask,
  detailRequest: {
    feed_id: string;
    xsec_token: string;
    load_all_comments: boolean;
    comment_config: CollectOptions["commentConfig"];
  },
  currentIndex: number,
  queueItem: QueueItem,
  callbacks: CollectorCallbacks,
  signal?: AbortSignal,
) {
  let nextTask = task;
  let lastError: unknown;

  for (let attempt = 1; attempt <= FEED_DETAIL_MAX_ATTEMPTS; attempt += 1) {
    taskControl.assertActive(nextTask.id, signal);
    if (attempt > 1) {
      nextTask = patchTask(nextTask, {
        message: `第 ${currentIndex} 条主贴读取失败，正在第 ${attempt} 次重试`,
      });
      nextTask = addLog(
        nextTask,
        "post",
        "主贴详情重试",
        `第 ${currentIndex} 条主贴第 ${attempt} 次重试：${queueItem.title || queueItem.feedId}`,
        {
          attempt,
          maxAttempts: FEED_DETAIL_MAX_ATTEMPTS,
          retryDelayMs: FEED_DETAIL_RETRY_DELAY_MS,
          feedId: queueItem.feedId,
        },
      );
      callbacks.onTaskUpdate(nextTask);
      await persistence.saveTask(nextTask);
    }

    try {
      const detail = await apiClient.getFeedDetail(detailRequest, { signal });
      taskControl.assertActive(nextTask.id, signal);
      if (attempt > 1) {
        nextTask = addLog(
          nextTask,
          "post",
          "主贴详情重试成功",
          `第 ${currentIndex} 条主贴第 ${attempt} 次重试成功：${queueItem.title || queueItem.feedId}`,
          { attempt, feedId: queueItem.feedId },
        );
        callbacks.onTaskUpdate(nextTask);
        await persistence.saveTask(nextTask);
      }
      return { task: nextTask, detail };
    } catch (error) {
      try {
        taskControl.assertActive(nextTask.id, signal);
      } catch (controlError) {
        throw controlError;
      }

      lastError = error;
      if (attempt >= FEED_DETAIL_MAX_ATTEMPTS) {
        break;
      }

      const message = errorToMessage(error);
      taskControl.assertActive(nextTask.id, signal);
      nextTask = patchTask(nextTask, {
        message: `第 ${currentIndex} 条主贴读取失败，2 秒后自动重试第 ${attempt + 1} 次`,
      });
      nextTask = addLog(
        nextTask,
        "error",
        "主贴详情请求失败",
        `第 ${currentIndex} 条主贴第 ${attempt} 次失败，2 秒后自动重试：${message}`,
        {
          attempt,
          nextAttempt: attempt + 1,
          maxAttempts: FEED_DETAIL_MAX_ATTEMPTS,
          retryDelayMs: FEED_DETAIL_RETRY_DELAY_MS,
          feedId: queueItem.feedId,
          error: message,
        },
      );
      callbacks.onTaskUpdate(nextTask);
      await persistence.saveTask(nextTask);
      await sleep(FEED_DETAIL_RETRY_DELAY_MS, signal, nextTask.id);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(errorToMessage(lastError));
}

function toStoredPost(taskId: string, detail: FeedDetailData, queueItem: QueueItem): StoredPost {
  const note = detail.data?.note;
  return {
    taskId,
    feedId: detail.feed_id || queueItem.feedId,
    title: note?.title || queueItem.title,
    desc: note?.desc,
    authorId: note?.user?.userId || queueItem.authorId,
    authorName: note?.user?.nickname || queueItem.authorName,
    authorAvatar: note?.user?.avatar || queueItem.searchItem.noteCard?.user?.avatar,
    likedCount: note?.interactInfo?.likedCount || queueItem.searchItem.noteCard?.interactInfo?.likedCount,
    sharedCount: note?.interactInfo?.sharedCount || queueItem.searchItem.noteCard?.interactInfo?.sharedCount,
    commentCount: note?.interactInfo?.commentCount || queueItem.searchItem.noteCard?.interactInfo?.commentCount,
    collectedCount: note?.interactInfo?.collectedCount || queueItem.searchItem.noteCard?.interactInfo?.collectedCount,
    ipLocation: normalizeIpLocation(note) || normalizeIpLocation(detail.data) || normalizeIpLocation(detail),
    publishTime: note?.time,
    rawPayload: detail,
  };
}

function toStoredComments(taskId: string, detail: FeedDetailData): StoredComment[] {
  const feedId = detail.feed_id;
  const list = detail.data?.comments?.list ?? [];

  return list.flatMap((comment) => {
    const topLevel = toStoredComment(taskId, feedId, comment);
    const subComments = (comment.subComments ?? [])
      .filter((item) => item.id)
      .map<StoredComment>((item) => ({
        taskId,
        feedId,
        commentId: item.id ?? "",
        parentCommentId: comment.id,
        content: item.content,
        userId: item.userInfo?.userId,
        xsecToken: item.userInfo?.xsecToken || item.userInfo?.xsec_token,
        nickname: item.userInfo?.nickname,
        avatar: item.userInfo?.avatar,
        ipLocation: item.ipLocation,
        createTime: item.createTime,
        rawPayload: item,
      }));

    return topLevel ? [topLevel, ...subComments] : subComments;
  });
}

function toStoredComment(taskId: string, feedId: string, comment: FeedComment): StoredComment | null {
  if (!comment.id) {
    return null;
  }

  return {
    taskId,
    feedId,
    commentId: comment.id,
    content: comment.content,
    userId: comment.userInfo?.userId,
    xsecToken: comment.userInfo?.xsecToken || comment.userInfo?.xsec_token,
    nickname: comment.userInfo?.nickname,
    avatar: comment.userInfo?.avatar,
    likeCount: comment.likeCount,
    ipLocation: comment.ipLocation,
    createTime: comment.createTime,
    rawPayload: comment,
  };
}

function collectUserProfileTargets(detail: FeedDetailData, queueItem: QueueItem) {
  const targets = new Map<string, string>();
  const authorId = detail.data?.note?.user?.userId;
  if (authorId) {
    targets.set(authorId, detail.data?.note?.user?.xsecToken || detail.data?.note?.user?.xsec_token || detail.data?.note?.xsecToken || queueItem.xsecToken);
  }

  detail.data?.comments?.list?.forEach((comment) => {
    if (comment.userInfo?.userId) {
      targets.set(comment.userInfo.userId, comment.userInfo.xsecToken || comment.userInfo.xsec_token || queueItem.xsecToken);
    }
    comment.subComments?.forEach((item) => {
      if (item.userInfo?.userId) {
        targets.set(item.userInfo.userId, item.userInfo.xsecToken || item.userInfo.xsec_token || queueItem.xsecToken);
      }
    });
  });

  return [...targets.entries()].map(([userId, xsecToken]) => ({ userId, xsecToken })).filter((item) => item.xsecToken);
}

function toStoredUser(taskId: string, userId: string, profile: UserProfileData): StoredUser {
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
      const value = toDisplayCount(dataValue) || toDisplayCount(basicValue);
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
    fansCount: findDirectCount("fansCount") || toDisplayCount(findCount("fans", "粉丝")),
    followsCount: findDirectCount("followsCount", "followingCount") || toDisplayCount(findCount("follows", "follow", "following", "关注")),
    likedAndCollectedCount:
      findDirectCount("likedAndCollectedCount") || mergeCounts(findDirectCount("likedCount"), findDirectCount("collectedCount")) || toDisplayCount(findCount("liked", "likes", "like", "获赞", "点赞", "收藏")),
  };
}

function normalizeIpLocation(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  return toDisplayCount(record.ipLocation) || toDisplayCount(record.ip_location) || toDisplayCount(record.ip);
}

function toDisplayCount(value: unknown) {
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

function sleep(ms: number, signal?: AbortSignal, taskId?: string) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      try {
        if (taskId) {
          taskControl.assertActive(taskId, signal);
        }
        reject(new TaskControlError("paused"));
      } catch (error) {
        reject(error);
      }
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        try {
          if (taskId) {
            taskControl.assertActive(taskId, signal);
          }
          reject(new TaskControlError("paused"));
        } catch (error) {
          reject(error);
        }
      },
      { once: true },
    );
  });
}

function getProgressCheckpoints(total: number) {
  return Array.from({ length: total }, (_, index) => index + 1).filter(
    (value) => value === 1 || value === total || value % 5 === 0,
  );
}

function errorToMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
