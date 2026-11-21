-- Expand accepted attachment formats while retaining all existing format checks.
ALTER TABLE public.ai_attachment_uploads DROP CONSTRAINT ai_attachment_format_v2;
ALTER TABLE public.ai_attachment_uploads ADD CONSTRAINT ai_attachment_format_v3 CHECK (
  (kind = 'image' AND extension IN ('png','jpg','webp') AND extracted_text IS NULL
   AND media_type = CASE extension WHEN 'png' THEN 'image/png' WHEN 'jpg' THEN 'image/jpeg' ELSE 'image/webp' END)
  OR (kind = 'text' AND size_bytes <= 524288 AND width IS NULL AND height IS NULL
      AND extension IN ('csv','txt','md','markdown','js','jsx','ts','tsx','py','c','cpp','h','hpp','ino','json','css','html','xml','yaml','yml','sql','sh','java','rs','go')
      AND media_type = CASE WHEN extension = 'csv' THEN 'text/csv'
                            WHEN extension IN ('md','markdown') THEN 'text/markdown'
                            ELSE 'text/plain' END)
  OR (kind = 'text' AND extension IN ('pdf','docx','xlsx') AND width IS NULL AND height IS NULL
      AND media_type = CASE extension WHEN 'pdf' THEN 'application/pdf'
                                     WHEN 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                                     ELSE 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' END)
);
