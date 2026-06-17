-- Database: open_data_collect
-- Table naming: open_* snake_case.

create extension if not exists pgcrypto;

create table if not exists open_collection_task (
  id text primary key,
  keyword text not null,
  channel text not null default '小红书',
  status text not null check (status in ('queued', 'running', 'completed', 'failed', 'paused')),
  message text,
  filters jsonb not null default '{}'::jsonb,
  options jsonb not null default '{}'::jsonb,
  total_count integer not null default 0,
  completed_count integer not null default 0,
  failed_count integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  logs jsonb not null default '[]'::jsonb,
  raw_search jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists open_task_item (
  task_id text not null references open_collection_task(id) on delete cascade,
  feed_id text not null,
  xsec_token text,
  title text,
  author_user_id text,
  author_nickname text,
  status text not null check (status in ('queued', 'fetching', 'completed', 'failed', 'skipped')),
  error_message text,
  search_payload jsonb not null default '{}'::jsonb,
  detail_payload jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (task_id, feed_id)
);

create table if not exists open_post (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references open_collection_task(id) on delete cascade,
  feed_id text not null,
  source_channel text not null default '小红书',
  collect_status text not null default '待采集' check (collect_status in ('成功', '失败', '待采集', '采集中', '跳过')),
  error_message text,
  xsec_token text,
  title text,
  description text,
  note_type text,
  post_url text,
  author_user_id text,
  author_nickname text,
  author_avatar text,
  author_profile_url text,
  liked_count_text text,
  shared_count_text text,
  comment_count_text text,
  collected_count_text text,
  ip_location text,
  publish_time_ms bigint,
  publish_time timestamptz,
  cover_url text,
  image_list jsonb not null default '[]'::jsonb,
  search_payload jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, feed_id)
);

create table if not exists open_comment (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references open_collection_task(id) on delete cascade,
  feed_id text not null,
  comment_id text not null,
  parent_comment_id text,
  comment_level smallint not null default 1 check (comment_level in (1, 2)),
  content text,
  user_id text,
  xsec_token text,
  nickname text,
  avatar text,
  like_count_text text,
  ip_location text,
  comment_time_ms bigint,
  comment_time timestamptz,
  show_tags jsonb not null default '[]'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_open_comment_task_comment_parent
on open_comment (task_id, comment_id, coalesce(parent_comment_id, ''));

create table if not exists open_user_profile (
  id uuid primary key default gen_random_uuid(),
  task_id text references open_collection_task(id) on delete set null,
  user_id text not null,
  source_channel text not null default '小红书',
  nickname text,
  red_id text,
  gender integer,
  ip_location text,
  description text,
  avatar text,
  profile_url text,
  fans_count_text text,
  follows_count_text text,
  liked_and_collected_count_text text,
  interactions jsonb not null default '[]'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, user_id)
);

create table if not exists open_raw_api_payload (
  id uuid primary key default gen_random_uuid(),
  task_id text references open_collection_task(id) on delete cascade,
  feed_id text,
  user_id text,
  endpoint text not null,
  request_payload jsonb,
  response_payload jsonb,
  success boolean not null default true,
  error_message text,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create table if not exists open_query_log (
  id uuid primary key default gen_random_uuid(),
  task_id text references open_collection_task(id) on delete set null,
  keyword text,
  channel text,
  filters jsonb not null default '{}'::jsonb,
  options jsonb not null default '{}'::jsonb,
  result_count integer not null default 0,
  note_count integer not null default 0,
  status text not null,
  error_message text,
  raw_payload jsonb,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_open_collection_task_status on open_collection_task(status);
create index if not exists idx_open_collection_task_keyword on open_collection_task(keyword);
create index if not exists idx_open_collection_task_created_at on open_collection_task(created_at desc);

create index if not exists idx_open_task_item_status on open_task_item(status);
create index if not exists idx_open_task_item_author on open_task_item(author_user_id);

create index if not exists idx_open_post_task_id on open_post(task_id);
create index if not exists idx_open_post_feed_id on open_post(feed_id);
create index if not exists idx_open_post_author_user_id on open_post(author_user_id);
create index if not exists idx_open_post_publish_time on open_post(publish_time desc);
create index if not exists idx_open_post_collect_status on open_post(collect_status);
create index if not exists idx_open_post_source_channel on open_post(source_channel);

create index if not exists idx_open_comment_task_feed on open_comment(task_id, feed_id);
create index if not exists idx_open_comment_user_id on open_comment(user_id);
create index if not exists idx_open_comment_time on open_comment(comment_time desc);

create index if not exists idx_open_user_profile_user_id on open_user_profile(user_id);
create index if not exists idx_open_user_profile_red_id on open_user_profile(red_id);

create index if not exists idx_open_raw_api_payload_task_endpoint on open_raw_api_payload(task_id, endpoint);
create index if not exists idx_open_query_log_keyword on open_query_log(keyword);
create index if not exists idx_open_query_log_created_at on open_query_log(created_at desc);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_open_collection_task_updated_at on open_collection_task;
create trigger set_open_collection_task_updated_at
before update on open_collection_task
for each row execute function set_updated_at();

drop trigger if exists set_open_task_item_updated_at on open_task_item;
create trigger set_open_task_item_updated_at
before update on open_task_item
for each row execute function set_updated_at();

drop trigger if exists set_open_post_updated_at on open_post;
create trigger set_open_post_updated_at
before update on open_post
for each row execute function set_updated_at();

drop trigger if exists set_open_comment_updated_at on open_comment;
create trigger set_open_comment_updated_at
before update on open_comment
for each row execute function set_updated_at();

drop trigger if exists set_open_user_profile_updated_at on open_user_profile;
create trigger set_open_user_profile_updated_at
before update on open_user_profile
for each row execute function set_updated_at();
