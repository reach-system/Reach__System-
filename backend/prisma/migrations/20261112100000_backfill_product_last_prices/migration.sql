-- Populate the last-price cache from historical completed invoices.
WITH ranked_invoice_prices AS (
    SELECT DISTINCT ON (item."productModelId")
        item."productModelId",
        COALESCE(adjustment."newPrice", item."price") AS "price",
        invoice."id" AS "sourceInvoiceId",
        COALESCE(invoice."confirmedAt", invoice."date") AS "effectiveAt"
    FROM "InvoiceItem" AS item
    INNER JOIN "Invoice" AS invoice ON invoice."id" = item."invoiceId"
    LEFT JOIN LATERAL (
        SELECT price_adjustment."newPrice"
        FROM "InvoicePriceAdjustment" AS price_adjustment
        WHERE price_adjustment."invoiceItemId" = item."id"
        ORDER BY price_adjustment."createdAt" DESC, price_adjustment."id" DESC
        LIMIT 1
    ) AS adjustment ON true
    WHERE invoice."status" IN ('CONFIRMED', 'DELIVERED')
    ORDER BY
        item."productModelId",
        COALESCE(invoice."confirmedAt", invoice."date") DESC,
        invoice."id" DESC,
        item."id" DESC
)
INSERT INTO "ProductLastPrice" (
    "productModelId",
    "price",
    "source",
    "sourceInvoiceId",
    "effectiveAt",
    "version",
    "createdAt",
    "updatedAt"
)
SELECT
    "productModelId",
    "price",
    'INVOICE',
    "sourceInvoiceId",
    "effectiveAt",
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM ranked_invoice_prices
ON CONFLICT ("productModelId") DO UPDATE SET
    "price" = EXCLUDED."price",
    "source" = EXCLUDED."source",
    "sourceInvoiceId" = EXCLUDED."sourceInvoiceId",
    "effectiveAt" = EXCLUDED."effectiveAt",
    "updatedByEmployeeId" = NULL,
    "version" = "ProductLastPrice"."version" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "ProductLastPrice"."effectiveAt" < EXCLUDED."effectiveAt";
