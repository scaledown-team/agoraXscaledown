# Agora × ScaleDown : Real-Time Voice AI with Context Compression



This is a live proof-of-concept built for Agora: a real-time voice AI demo where ScaleDown compresses the growing conversation history before every LLM call, proving flat token usage vs. the linear growth that happens today.

---

## What This Demo Proves

In a standard voice AI conversation, the context window grows with every turn:

```
Turn 1:  ~200 tokens  →  LLM call
Turn 2:  ~400 tokens  →  LLM call
Turn 3:  ~600 tokens  →  LLM call
Turn N:  ~N×200 tokens → LLM call   ← this is your cost
```

With ScaleDown:

```
Turn 1:  ~200 tokens  →  compress  →  ~140 tokens  →  LLM call
Turn 2:  ~400 tokens  →  compress  →  ~200 tokens  →  LLM call
Turn 3:  ~600 tokens  →  compress  →  ~260 tokens  →  LLM call
Turn N:  flat growth, not linear   ← this is your cost with ScaleDown
```

The dashboard shows this compression happening **live**, turn by turn, with real token counts.

---

## Architecture

```
User (microphone)
      │
      ▼
  Agora RTC  ──────────────────────────────────────┐
      │                                             │
  Deepgram ASR (speech → text)                     │
      │                                             │
  Agora Conversational AI Agent                    │
      │                                             │
      │  POST /api/llm-proxy  (OpenAI-compatible)  │
      ▼                                             │
  ┌─────────────────────────────────────┐          │
  │         ScaleDown LLM Proxy         │          │
  │                                     │          │
  │  1. Receive messages[]              │          │
  │  2. POST → ScaleDown /compress/raw/ │          │
  │  3. Log trace to Supabase           │          │
  │  4. Forward compressed → Groq       │          │
  └─────────────────────────────────────┘          │
      │                                             │
  Groq (Llama 3.3 70B) → response                  │
      │                                             │
  Cartesia TTS (text → speech)                     │
      │                                             │
  Agora RTC  ◄─────────────────────────────────────┘
      │
      ▼
  User (speaker)
```

ScaleDown sits invisibly between Agora's agent and the LLM. Agora sees it as a standard OpenAI-compatible endpoint. The compression is transparent to everything else in the pipeline.

---
---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Voice transport | [Agora RTC](https://www.agora.io) |
| Speech-to-text | [Deepgram](https://deepgram.com) Nova-2 |
| Context compression | [ScaleDown](https://scaledown.xyz) `/compress/raw/` |
| LLM | [Groq](https://groq.com) · Llama 3.3 70B |
| Text-to-speech | [Cartesia](https://cartesia.ai) |
| Frontend | Next.js 14 · React · Tailwind CSS |
| Persistence | [Supabase](https://supabase.com) (PostgreSQL) |
| Deployment | Vercel + ngrok (for Agora agent callback) |

---

## Getting Started

### Prerequisites

- Node.js 18+
- [ngrok](https://ngrok.com) account (free tier works)
- API keys for: Agora, Deepgram, ScaleDown, Groq, Cartesia, Supabase

### 1. Clone and install

```bash
git clone https://github.com/your-org/agora-x-scaledown.git
cd agora-x-scaledown
npm install
```

### 2. Configure environment

Create `.env.local` in the project root:

```env
# Agora
AGORA_APP_ID=your_agora_app_id
AGORA_APP_CERTIFICATE=your_agora_app_certificate
AGORA_CUSTOMER_ID=your_agora_customer_id
AGORA_CUSTOMER_SECRET=your_agora_customer_secret
AGORA_BASE_URL=https://api.agora.io

# Deepgram (ASR)
DEEPGRAM_API_KEY=your_deepgram_key

# ScaleDown
SCALEDOWN_API_KEY=your_scaledown_key
SCALEDOWN_API_URL=https://api.scaledown.xyz

# Groq (LLM)
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=your_groq_key
LLM_MODEL=llama-3.3-70b-versatile

# Cartesia (TTS)
CARTESIA_API_KEY=your_cartesia_key
CARTESIA_VOICE_ID=your_voice_id

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Proxy (set to your ngrok URL once running)
PROXY_BASE_URL=https://your-ngrok-url.ngrok-free.app
```

### 3. Set up Supabase

Run the following in your Supabase SQL editor:

```sql
create table conversations (
  id uuid default gen_random_uuid() primary key,
  label text,
  mode text,
  created_at timestamptz default now()
);

create table trace_events (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references conversations(id),
  turn integer,
  original_tokens integer,
  compressed_tokens integer,
  compression_ratio float,
  latency_ms integer,
  baseline_mode boolean default false,
  model text,
  created_at timestamptz default now()
);
```

### 4. Start the dev server

```bash
npm run dev
```

### 5. Expose to Agora with ngrok

In a separate terminal:

```bash
ngrok http 3000
```

Copy the `https://` URL into your `.env.local` as `PROXY_BASE_URL`, then restart the dev server.

### 6. Talk

Open [http://localhost:3000](http://localhost:3000), click **Start Conversation**, and start speaking. The compression metrics update live with every turn.

---

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── setup-conversation/   # Generates Agora tokens
│   │   ├── join-conversation/    # Starts Agora AI agent, creates Supabase record
│   │   ├── leave-agent/          # Stops the AI agent
│   │   ├── llm-proxy/            # ← ScaleDown integration point
│   │   ├── conversations/        # Lists all past conversations
│   │   └── traces/               # Returns turn-by-turn trace data
│   └── page.tsx                  # Main dashboard UI
├── hooks/
│   └── useConversation.ts        # Agora RTC + agent lifecycle
└── lib/
    ├── scaledown.ts              # ScaleDown compress API wrapper
    ├── tracing.ts                # Supabase trace logging
    ├── supabase.ts               # Supabase client
    └── utils.ts                  # Token estimation helpers
```

---

## Built by

[ScaleDown AI](https://scaledown.xyz) — context compression for production LLM applications.

---
