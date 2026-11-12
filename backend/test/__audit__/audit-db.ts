/**
 * Audit-only DB harness.
 *
 * HARD GUARD: every helper that touches the database calls assertAuditTarget()
 * and refuses to run unless DATABASE_URL points at the dedicated
 * `pallet_pos_audit` database. The development/production database
 * (`pallet_pos`) can never be reached from these tests.
 */
import { PrismaClient } from '@prisma/client';
import { InvoiceChangeRequestsService } from '../../src/invoice-change-requests/invoice-change-requests.service';

export const AUDIT_DB_NAME = 'pallet_pos_audit';

export function assertAuditTarget(): string {
  const url = process.env.DATABASE_URL ?? '';
  let dbName = '';
  try {
    dbName = new URL(url).pathname.replace(/^\//, '');
  } catch {
    dbName = '';
  }
  if (dbName !== AUDIT_DB_NAME) {
    throw new Error(
      `REFUSING TO TOUCH DB: expected ${AUDIT_DB_NAME}, got "${dbName || '<unset>'}" (${url || '<unset>'})`,
    );
  }
  return url;
}

assertAuditTarget();

export const prisma = new PrismaClient();

export async function resetAuditDb(): Promise<void> {
  assertAuditTarget();
  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  const names = tables
    .map((table) => table.tablename)
    .filter((name) => name !== '_prisma_migrations');
  if (names.length === 0) return;
  const list = names.map((name) => `"${name}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export type BaseFixture = Awaited<ReturnType<typeof seedBase>>;

export async function seedBase() {
  assertAuditTarget();
  const admin = await prisma.employee.create({
    data: { name: 'Audit Admin', username: 'audit_admin', passwordHash: 'x', role: 'ADMIN', isActive: true },
  });
  const sales = await prisma.employee.create({
    data: { name: 'Audit Sales', username: 'audit_sales', passwordHash: 'x', role: 'SALES', isActive: true },
  });
  const category = await prisma.category.create({ data: { name: 'Audit Category', isActive: true } });
  const customer = await prisma.customer.create({
    data: { name: 'Audit Customer', type: 'INDIVIDUAL', isActive: true },
  });
  const supplier = await prisma.supplier.create({ data: { name: 'Audit Supplier', isActive: true } });
  return { admin, sales, category, customer, supplier };
}

let modelCounter = 0;

export async function createModel(
  categoryId: number,
  opts: { isSerialized?: boolean; unit?: 'PIECE' | 'METER'; name?: string; reservedQuantity?: number } = {},
) {
  assertAuditTarget();
  modelCounter += 1;
  return prisma.productModel.create({
    data: {
      categoryId,
      name: opts.name ?? `Audit Model ${modelCounter}`,
      isSerialized: opts.isSerialized ?? false,
      unit: opts.unit ?? 'PIECE',
      reservedQuantity: opts.reservedQuantity ?? 0,
      minStockAlert: 0,
      isActive: true,
    },
  });
}

let invoiceCounter = 0;

export interface InvoiceLineInput {
  productModelId: number;
  quantity: number;
  price: number;
}

export async function createInvoice(opts: {
  customerId: number;
  employeeId: number;
  items: InvoiceLineInput[];
  discountPercentage?: number;
  discountAmount?: number;
  status?: 'PENDING_ACCOUNTANT' | 'CONFIRMED' | 'DELIVERED' | 'CANCELLED';
  date?: Date;
  invoiceNumber?: string;
}) {
  assertAuditTarget();
  const { calculateInvoiceTotals } = await import('../../src/common/invoice-totals.util');
  const totals = calculateInvoiceTotals(
    opts.items.map((item) => ({ price: item.price, quantity: item.quantity })),
    opts.discountPercentage ?? 0,
    opts.discountAmount ?? 0,
  );
  invoiceCounter += 1;
  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: opts.invoiceNumber ?? `AUD-${String(invoiceCounter).padStart(6, '0')}`,
      customerId: opts.customerId,
      employeeId: opts.employeeId,
      status: (opts.status ?? 'CONFIRMED') as any,
      originalTotal: totals.subtotal,
      currentTotal: totals.total,
      discountPercentage: opts.discountPercentage ?? 0,
      discountAmount: opts.discountAmount ?? 0,
      date: opts.date ?? new Date(),
    },
  });
  const items = [] as { id: number; productModelId: number; quantity: number; price: number }[];
  for (const item of opts.items) {
    const created = await prisma.invoiceItem.create({
      data: {
        invoiceId: invoice.id,
        productModelId: item.productModelId,
        quantity: item.quantity,
        price: item.price,
      },
    });
    items.push({
      id: created.id,
      productModelId: created.productModelId,
      quantity: Number(created.quantity),
      price: Number(created.price),
    });
  }
  return { invoice, items, totals };
}

export async function createLot(opts: {
  supplierId: number;
  employeeId: number;
  productModelId: number;
  quantity: number;
  remaining?: number;
  purchasePrice?: number;
}) {
  assertAuditTarget();
  const receipt = await prisma.stockReceipt.create({
    data: {
      employeeId: opts.employeeId,
      supplierId: opts.supplierId,
      status: 'PRICED',
      pricedByEmployeeId: opts.employeeId,
      pricedAt: new Date(),
      date: new Date(),
    },
  });
  return prisma.stockLot.create({
    data: {
      productModelId: opts.productModelId,
      stockReceiptId: receipt.id,
      supplierId: opts.supplierId,
      quantityReceived: opts.quantity,
      quantityRemaining: opts.remaining ?? opts.quantity,
      quantityReserved: 0,
      purchasePrice: opts.purchasePrice ?? 50,
      receivedDate: new Date(),
    },
  });
}

/** Simulate that `quantity` units of a line were consumed from a lot. */
export async function consumeFromLot(invoiceItemId: number, stockLotId: number, quantity: number) {
  assertAuditTarget();
  await prisma.stockConsumption.create({
    data: { invoiceItemId, stockLotId, quantity, unitCost: 50, totalCost: 50 * quantity },
  });
  await prisma.stockLot.update({
    where: { id: stockLotId },
    data: { quantityRemaining: { decrement: quantity } },
  });
}

export async function createSerializedSoldUnit(opts: {
  productModelId: number;
  invoiceItemId: number;
  employeeId: number;
  barcode?: string;
  price?: number;
}) {
  assertAuditTarget();
  const unit = await prisma.productUnit.create({
    data: {
      productModelId: opts.productModelId,
      barcode: opts.barcode ?? `AUD-UNIT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'SOLD',
      receivedDate: new Date(),
      purchasePrice: opts.price ?? 100,
    },
  });
  const assignment = await prisma.invoiceItemUnitAssignment.create({
    data: {
      invoiceItemId: opts.invoiceItemId,
      productUnitId: unit.id,
      scannedByEmployeeId: opts.employeeId,
    },
  });
  return { unit, assignment };
}

export async function createChangeRequest(opts: {
  invoiceId: number;
  requestedByEmployeeId: number;
  type?: 'EDIT' | 'FULL_RETURN' | 'PARTIAL_RETURN';
  items: Array<{
    action: 'ADD_ITEM' | 'REMOVE_ITEM' | 'CHANGE_PRICE' | 'RETURN_ITEM';
    invoiceItemId?: number;
    productModelId?: number;
    productUnitId?: number;
    quantity?: number;
    proposedPrice?: number;
    notes?: string;
  }>;
}) {
  assertAuditTarget();
  return prisma.invoiceChangeRequest.create({
    data: {
      invoiceId: opts.invoiceId,
      requestedByEmployeeId: opts.requestedByEmployeeId,
      type: (opts.type ?? 'EDIT') as any,
      reason: 'audit fixture',
      items: { create: opts.items as any },
    },
  });
}

export function createService() {
  // Notifications/realtime are intentionally mocked: they write outside the
  // approval transaction and are not what these tests are measuring.
  const notifications = {
    createLowStockNotification: jest.fn(async () => undefined),
    resolveLowStockNotification: jest.fn(async () => undefined),
  };
  const realtime = { publish: jest.fn() };
  const service = new InvoiceChangeRequestsService(
    prisma as any,
    notifications as any,
    realtime as any,
  );
  return { service, notifications, realtime };
}

export async function currentTotalOf(invoiceId: number): Promise<number> {
  assertAuditTarget();
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  return Number(invoice.currentTotal);
}

export function dayRange(daysAgo: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date;
}
