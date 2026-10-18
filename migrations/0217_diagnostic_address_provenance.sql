-- Additive future-write correction. Do not rewrite historical observations.
-- Authority still belongs to the existing ingest function/trusted server metadata.
CREATE FUNCTION public.diagnostic_address_provenance() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  NEW.address_provenance := CASE WHEN NEW.ip_address IS NULL
    THEN 'server_unresolved' ELSE 'server_resolved' END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER diagnostic_address_provenance
BEFORE INSERT OR UPDATE OF ip_address,address_provenance ON public.product_analytics_events
FOR EACH ROW EXECUTE FUNCTION public.diagnostic_address_provenance();

CREATE TRIGGER diagnostic_address_provenance
BEFORE INSERT OR UPDATE OF ip_address,address_provenance ON public.analytics_operation_receipts
FOR EACH ROW EXECUTE FUNCTION public.diagnostic_address_provenance();
