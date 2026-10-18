-- Ranking do EMOJI SNAKE (separado do Quica). Rode no SQL Editor do Supabase.
create table if not exists public.snake_scores(
  player_hash text primary key, nickname text not null, emoji text not null,
  best_score int not null default 0 check (best_score between 0 and 1000000),
  best_len int not null default 0, updated_at timestamptz not null default now());
create index if not exists snake_scores_rank on public.snake_scores(best_score desc);
alter table public.snake_scores enable row level security;
revoke all on public.snake_scores from anon, authenticated;
create or replace function public.snake_submit(p_hash text,p_nick text,p_emoji text,p_score int,p_len int)
returns void language sql security definer set search_path = public as $$
  insert into snake_scores(player_hash,nickname,emoji,best_score,best_len) values(p_hash,p_nick,p_emoji,p_score,p_len)
  on conflict (player_hash) do update set nickname=excluded.nickname, emoji=excluded.emoji,
    best_score=greatest(snake_scores.best_score,excluded.best_score), best_len=greatest(snake_scores.best_len,excluded.best_len), updated_at=now(); $$;
revoke all on function public.snake_submit(text,text,text,int,int) from public, anon, authenticated;
grant execute on function public.snake_submit(text,text,text,int,int) to service_role;
