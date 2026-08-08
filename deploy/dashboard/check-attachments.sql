-- Did the last assignment actually carry its file?
--
-- Paste into the Supabase SQL Editor and run. Three rows come back, and
-- between them they say which half of the pipeline dropped the attachment.

-- 1. The last five messages, and whether the server recorded any file on them.
select
  m.sent_at,
  m.is_assignment,
  m.channels,
  left(m.body, 40) as body,
  (select count(*) from message_attachments a where a.message_id = m.id) as files,
  (select count(*) from message_deliveries d where d.message_id = m.id) as deliveries
from messages m
order by m.sent_at desc
limit 5;

-- 2. The attachment rows themselves, if any.
select filename, mime_type, size_bytes, storage_path, created_at
from message_attachments
order by created_at desc
limit 5;

-- 3. What is actually sitting in the bucket.
select name, (metadata ->> 'size')::bigint as bytes, metadata ->> 'mimetype' as mime, created_at
from storage.objects
where bucket_id = 'attachments'
order by created_at desc
limit 5;
