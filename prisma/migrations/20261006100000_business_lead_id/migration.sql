CREATE SEQUENCE "Lead_business_id_seq"
  AS BIGINT
  START WITH 1
  INCREMENT BY 1
  MAXVALUE 9999999
  NO CYCLE
  CACHE 1;

ALTER TABLE "Lead" ADD COLUMN "leadId" TEXT;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "Lead") > 9999999 THEN
    RAISE EXCEPTION 'Cannot backfill business lead IDs: the seven-digit ID range is exhausted.';
  END IF;
END $$;

WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS number
  FROM "Lead"
)
UPDATE "Lead" AS lead
SET "leadId" = 'LD-' || LPAD(numbered.number::TEXT, 7, '0')
FROM numbered
WHERE lead."id" = numbered."id";

SELECT SETVAL(
  '"Lead_business_id_seq"',
  GREATEST(COUNT(*)::BIGINT, 1),
  COUNT(*) > 0
)
FROM "Lead";

ALTER TABLE "Lead"
  ALTER COLUMN "leadId" SET DEFAULT ('LD-' || LPAD(NEXTVAL('"Lead_business_id_seq"')::TEXT, 7, '0')),
  ALTER COLUMN "leadId" SET NOT NULL;

ALTER SEQUENCE "Lead_business_id_seq" OWNED BY "Lead"."leadId";

ALTER TABLE "Lead"
  ADD CONSTRAINT "Lead_leadId_format_check" CHECK ("leadId" ~ '^LD-[0-9]{7}$');

CREATE UNIQUE INDEX "Lead_leadId_key" ON "Lead"("leadId");
