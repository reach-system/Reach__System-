DO $$
DECLARE
  sequence_record RECORD;
  max_id BIGINT;
BEGIN
  FOR sequence_record IN
    SELECT
      columns.table_schema,
      columns.table_name,
      columns.column_name,
      pg_get_serial_sequence(
        format('%I.%I', columns.table_schema, columns.table_name),
        columns.column_name
      ) AS sequence_name
    FROM information_schema.columns AS columns
    WHERE columns.table_schema = 'public'
      AND (
        columns.is_identity = 'YES'
        OR columns.column_default LIKE 'nextval(%'
      )
  LOOP
    IF sequence_record.sequence_name IS NULL THEN
      RAISE EXCEPTION 'Could not identify the owned sequence for %.%.%',
        sequence_record.table_schema,
        sequence_record.table_name,
        sequence_record.column_name;
    END IF;

    EXECUTE format(
      'SELECT MAX(%I)::bigint FROM %I.%I',
      sequence_record.column_name,
      sequence_record.table_schema,
      sequence_record.table_name
    ) INTO max_id;

    PERFORM setval(
      sequence_record.sequence_name::regclass,
      GREATEST(COALESCE(max_id, 1), 1),
      max_id IS NOT NULL
    );
  END LOOP;
END
$$;

INSERT INTO public."InvoiceSequence" ("id", "currentNumber")
SELECT
  1,
  COALESCE(MAX(substring("invoiceNumber" FROM '([0-9]+)$')::integer), 0)
FROM public."Invoice"
ON CONFLICT ("id") DO UPDATE
SET "currentNumber" = GREATEST(
  public."InvoiceSequence"."currentNumber",
  EXCLUDED."currentNumber"
);

INSERT INTO public."QuotationSequence" ("id", "currentNumber")
SELECT
  1,
  COALESCE(MAX(substring("quotationNumber" FROM '([0-9]+)$')::integer), 0)
FROM public."Quotation"
ON CONFLICT ("id") DO UPDATE
SET "currentNumber" = GREATEST(
  public."QuotationSequence"."currentNumber",
  EXCLUDED."currentNumber"
);
