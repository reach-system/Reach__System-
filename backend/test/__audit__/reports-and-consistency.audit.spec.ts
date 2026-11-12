import {
  assertAuditTarget,
  createChangeRequest,
  createInvoice,
  createLot,
  createModel,
  createService,
  consumeFromLot,
  currentTotalOf,
  prisma,
  resetAuditDb,
  seedBase,
  type BaseFixture,
} from './audit-db';
import { ReportsService } from '../../src/reports/reports.service';

let base: BaseFixture;
let changeService: ReturnType<typeof createService>['service'];
let reports: ReportsService;

beforeAll(() => {
  assertAuditTarget();
});

beforeEach(async () => {
  await resetAuditDb();
  base = await seedBase();
  changeService = createService().service;
  reports = new ReportsService(prisma as any);
});

afterAll(async () => {
  await prisma.$disconnect();
});

function rangeAroundNow(daysBack = 2): { start: Date; end: Date; from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getTime() - daysBack * 86400000);
  const end = new Date(now.getTime() + 86400000);
  const fmt = (date: Date) => date.toISOString().slice(0, 10);
  return { start, end, from: fmt(start), to: fmt(now) };
}

describe('H. Reports adjustment aggregation', () => {
  it('H1 counts (newPrice - oldPrice) * appliedQuantity', async () => {
    const model = await createModel(base.category.id);
    const { invoice, items } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 3, price: 450 }],
      status: 'DELIVERED',
    });
    await prisma.invoicePriceAdjustment.create({
      data: {
        invoiceId: invoice.id,
        invoiceItemId: items[0].id,
        requestedById: base.sales.id,
        approvedById: base.admin.id,
        oldPrice: 450,
        newPrice: 440,
        appliedQuantity: 3,
        reason: 'audit',
      },
    });

    const { start, end } = rangeAroundNow();
    const data = await reports.privateComputeRevenueData(start, end);

    expect(data.originalSales).toBe(1350);
    expect(data.approvedAdjustments).toBe(-30);
    expect(data.netSales).toBe(1320);
  });

  it('H2 quantifies the historical appliedQuantity=1 understatement', async () => {
    const model = await createModel(base.category.id);
    const { invoice, items } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 3, price: 450 }],
      status: 'DELIVERED',
    });
    // Simulates a pre-migration adjustment row: default appliedQuantity = 1.
    await prisma.invoicePriceAdjustment.create({
      data: {
        invoiceId: invoice.id,
        invoiceItemId: items[0].id,
        requestedById: base.sales.id,
        approvedById: base.admin.id,
        oldPrice: 450,
        newPrice: 440,
        appliedQuantity: 1,
        reason: 'audit',
      },
    });

    const { start, end } = rangeAroundNow();
    const data = await reports.privateComputeRevenueData(start, end);

    // The price change actually reduced the invoice by 30 (3 units × 10).
    expect(data.approvedAdjustments).toBe(-10);
    expect(data.netSales).toBe(1340);
    // Correct revenue after the price change is 1320.
    expect(data.netSales).not.toBe(1320);
  });

  it('H3 by-day adjustment total is quantity-aware', async () => {
    const model = await createModel(base.category.id);
    const { invoice, items } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 3, price: 450 }],
      status: 'DELIVERED',
    });
    await prisma.invoicePriceAdjustment.create({
      data: {
        invoiceId: invoice.id,
        invoiceItemId: items[0].id,
        requestedById: base.sales.id,
        approvedById: base.admin.id,
        oldPrice: 450,
        newPrice: 440,
        appliedQuantity: 3,
        reason: 'audit',
      },
    });

    const { from, to } = rangeAroundNow();
    const report = await reports.computeRevenue(from, to);
    const today = new Date().toISOString().slice(0, 10);
    const day = report.byDay.find((entry) => entry.date === today);
    expect(day?.total).toBe(1320);
  });

  it('H4 [EXPECTED FAIL] adjustments are attributed to their own date while gross sales use invoice.date', async () => {
    const model = await createModel(base.category.id);
    const { invoice, items } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 3, price: 450 }],
      status: 'DELIVERED',
      date: new Date(Date.now() - 10 * 86400000),
    });
    await prisma.invoicePriceAdjustment.create({
      data: {
        invoiceId: invoice.id,
        invoiceItemId: items[0].id,
        requestedById: base.sales.id,
        approvedById: base.admin.id,
        oldPrice: 450,
        newPrice: 440,
        appliedQuantity: 3,
        reason: 'audit',
        createdAt: new Date(), // adjustment happens now
      },
    });

    const { start, end } = rangeAroundNow();
    const data = await reports.privateComputeRevenueData(start, end);

    // The invoice is outside the range (date 10 days ago), but its adjustment
    // is inside it (created now), producing negative "net sales" for the period.
    expect(data.originalSales).toBe(0);
    expect(data.approvedAdjustments).toBe(-30);
    expect(data.netSales).toBe(0);
  });

  it('H5 [EXPECTED FAIL] revenue totals are not rounded before being returned', async () => {
    const model = await createModel(base.category.id);
    await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [
        { productModelId: model.id, quantity: 1, price: 0.1 },
        { productModelId: model.id, quantity: 1, price: 0.2 },
      ],
      status: 'DELIVERED',
    });

    const { start, end } = rangeAroundNow();
    const data = await reports.privateComputeRevenueData(start, end);
    expect(data.originalSales).toBe(0.3);
    expect(data.netSales).toBe(0.3);
  });
});

describe('G. Financial consistency beyond currentTotal', () => {
  it('G1 refund + remaining total is invariant after a discounted return', async () => {
    const model = await createModel(base.category.id);
    const lot = await createLot({
      supplierId: base.supplier.id,
      employeeId: base.sales.id,
      productModelId: model.id,
      quantity: 10,
    });
    const { invoice, items } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 3, price: 450 }],
      discountPercentage: 10,
      status: 'DELIVERED',
    });
    await consumeFromLot(items[0].id, lot.id, 3);

    const request = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      type: 'PARTIAL_RETURN',
      items: [{ action: 'RETURN_ITEM', invoiceItemId: items[0].id, quantity: 1 }],
    });
    const result: any = await changeService.approve(request.id, base.admin.id);

    expect(result.refundTotal).toBe(405);
    expect(await currentTotalOf(invoice.id)).toBe(810);
    expect(result.refundTotal + (await currentTotalOf(invoice.id))).toBe(1215);
  });

  it('G2 [EXPECTED FAIL] a return does not reduce customer debt or write a debt movement', async () => {
    const customer = await prisma.customer.update({
      where: { id: base.customer.id },
      data: { currentDebt: 1000 },
    });
    const model = await createModel(base.category.id);
    const lot = await createLot({
      supplierId: base.supplier.id,
      employeeId: base.sales.id,
      productModelId: model.id,
      quantity: 10,
    });
    const { invoice, items } = await createInvoice({
      customerId: customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 3, price: 450 }],
      status: 'DELIVERED',
    });
    await consumeFromLot(items[0].id, lot.id, 3);

    const request = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      type: 'PARTIAL_RETURN',
      items: [{ action: 'RETURN_ITEM', invoiceItemId: items[0].id, quantity: 1 }],
    });
    await changeService.approve(request.id, base.admin.id);

    const customerAfter = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    const movements = await prisma.customerDebtMovement.count({ where: { customerId: customer.id } });
    // A 450 refund should reduce the customer's outstanding debt.
    expect(Number(customerAfter.currentDebt)).toBe(550);
    expect(movements).toBe(1);
  });

  it('G3 the repair path does not reconcile historical refundAmount rows', async () => {
    const model = await createModel(base.category.id);
    const { invoice, items } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 3, price: 450 }],
      status: 'DELIVERED',
    });
    // Old drifting-ratio refund: 270 instead of 450. Old total: 810 instead of 900.
    const returnRow = await prisma.invoiceReturn.create({
      data: {
        invoiceId: invoice.id,
        requestedById: base.sales.id,
        approvedById: base.admin.id,
        reason: 'audit historical',
        refundTotal: 270,
        items: {
          create: [{ invoiceItemId: items[0].id, quantity: 1, refundAmount: 270 }],
        },
      },
    });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { currentTotal: 810 } });

    const { execFileSync } = await import('child_process');
    const path = await import('path');
    const backendRoot = path.resolve(__dirname, '../..');
    execFileSync(
      process.execPath,
      ['-r', 'ts-node/register', path.join(backendRoot, 'scripts/repair-invoice-totals.ts'), '--apply'],
      { cwd: backendRoot, env: { ...process.env, DATABASE_URL: assertAuditTarget() }, encoding: 'utf8' },
    );

    expect(await currentTotalOf(invoice.id)).toBe(900);
    const returnAfter = await prisma.invoiceReturn.findUniqueOrThrow({ where: { id: returnRow.id } });
    expect(Number(returnAfter.refundTotal)).toBe(270);
    // Sum of refunds + remaining receivable no longer equals the original price.
    expect(Number(returnAfter.refundTotal) + (await currentTotalOf(invoice.id))).toBe(1170);
  });
});
