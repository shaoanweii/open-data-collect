// 检查 PG 数据库所有表的数据
import pg from "pg";

const pool = new pg.Pool({ connectionString: "postgres://postgres:light%230000ffs@118.196.53.239:5432/open_data_collect" });

async function main() {
  // 行数
  const tbls = ["open_collection_task","open_task_item","open_post","open_comment","open_user_profile","open_query_log","open_raw_api_payload"];
  console.log("=== 各表行数 ===");
  for (const t of tbls) {
    const r = await pool.query("SELECT count(*) as c FROM " + t);
    console.log("  " + t + ": " + r.rows[0].c);
  }

  // 任务
  console.log("\n=== open_collection_task ===");
  const tasks = await pool.query("SELECT id, keyword, channel, status, total_count, completed_count, failed_count, message FROM open_collection_task ORDER BY created_at");
  for (const t of tasks.rows) {
    console.log("  [%s] %s | %s | %s | total=%d done=%d fail=%d | %s",
      t.id.slice(-12), t.keyword, t.channel, t.status, t.total_count, t.completed_count, t.failed_count, t.message);
  }

  // task_item
  console.log("\n=== open_task_item ===");
  const items = await pool.query("SELECT task_id, feed_id, title, status FROM open_task_item ORDER BY created_at");
  for (const i of items.rows) {
    console.log("  task=%s feed=%s | %s | %s", i.task_id.slice(-12), i.feed_id.slice(-8), (i.title||"(none)").slice(0,25), i.status);
  }

  // post
  console.log("\n=== open_post ===");
  const posts = await pool.query("SELECT task_id, feed_id, title, collect_status, author_nickname FROM open_post ORDER BY created_at");
  for (const p of posts.rows) {
    console.log("  task=%s feed=%s | %s | %s | %s", p.task_id.slice(-12), p.feed_id.slice(-8), (p.title||"(none)").slice(0,25), p.collect_status, p.author_nickname || "");
  }

  // comment
  console.log("\n=== open_comment ===");
  const cmts = await pool.query("SELECT task_id, feed_id, comment_id, comment_level, nickname, user_id FROM open_comment ORDER BY created_at");
  for (const c of cmts.rows) {
    console.log("  task=%s feed=%s L%d | %s | uid=%s", c.task_id.slice(-12), c.feed_id.slice(-8), c.comment_level, c.nickname, (c.user_id||"").slice(-8));
  }

  // user_profile
  console.log("\n=== open_user_profile ===");
  const users = await pool.query("SELECT task_id, user_id, nickname, fans_count_text FROM open_user_profile ORDER BY first_seen_at");
  for (const u of users.rows) {
    console.log("  task=%s uid=%s | %s | fans=%s", (u.task_id||"NULL").slice(-12), u.user_id.slice(-8), u.nickname, u.fans_count_text||"0");
  }

  await pool.end();
}

main().catch(console.error);
