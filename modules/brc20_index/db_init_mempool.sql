
CREATE TABLE IF NOT EXISTS public.brc20_mempool_timestamp (
    key text PRIMARY KEY,              -- e.g., always 'latest'
    latest_timestamp timestamptz NOT NULL
);

-- for mempool tracking
CREATE TABLE IF NOT EXISTS public.brc20_mempool_events (
	id bigserial NOT NULL,
	txid text NOT NULL,
	event_type int4 NOT NULL,
	block_height int4 NOT NULL,
	"event" jsonb NOT NULL,
	old_satpoint text NOT NULL,
	new_pkScript text NOT NULL,
	new_addr text NOT NULL,
	sent_as_fee boolean NOT NULL,
	content_type text NOT NULL,
	parent_id text NOT NULL,
	blocks_to_confirm int4 NOT NULL, -- when its likely to confirm based on current fee rates of all txns in the mempool
	seen_at timestamptz NOT NULL,
	CONSTRAINT brc20_mempool_events_id PRIMARY KEY (id),
	CONSTRAINT brc20_mempool_events_txid_event_type_key UNIQUE (txid, event_type)
);

CREATE INDEX brc20_mempool_events_txid_idx ON public.brc20_mempool_events USING btree (txid);
CREATE INDEX brc20_mempool_events_block_height_idx ON public.brc20_mempool_events USING btree (block_height);
CREATE INDEX brc20_mempool_events_event_type_idx ON public.brc20_mempool_events USING btree (event_type);
CREATE INDEX brc20_mempool_events_addr_idx ON public.brc20_mempool_events USING btree (new_addr);
CREATE INDEX brc20_mempool_events_seen_at_idx 
  ON public.brc20_mempool_events USING btree (seen_at);
CREATE INDEX brc20_mempool_events_event_gin_idx 
  ON public.brc20_mempool_events USING gin ("event");
CREATE INDEX brc20_mempool_events_event_tick_lower_idx 
  ON public.brc20_mempool_events USING btree (lower("event"->>'tick'));
CREATE INDEX brc20_mempool_events_tick_block_height_idx 
  ON public.brc20_mempool_events USING btree (lower("event"->>'tick'), block_height);
CREATE INDEX brc20_events_event_type_tick_block_height_idx
  ON brc20_events (event_type, block_height, (event->>'tick'::text));
CREATE INDEX brc20_mempool_events_event_type_block_height_tick_lower_idx
  ON brc20_mempool_events (event_type, block_height, lower(event->>'tick'));

