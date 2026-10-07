-- Применено оркестратором через MCP apply_migration 06.10.2026 (версия 20261006202206).
-- Ответы с «−» (U+2212), «–», «—» и неразрывным пробелом нормализуются как обычный минус/пробел.
CREATE OR REPLACE FUNCTION public.normalize_variant_answer(raw text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
 SET search_path TO 'public'
AS $function$
  SELECT lower(
    btrim(
      regexp_replace(
        replace(translate(raw, E'−–— ', '--- '), ',', '.'),
        '\s+', ' ', 'g'
      )
    )
  );
$function$;
