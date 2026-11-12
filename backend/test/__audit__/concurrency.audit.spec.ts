import {
  assertAuditTarget,
  createChangeRequest,
  createInvoice,
  createLot,
  createModel,
  createService,
  currentTotalOf,
  prisma,
  resetAuditDb,
  seedBase,
  type BaseFixture,
} from './audit-db';

let base: BaseFixture;
let service: ReturnType<typeof createService>['service'];

beforeAll(() => {
  assertAuditTarget();
});

beforeEach(async () => {
  await resetAuditDb();
  base = await seedBase();
  service = createService().service;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const dropPendingIndex = async () => {
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "InvoiceChangeRequest_pending_invoice_unique"`);
};

const restorePendingIndex = async () => {
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceChangeRequest_pending_invoice_unique" ON "InvoiceChangeRequest" ("invoiceId") WHERE "status" = 'PENDING'`,
  );
};

describe('E. Concurrency', () => {
  it('E1 the partial unique index prevents two PENDING requests on one invoice', async () => {
    const model = await createModel(base.category.id);
    const { invoice, items } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 1, price: 100 }],
    });
    const first = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      items: [{ action: 'CHANGE_PRICE', invoiceItemId: items[0].id, proposedPrice: 90 }],
    });
    expect(first.status).toBe('PENDING');

    await expect(
      createChangeRequest({
        invoiceId: invoice.id,
        requestedByEmployeeId: base.sales.id,
        items: [{ action: 'ADD_ITEM', productModelId: model.id, quantity: 1, proposedPrice: 50 }],
      }),
    ).rejects.toBeTruthy();
  });

  it('E2 two concurrent approvals of the SAME request: exactly one succeeds', async () => {
    const model = await createModel(base.category.id);
    const addModel = await createModel(base.category.id);
    await createLot({
      supplierId: base.supplier.id,
      employeeId: base.sales.id,
      productModelId: addModel.id,
      quantity: 5,
    });
    const { invoice } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 1, price: 100 }],
    });
    const request = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      items: [{ action: 'ADD_ITEM', productModelId: addModel.id, quantity: 1, proposedPrice: 50 }],
    });

    const results = await Promise.allSettled([
      service.approve(request.id, base.admin.id),
      service.approve(request.id, base.admin.id),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const requestAfter = await prisma.invoiceChangeRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(requestAfter.status).toBe('APPROVED');
    const added = await prisma.invoiceItem.count({
      where: { invoiceId: invoice.id, productModelId: addModel.id },
    });
    expect(added).toBe(1);
  });

  it('E3 two concurrent requests on the same invoice serialize (index temporarily dropped)', async () => {
    await dropPendingIndex();
    try {
      const modelA = await createModel(base.category.id);
      const modelB = await createModel(base.category.id);
      await createLot({
        supplierId: base.supplier.id,
        employeeId: base.sales.id,
        productModelId: modelA.id,
        quantity: 5,
      });
      await createLot({
        supplierId: base.supplier.id,
        employeeId: base.sales.id,
        productModelId: modelB.id,
        quantity: 5,
      });
      const { invoice } = await createInvoice({
        customerId: base.customer.id,
        employeeId: base.sales.id,
        items: [{ productModelId: modelA.id, quantity: 3, price: 450 }],
      });

      const requestA = await createChangeRequest({
        invoiceId: invoice.id,
        requestedByEmployeeId: base.sales.id,
        items: [{ action: 'ADD_ITEM', productModelId: modelA.id, quantity: 1, proposedPrice: 100 }],
      });
      const requestB = await createChangeRequest({
        invoiceId: invoice.id,
        requestedByEmployeeId: base.sales.id,
        items: [{ action: 'ADD_ITEM', productModelId: modelB.id, quantity: 1, proposedPrice: 200 }],
      });

      const results = await Promise.allSettled([
        service.approve(requestA.id, base.admin.id),
        service.approve(requestB.id, base.admin.id),
      ]);

      // Both adds are commutative: 1350 + 100 + 200 = 1650 regardless of order.
      expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
      expect(await currentTotalOf(invoice.id)).toBe(1650);
      expect(await prisma.invoiceItem.count({ where: { invoiceId: invoice.id } })).toBe(3);

      const auditCount = await prisma.invoiceAuditLog.count({
        where: { invoiceId: invoice.id, action: 'ITEM_ADDED' },
      });
      expect(auditCount).toBe(2);
    } finally {
      await restorePendingIndex();
    }
  });

});
