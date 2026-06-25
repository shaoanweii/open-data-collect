import { createHash } from "node:crypto";

const PROMPT_VERSION = "automotive-clue-v1";

export async function ensureClueAnalysisSchema(pool) {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS open_clue_analysis_job (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      scope_task_id text REFERENCES open_collection_task(id) ON DELETE SET NULL,
      requested_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
      total_users integer NOT NULL DEFAULT 0,
      completed_users integer NOT NULL DEFAULT 0,
      failed_users integer NOT NULL DEFAULT 0,
      model text NOT NULL,
      message text,
      error_message text,
      created_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      finished_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS open_clue_analysis_result (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id uuid NOT NULL REFERENCES open_clue_analysis_job(id) ON DELETE CASCADE,
      scope_task_id text REFERENCES open_collection_task(id) ON DELETE SET NULL,
      user_id text NOT NULL,
      nickname text,
      ip_location text,
      rating text NOT NULL CHECK (rating IN ('high', 'medium', 'low', 'none')),
      confidence numeric(5,4) NOT NULL DEFAULT 0,
      has_purchase_intent boolean NOT NULL DEFAULT false,
      user_type text NOT NULL DEFAULT '未拥车',
      intent_types jsonb NOT NULL DEFAULT '[]'::jsonb,
      concerns jsonb NOT NULL DEFAULT '[]'::jsonb,
      brands jsonb NOT NULL DEFAULT '[]'::jsonb,
      car_series jsonb NOT NULL DEFAULT '[]'::jsonb,
      competitors jsonb NOT NULL DEFAULT '[]'::jsonb,
      summary text NOT NULL,
      evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
      sales_strategy jsonb NOT NULL DEFAULT '{}'::jsonb,
      dealer_recommendation jsonb NOT NULL DEFAULT '{}'::jsonb,
      data_cutoff_at timestamptz,
      post_count integer NOT NULL DEFAULT 0,
      comment_count integer NOT NULL DEFAULT 0,
      model text NOT NULL,
      prompt_version text NOT NULL,
      input_hash text NOT NULL,
      raw_input jsonb NOT NULL,
      raw_output jsonb NOT NULL,
      llm_origin_log jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_open_clue_job_status ON open_clue_analysis_job(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_open_clue_result_user ON open_clue_analysis_result(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_open_clue_result_scope ON open_clue_analysis_result(scope_task_id, created_at DESC);
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF to_regclass('open_comment') IS NOT NULL THEN
        ALTER TABLE open_comment ADD COLUMN IF NOT EXISTS source_channel text;
        ALTER TABLE open_comment ADD COLUMN IF NOT EXISTS source_sub_channel text;
      END IF;
      IF to_regclass('open_post') IS NOT NULL THEN
        ALTER TABLE open_post ADD COLUMN IF NOT EXISTS source_channel text;
        ALTER TABLE open_post ADD COLUMN IF NOT EXISTS source_sub_channel text;
      END IF;
      IF to_regclass('open_user_profile') IS NOT NULL THEN
        ALTER TABLE open_user_profile ADD COLUMN IF NOT EXISTS source_channel text;
        ALTER TABLE open_user_profile ADD COLUMN IF NOT EXISTS source_sub_channel text;
      END IF;
    END $$;
  `);

  await pool.query(`
    UPDATE open_post p
    SET source_channel = NULLIF(t.channel, '')
    FROM open_collection_task t
    WHERE p.task_id = t.id
      AND (p.source_channel IS NULL OR p.source_channel = '' OR p.source_channel = '未知')
      AND NULLIF(t.channel, '') IS NOT NULL
  `).catch(() => {
    // 基础采集表不存在或旧库字段未就绪时跳过，服务下次启动会继续迁移。
  });

  await pool.query(`
    UPDATE open_user_profile u
    SET source_channel = NULLIF(t.channel, '')
    FROM open_collection_task t
    WHERE u.task_id = t.id
      AND (u.source_channel IS NULL OR u.source_channel = '' OR u.source_channel = '未知')
      AND NULLIF(t.channel, '') IS NOT NULL
  `).catch(() => {
    // 基础采集表不存在或旧库字段未就绪时跳过，服务下次启动会继续迁移。
  });

  await pool.query(`
    UPDATE open_comment c
    SET source_channel = COALESCE(
      NULLIF(c.source_channel, ''),
      (SELECT p.source_channel FROM open_post p WHERE p.task_id = c.task_id AND p.feed_id = c.feed_id LIMIT 1),
      (SELECT NULLIF(t.channel, '') FROM open_collection_task t WHERE t.id = c.task_id LIMIT 1)
    )
    WHERE (c.source_channel IS NULL OR c.source_channel = '' OR c.source_channel = '未知')
      AND COALESCE(
        (SELECT p.source_channel FROM open_post p WHERE p.task_id = c.task_id AND p.feed_id = c.feed_id LIMIT 1),
        (SELECT NULLIF(t.channel, '') FROM open_collection_task t WHERE t.id = c.task_id LIMIT 1)
      ) IS NOT NULL
  `).catch(() => {
    // 基础采集表不存在或旧库字段未就绪时跳过，服务下次启动会继续迁移。
  });

  await pool.query(`
    UPDATE open_comment
    SET source_sub_channel = '评论区'
    WHERE source_sub_channel IS NULL OR source_sub_channel = ''
  `).catch(() => {
    // 基础采集表不存在或旧库字段未就绪时跳过，服务下次启动会继续迁移。
  });

  // 迁移：为已有表新增 user_type 字段
  await pool.query(`
    ALTER TABLE open_clue_analysis_result ADD COLUMN IF NOT EXISTS user_type text NOT NULL DEFAULT '未拥车'
  `);

  // 迁移：为已有表新增 llm_origin_log 字段
  await pool.query(`
    ALTER TABLE open_clue_analysis_result ADD COLUMN IF NOT EXISTS llm_origin_log jsonb NOT NULL DEFAULT '{}'::jsonb
  `);

  // LLM 调用指标表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS open_clue_analysis_metric (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id uuid NOT NULL REFERENCES open_clue_analysis_job(id) ON DELETE CASCADE,
      user_id text NOT NULL,
      model text NOT NULL,
      prompt_tokens integer NOT NULL DEFAULT 0,
      completion_tokens integer NOT NULL DEFAULT 0,
      total_tokens integer NOT NULL DEFAULT 0,
      duration_ms integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_clue_metric_job ON open_clue_analysis_metric(job_id);
    CREATE INDEX IF NOT EXISTS idx_clue_metric_created ON open_clue_analysis_metric(created_at DESC);
  `);

  // 迁移：扩容 rating CHECK 约束（low → low, none）
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'open_clue_analysis_result_rating_check'
      ) THEN
        ALTER TABLE open_clue_analysis_result DROP CONSTRAINT open_clue_analysis_result_rating_check;
      END IF;
    END $$;
    ALTER TABLE open_clue_analysis_result ADD CONSTRAINT open_clue_analysis_result_rating_check
      CHECK (rating IN ('high', 'medium', 'low', 'none')) NOT VALID;
  `).catch(() => {
    // 约束可能已更新或名称不同，静默跳过
  });

  await pool.query(`
    UPDATE open_clue_analysis_job
    SET status = 'failed',
        error_message = '分析服务重启，任务已中断，请重新评级',
        message = '任务已中断',
        finished_at = now(),
        updated_at = now()
    WHERE status IN ('queued', 'running')
  `);

  await ensureIncubationSchema(pool);
  await syncIncubationLeads(pool);
}

export async function startClueAnalysis(pool, { taskId = null, userIds = [] } = {}) {
  assertDeepSeekConfig();
  const normalizedUserIds = Array.from(new Set((userIds || []).filter(Boolean)));
  const running = await pool.query(
    `SELECT id FROM open_clue_analysis_job
     WHERE status IN ('queued', 'running')
       AND COALESCE(scope_task_id, '') = COALESCE($1, '')
     ORDER BY created_at DESC LIMIT 1`,
    [taskId || null],
  );
  if (running.rowCount) {
    const error = new Error("当前分析范围已有任务正在运行");
    error.statusCode = 409;
    error.jobId = running.rows[0].id;
    throw error;
  }

  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-pro";
  const result = await pool.query(
    `INSERT INTO open_clue_analysis_job (
       scope_task_id, requested_user_ids, status, model, message
     ) VALUES ($1, $2::jsonb, 'queued', $3, '等待构建用户分析数据')
     RETURNING *`,
    [taskId || null, JSON.stringify(normalizedUserIds), model],
  );
  const job = result.rows[0];

  setTimeout(() => {
    void runClueAnalysis(pool, job.id).catch(async (error) => {
      await markJobFailed(pool, job.id, error);
    });
  }, 0);

  return mapJob(job);
}

export async function getClueAnalysisJob(pool, jobId) {
  const result = await pool.query("SELECT * FROM open_clue_analysis_job WHERE id = $1", [jobId]);
  return result.rowCount ? mapJob(result.rows[0]) : null;
}

export async function getLatestClueResults(pool, { taskId = null } = {}) {
  const result = await pool.query(
    `SELECT DISTINCT ON (user_id)
       id, job_id, scope_task_id, user_id, nickname, ip_location, rating,
       confidence::float8 AS confidence, has_purchase_intent, user_type, intent_types,
       concerns, brands, car_series, competitors, summary, evidence,
       sales_strategy, dealer_recommendation, data_cutoff_at, post_count,
       comment_count, model, prompt_version, llm_origin_log, created_at
     FROM open_clue_analysis_result
     WHERE (($1::text IS NULL AND scope_task_id IS NULL) OR scope_task_id = $1)
     ORDER BY user_id, created_at DESC`,
    [taskId || null],
  );
  return result.rows.map(mapResult);
}

async function ensureIncubationSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS open_incubation_lead (
      user_id text PRIMARY KEY,
      latest_result_id uuid REFERENCES open_clue_analysis_result(id) ON DELETE SET NULL,
      lead_status text NOT NULL DEFAULT 'new' CHECK (lead_status IN ('new', 'following', 'replied', 'converted', 'lost')),
      reply_count integer NOT NULL DEFAULT 0 CHECK (reply_count >= 0),
      has_replied boolean NOT NULL DEFAULT false,
      converted boolean NOT NULL DEFAULT false,
      last_followed_at timestamptz,
      next_follow_at timestamptz,
      owner text,
      note text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_open_incubation_lead_status ON open_incubation_lead(lead_status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_open_incubation_lead_latest_result ON open_incubation_lead(latest_result_id);

    CREATE TABLE IF NOT EXISTS open_incubation_followup_event (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL REFERENCES open_incubation_lead(user_id) ON DELETE CASCADE,
      event_type text NOT NULL CHECK (event_type IN ('reply', 'call', 'wechat', 'visit', 'converted', 'lost', 'note', 'status')),
      content text,
      occurred_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_open_incubation_event_user ON open_incubation_followup_event(user_id, occurred_at DESC);
  `);
}

async function syncIncubationLeads(pool) {
  await pool.query(`
    INSERT INTO open_incubation_lead (user_id, latest_result_id)
    SELECT DISTINCT ON (user_id) user_id, id
    FROM open_clue_analysis_result
    ORDER BY user_id, created_at DESC
    ON CONFLICT (user_id) DO UPDATE
    SET latest_result_id = EXCLUDED.latest_result_id,
        updated_at = CASE
          WHEN open_incubation_lead.latest_result_id IS DISTINCT FROM EXCLUDED.latest_result_id THEN now()
          ELSE open_incubation_lead.updated_at
        END
  `);
}

export async function getClueScopes(pool) {
  const result = await pool.query(
    `SELECT id, keyword, channel, status, created_at AS "createdAt"
     FROM open_collection_task
     ORDER BY created_at DESC`,
  );
  return result.rows;
}

// 获取所有已评级的孵化线索（360° 列表视图）
export async function getIncubationLeads(pool) {
  const result = await pool.query(
    `WITH latest AS (
       SELECT DISTINCT ON (user_id)
         id, job_id, scope_task_id, user_id, nickname, ip_location, rating,
         confidence::float8 AS confidence, has_purchase_intent, user_type, intent_types,
         concerns, brands, car_series, competitors, summary, evidence,
         sales_strategy, dealer_recommendation, data_cutoff_at, post_count,
         comment_count, model, prompt_version, llm_origin_log, created_at
       FROM open_clue_analysis_result
       ORDER BY user_id, created_at DESC
     ),
     latest_profile AS (
       SELECT DISTINCT ON (user_id)
         user_id, red_id, description, avatar, ip_location AS profile_ip_location
       FROM open_user_profile
       ORDER BY user_id, updated_at DESC NULLS LAST, first_seen_at DESC NULLS LAST
     ),
     source_rows AS (
       SELECT user_id, source_channel, source_sub_channel FROM open_user_profile WHERE user_id IS NOT NULL
       UNION ALL
       SELECT author_user_id AS user_id, source_channel, source_sub_channel FROM open_post WHERE author_user_id IS NOT NULL
       UNION ALL
       SELECT user_id, source_channel, source_sub_channel FROM open_comment WHERE user_id IS NOT NULL
     ),
     source_by_user AS (
       SELECT
         user_id,
         array_remove(array_agg(DISTINCT NULLIF(source_channel, '')), NULL) AS source_channels,
         array_remove(array_agg(DISTINCT NULLIF(source_sub_channel, '')), NULL) AS source_sub_channels
       FROM source_rows
       GROUP BY user_id
     )
     SELECT latest.*,
            profile.red_id, profile.description, profile.avatar,
            COALESCE(latest.ip_location, profile.profile_ip_location) AS display_ip_location,
            source.source_channels, source.source_sub_channels,
            lead.lead_status, lead.reply_count, lead.has_replied, lead.converted,
            lead.last_followed_at, lead.next_follow_at, lead.owner, lead.note,
            lead.created_at AS lead_created_at, lead.updated_at AS lead_updated_at
     FROM latest
     LEFT JOIN latest_profile profile ON profile.user_id = latest.user_id
     LEFT JOIN source_by_user source ON source.user_id = latest.user_id
     LEFT JOIN open_incubation_lead lead ON lead.user_id = latest.user_id
     ORDER BY latest.created_at DESC`,
  );
  return result.rows.map(mapResult);
}

// 获取单个用户的完整 360° 孵化详情
export async function getIncubationDetail(pool, userId) {
  const [resultRow, profiles, posts, comments, leadRow, events, sources] = await Promise.all([
    pool.query(
      `SELECT id, job_id, scope_task_id, user_id, nickname, ip_location, rating,
              confidence::float8 AS confidence, has_purchase_intent, user_type, intent_types,
              concerns, brands, car_series, competitors, summary, evidence,
              sales_strategy, dealer_recommendation, data_cutoff_at, post_count,
              comment_count, model, prompt_version, llm_origin_log, created_at
       FROM open_clue_analysis_result
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId],
    ),
    pool.query(
      `SELECT nickname, red_id, gender, ip_location, description, avatar,
              source_channel, source_sub_channel,
              fans_count_text, follows_count_text, liked_and_collected_count_text
       FROM open_user_profile
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId],
    ),
    pool.query(
      `SELECT task_id, feed_id, source_channel, source_sub_channel, title, description, author_nickname, author_avatar,
              liked_count_text, shared_count_text, comment_count_text,
              collected_count_text, ip_location, publish_time
       FROM open_post
       WHERE author_user_id = $1
       ORDER BY publish_time DESC NULLS LAST
       LIMIT 50`,
      [userId],
    ),
    pool.query(
      `SELECT task_id, feed_id, source_channel, source_sub_channel, comment_id, parent_comment_id, content,
              nickname, avatar, ip_location, comment_time, like_count_text
       FROM open_comment
       WHERE user_id = $1
      ORDER BY comment_time DESC NULLS LAST
      LIMIT 100`,
      [userId],
    ),
    pool.query(
      `SELECT user_id, latest_result_id, lead_status, reply_count, has_replied, converted,
              last_followed_at, next_follow_at, owner, note, created_at AS lead_created_at, updated_at AS lead_updated_at
       FROM open_incubation_lead
       WHERE user_id = $1`,
      [userId],
    ),
    pool.query(
      `SELECT id, event_type, content, occurred_at, created_at
       FROM open_incubation_followup_event
       WHERE user_id = $1
      ORDER BY occurred_at DESC
      LIMIT 20`,
      [userId],
    ),
    pool.query(
      `WITH rows AS (
        SELECT source_channel, source_sub_channel FROM open_user_profile WHERE user_id = $1
        UNION ALL
        SELECT source_channel, source_sub_channel FROM open_post WHERE author_user_id = $1
        UNION ALL
        SELECT source_channel, source_sub_channel FROM open_comment WHERE user_id = $1
      )
      SELECT
        array_remove(array_agg(DISTINCT NULLIF(source_channel, '')), NULL) AS source_channels,
        array_remove(array_agg(DISTINCT NULLIF(source_sub_channel, '')), NULL) AS source_sub_channels
      FROM rows`,
      [userId],
    ),
  ]);

  const lead = leadRow.rowCount ? leadRow.rows[0] : null;
  const analysis = resultRow.rowCount ? mapResult({ ...resultRow.rows[0], ...(lead || {}) }) : null;
  const profile = profiles.rowCount ? profiles.rows[0] : {};
  const source = sources.rows[0] || {};
  const sourceChannels = source.source_channels?.length ? source.source_channels : sourceChannelsForRows([], [profile]);
  const sourceSubChannels = source.source_sub_channels?.length ? source.source_sub_channels : sourceSubChannelsForRows([profile]);

  return {
    analysis,
    followUp: lead ? mapFollowUp(lead) : analysis?.followUp || defaultFollowUp(),
    followEvents: events.rows.map((event) => ({
      id: event.id,
      type: event.event_type,
      content: event.content || "",
      occurredAt: event.occurred_at,
      createdAt: event.created_at,
    })),
    profile: {
      nickname: profile.nickname || analysis?.nickname || userId,
      redId: profile.red_id || null,
      gender: profile.gender ?? null,
      ipLocation: profile.ip_location || analysis?.ipLocation || null,
      description: profile.description || null,
      avatar: profile.avatar || null,
      sourceChannels,
      sourceSubChannels,
      fansCount: profile.fans_count_text || null,
      followsCount: profile.follows_count_text || null,
      likedAndCollectedCount: profile.liked_and_collected_count_text || null,
    },
    posts: posts.rows.map((p) => ({
      taskId: p.task_id,
      feedId: p.feed_id,
      sourceChannel: p.source_channel || null,
      sourceSubChannel: p.source_sub_channel || null,
      title: p.title,
      desc: p.description,
      authorName: p.author_nickname,
      authorAvatar: p.author_avatar || null,
      likedCount: p.liked_count_text,
      sharedCount: p.shared_count_text,
      commentCount: p.comment_count_text,
      collectedCount: p.collected_count_text,
      ipLocation: p.ip_location,
      publishTime: p.publish_time,
    })),
    comments: comments.rows.map((c) => ({
      taskId: c.task_id,
      feedId: c.feed_id,
      sourceChannel: c.source_channel || null,
      sourceSubChannel: c.source_sub_channel || null,
      commentId: c.comment_id,
      parentCommentId: c.parent_comment_id,
      content: c.content,
      nickname: c.nickname,
      avatar: c.avatar || null,
      ipLocation: c.ip_location,
      commentTime: c.comment_time,
      likeCount: c.like_count_text,
    })),
  };
}

export async function updateIncubationLead(pool, userId, payload = {}) {
  if (!userId) {
    const error = new Error("缺少用户 ID");
    error.statusCode = 400;
    throw error;
  }

  await syncIncubationLead(pool, userId);

  const currentResult = await pool.query(
    `SELECT latest_result_id, lead_status, reply_count, has_replied, converted, last_followed_at, next_follow_at, owner, note
     FROM open_incubation_lead WHERE user_id = $1`,
    [userId],
  );
  const current = currentResult.rows[0] || {};
  const nextReplyCount = normalizeReplyCount(payload.replyCount, current.reply_count);
  const nextConverted = typeof payload.converted === "boolean" ? payload.converted : Boolean(current.converted);
  const nextHasReplied = typeof payload.hasReplied === "boolean"
    ? payload.hasReplied
    : Boolean(current.has_replied || nextReplyCount > 0);
  const nextStatus = normalizeLeadStatus(payload.status, {
    fallback: current.lead_status || "new",
    replyCount: nextReplyCount,
    hasReplied: nextHasReplied,
    converted: nextConverted,
  });
  const markFollowed = payload.markFollowed !== false && (
    payload.status !== undefined ||
    payload.replyCount !== undefined ||
    payload.hasReplied !== undefined ||
    payload.converted !== undefined
  );

  const result = await pool.query(
    `UPDATE open_incubation_lead
     SET lead_status = $2,
         reply_count = $3,
         has_replied = $4,
         converted = $5,
         last_followed_at = CASE WHEN $6 THEN now() ELSE last_followed_at END,
         next_follow_at = COALESCE($7::timestamptz, next_follow_at),
         owner = COALESCE($8, owner),
         note = COALESCE($9, note),
         updated_at = now()
     WHERE user_id = $1
     RETURNING user_id, latest_result_id, lead_status, reply_count, has_replied, converted,
               last_followed_at, next_follow_at, owner, note, created_at AS lead_created_at, updated_at AS lead_updated_at`,
    [
      userId,
      nextStatus,
      nextReplyCount,
      nextHasReplied,
      nextConverted || nextStatus === "converted",
      markFollowed,
      payload.nextFollowAt || null,
      payload.owner || null,
      payload.note || null,
    ],
  );

  if (payload.eventType || payload.content) {
    await pool.query(
      `INSERT INTO open_incubation_followup_event (user_id, event_type, content)
       VALUES ($1, $2, $3)`,
      [userId, normalizeEventType(payload.eventType, nextStatus), payload.content || payload.note || ""],
    );
  }

  return mapFollowUp(result.rows[0]);
}

export async function getClueCandidates(pool, { taskId = null } = {}) {
  const [userPackages, results] = await Promise.all([
    loadUserPackages(pool, taskId, []),
    getLatestClueResults(pool, { taskId }),
  ]);
  const resultsByUser = new Map(results.map((result) => [result.userId, result]));

  return userPackages.map((item) => {
    const comments = [...item.comments].sort((a, b) => dateValue(b.comment_time || b.created_at) - dateValue(a.comment_time || a.created_at));
    const posts = [...item.posts].sort((a, b) => dateValue(b.publish_time || b.collected_at) - dateValue(a.publish_time || a.collected_at));
    const latestComment = comments[0];
    const latestPost = posts[0];
    const latestAt = [latestComment?.comment_time || latestComment?.created_at, latestPost?.publish_time || latestPost?.collected_at]
      .filter(Boolean)
      .sort((a, b) => dateValue(b) - dateValue(a))[0] || null;
    const sourceChannels = item.source_channels?.length ? item.source_channels : sourceChannelsForUser(item);
    const sourceSubChannels = item.source_sub_channels || [];

    return {
      id: item.user.user_id,
      name: item.user.nickname,
      avatar: item.user.avatar || null,
      ipLocation: item.user.ip_location,
      redId: item.user.red_id,
      desc: item.user.description,
      sourceChannels,
      sourceSubChannels,
      postCount: item.statistics.post_count,
      commentCount: item.statistics.comment_count,
      activityCount: item.statistics.post_count + item.statistics.comment_count,
      latestAt,
      latestComment: latestComment ? mapCandidateComment(latestComment) : null,
      comments: comments.map(mapCandidateComment),
      posts: posts.map((post) => ({
        taskId: post.task_id,
        feedId: post.feed_id,
        title: post.title,
        desc: post.description,
        publishTime: post.publish_time,
      })),
      analysis: resultsByUser.get(item.user.user_id) || null,
      dataCutoffAt: item.data_cutoff_at,
    };
  });
}

function sourceChannelsForUser(userPackage) {
  const channelsByTask = new Map((userPackage.scope?.tasks || []).map((task) => [task.id, task.channel || "未知"]));
  const taskIds = new Set([
    ...(userPackage.posts || []).map((row) => row.task_id),
    ...(userPackage.comments || []).map((row) => row.task_id),
  ].filter(Boolean));
  return Array.from(taskIds)
    .map((taskId) => channelsByTask.get(taskId))
    .filter(Boolean)
    .filter((channel, index, channels) => channels.indexOf(channel) === index);
}

function sourceChannelsForRows(tasks, rows) {
  const channelsByTask = new Map((tasks || []).map((task) => [task.id, task.channel || "未知"]));
  const channels = Array.from(new Set((rows || [])
    .map((row) => row.source_channel || channelsByTask.get(row.task_id))
    .filter(Boolean)));
  return channels.length ? channels : (rows?.length ? ["小红书"] : []);
}

function sourceSubChannelsForRows(rows) {
  return Array.from(new Set((rows || [])
    .map((row) => row.source_sub_channel)
    .filter(Boolean)));
}

async function runClueAnalysis(pool, jobId) {
  const jobResult = await pool.query("SELECT * FROM open_clue_analysis_job WHERE id = $1", [jobId]);
  if (!jobResult.rowCount) return;
  const job = jobResult.rows[0];
  const userPackages = await loadUserPackages(pool, job.scope_task_id, job.requested_user_ids || []);

  await pool.query(
    `UPDATE open_clue_analysis_job
     SET status = 'running', total_users = $2, started_at = now(),
         message = $3, updated_at = now()
     WHERE id = $1`,
    [jobId, userPackages.length, userPackages.length ? `准备分析 ${userPackages.length} 位用户` : "没有可分析的用户"],
  );

  if (!userPackages.length) {
    await pool.query(
      `UPDATE open_clue_analysis_job SET status = 'completed', message = '没有可分析的用户',
       finished_at = now(), updated_at = now() WHERE id = $1`,
      [jobId],
    );
    return;
  }

  const concurrency = Math.max(1, Math.min(4, Number(process.env.DEEPSEEK_ANALYSIS_CONCURRENCY || 2)));
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, userPackages.length) }, async () => {
    while (cursor < userPackages.length) {
      const index = cursor++;
      const userPackage = userPackages[index];
      try {
        const result = await analyzeUser(userPackage);
        await saveAnalysisResult(pool, job, userPackage, result.analysis);
        await saveLlmMetric(pool, job.id, userPackage.user.user_id, job.model, result.usage, result.duration_ms);
        await updateJobProgress(pool, jobId, true, userPackage.user.nickname || userPackage.user.user_id);
      } catch (error) {
        await updateJobProgress(pool, jobId, false, userPackage.user.nickname || userPackage.user.user_id, error);
      }
    }
  });
  await Promise.all(workers);

  const finalResult = await pool.query("SELECT completed_users, failed_users, total_users FROM open_clue_analysis_job WHERE id = $1", [jobId]);
  const final = finalResult.rows[0];
  await pool.query(
    `UPDATE open_clue_analysis_job
     SET status = $2, message = $3, finished_at = now(), updated_at = now(),
         error_message = CASE WHEN $2 = 'failed' THEN COALESCE(error_message, $3) ELSE error_message END
     WHERE id = $1`,
    [
      jobId,
      final.completed_users === 0 && final.failed_users > 0 ? "failed" : "completed",
      `评级完成：成功 ${final.completed_users} 位，失败 ${final.failed_users} 位`,
    ],
  );
}

async function loadUserPackages(pool, taskId, requestedUserIds) {
  // 支持逗号分隔的多任务 ID
  const taskIds = taskId ? taskId.split(",").filter(Boolean) : [];
  const singleTaskId = taskIds.length === 1 ? taskIds[0] : (taskIds.length > 1 ? null : null);
  // 多选时用 IN 子句，单选或全量时用参数化
  const taskFilter = () => {
    if (taskIds.length === 0) return "($1::text IS NULL)";
    if (taskIds.length > 1) {
      const placeholders = taskIds.map((_, i) => `$${i + 1}`);
      return `(task_id IN (${placeholders.join(", ")}))`;
    }
    return "($1::text IS NULL OR task_id = $1)";
  };
  const params = taskIds.length === 0 ? [null]
    : taskIds.length > 1 ? [...taskIds]
    : [taskId || null];
  const [profilesResult, postsResult, commentsResult, tasksResult] = await Promise.all([
    pool.query(
      `SELECT task_id, user_id, source_channel, source_sub_channel, nickname, red_id, gender, ip_location, description,
              avatar, fans_count_text, follows_count_text, liked_and_collected_count_text,
              interactions, first_seen_at, updated_at
       FROM open_user_profile
       WHERE ${taskFilter()}`,
      params,
    ),
    pool.query(
      `SELECT task_id, feed_id, source_channel, source_sub_channel, title, description, note_type, author_user_id,
              author_nickname, liked_count_text, shared_count_text, comment_count_text,
              collected_count_text, ip_location, publish_time, collected_at, updated_at
       FROM open_post
       WHERE author_user_id IS NOT NULL AND ${taskFilter()}
       ORDER BY publish_time NULLS LAST, created_at`,
      params,
    ),
    pool.query(
      `SELECT task_id, feed_id, comment_id, parent_comment_id, comment_level, content,
              user_id, source_channel, source_sub_channel, nickname, like_count_text, ip_location, comment_time, show_tags,
              created_at, updated_at
       FROM open_comment
       WHERE user_id IS NOT NULL AND ${taskFilter()}
       ORDER BY comment_time NULLS LAST, created_at`,
      params,
    ),
    pool.query(
      `SELECT id, keyword, channel, created_at
       FROM open_collection_task
       WHERE ${taskFilter().replace(/task_id/g, "id")}
       ORDER BY created_at`,
      params,
    ),
  ]);

  const requested = new Set(requestedUserIds || []);
  const userIds = new Set([
    ...profilesResult.rows.map((row) => row.user_id),
    ...postsResult.rows.map((row) => row.author_user_id),
    ...commentsResult.rows.map((row) => row.user_id),
  ].filter(Boolean));
  const targetIds = requested.size ? Array.from(userIds).filter((id) => requested.has(id)) : Array.from(userIds);

  return targetIds.map((userId) => {
    const profiles = profilesResult.rows.filter((row) => row.user_id === userId);
    const posts = postsResult.rows.filter((row) => row.author_user_id === userId);
    const comments = commentsResult.rows.filter((row) => row.user_id === userId);
    const profile = mergeProfiles(userId, profiles, posts, comments);
    const cutoffValues = [
      ...profiles.map((row) => row.updated_at || row.first_seen_at),
      ...posts.map((row) => row.updated_at || row.collected_at),
      ...comments.map((row) => row.updated_at || row.created_at),
    ].filter(Boolean).map((value) => new Date(value).getTime());

    return {
      scope: { task_id: taskId || null, tasks: tasksResult.rows },
      user: profile,
      source_channels: sourceChannelsForRows(tasksResult.rows, [...profiles, ...posts, ...comments]),
      source_sub_channels: sourceSubChannelsForRows([...profiles, ...posts, ...comments]),
      statistics: { post_count: posts.length, comment_count: comments.length },
      posts,
      comments,
      data_cutoff_at: cutoffValues.length ? new Date(Math.max(...cutoffValues)).toISOString() : null,
    };
  });
}

function mergeProfiles(userId, profiles, posts, comments) {
  const latest = [...profiles].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0] || {};
  const author = posts.find((row) => row.author_nickname) || {};
  const commenter = [...comments].reverse().find((row) => row.nickname) || {};
  return {
    user_id: userId,
    nickname: latest.nickname || author.author_nickname || commenter.nickname || userId,
    red_id: latest.red_id || null,
    gender: latest.gender ?? null,
    ip_location: latest.ip_location || commenter.ip_location || author.ip_location || null,
    description: latest.description || null,
    avatar: latest.avatar || null,
    fans_count: latest.fans_count_text || null,
    follows_count: latest.follows_count_text || null,
    liked_and_collected_count: latest.liked_and_collected_count_text || null,
    interactions: latest.interactions || [],
  };
}

async function analyzeUser(userPackage) {
  const baseUrl = (process.env.DEEPSEEK_API_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const startedAt = new Date();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(Math.max(30000, Number(process.env.DEEPSEEK_REQUEST_TIMEOUT_MS || 180000))),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || "deepseek-v4-pro",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildFewShotUser() },
        { role: "assistant", content: buildFewShotAssistant() },
        { role: "user", content: buildUserMessage(userPackage) },
      ],
    }),
  });
  const payload = await response.json();
  const durationMs = new Date() - startedAt;
  if (!response.ok) throw new Error(payload?.error?.message || `DeepSeek API ${response.status}`);
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek 未返回评级内容");
  const parsed = parseJsonContent(content);
  return {
    analysis: validateAnalysis(parsed),
    usage: payload.usage ? {
      prompt_tokens: payload.usage.prompt_tokens ?? 0,
      completion_tokens: payload.usage.completion_tokens ?? 0,
      total_tokens: payload.usage.total_tokens ?? 0,
    } : null,
    duration_ms: durationMs,
  };
}

function buildSystemPrompt() {
  return `你是汽车行业的潜客线索挖掘专家。你会收到某一个用户的完整资料、全部已采集帖子和全部已采集评论。
基于用户的帖子内容、评论内容、主页简介，从语义层面综合分析用户的身份和意向。

【第一步：用户类型判定 —— 从原始数据判断用户是否已拥有车辆】
user_type 是你从用户的帖子、评论、简介中分析出的身份标签，与评级（rating）完全独立。

—— 已购车：用户的数据（帖子/评论/简介）表明 TA 已经拥有一辆车 ——
例1：简介"SU7车主"，帖子是SU7驾驶vlog => 已购车。依据：简介自称车主 + 帖子围绕已购车。
例2："我提车三个月了，分享感受" => 已购车。依据：明确说提车 + 讨论用车。
例3：帖子标题"提车作业：等了两个月终于到了"+照片 => 已购车。依据：提车作业。
例4："我的车开了5000公里，说说优缺点" => 已购车。依据：以车主身份发言。
例5："保养花了800，感觉被坑了" => 已购车。依据：保养是车主行为。
例6："改装分享：加了前铲和尾翼" => 已购车。依据：改装代表已拥有车辆。
例7：帖子标题"SU7用车一年真实体验"，内容为油耗评价 => 已购车。依据：用车一年。
例8："已经入手了，开了两周" => 已购车。依据：已入手 + 开了两周。
例9：简介"已认证车主"，帖子为车辆使用分享 => 已购车。依据：已认证车主。
例10：用户简介"爱分享驾驶日常"，帖子全是沉浸式驾驶视频 + 用车感受 => 已购车。依据：帖子内容全部围绕已购车的驾驶和用车。
例11：用户帖子标题"分享一下SU7的续航"，内容讲充电心得 => 已购车。依据：续航和充电是车主行为。

—— 未拥车：用户的数据中没有已购车证据 ——
例12："SU7和Model 3怎么选？" => 未拥车。依据：在选车比较。
例13："试驾了SU7，加速真猛" => 未拥车。依据：试驾不是已购。
例14："朋友刚提了SU7，我坐了感觉不错" => 未拥车。依据：坐朋友的车。
例15："这车真好看""路上看到好多" => 未拥车。依据：泛泛而谈，无车主证据。
例16："想买但预算不够" => 未拥车。依据：想买表示尚未拥有。
例17："有没有推荐20万左右的电车？" => 未拥车。依据：在寻求购车建议。
例18：只发了表情或"好""嗯" => 未拥车。依据：无有效语义。
例19：帖子全是转发内容 => 未拥车。依据：无原创用车内容。
例20："这个月刚定车，到时候交作业" => 未拥车。依据：定车尚未提车，未拥车。

⚠️ 关键区分 —— user_type 和 rating 是独立的两个维度：
- user_type=已购车 + rating=low：车主分享用车日常，但没有新购车/置换需求（最常见）
- user_type=已购车 + rating=high：车主有明确的置换或增购需求
- user_type=未拥车 + rating=high：观望用户有明确的购车意向
- user_type=未拥车 + rating=low：纯粹看热闹，无购车意向

⚠️ 注意：判断 user_type 只看用户的帖子、评论、简介这些原始数据，不能从自己输出的 evidence 或 summary 来推断。如果你能在用户的原始数据中找到车主证据，user_type 必须是"已购车"。

【第二步：评级规则（购买意向强度，与用户类型无关）】
- **none**：用户内容无价值——仅表情包、灌水、无语义内容。一旦判定 none，所有字段用默认空值。
- high：存在强烈、可执行的购车/置换/增购/转介绍意向。
- medium：存在购车意向但对比竞品、信息不完整。
- low：无购车/置换/增购/转介绍意向；泛泛讨论、玩梗、纯车主用车分享。

【第三步：输出格式（严格 JSON）】
基于原始数据分析，不得虚构。summary 用一段话概括分析结论。sales_strategy 只放核心话术，无需求时可简化。

{
  "rating": "high|medium|low|none",
  "confidence": 0到1,
  "has_purchase_intent": true或false,
  "user_type": "已购车" 或 "未拥车",
  "intent_types": ["购车|置换|配附件增购|转介绍|已购车"],
  "concerns": ["关注点"],
  "brands": ["品牌"],
  "car_series": ["车系"],
  "competitors": ["竞品品牌或车系"],
  "summary": "分析结论（不能为空）",
  "evidence": [{"type":"post|comment|profile","id":"数据ID","quote":"原文证据","reason":"判断依据"}],
  "sales_strategy": {"contact_angle":"建联切入点","key_points":["沟通重点"],"suggested_message":"建议话术","avoid":["应避免事项"]},
  "dealer_recommendation": {"ip_location":"用户IP属地","store_name":null,"recommendation_basis":"推荐依据"}
}

user_type 输出规则：
- 已购车时 intent_types 必须包含"已购车"。如有置换/增购/转介绍也一并列出。
- sales_strategy 按场景输出：
  A（已购车+无衍生需求）：contact_angle="用户已购车，暂无购车需求", key_points=["已购车主"], suggested_message 说明已购车、无需求，可关注后续用车咨询
  B（已购车+有置换/增购/转介绍需求）：说明已购车但有衍生需求及建议
  C（未拥车+有购车意向）：正常购车策略
  D（未拥车+无购车意向）：说明暂无购车意向，建议保持观察`;
}

// 给模型一个完整示例：已购车但无购车意向（低意向车主）
function buildFewShotUser() {
  return `以下是一个示例用户数据，帮助你理解如何输出正确字段：

用户简介："SU7车主｜爱开车｜分享日常"
帖子：[{"title":"分享SU7驾驶日常vlog，沉浸式体验","content":"今天天气不错，开着SU7出去兜风，分享一下驾驶感受...","publish_time":"2026-05-15"}]
评论：[{"content":"这车真不错啊","comment_time":"2026-05-20"},{"content":"SU7续航怎么样？车主来说说","comment_time":"2026-05-18"}]

请根据以上数据输出 JSON。`;
}

// 模型应该输出的正确答案（已购车 + 低意向）
function buildFewShotAssistant() {
  return JSON.stringify({
    rating: "low",
    confidence: 0.85,
    has_purchase_intent: false,
    user_type: "已购车",
    intent_types: ["已购车"],
    concerns: ["用车体验", "续航"],
    brands: ["小米"],
    car_series: ["SU7"],
    competitors: [],
    summary: "用户为SU7车主，主要分享驾驶vlog和日常用车感受，评论为泛泛点赞和车主交流，无任何新增购车、置换、增购或转介绍意向。",
    evidence: [
      { type: "profile", id: "profile", quote: "SU7车主｜爱开车｜分享日常", reason: "简介自称为SU7车主" },
      { type: "post", id: "post-1", quote: "分享SU7驾驶日常vlog", reason: "帖子围绕已购SU7的驾驶分享" },
    ],
    sales_strategy: {
      contact_angle: "用户已购车，暂无购车需求",
      key_points: ["已购车主，关注用车体验"],
      suggested_message: "用户为SU7车主，暂无购车及衍生需求，可关注后续用车咨询或置换意向。",
      avoid: ["强行推荐购车"],
    },
    dealer_recommendation: { ip_location: "未知", store_name: null, recommendation_basis: "用户为已购车主，暂无需推荐经销商" },
  });
}

function buildUserMessage(userPackage) {
  return `现在请评价以下真实用户的完整采集数据。严格按示例格式输出 JSON，不得遗漏字段。\n${JSON.stringify(userPackage)}`;
}

function parseJsonContent(content) {
  const normalized = content.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(normalized);
}

function validateAnalysis(value) {
  if (!value || !["high", "medium", "low", "none"].includes(value.rating)) throw new Error("模型返回了无效线索评级");

  // 无价值内容：强制所有字段为默认空值
  if (value.rating === "none") {
    return {
      rating: "none",
      confidence: 0,
      has_purchase_intent: false,
      user_type: "未拥车",
      intent_types: [],
      concerns: [],
      brands: [],
      car_series: [],
      competitors: [],
      summary: "无价值内容：该用户内容均为表情包、无意义灌水或无可分析语义，无需跟进。",
      evidence: [],
      sales_strategy: {
        contact_angle: "",
        key_points: [],
        suggested_message: "用户内容无价值，无需建联。",
        avoid: [],
      },
      dealer_recommendation: {},
      raw: value,
    };
  }

  // user_type：信任模型的语义分析结果，仅在不合法值时兜底
  const userType = ["已购车", "未拥车"].includes(value.user_type) ? value.user_type : "未拥车";

  return {
    rating: value.rating,
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)),
    has_purchase_intent: Boolean(value.has_purchase_intent),
    user_type: userType,
    intent_types: toStringArray(value.intent_types),
    concerns: toStringArray(value.concerns),
    brands: toStringArray(value.brands),
    car_series: toStringArray(value.car_series),
    competitors: toStringArray(value.competitors),
    summary: String(value.summary || "暂无评级结论"),
    evidence: Array.isArray(value.evidence) ? value.evidence : [],
    sales_strategy: value.sales_strategy && typeof value.sales_strategy === "object" ? value.sales_strategy : {},
    dealer_recommendation: value.dealer_recommendation && typeof value.dealer_recommendation === "object" ? value.dealer_recommendation : {},
    raw: value,
  };
}

async function saveAnalysisResult(pool, job, userPackage, analysis) {
  const rawInput = JSON.stringify(userPackage);
  const rawOutput = JSON.stringify(analysis.raw);
  const llmOriginLog = JSON.stringify({ input: userPackage, output: analysis.raw });
  const result = await pool.query(
    `INSERT INTO open_clue_analysis_result (
       job_id, scope_task_id, user_id, nickname, ip_location, rating, confidence,
       has_purchase_intent, user_type, intent_types, concerns, brands, car_series, competitors,
       summary, evidence, sales_strategy, dealer_recommendation, data_cutoff_at,
       post_count, comment_count, model, prompt_version, input_hash, raw_input, raw_output, llm_origin_log
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb,
       $13::jsonb, $14::jsonb, $15, $16::jsonb, $17::jsonb, $18::jsonb, $19,
       $20, $21, $22, $23, $24, $25::jsonb, $26::jsonb, $27::jsonb
     )
     RETURNING id`,
    [
      job.id, job.scope_task_id, userPackage.user.user_id, userPackage.user.nickname,
      userPackage.user.ip_location, analysis.rating, analysis.confidence,
      analysis.has_purchase_intent, analysis.user_type, JSON.stringify(analysis.intent_types), JSON.stringify(analysis.concerns),
      JSON.stringify(analysis.brands), JSON.stringify(analysis.car_series), JSON.stringify(analysis.competitors),
      analysis.summary, JSON.stringify(analysis.evidence), JSON.stringify(analysis.sales_strategy),
      JSON.stringify(analysis.dealer_recommendation), userPackage.data_cutoff_at,
      userPackage.statistics.post_count, userPackage.statistics.comment_count,
      job.model, PROMPT_VERSION, createHash("sha256").update(rawInput).digest("hex"), rawInput,
      rawOutput, llmOriginLog,
    ],
  );
  await syncIncubationLead(pool, userPackage.user.user_id, result.rows[0]?.id);
}

async function updateJobProgress(pool, jobId, success, nickname, error) {
  const message = success ? `已完成 ${nickname} 的线索评级` : `${nickname} 评级失败`;
  await pool.query(
    `UPDATE open_clue_analysis_job
     SET completed_users = completed_users + $2,
         failed_users = failed_users + $3,
         message = $4,
         error_message = CASE WHEN $3 = 1 THEN $5 ELSE error_message END,
         updated_at = now()
     WHERE id = $1`,
    [jobId, success ? 1 : 0, success ? 0 : 1, message, error ? errorToMessage(error) : null],
  );
}

// 保存单次 LLM 调用指标（token 消耗 + 耗时）
async function saveLlmMetric(pool, jobId, userId, model, usage, durationMs) {
  if (!usage) return;
  await pool.query(
    `INSERT INTO open_clue_analysis_metric (job_id, user_id, model, prompt_tokens, completion_tokens, total_tokens, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [jobId, userId, model, usage.prompt_tokens, usage.completion_tokens, usage.total_tokens, durationMs],
  );
}

export async function getLlmMetrics(pool) {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM(prompt_tokens), 0)::int AS total_prompt_tokens,
       COALESCE(SUM(completion_tokens), 0)::int AS total_completion_tokens,
       COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
       COUNT(*)::int AS call_count,
       COALESCE(ROUND(AVG(duration_ms)), 0)::int AS avg_duration_ms,
       COALESCE(MIN(duration_ms), 0)::int AS min_duration_ms,
       COALESCE(MAX(duration_ms), 0)::int AS max_duration_ms
     FROM open_clue_analysis_metric`,
  );
  const row = result.rows[0] || {};
  return {
    totalPromptTokens: row.total_prompt_tokens || 0,
    totalCompletionTokens: row.total_completion_tokens || 0,
    totalTokens: row.total_tokens || 0,
    callCount: row.call_count || 0,
    avgDurationMs: row.avg_duration_ms || 0,
    minDurationMs: row.min_duration_ms || 0,
    maxDurationMs: row.max_duration_ms || 0,
  };
}

async function markJobFailed(pool, jobId, error) {
  await pool.query(
    `UPDATE open_clue_analysis_job SET status = 'failed', message = '评级任务失败',
     error_message = $2, finished_at = now(), updated_at = now() WHERE id = $1`,
    [jobId, errorToMessage(error)],
  );
}

function mapJob(row) {
  const processed = row.completed_users + row.failed_users;
  return {
    id: row.id,
    taskId: row.scope_task_id,
    status: row.status,
    totalUsers: row.total_users,
    completedUsers: row.completed_users,
    failedUsers: row.failed_users,
    processedUsers: processed,
    progress: row.total_users ? Math.round((processed / row.total_users) * 100) : 0,
    model: row.model,
    message: row.message,
    error: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function mapResult(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    taskId: row.scope_task_id,
    userId: row.user_id,
    nickname: row.nickname,
    ipLocation: row.display_ip_location || row.ip_location,
    redId: row.red_id || null,
    desc: row.description || null,
    avatar: row.avatar || null,
    sourceChannels: row.source_channels || [],
    sourceSubChannels: row.source_sub_channels || [],
    rating: row.rating,
    confidence: row.confidence,
    hasPurchaseIntent: row.has_purchase_intent,
    userType: row.user_type || "未拥车",
    intentTypes: row.intent_types || [],
    concerns: row.concerns || [],
    brands: row.brands || [],
    carSeries: row.car_series || [],
    competitors: row.competitors || [],
    summary: row.summary,
    evidence: row.evidence || [],
    salesStrategy: row.sales_strategy || {},
    dealerRecommendation: row.dealer_recommendation || {},
    llmOriginLog: row.llm_origin_log || {},
    dataCutoffAt: row.data_cutoff_at,
    postCount: row.post_count,
    commentCount: row.comment_count,
    model: row.model,
    promptVersion: row.prompt_version,
    createdAt: row.created_at,
    followUp: mapFollowUp(row),
  };
}

async function syncIncubationLead(pool, userId, resultId = null) {
  if (!userId) return;
  const latestResult = resultId
    ? { rows: [{ id: resultId }], rowCount: 1 }
    : await pool.query(
      `SELECT id FROM open_clue_analysis_result
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId],
    );
  if (!latestResult.rowCount) return;

  await pool.query(
    `INSERT INTO open_incubation_lead (user_id, latest_result_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE
     SET latest_result_id = EXCLUDED.latest_result_id,
         updated_at = CASE
           WHEN open_incubation_lead.latest_result_id IS DISTINCT FROM EXCLUDED.latest_result_id THEN now()
           ELSE open_incubation_lead.updated_at
         END`,
    [userId, latestResult.rows[0].id],
  );
}

function mapFollowUp(row = {}) {
  return {
    status: row.lead_status || "new",
    statusLabel: leadStatusLabel(row.lead_status || "new"),
    replyCount: Number(row.reply_count || 0),
    hasReplied: Boolean(row.has_replied),
    converted: Boolean(row.converted),
    lastFollowedAt: row.last_followed_at || null,
    nextFollowAt: row.next_follow_at || null,
    owner: row.owner || null,
    note: row.note || null,
    createdAt: row.lead_created_at || null,
    updatedAt: row.lead_updated_at || null,
  };
}

function defaultFollowUp() {
  return mapFollowUp({});
}

function normalizeLeadStatus(status, { fallback = "new", replyCount = 0, hasReplied = false, converted = false } = {}) {
  const normalized = typeof status === "string" ? status.trim() : "";
  const alias = {
    new: "new",
    未跟进: "new",
    following: "following",
    跟进中: "following",
    replied: "replied",
    已回复: "replied",
    converted: "converted",
    已成交: "converted",
    lost: "lost",
    已流失: "lost",
  };
  const value = alias[normalized] || normalized;
  if (["new", "following", "replied", "converted", "lost"].includes(value)) return value;
  if (converted) return "converted";
  if (hasReplied || replyCount > 0) return "replied";
  return ["new", "following", "replied", "converted", "lost"].includes(fallback) ? fallback : "new";
}

function normalizeReplyCount(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return Math.max(0, Number(fallback) || 0);
  return Math.max(0, Math.floor(Number(value) || 0));
}

function normalizeEventType(eventType, status) {
  const value = typeof eventType === "string" ? eventType.trim() : "";
  if (["reply", "call", "wechat", "visit", "converted", "lost", "note", "status"].includes(value)) return value;
  if (status === "converted") return "converted";
  if (status === "lost") return "lost";
  if (status === "replied") return "reply";
  return "status";
}

function leadStatusLabel(status) {
  const map = {
    new: "未跟进",
    following: "跟进中",
    replied: "已回复",
    converted: "已成交",
    lost: "已流失",
  };
  return map[status] || "未跟进";
}

function assertDeepSeekConfig() {
  if (!process.env.DEEPSEEK_API_KEY) {
    const error = new Error("服务端未配置 DEEPSEEK_API_KEY");
    error.statusCode = 503;
    throw error;
  }
}

function toStringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function mapCandidateComment(comment) {
  return {
    taskId: comment.task_id,
    feedId: comment.feed_id,
    commentId: comment.comment_id,
    parentCommentId: comment.parent_comment_id,
    userId: comment.user_id,
    nickname: comment.nickname,
    content: comment.content,
    ipLocation: comment.ip_location,
    createTime: comment.comment_time,
    likeCount: comment.like_count_text,
  };
}

function dateValue(value) {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function errorToMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
