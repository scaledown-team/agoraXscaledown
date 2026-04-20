-- ============================================================
-- Agora x ScaleDown — Database Migrations
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Phase 0: Initial schema
create table if not exists conversations (
  id uuid default gen_random_uuid() primary key,
  label text,
  mode text,
  created_at timestamptz default now()
);

create table if not exists trace_events (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references conversations(id),
  turn integer,
  original_tokens integer,
  compressed_tokens integer,
  compression_ratio float,
  latency_ms integer,
  groq_latency_ms integer,
  total_latency_ms integer,
  compression_success boolean default true,
  baseline_mode boolean default false,
  model text,
  created_at timestamptz default now()
);

-- Phase 1: Real token counts + cost tracking
ALTER TABLE trace_events
  ADD COLUMN IF NOT EXISTS groq_prompt_tokens integer,
  ADD COLUMN IF NOT EXISTS groq_completion_tokens integer,
  ADD COLUMN IF NOT EXISTS cost_input_usd numeric(10,8),
  ADD COLUMN IF NOT EXISTS cost_output_usd numeric(10,8),
  ADD COLUMN IF NOT EXISTS cost_total_usd numeric(10,8),
  ADD COLUMN IF NOT EXISTS token_source text DEFAULT 'estimate';

-- Phase 2: Quality measurement (shadow baseline + LLM-as-judge)
ALTER TABLE trace_events
  ADD COLUMN IF NOT EXISTS response_text text,
  ADD COLUMN IF NOT EXISTS shadow_response_text text,
  ADD COLUMN IF NOT EXISTS quality_score numeric(4,3);
