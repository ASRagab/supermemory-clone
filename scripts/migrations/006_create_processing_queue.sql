-- Create processing_queue table for async job management
-- TASK-008: Chunking Worker Implementation
-- This table manages the processing pipeline for documents

CREATE TABLE IF NOT EXISTS processing_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  stage VARCHAR(30) NOT NULL DEFAULT 'extraction',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  error TEXT,
  error_code VARCHAR(50),
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  worker_id VARCHAR(100),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  scheduled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Constraints
  CONSTRAINT processing_queue_stage_check
    CHECK (stage IN ('extraction', 'embedding', 'deduplication', 'relationship', 'profile_update', 'cleanup')),
  CONSTRAINT processing_queue_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'retry')),
  CONSTRAINT processing_queue_attempts_check
    CHECK (attempts <= max_attempts)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_processing_queue_document ON processing_queue(document_id);
CREATE INDEX IF NOT EXISTS idx_processing_queue_status ON processing_queue(status) WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS idx_processing_queue_stage ON processing_queue(stage);
CREATE INDEX IF NOT EXISTS idx_processing_queue_worker ON processing_queue(worker_id) WHERE worker_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_processing_queue_priority ON processing_queue(priority DESC, scheduled_at ASC) WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS idx_processing_queue_stale ON processing_queue(started_at) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_processing_queue_worker_select ON processing_queue(status, stage, priority, scheduled_at) WHERE status IN ('pending', 'retry');

COMMENT ON TABLE processing_queue IS 'Manages async processing pipeline for documents';
COMMENT ON COLUMN processing_queue.stage IS 'Processing stage: extraction, embedding, deduplication, relationship, profile_update, cleanup';
COMMENT ON COLUMN processing_queue.status IS 'Job status: pending, processing, completed, failed, cancelled, retry';
COMMENT ON COLUMN processing_queue.priority IS 'Higher values = higher priority';
COMMENT ON COLUMN processing_queue.attempts IS 'Number of processing attempts';
COMMENT ON COLUMN processing_queue.max_attempts IS 'Maximum allowed attempts before marking as failed';
