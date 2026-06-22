-- open_clue_analysis_job
create table if not exists open_clue_analysis_job (
  id uuid primary key default gen_random_uuid(),
  scope_task_id text references open_collection_task(id) on delete set null,
  requested_user_ids jsonb not null default '[]'::jsonb,
  total_users integer not null default 0,
  completed_users integer not null default 0,
  failed_users integer not null default 0,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  model text not null default 'deepseek-v4-pro',
  prompt_version text not null default 'v2.0',
  message text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- open_clue_analysis_result
create table if not exists open_clue_analysis_result (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references open_clue_analysis_job(id) on delete cascade,
  scope_task_id text references open_collection_task(id) on delete set null,
  user_id text not null,
  nickname text,
  ip_location text,
  rating text not null check (rating in ('high', 'medium', 'low', 'none')),
  confidence numeric(5,4) not null default 0,
  has_purchase_intent boolean not null default false,
  user_type text not null default '未拥车',
  intent_types jsonb not null default '[]'::jsonb,
  concerns jsonb not null default '[]'::jsonb,
  brands jsonb not null default '[]'::jsonb,
  car_series jsonb not null default '[]'::jsonb,
  competitors jsonb not null default '[]'::jsonb,
  summary text not null,
  evidence jsonb not null default '[]'::jsonb,
  sales_strategy jsonb not null default '{}'::jsonb,
  dealer_recommendation jsonb not null default '{}'::jsonb,
  data_cutoff_at timestamptz,
  post_count integer not null default 0,
  comment_count integer not null default 0,
  model text not null,
  prompt_version text not null,
  input_hash text not null,
  raw_input jsonb not null,
  raw_output jsonb not null,
  llm_origin_log jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- LLM 调用指标表（token 消耗、耗时）
create table if not exists open_clue_analysis_metric (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references open_clue_analysis_job(id) on delete cascade,
  user_id text not null,
  model text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  duration_ms integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_clue_metric_job on open_clue_analysis_metric(job_id);
create index if not exists idx_clue_metric_created on open_clue_analysis_metric(created_at desc);

create index if not exists idx_open_clue_job_status on open_clue_analysis_job(status, created_at desc);
create index if not exists idx_open_clue_result_user on open_clue_analysis_result(user_id, created_at desc);
create index if not exists idx_open_clue_result_scope on open_clue_analysis_result(scope_task_id, created_at desc);

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

drop trigger if exists set_open_clue_analysis_job_updated_at on open_clue_analysis_job;
create trigger set_open_clue_analysis_job_updated_at
  before update on open_clue_analysis_job
  for each row execute function set_updated_at();
