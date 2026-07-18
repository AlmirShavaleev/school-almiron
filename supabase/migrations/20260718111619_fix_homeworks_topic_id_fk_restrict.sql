ALTER TABLE public.homeworks DROP CONSTRAINT homeworks_topic_id_fkey;
ALTER TABLE public.homeworks ADD CONSTRAINT homeworks_topic_id_fkey
  FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE RESTRICT;
