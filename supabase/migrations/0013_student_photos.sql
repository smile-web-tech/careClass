-- Where a student's picture lives on the server.
--
-- The file itself goes in the `attachments` bucket under the teacher's own
-- folder, which already has the right storage policy: the first path segment
-- is the owner, and nobody can read another teacher's prefix.
--
-- Only the path is stored, never a URL. URLs from that bucket are signed and
-- expire, so a column holding one would be a column full of dead links within
-- the hour. The app signs at the moment it displays.
-- Not `photo_url`, which has sat unused on this table since migration 0001.
-- That column's name promises a URL, and a URL into a private bucket expires
-- within the hour, so it would be a column full of dead links.
alter table students add column if not exists photo_path text;

comment on column students.photo_path is
  'Object key in the attachments bucket, `<teacher_id>/students/<student_id>.jpg`. '
  'Null when the student has no picture. The device keeps its own copy in the '
  'app folder and works from that offline.';
