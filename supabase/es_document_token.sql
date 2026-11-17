-- Verification QR tokens for invoices printed from the app (Invoices & quotations screen).
--
-- The public verify page (www.environmsafe.com/verify?t=<token>) looks a token up
-- with es_verify_invoice(). Tokens are minted by es_invoice_token(), which only the
-- service role may call. This wrapper lets a signed-in member who may write to the
-- company's books ask for the token of one of its invoice numbers, and nothing else.
-- It is additive: no table or existing function changes.
--
-- Apply once in the Supabase SQL editor (project mcgjrsfsppdcnvolqsgs).

create or replace function public.es_document_token(p_company uuid, p_invoice_no text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not private.es_can_write(p_company) then
    raise exception 'not allowed to write to this company';
  end if;
  if p_invoice_no is null or p_invoice_no !~ '^[A-Za-z0-9][A-Za-z0-9/_.-]{2,40}$' then
    raise exception 'not an invoice number';
  end if;
  return public.es_invoice_token(p_company, p_invoice_no);
end;
$$;

revoke all on function public.es_document_token(uuid, text) from public, anon;
grant execute on function public.es_document_token(uuid, text) to authenticated;
