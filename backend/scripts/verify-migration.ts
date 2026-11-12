import { PrismaClient } from '@prisma/client';
import { requiredEnvironment, safeErrorMessage } from './db-cli';

type TableName = { table_name: string };
type EnumColumn = {
  table_name: string;
  column_name: string;
  enum_label: string;
};
type ForeignKey = {
  table_name: string;
  constraint_name: string;
  referenced_table: string;
  columns: string[];
  referenced_columns: string[];
};
type NumericStats = { min: string | null; max: string | null; sum: string | null };

const numericChecks: Record<string, string[]> = {
  Customer: ['currentDebt'],
  CustomerDebtMovement: ['amount', 'balanceAfter'],
  Expense: ['amount'],
  Invoice: ['originalTotal', 'currentTotal', 'discountPercentage', 'discountAmount'],
  InvoiceItem: ['quantity', 'price', 'costAtSale'],
  InvoicePriceAdjustment: ['oldPrice', 'newPrice', 'appliedQuantity'],
  InvoiceReturn: ['refundTotal'],
  InvoiceReturnItem: ['quantity', 'refundAmount'],
  ProductModel: ['reservedQuantity', 'minStockAlert'],
  ProductLastPrice: ['price'],
  Quotation: ['subtotal', 'lineDiscountTotal', 'discountPercentage', 'discountAmount', 'total'],
  QuotationItem: ['price', 'lineDiscount'],
  StockAdjustment: ['quantity'],
  StockConsumption: ['quantity', 'unitCost', 'totalCost'],
  StockLot: ['quantityReceived', 'quantityRemaining', 'quantityReserved', 'purchasePrice'],
};

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function prismaFor(url: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url } } });
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function tableNames(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.$queryRaw<TableName[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> '_prisma_migrations'
    ORDER BY table_name
  `;
  return rows.map((row) => row.table_name);
}

async function readSnapshot(prisma: PrismaClient, tables: string[]) {
  const columnRows = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `;
  const columns = new Map<string, Set<string>>();
  for (const row of columnRows) {
    const current = columns.get(row.table_name) ?? new Set<string>();
    current.add(row.column_name);
    columns.set(row.table_name, current);
  }

  const countSql = tables.map((table) =>
    `SELECT ${quoteLiteral(table)}::text AS table_name, COUNT(*)::text AS row_count ` +
    `FROM public.${quoteIdentifier(table)}`,
  );
  const countRows = countSql.length
    ? await prisma.$queryRawUnsafe<Array<{ table_name: string; row_count: string }>>(countSql.join(' UNION ALL '))
    : [];
  const counts = Object.fromEntries(countRows.map((row) => [row.table_name, row.row_count]));

  const missingNumericColumns: string[] = [];
  const numericSql: string[] = [];
  for (const [table, names] of Object.entries(numericChecks)) {
    if (!tables.includes(table)) continue;
    for (const column of names) {
      if (!columns.get(table)?.has(column)) {
        missingNumericColumns.push(`${table}.${column}`);
        continue;
      }
      const field = quoteIdentifier(column);
      numericSql.push(
        `SELECT ${quoteLiteral(`${table}.${column}`)}::text AS metric, ` +
        `MIN(${field})::text AS min, MAX(${field})::text AS max, ` +
        `SUM(${field}::numeric)::text AS sum FROM public.${quoteIdentifier(table)}`,
      );
    }
  }
  const numericRows = numericSql.length
    ? await prisma.$queryRawUnsafe<Array<{ metric: string } & NumericStats>>(numericSql.join(' UNION ALL '))
    : [];
  const numeric = Object.fromEntries(numericRows.map((row) => [
    row.metric,
    { min: row.min, max: row.max, sum: row.sum },
  ]));

  const enumColumns = await prisma.$queryRaw<EnumColumn[]>`
    SELECT
      relation.relname AS table_name,
      attribute.attname AS column_name,
      enum_value.enumlabel AS enum_label
    FROM pg_attribute AS attribute
    JOIN pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_type AS enum_type ON enum_type.oid = attribute.atttypid
    JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
    ORDER BY relation.relname, attribute.attname, enum_value.enumsortorder
  `;
  const enumDefinitions = new Map<string, string[]>();
  for (const row of enumColumns) {
    if (!tables.includes(row.table_name)) continue;
    const key = `${row.table_name}.${row.column_name}`;
    const values = enumDefinitions.get(key) ?? [];
    values.push(row.enum_label);
    enumDefinitions.set(key, values);
  }

  const enums: Record<string, Record<string, string>> = {};
  for (const [key, labels] of enumDefinitions) {
    const [table, column] = key.split('.');
    const grouped = await prisma.$queryRawUnsafe<Array<{ value: string | null; row_count: string }>>(
      `SELECT ${quoteIdentifier(column)}::text AS value, COUNT(*)::text AS row_count ` +
      `FROM public.${quoteIdentifier(table)} GROUP BY ${quoteIdentifier(column)}::text`,
    );
    const countsByValue: Record<string, string> = Object.fromEntries(labels.map((label) => [label, '0']));
    for (const row of grouped) countsByValue[row.value ?? '<NULL>'] = row.row_count;
    enums[key] = countsByValue;
  }

  const foreignKeys = await prisma.$queryRaw<ForeignKey[]>`
    SELECT
      constraints.table_name,
      constraints.constraint_name,
      usage.table_name AS referenced_table,
      ARRAY_AGG(key_usage.column_name ORDER BY key_usage.ordinal_position) AS columns,
      ARRAY_AGG(usage.column_name ORDER BY key_usage.ordinal_position) AS referenced_columns
    FROM information_schema.table_constraints AS constraints
    JOIN information_schema.key_column_usage AS key_usage
      ON key_usage.constraint_schema = constraints.constraint_schema
      AND key_usage.constraint_name = constraints.constraint_name
    JOIN information_schema.constraint_column_usage AS usage
      ON usage.constraint_schema = constraints.constraint_schema
      AND usage.constraint_name = constraints.constraint_name
      AND key_usage.position_in_unique_constraint = usage.ordinal_position
    WHERE constraints.constraint_schema = 'public'
      AND constraints.constraint_type = 'FOREIGN KEY'
    GROUP BY constraints.table_name, constraints.constraint_name, usage.table_name
    ORDER BY constraints.table_name, constraints.constraint_name
  `;

  const foreignKeySql = foreignKeys
    .filter((foreignKey) => tables.includes(foreignKey.table_name))
    .map((foreignKey) => {
      const sourceAlias = 'source_row';
      const targetAlias = 'target_row';
      const allPresent = foreignKey.columns
        .map((column) => `${sourceAlias}.${quoteIdentifier(column)} IS NOT NULL`)
        .join(' AND ');
      const matches = foreignKey.columns
        .map((column, index) =>
          `${targetAlias}.${quoteIdentifier(foreignKey.referenced_columns[index])} = ` +
          `${sourceAlias}.${quoteIdentifier(column)}`,
        )
        .join(' AND ');
      const metric = `${foreignKey.table_name}.${foreignKey.constraint_name}`;
      return (
        `SELECT ${quoteLiteral(metric)}::text AS metric, COUNT(*)::text AS violations ` +
        `FROM public.${quoteIdentifier(foreignKey.table_name)} AS ${sourceAlias} ` +
        `WHERE ${allPresent} AND NOT EXISTS (` +
        `SELECT 1 FROM public.${quoteIdentifier(foreignKey.referenced_table)} AS ${targetAlias} ` +
        `WHERE ${matches})`
      );
    });
  const foreignKeyRows = foreignKeySql.length
    ? await prisma.$queryRawUnsafe<Array<{ metric: string; violations: string }>>(foreignKeySql.join(' UNION ALL '))
    : [];
  const foreignKeyViolations = Object.fromEntries(
    foreignKeyRows.map((row) => [row.metric, row.violations]),
  );

  return { counts, numeric, enums, foreignKeyViolations, missingNumericColumns };
}

async function main(): Promise<void> {
  const sourceUrl = requiredEnvironment('SOURCE_DATABASE_URL');
  const targetUrl = requiredEnvironment('DIRECT_URL');
  const source = prismaFor(sourceUrl);
  const target = prismaFor(targetUrl);

  try {
    await Promise.all([source.$connect(), target.$connect()]);
    const [sourceTables, targetTables] = await Promise.all([tableNames(source), tableNames(target)]);
    const [sourceSnapshot, targetSnapshot] = await Promise.all([
      readSnapshot(source, sourceTables),
      readSnapshot(target, targetTables),
    ]);

    const allTables = [...new Set([...sourceTables, ...targetTables])].sort();
    let failed = false;
    for (const table of allTables) {
      const tableSourceEnums = Object.fromEntries(
        Object.entries(sourceSnapshot.enums).filter(([key]) => key.startsWith(`${table}.`)),
      );
      const tableTargetEnums = Object.fromEntries(
        Object.entries(targetSnapshot.enums).filter(([key]) => key.startsWith(`${table}.`)),
      );
      const tableSourceNumeric = Object.fromEntries(
        Object.entries(sourceSnapshot.numeric).filter(([key]) => key.startsWith(`${table}.`)),
      );
      const tableTargetNumeric = Object.fromEntries(
        Object.entries(targetSnapshot.numeric).filter(([key]) => key.startsWith(`${table}.`)),
      );
      const tableSourceForeignKeys = Object.fromEntries(
        Object.entries(sourceSnapshot.foreignKeyViolations).filter(([key]) => key.startsWith(`${table}.`)),
      );
      const tableTargetForeignKeys = Object.fromEntries(
        Object.entries(targetSnapshot.foreignKeyViolations).filter(([key]) => key.startsWith(`${table}.`)),
      );
      const missingNumericColumns = [
        ...sourceSnapshot.missingNumericColumns,
        ...targetSnapshot.missingNumericColumns,
      ].filter((key) => key.startsWith(`${table}.`));

      const sourceCount = sourceSnapshot.counts[table] ?? 'MISSING';
      const targetCount = targetSnapshot.counts[table] ?? 'MISSING';
      const fkClean = [...Object.values(tableSourceForeignKeys), ...Object.values(tableTargetForeignKeys)]
        .every((count) => count === '0');
      const pass =
        sourceCount !== 'MISSING' &&
        targetCount !== 'MISSING' &&
        sourceCount === targetCount &&
        stable(tableSourceNumeric) === stable(tableTargetNumeric) &&
        stable(tableSourceEnums) === stable(tableTargetEnums) &&
        stable(tableSourceForeignKeys) === stable(tableTargetForeignKeys) &&
        fkClean &&
        missingNumericColumns.length === 0;

      console.log(
        `${pass ? 'PASS' : 'FAIL'} public.${table}: rows source=${sourceCount} target=${targetCount}` +
        (missingNumericColumns.length ? ` missing_numeric=${missingNumericColumns.join(',')}` : ''),
      );
      if (!pass) failed = true;
    }

    console.log(failed ? 'MIGRATION VERIFICATION: FAIL' : 'MIGRATION VERIFICATION: PASS');
    if (failed) process.exitCode = 1;
  } finally {
    await Promise.all([source.$disconnect(), target.$disconnect()]);
  }
}

main().catch((error: unknown) => {
  console.error(`Migration verification failed: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
