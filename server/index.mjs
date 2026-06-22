import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import {
  ensureClueAnalysisSchema,
  getClueAnalysisJob,
  getClueCandidates,
  getClueScopes,
  getLatestClueResults,
  getLlmMetrics,
  startClueAnalysis,
} from "./clue-analysis.mjs";

loadLocalEnv();

const { Pool } = pg;
const PORT = Number(process.env.STORAGE_API_PORT || 5174);
const DATABASE_URL =
  process.env.DATABASE_URL ||
  `postgres://${encodeURIComponent(process.env.PGUSER || "postgres")}:${encodeURIComponent(
    process.env.PGPASSWORD || "",
  )}@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "5432"}/${
    process.env.PGDATABASE || "open_data_collect"
  }`;

const pool = new Pool({
  connectionString: DATABASE_URL,
});

const server = http.createServer(async (request, response) => {
  setCors(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/api/storage/health") {
      await pool.query("select 1");
      sendJson(response, { ok: true });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/storage/cache") {
      sendJson(response, await loadCache());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/storage/task") {
      const task = await readJson(request);
      await saveTask(task);
      sendJson(response, { ok: true });
      return;
    }

    if (request.method === "PATCH" && url.pathname.startsWith("/api/storage/task/")) {
      const taskId = decodeURIComponent(url.pathname.replace("/api/storage/task/", "").replace(/\/status$/, ""));
      const payload = await readJson(request);
      const task = await updateTaskStatus(taskId, payload.status, payload.message);
      sendJson(response, { task });
      return;
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/storage/task/")) {
      const taskId = decodeURIComponent(url.pathname.replace("/api/storage/task/", ""));
      await deleteTask(taskId);
      sendJson(response, await loadCache());
      return;
    }

    if (request.method === "DELETE" && url.pathname === "/api/storage/posts") {
      const payload = await readJson(request);
      await deletePosts(payload.targets || []);
      sendJson(response, await loadCache());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/storage/post") {
      const post = await readJson(request);
      await savePost(post);
      sendJson(response, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/storage/comments") {
      const comments = await readJson(request);
      await saveComments(Array.isArray(comments) ? comments : []);
      sendJson(response, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/storage/user") {
      const user = await readJson(request);
      await saveUser(user);
      sendJson(response, { ok: true });
      return;
    }

    // 用户画像分析聚合接口
    if (request.method === "GET" && url.pathname === "/api/storage/analytics") {
      const startDate = url.searchParams.get("startDate") || "";
      const endDate = url.searchParams.get("endDate") || "";
      sendJson(response, await fetchAnalytics(startDate, endDate));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/clues/scopes") {
      sendJson(response, { tasks: await getClueScopes(pool) });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/clues/candidates") {
      const taskId = url.searchParams.get("taskId") || null;
      sendJson(response, { candidates: await getClueCandidates(pool, { taskId }) });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/clues/results") {
      const taskId = url.searchParams.get("taskId") || null;
      sendJson(response, { results: await getLatestClueResults(pool, { taskId }) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/clues/analyze") {
      const payload = await readJson(request);
      const job = await startClueAnalysis(pool, {
        taskId: payload.taskId || null,
        userIds: Array.isArray(payload.userIds) ? payload.userIds : [],
      });
      sendJson(response, { job }, 202);
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/clues/jobs/")) {
      const jobId = decodeURIComponent(url.pathname.replace("/api/clues/jobs/", ""));
      const job = await getClueAnalysisJob(pool, jobId);
      sendJson(response, job ? { job } : { error: "Analysis job not found" }, job ? 200 : 404);
      return;
    }

    sendJson(response, { error: "Not found" }, 404);
  } catch (error) {
    sendJson(response, {
      error: error instanceof Error ? error.message : String(error),
      jobId: error?.jobId,
    }, Number(error?.statusCode) || 500);
  }
});

await ensureClueAnalysisSchema(pool);
server.listen(PORT, "127.0.0.1", () => {
  console.log(`storage api listening on http://127.0.0.1:${PORT}`);
});

async function loadCache() {
  const [tasks, posts, comments, users] = await Promise.all([
    pool.query("select raw_payload from open_collection_task order by created_at desc limit 200"),
    pool.query("select raw_payload from open_post order by created_at desc limit 2000"),
    pool.query("select raw_payload from open_comment order by created_at desc limit 5000"),
    pool.query("select raw_payload from open_user_profile order by first_seen_at desc limit 3000"),
  ]);

  return {
    tasks: tasks.rows.map((row) => row.raw_payload).filter(Boolean),
    posts: posts.rows.map((row) => row.raw_payload).filter(Boolean),
    comments: comments.rows.map((row) => row.raw_payload).filter(Boolean),
    users: users.rows.map((row) => row.raw_payload).filter(Boolean),
  };
}

// 用户画像分析聚合查询
async function fetchAnalytics(startDate = "", endDate = "") {
  // 构建任务时间过滤条件
  const taskDateFilter = (startDate || endDate) ? `
    AND created_at >= $1::timestamptz
    AND created_at <  $2::timestamptz + INTERVAL '1 day'
  ` : "";
  // 构建关联表过滤（帖子/评论/用户，通过 task_id 子查询）
  const relatedDateFilter = (startDate || endDate) ? `
    WHERE task_id IN (
      SELECT id FROM open_collection_task
      WHERE created_at >= $1::timestamptz
        AND created_at <  $2::timestamptz + INTERVAL '1 day'
    )
  ` : "";
  // 任务趋势：用日期范围构建序列
  const trendRange = (startDate && endDate) ? `
    SELECT TO_CHAR(days.day, 'YYYY-MM-DD') AS date, COUNT(tasks.id)::int AS count
    FROM GENERATE_SERIES($1::date, $2::date, INTERVAL '1 day') AS days(day)
    LEFT JOIN open_collection_task tasks
      ON tasks.created_at >= days.day
     AND tasks.created_at < days.day + INTERVAL '1 day'
    GROUP BY days.day
    ORDER BY days.day
  ` : `
    SELECT TO_CHAR(days.day, 'YYYY-MM-DD') AS date, COUNT(tasks.id)::int AS count
    FROM GENERATE_SERIES(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') AS days(day)
    LEFT JOIN open_collection_task tasks
      ON tasks.created_at >= days.day
     AND tasks.created_at < days.day + INTERVAL '1 day'
    GROUP BY days.day
    ORDER BY days.day
  `;
  const params = (startDate || endDate) ? [startDate || "1970-01-01", endDate || "2099-12-31"] : [];

  const [
    summaryResult,
    taskStatusResult,
    taskTrendResult,
    channelTaskResult,
    channelPostResult,
    channelCommentResult,
    channelUserResult,
    ipLocationResult,
    topAuthorResult,
    topCommenterResult,
    recentTaskResult,
    llmMetricsResult,
  ] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM open_collection_task WHERE 1=1 ${taskDateFilter}) AS tasks,
        (SELECT COUNT(*)::int FROM open_post ${relatedDateFilter}) AS posts,
        (SELECT COUNT(*)::int FROM open_comment ${relatedDateFilter}) AS comments,
        (SELECT COUNT(*)::int FROM open_user_profile ${relatedDateFilter}) AS users
    `, params),
    pool.query(`
      SELECT status, COUNT(*)::int AS count
      FROM open_collection_task
      WHERE 1=1 ${taskDateFilter}
      GROUP BY status
      ORDER BY count DESC
    `, params),
    pool.query(trendRange, params),
    // 渠道任务数分布
    pool.query(`SELECT channel, COUNT(*)::int as count FROM open_collection_task WHERE 1=1 ${taskDateFilter} GROUP BY channel ORDER BY count DESC`, params),
    // 渠道帖子数分布
    pool.query(`SELECT source_channel as channel, COUNT(*)::int as count FROM open_post ${relatedDateFilter} GROUP BY source_channel ORDER BY count DESC`, params),
    // 渠道评论数分布
    pool.query(`
      SELECT COALESCE(p.source_channel, '未知') as channel, COUNT(*)::int as count
      FROM open_comment c
      LEFT JOIN open_post p ON c.task_id = p.task_id AND c.feed_id = p.feed_id
      ${relatedDateFilter ? `WHERE c.task_id IN (SELECT id FROM open_collection_task WHERE 1=1 ${taskDateFilter})` : ""}
      GROUP BY p.source_channel
      ORDER BY count DESC
    `, params),
    // 渠道用户数分布
    pool.query(`SELECT source_channel as channel, COUNT(*)::int as count FROM open_user_profile ${relatedDateFilter} GROUP BY source_channel ORDER BY count DESC`, params),
    // 用户 IP 属地分布（TOP 20）
    pool.query(`
      SELECT ip_location, COUNT(*)::int as count
      FROM open_user_profile
      ${relatedDateFilter ? `${relatedDateFilter} AND` : "WHERE"} ip_location IS NOT NULL AND ip_location != ''
      GROUP BY ip_location
      ORDER BY count DESC
      LIMIT 20
    `, params),
    pool.query(`
      SELECT
        COALESCE(author_user_id, author_nickname, 'unknown-author') AS id,
        COALESCE(MAX(author_nickname), MAX(author_user_id), '未知作者') AS name,
        MAX(author_avatar) AS avatar,
        COUNT(*)::int AS count
      FROM open_post
      ${relatedDateFilter}
      GROUP BY COALESCE(author_user_id, author_nickname, 'unknown-author')
      ORDER BY count DESC
      LIMIT 6
    `, params),
    pool.query(`
      SELECT
        COALESCE(comments.user_id, comments.nickname, 'unknown-commenter') AS id,
        COALESCE(MAX(comments.nickname), MAX(comments.user_id), '未知用户') AS name,
        MAX(COALESCE(NULLIF(comments.avatar, ''), profiles.avatar)) AS avatar,
        COUNT(*)::int AS count
      FROM open_comment comments
      LEFT JOIN (
        SELECT user_id, MAX(avatar) AS avatar
        FROM (
          SELECT user_id, avatar
          FROM open_user_profile
          ${relatedDateFilter ? `WHERE task_id IN (SELECT id FROM open_collection_task WHERE 1=1 ${taskDateFilter})` : ""}
          UNION ALL
          SELECT author_user_id AS user_id, author_avatar AS avatar
          FROM open_post
          ${relatedDateFilter ? `WHERE task_id IN (SELECT id FROM open_collection_task WHERE 1=1 ${taskDateFilter})` : ""}
        ) available_avatars
        WHERE avatar IS NOT NULL AND avatar != '' AND user_id IS NOT NULL
        GROUP BY user_id
      ) profiles ON profiles.user_id = comments.user_id
      ${relatedDateFilter ? `WHERE comments.task_id IN (SELECT id FROM open_collection_task WHERE 1=1 ${taskDateFilter})` : ""}
      GROUP BY COALESCE(comments.user_id, comments.nickname, 'unknown-commenter')
      ORDER BY count DESC
      LIMIT 6
    `, params),
    pool.query(`
      SELECT
        id,
        keyword,
        status,
        CASE
          WHEN status = 'completed' THEN CONCAT('采集完成，共 ', total_count, ' 条主贴')
          ELSE COALESCE(message, '')
        END AS message,
        created_at AS "createdAt"
      FROM open_collection_task
      WHERE 1=1 ${taskDateFilter}
      ORDER BY created_at DESC
    `, params),
    getLlmMetrics(pool),
  ]);

  return {
    summary: summaryResult.rows[0],
    taskStatuses: taskStatusResult.rows,
    taskTrend: taskTrendResult.rows,
    channelTasks: channelTaskResult.rows,
    channelPosts: channelPostResult.rows,
    channelComments: channelCommentResult.rows,
    channelUsers: channelUserResult.rows,
    ipLocations: ipLocationResult.rows,
    topAuthors: topAuthorResult.rows,
    topCommenters: topCommenterResult.rows,
    recentTasks: recentTaskResult.rows,
    llmMetrics: llmMetricsResult,
  };
}

async function saveTask(task) {
  if (!task?.id) {
    return;
  }

  await pool.query(
    `insert into open_collection_task (
      id, keyword, channel, status, message, filters, options, total_count,
      completed_count, failed_count, errors, logs, raw_search, raw_payload,
      started_at, finished_at, created_at
    ) values (
      $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8,
      $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb,
      $15, $16, $17
    )
    on conflict (id) do update set
      keyword = excluded.keyword,
      channel = excluded.channel,
      status = excluded.status,
      message = excluded.message,
      filters = excluded.filters,
      options = excluded.options,
      total_count = excluded.total_count,
      completed_count = excluded.completed_count,
      failed_count = excluded.failed_count,
      errors = excluded.errors,
      logs = excluded.logs,
      raw_search = excluded.raw_search,
      raw_payload = excluded.raw_payload,
      started_at = excluded.started_at,
      finished_at = excluded.finished_at`,
    [
      task.id,
      task.keyword,
      task.channel || "小红书",
      task.status,
      task.message,
      json(task.filters),
      json(task.options),
      task.total || 0,
      task.completed || 0,
      task.failed || 0,
      json(task.errors || []),
      json(task.logs || []),
      json(task.rawSearch || null),
      json(task),
      toDate(task.startedAt),
      toDate(task.finishedAt),
      toDate(task.createdAt) || new Date(),
    ],
  );

  for (const item of task.items || []) {
    await saveTaskItem(task.id, item);
  }
  await saveTaskLogTables(task);
}

async function saveTaskItem(taskId, item) {
  await pool.query(
    `insert into open_task_item (
      task_id, feed_id, xsec_token, title, author_user_id, author_nickname,
      status, error_message, search_payload, detail_payload, raw_payload
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb)
    on conflict (task_id, feed_id) do update set
      xsec_token = excluded.xsec_token,
      title = excluded.title,
      author_user_id = excluded.author_user_id,
      author_nickname = excluded.author_nickname,
      status = excluded.status,
      error_message = excluded.error_message,
      search_payload = excluded.search_payload,
      detail_payload = excluded.detail_payload,
      raw_payload = excluded.raw_payload`,
    [
      taskId,
      item.feedId,
      item.xsecToken,
      item.title,
      item.authorId,
      item.authorName,
      item.status,
      item.error,
      json(item.searchItem || {}),
      json(item.detail || null),
      json(item),
    ],
  );

  await savePostShell(taskId, item);
}

async function savePostShell(taskId, item) {
  await pool.query(
    `insert into open_post (
      task_id, feed_id, source_channel, collect_status, error_message, xsec_token,
      title, post_url, author_user_id, author_nickname, author_profile_url,
      search_payload, raw_payload
    ) values (
      $1, $2, '小红书', $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11::jsonb, $12::jsonb
    )
    on conflict (task_id, feed_id) do update set
      collect_status = case
        when open_post.collect_status = '成功' and excluded.collect_status <> '失败' then open_post.collect_status
        else excluded.collect_status
      end,
      error_message = excluded.error_message,
      xsec_token = coalesce(excluded.xsec_token, open_post.xsec_token),
      title = coalesce(excluded.title, open_post.title),
      post_url = coalesce(excluded.post_url, open_post.post_url),
      author_user_id = coalesce(excluded.author_user_id, open_post.author_user_id),
      author_nickname = coalesce(excluded.author_nickname, open_post.author_nickname),
      author_profile_url = coalesce(excluded.author_profile_url, open_post.author_profile_url),
      search_payload = coalesce(excluded.search_payload, open_post.search_payload)`,
    [
      taskId,
      item.feedId,
      collectStatusText(item.status),
      item.error,
      item.xsecToken,
      item.title,
      buildPostUrl(item.feedId, item.xsecToken),
      item.authorId,
      item.authorName,
      item.authorId ? `https://www.xiaohongshu.com/user/profile/${item.authorId}` : null,
      json(item.searchItem || {}),
      json(item),
    ],
  );
}

async function saveTaskLogTables(task) {
  await pool.query("delete from open_raw_api_payload where task_id = $1", [task.id]);
  await pool.query("delete from open_query_log where task_id = $1", [task.id]);

  for (const log of task.logs || []) {
    if (log.payload === undefined) {
      continue;
    }
    const isRequest = log.title.includes("请求");
    await pool.query(
      `insert into open_raw_api_payload (
        task_id, endpoint, request_payload, response_payload, success,
        error_message, created_at
      ) values ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)`,
      [
        task.id,
        log.title,
        isRequest ? json(log.payload) : null,
        isRequest ? null : json(log.payload),
        log.type !== "error",
        log.type === "error" ? log.message : null,
        toDate(log.time) || new Date(),
      ],
    );
  }

  await pool.query(
    `insert into open_query_log (
      task_id, keyword, channel, filters, options, result_count, note_count,
      status, error_message, raw_payload, created_at
    ) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10::jsonb, $11)`,
    [
      task.id,
      task.keyword,
      task.channel || "小红书",
      json(task.filters),
      json(task.options),
      task.rawSearch?.count || task.total || 0,
      task.total || 0,
      task.status,
      task.errors?.[0] || null,
      json(task.rawSearch || null),
      toDate(task.createdAt) || new Date(),
    ],
  );
}

async function updateTaskStatus(taskId, status, message) {
  const cache = await loadCache();
  const task = cache.tasks.find((item) => item.id === taskId);
  if (!task) {
    return null;
  }
  const nextTask = { ...task, status, message: message ?? task.message };
  await saveTask(nextTask);
  return nextTask;
}

async function deleteTask(taskId) {
  await pool.query("delete from open_collection_task where id = $1", [taskId]);
}

async function deletePosts(targets) {
  for (const target of targets) {
    await pool.query("delete from open_post where task_id = $1 and feed_id = $2", [target.taskId, target.feedId]);
    await pool.query("delete from open_comment where task_id = $1 and feed_id = $2", [target.taskId, target.feedId]);
    await pool.query("delete from open_task_item where task_id = $1 and feed_id = $2", [target.taskId, target.feedId]);
  }
}

async function savePost(post) {
  if (!post?.taskId || !post?.feedId) {
    return;
  }

  await pool.query(
    `insert into open_post (
      task_id, feed_id, source_channel, collect_status, xsec_token, title,
      description, post_url, author_user_id, author_nickname, author_avatar,
      author_profile_url, liked_count_text, shared_count_text, comment_count_text,
      collected_count_text, ip_location, publish_time_ms, publish_time, search_payload, raw_payload
    ) values (
      $1, $2, '小红书', '成功', $3, $4,
      $5, $6, $7, $8, $9,
      $10, $11, $12, $13,
      $14, $15, $16, $17, $18::jsonb, $19::jsonb
    )
    on conflict (task_id, feed_id) do update set
      collect_status = '成功',
      error_message = null,
      xsec_token = excluded.xsec_token,
      title = excluded.title,
      description = excluded.description,
      post_url = excluded.post_url,
      author_user_id = excluded.author_user_id,
      author_nickname = excluded.author_nickname,
      author_avatar = excluded.author_avatar,
      author_profile_url = excluded.author_profile_url,
      liked_count_text = excluded.liked_count_text,
      shared_count_text = excluded.shared_count_text,
      comment_count_text = excluded.comment_count_text,
      collected_count_text = excluded.collected_count_text,
      ip_location = excluded.ip_location,
      publish_time_ms = excluded.publish_time_ms,
      publish_time = excluded.publish_time,
      search_payload = excluded.search_payload,
      raw_payload = excluded.raw_payload`,
    [
      post.taskId,
      post.feedId,
      post.xsecToken,
      post.title,
      post.desc,
      buildPostUrl(post.feedId, post.xsecToken),
      post.authorId,
      post.authorName,
      post.authorAvatar,
      post.authorId ? `https://www.xiaohongshu.com/user/profile/${post.authorId}` : null,
      post.likedCount,
      post.sharedCount,
      post.commentCount,
      post.collectedCount,
      post.ipLocation,
      post.publishTime,
      timestampFromMs(post.publishTime),
      json(null),
      json(post),
    ],
  );
}

async function saveComments(comments) {
  for (const comment of comments) {
    if (!comment?.taskId || !comment?.commentId) {
      continue;
    }
    await pool.query(
      "delete from open_comment where task_id = $1 and comment_id = $2 and coalesce(parent_comment_id, '') = coalesce($3, '')",
      [comment.taskId, comment.commentId, comment.parentCommentId || null],
    );
    await pool.query(
      `insert into open_comment (
        task_id, feed_id, comment_id, parent_comment_id, comment_level, content,
        user_id, xsec_token, nickname, avatar, like_count_text, ip_location,
        comment_time_ms, comment_time, raw_payload
      ) values (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, $15::jsonb
      )`,
      [
        comment.taskId,
        comment.feedId,
        comment.commentId,
        comment.parentCommentId,
        comment.parentCommentId ? 2 : 1,
        comment.content,
        comment.userId,
        comment.xsecToken,
        comment.nickname,
        comment.avatar,
        comment.likeCount,
        comment.ipLocation,
        comment.createTime,
        timestampFromMs(comment.createTime),
        json(comment),
      ],
    );
  }
}

async function saveUser(user) {
  if (!user?.taskId || !user?.userId) {
    return;
  }

  await pool.query(
    `insert into open_user_profile (
      task_id, user_id, source_channel, nickname, red_id, gender, ip_location,
      description, avatar, profile_url, fans_count_text, follows_count_text,
      liked_and_collected_count_text, interactions, raw_payload
    ) values (
      $1, $2, '小红书', $3, $4, $5, $6,
      $7, $8, $9, $10, $11,
      $12, $13::jsonb, $14::jsonb
    )
    on conflict (task_id, user_id) do update set
      nickname = excluded.nickname,
      red_id = excluded.red_id,
      gender = excluded.gender,
      ip_location = excluded.ip_location,
      description = excluded.description,
      avatar = excluded.avatar,
      profile_url = excluded.profile_url,
      fans_count_text = excluded.fans_count_text,
      follows_count_text = excluded.follows_count_text,
      liked_and_collected_count_text = excluded.liked_and_collected_count_text,
      interactions = excluded.interactions,
      raw_payload = excluded.raw_payload`,
    [
      user.taskId,
      user.userId,
      user.nickname,
      user.redId,
      user.gender,
      user.ipLocation,
      user.desc,
      user.avatar,
      `https://www.xiaohongshu.com/user/profile/${user.userId}`,
      user.fansCount,
      user.followsCount,
      user.likedAndCollectedCount,
      json(user.interactions || []),
      json(user),
    ],
  );
}

function loadLocalEnv() {
  for (const name of [".env.local", ".env"]) {
    const file = resolve(process.cwd(), name);
    if (!existsSync(file)) {
      continue;
    }
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        continue;
      }
      const [key, ...rest] = trimmed.split("=");
      if (!process.env[key]) {
        process.env[key] = rest.join("=").replace(/^["']|["']$/g, "");
      }
    }
  }
}

function readJson(request) {
  return new Promise((resolveJson, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolveJson(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function setCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function toDate(value) {
  return value ? new Date(value) : null;
}

function timestampFromMs(value) {
  return typeof value === "number" ? new Date(value) : null;
}

function buildPostUrl(feedId, xsecToken) {
  const url = new URL(`https://www.xiaohongshu.com/explore/${feedId}`);
  if (xsecToken) {
    url.searchParams.set("xsec_token", xsecToken);
  }
  return url.toString();
}

function collectStatusText(status) {
  const map = {
    queued: "待采集",
    fetching: "采集中",
    completed: "成功",
    failed: "失败",
    skipped: "跳过",
  };
  return map[status] || "待采集";
}
