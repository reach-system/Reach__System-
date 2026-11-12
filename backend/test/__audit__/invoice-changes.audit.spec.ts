import {
  assertAuditTarget,
  createChangeRequest,
  createInvoice,
  createLot,
  createModel,
  createSerializedSoldUnit,
  createService,
  consumeFromLot,
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

const approveErrorCode = async (promise: Promise<unknown>): Promise<string | undefined> => {
  try {
    await promise;
    return undefined;
  } catch (error) {
    const response = (error as { response?: { code?: string } }).response;
    return response?.code;
  }
};

describe('A. Price-change math', () => {
  it('A1 applies 450 -> 440 to all 3 units', async () => {
    const model = await createModel(base.category.id);
    const { invoice, items } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 3, price: 450 }],
    });
    const request = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      items: [{ action: 'CHANGE_PRICE', invoiceItemId: items[0].id, proposedPrice: 440 }],
    });

    const result: any = await service.approve(request.id, base.admin.id, 'audit');

    expect(result.newTotal).toBe(1320);
    expect(result.totalDelta).toBe(-30);
    expect(await currentTotalOf(invoice.id)).toBe(1320);
    const adjustment = await prisma.invoicePriceAdjustment.findFirstOrThrow({ where: { requestId: request.id } });
    expect(Number(adjustment.appliedQuantity)).toBe(3);
    expect(Number(adjustment.oldPrice)).toBe(450);
    expect(Number(adjustment.newPrice)).toBe(440);
  });

  it('A2 honours a 10% invoice discount', async () => {
    const model = await createModel(base.category.id);
    const { invoice, items } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 3, price: 450 }],
      discountPercentage: 10,
    });
    expect(Number(invoice.currentTotal)).toBe(1215);
    const request = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      items: [{ action: 'CHANGE_PRICE', invoiceItemId: items[0].id, proposedPrice: 440 }],
    });

    const result: any = await service.approve(request.id, base.admin.id);

    expect(result.newTotal).toBe(1188);
    expect(result.totalDelta).toBe(-27);
  });

  it('A3 honours a fixed invoice discount', async () => {
    const model = await createModel(base.category.id);
    const { invoice, items } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 3, price: 450 }],
      discountAmount: 100,
    });
    expect(Number(invoice.currentTotal)).toBe(1250);
    const request = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      items: [{ action: 'CHANGE_PRICE', invoiceItemId: items[0].id, proposedPrice: 440 }],
    });

    const result: any = await service.approve(request.id, base.admin.id);

    // factor = (1350 - 100) / 1350; 1320 * factor = 1222.222... -> 1222.22
    expect(result.newTotal).toBe(1222.22);
    expect(result.totalDelta).toBe(-27.78);
  });

  it('A4 honours percentage + fixed discount together', async () => {
    const model = await createModel(base.category.id);
    const { invoice, items } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 3, price: 450 }],
      discountPercentage: 10,
      discountAmount: 100,
    });
    // 1350 - 135 - 100 = 1115
    expect(Number(invoice.currentTotal)).toBe(1115);
    const request = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      items: [{ action: 'CHANGE_PRICE', invoiceItemId: items[0].id, proposedPrice: 440 }],
    });

    const result: any = await service.approve(request.id, base.admin.id);

    // 1320 * (1115 / 1350) = 1090.222... -> 1090.22
    expect(result.newTotal).toBe(1090.22);
  });

  it('A5 caps a fixed discount larger than the subtotal and keeps total at 0', async () => {
    const model = await createModel(base.category.id);
    const { invoice, items } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 3, price: 450 }],
      discountAmount: 5000,
    });
    expect(Number(invoice.currentTotal)).toBe(0);
    const request = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      items: [{ action: 'CHANGE_PRICE', invoiceItemId: items[0].id, proposedPrice: 440 }],
    });

    const result: any = await service.approve(request.id, base.admin.id);

    expect(result.newTotal).toBe(0);
    expect(result.totalDelta).toBe(0);
  });

  it('A6 uses the latest adjustment as oldPrice for a repeated change', async () => {
    const model = await createModel(base.category.id);
    const { invoice, items } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 3, price: 450 }],
    });

    const first = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      items: [{ action: 'CHANGE_PRICE', invoiceItemId: items[0].id, proposedPrice: 440 }],
    });
    await service.approve(first.id, base.admin.id);

    const second = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      items: [{ action: 'CHANGE_PRICE', invoiceItemId: items[0].id, proposedPrice: 430 }],
    });
    const result: any = await service.approve(second.id, base.admin.id);

    expect(result.newTotal).toBe(1290);
    expect(result.totalDelta).toBe(-30);
    const adjustment = await prisma.invoicePriceAdjustment.findFirstOrThrow({ where: { requestId: second.id } });
    expect(Number(adjustment.oldPrice)).toBe(440);
    expect(Number(adjustment.newPrice)).toBe(430);
  });

  it('A7 applies a price change only to the remaining quantity after a partial return', async () => {
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
    });
    await consumeFromLot(items[0].id, lot.id, 3);

    const returnRequest = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      type: 'PARTIAL_RETURN',
      items: [{ action: 'RETURN_ITEM', invoiceItemId: items[0].id, quantity: 1 }],
    });
    await service.approve(returnRequest.id, base.admin.id);
    expect(await currentTotalOf(invoice.id)).toBe(900);

    const priceRequest = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      items: [{ action: 'CHANGE_PRICE', invoiceItemId: items[0].id, proposedPrice: 440 }],
    });
    const result: any = await service.approve(priceRequest.id, base.admin.id);

    expect(result.newTotal).toBe(880);
    const adjustment = await prisma.invoicePriceAdjustment.findFirstOrThrow({ where: { requestId: priceRequest.id } });
    expect(Number(adjustment.appliedQuantity)).toBe(2);
  });

  it('A8 rejects a price change on a fully returned line', async () => {
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
    });
    await consumeFromLot(items[0].id, lot.id, 3);

    const returnRequest = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      type: 'FULL_RETURN',
      items: [{ action: 'RETURN_ITEM', invoiceItemId: items[0].id, quantity: 3 }],
    });
    await service.approve(returnRequest.id, base.admin.id);

    const priceRequest = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      items: [{ action: 'CHANGE_PRICE', invoiceItemId: items[0].id, proposedPrice: 440 }],
    });
    const code = await approveErrorCode(service.approve(priceRequest.id, base.admin.id));
    expect(code).toBe('INVOICE_ITEM_FULLY_RETURNED');
    expect(await prisma.invoicePriceAdjustment.count({ where: { requestId: priceRequest.id } })).toBe(0);
  });

  it('A9 rejects duplicate price rows for the same line in one request', async () => {
    const model = await createModel(base.category.id);
    const { invoice, items } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 3, price: 450 }],
    });
    const request = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      items: [
        { action: 'CHANGE_PRICE', invoiceItemId: items[0].id, proposedPrice: 440 },
        { action: 'CHANGE_PRICE', invoiceItemId: items[0].id, proposedPrice: 430 },
      ],
    });
    const code = await approveErrorCode(service.approve(request.id, base.admin.id));
    expect(code).toBe('DUPLICATE_PRICE_CHANGE');
    expect(await prisma.invoicePriceAdjustment.count({ where: { invoiceId: invoice.id } })).toBe(0);
  });

  it('A10 applies a price increase', async () => {
    const model = await createModel(base.category.id);
    const { invoice, items } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 3, price: 450 }],
    });
    const request = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      items: [{ action: 'CHANGE_PRICE', invoiceItemId: items[0].id, proposedPrice: 500 }],
    });
    const result: any = await service.approve(request.id, base.admin.id);
    expect(result.newTotal).toBe(1500);
    expect(result.totalDelta).toBe(150);
  });

  it('A11 allows a price of 0', async () => {
    const model = await createModel(base.category.id);
    const { invoice, items } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 3, price: 450 }],
    });
    const request = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      items: [{ action: 'CHANGE_PRICE', invoiceItemId: items[0].id, proposedPrice: 0 }],
    });
    const result: any = await service.approve(request.id, base.admin.id);
    expect(result.newTotal).toBe(0);
  });

  it('A12 rejects a negative price at approval', async () => {
    const model = await createModel(base.category.id);
    const { invoice, items } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 3, price: 450 }],
    });
    const request = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      items: [{ action: 'CHANGE_PRICE', invoiceItemId: items[0].id }],
    });
    // Decimal column accepts -5; bypass the DTO to exercise approval validation.
    await prisma.invoiceChangeRequestItem.updateMany({
      where: { requestId: request.id },
      data: { proposedPrice: -5 },
    });
    const code = await approveErrorCode(service.approve(request.id, base.admin.id));
    expect(code).toBe('INVALID_PRICE');
  });

  it('A13 [EXPECTED FAIL] rejects a NaN proposed price instead of treating it as 0', async () => {
    const model = await createModel(base.category.id);
    const { invoice, items } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 3, price: 450 }],
    });
    const request = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      items: [{ action: 'CHANGE_PRICE', invoiceItemId: items[0].id, proposedPrice: 440 }],
    });
    await prisma.$executeRawUnsafe(
      `UPDATE "InvoiceChangeRequestItem" SET "proposedPrice" = 'NaN'::numeric WHERE "requestId" = $1`,
      request.id,
    );

    // Correct behaviour: reject invalid data. Current code maps NaN -> 0.
    const code = await approveErrorCode(service.approve(request.id, base.admin.id));
    expect(code).toBe('INVALID_PRICE');
  });
});

describe('B. Returns', () => {
  it('B1 does not drift refunds across two partial returns (10% discount)', async () => {
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
    });
    await consumeFromLot(items[0].id, lot.id, 3);

    const first = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      type: 'PARTIAL_RETURN',
      items: [{ action: 'RETURN_ITEM', invoiceItemId: items[0].id, quantity: 1 }],
    });
    const firstResult: any = await service.approve(first.id, base.admin.id);
    expect(firstResult.refundTotal).toBe(405);
    expect(await currentTotalOf(invoice.id)).toBe(810);

    const second = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      type: 'PARTIAL_RETURN',
      items: [{ action: 'RETURN_ITEM', invoiceItemId: items[0].id, quantity: 1 }],
    });
    const secondResult: any = await service.approve(second.id, base.admin.id);
    expect(secondResult.refundTotal).toBe(405);
    expect(await currentTotalOf(invoice.id)).toBe(405);
  });

  it('B2 applies return + price change + add item in one request', async () => {
    const model = await createModel(base.category.id);
    const lot = await createLot({
      supplierId: base.supplier.id,
      employeeId: base.sales.id,
      productModelId: model.id,
      quantity: 10,
    });
    const addModel = await createModel(base.category.id);
    const addLot = await createLot({
      supplierId: base.supplier.id,
      employeeId: base.sales.id,
      productModelId: addModel.id,
      quantity: 5,
    });
    const { invoice, items } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 3, price: 450 }],
    });
    await consumeFromLot(items[0].id, lot.id, 3);

    const request = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      type: 'EDIT',
      items: [
        { action: 'RETURN_ITEM', invoiceItemId: items[0].id, quantity: 1 },
        { action: 'CHANGE_PRICE', invoiceItemId: items[0].id, proposedPrice: 440 },
        { action: 'ADD_ITEM', productModelId: addModel.id, quantity: 2, proposedPrice: 100 },
      ],
    });
    const result: any = await service.approve(request.id, base.admin.id);

    // 2 remaining @440 + 2 added @100 = 1080; refund for 1 @450 = 450
    expect(result.refundTotal).toBe(450);
    expect(result.newTotal).toBe(1080);
    expect(await currentTotalOf(invoice.id)).toBe(1080);
    const added = await prisma.invoiceItem.findFirstOrThrow({
      where: { invoiceId: invoice.id, productModelId: addModel.id },
    });
    expect(Number(added.quantity)).toBe(2);
    expect(Number(added.price)).toBe(100);
    const originalLotAfter = await prisma.stockLot.findUniqueOrThrow({ where: { id: lot.id } });
    expect(Number(originalLotAfter.quantityRemaining)).toBe(8); // 7 after sale + 1 returned
    const addLotAfter = await prisma.stockLot.findUniqueOrThrow({ where: { id: addLot.id } });
    expect(Number(addLotAfter.quantityReserved)).toBe(2);
  });

  it('B3 rejects returning more than the remaining quantity', async () => {
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
    });
    await consumeFromLot(items[0].id, lot.id, 3);

    const first = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      type: 'PARTIAL_RETURN',
      items: [{ action: 'RETURN_ITEM', invoiceItemId: items[0].id, quantity: 2 }],
    });
    await service.approve(first.id, base.admin.id);

    const overReturn = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      type: 'PARTIAL_RETURN',
      items: [{ action: 'RETURN_ITEM', invoiceItemId: items[0].id, quantity: 2 }],
    });
    // At approval the outstanding check must reject (direct row bypasses DTO).
    const code = await approveErrorCode(service.approve(overReturn.id, base.admin.id));
    expect(code).toBe('OVER_RETURN');
  });

  it('B4 returns a serialized unit and releases it', async () => {
    const model = await createModel(base.category.id, { isSerialized: true });
    const { invoice, items } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 1, price: 450 }],
    });
    const { unit, assignment } = await createSerializedSoldUnit({
      productModelId: model.id,
      invoiceItemId: items[0].id,
      employeeId: base.sales.id,
      barcode: 'AUD-SERIAL-1',
    });

    const request = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      type: 'FULL_RETURN',
      items: [{ action: 'RETURN_ITEM', invoiceItemId: items[0].id, productUnitId: unit.id }],
    });
    const result: any = await service.approve(request.id, base.admin.id);

    expect(result.refundTotal).toBe(450);
    expect(result.newTotal).toBe(0);
    const unitAfter = await prisma.productUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(unitAfter.status).toBe('AVAILABLE');
    const assignmentAfter = await prisma.invoiceItemUnitAssignment.findUniqueOrThrow({
      where: { id: assignment.id },
    });
    expect(assignmentAfter.reversedAt).not.toBeNull();
    const audit = await prisma.invoiceAuditLog.findFirstOrThrow({
      where: { invoiceId: invoice.id, action: 'FULL_RETURNED' },
    });
    expect(audit).toBeTruthy();
  });

  it('B5 full return of every line yields total 0 and FULL_RETURNED audit', async () => {
    const modelA = await createModel(base.category.id);
    const modelB = await createModel(base.category.id);
    const lotA = await createLot({
      supplierId: base.supplier.id,
      employeeId: base.sales.id,
      productModelId: modelA.id,
      quantity: 10,
    });
    const lotB = await createLot({
      supplierId: base.supplier.id,
      employeeId: base.sales.id,
      productModelId: modelB.id,
      quantity: 10,
    });
    const { invoice, items } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [
        { productModelId: modelA.id, quantity: 2, price: 100 },
        { productModelId: modelB.id, quantity: 1, price: 50 },
      ],
    });
    await consumeFromLot(items[0].id, lotA.id, 2);
    await consumeFromLot(items[1].id, lotB.id, 1);

    const request = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      type: 'FULL_RETURN',
      items: [
        { action: 'RETURN_ITEM', invoiceItemId: items[0].id, quantity: 2 },
        { action: 'RETURN_ITEM', invoiceItemId: items[1].id, quantity: 1 },
      ],
    });
    const result: any = await service.approve(request.id, base.admin.id);

    expect(result.newTotal).toBe(0);
    expect(await currentTotalOf(invoice.id)).toBe(0);
    const audit = await prisma.invoiceAuditLog.findFirstOrThrow({
      where: { invoiceId: invoice.id, action: 'FULL_RETURNED' },
    });
    expect(audit).toBeTruthy();
    // A full return closes the invoice: it is no longer an active sale.
    const invoiceAfter = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(invoiceAfter.status).toBe('CANCELLED');
  });
});

describe('C. Add items', () => {
  it('C1 makes the add delta discount-aware', async () => {
    const model = await createModel(base.category.id);
    const addModel = await createModel(base.category.id);
    await createLot({
      supplierId: base.supplier.id,
      employeeId: base.sales.id,
      productModelId: addModel.id,
      quantity: 10,
    });
    const { invoice } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 3, price: 450 }],
      discountPercentage: 10,
    });
    const request = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      items: [{ action: 'ADD_ITEM', productModelId: addModel.id, quantity: 2, proposedPrice: 100 }],
    });
    const result: any = await service.approve(request.id, base.admin.id);
    expect(result.totalDelta).toBe(180);
    expect(await currentTotalOf(invoice.id)).toBe(1395);
  });

  it('C2 auto-rejects an add-only request when stock is insufficient', async () => {
    const model = await createModel(base.category.id);
    const { invoice } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 1, price: 450 }],
    });
    const request = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      items: [{ action: 'ADD_ITEM', productModelId: model.id, quantity: 1, proposedPrice: 100 }],
    });
    const result: any = await service.approve(request.id, base.admin.id);
    expect(result.status).toBe('REJECTED');
    expect(await currentTotalOf(invoice.id)).toBe(450);
    expect(await prisma.invoiceItem.count({ where: { invoiceId: invoice.id } })).toBe(1);
  });

  it('C3 reserves exactly the available stock', async () => {
    const model = await createModel(base.category.id);
    const lot = await createLot({
      supplierId: base.supplier.id,
      employeeId: base.sales.id,
      productModelId: model.id,
      quantity: 2,
    });
    const { invoice } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 1, price: 450 }],
    });
    // The invoice's own item does not consume the lot in this fixture, so 2 are free.
    const request = await createChangeRequest({
      invoiceId: invoice.id,
      requestedByEmployeeId: base.sales.id,
      items: [{ action: 'ADD_ITEM', productModelId: model.id, quantity: 2, proposedPrice: 100 }],
    });
    const result: any = await service.approve(request.id, base.admin.id);
    expect(result.status).toBe('APPROVED');
    const lotAfter = await prisma.stockLot.findUniqueOrThrow({ where: { id: lot.id } });
    expect(Number(lotAfter.quantityReserved)).toBe(2);
    expect(Number(lotAfter.quantityReserved)).toBeLessThanOrEqual(Number(lotAfter.quantityRemaining));
  });

  it('C4 [EXPECTED FAIL] concurrent adds on different invoices cannot oversell the last unit', async () => {
    const model = await createModel(base.category.id);
    const lot = await createLot({
      supplierId: base.supplier.id,
      employeeId: base.sales.id,
      productModelId: model.id,
      quantity: 1,
    });
    const competitors = 8;
    const entries: { invoiceId: number; requestId: number }[] = [];
    for (let i = 0; i < competitors; i += 1) {
      const created = await createInvoice({
        customerId: base.customer.id,
        employeeId: base.sales.id,
        items: [{ productModelId: model.id, quantity: 1, price: 10 }],
      });
      const request = await createChangeRequest({
        invoiceId: created.invoice.id,
        requestedByEmployeeId: base.sales.id,
        items: [{ action: 'ADD_ITEM', productModelId: model.id, quantity: 1, proposedPrice: 100 }],
      });
      entries.push({ invoiceId: created.invoice.id, requestId: request.id });
    }

    // Force the race deterministically: hold a row lock on the lot so every
    // approval passes its Phase-1 stock check (a plain read is not blocked)
    // and then blocks on the Phase-2 `UPDATE ... increment`. Once the lock is
    // released, every transaction applies its unconditional increment.
    let releaseLock: () => void = () => undefined;
    const lockHeld = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockTransaction = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "StockLot" WHERE id = ${lot.id} FOR UPDATE`;
      await lockHeld;
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const approvals = Promise.allSettled(
      entries.map((entry) => service.approve(entry.requestId, base.admin.id)),
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    releaseLock();
    await lockTransaction;
    await approvals;

    const approvedRequests = await prisma.invoiceChangeRequest.count({
      where: { id: { in: entries.map((entry) => entry.requestId) }, status: 'APPROVED' },
    });
    const approvedAdds = await prisma.invoiceAuditLog.count({
      where: { invoiceId: { in: entries.map((entry) => entry.invoiceId) }, action: 'ITEM_ADDED' },
    });
    const lotAfter = await prisma.stockLot.findUniqueOrThrow({ where: { id: lot.id } });

    // Only one unit exists, so at most one add may be approved.
    expect(approvedRequests).toBe(1);
    expect(approvedAdds).toBe(1);
    expect(Number(lotAfter.quantityReserved)).toBe(1);
    expect(Number(lotAfter.quantityReserved)).toBeLessThanOrEqual(Number(lotAfter.quantityRemaining));
  });
});

describe('D. Rounding consistency', () => {
  it('D1 [EXPECTED FAIL] creation total equals a no-change recompute for fractional lines', async () => {
    const model = await createModel(base.category.id);
    const { invoice } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [
        { productModelId: model.id, quantity: 1, price: 33.33 },
        { productModelId: model.id, quantity: 1, price: 33.33 },
        { productModelId: model.id, quantity: 1, price: 33.33 },
      ],
      discountPercentage: 10,
    });
    expect(Number(invoice.currentTotal)).toBe(89.99);

    const state: any = await (service as any).computeInvoiceFinancialState(prisma, invoice.id);
    expect(state.total).toBe(89.99);
  });

  it('D2 creation total equals a no-change recompute for an ordinary invoice', async () => {
    const model = await createModel(base.category.id);
    const { invoice } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 3, price: 450 }],
      discountPercentage: 10,
    });
    const state: any = await (service as any).computeInvoiceFinancialState(prisma, invoice.id);
    expect(state.total).toBe(Number(invoice.currentTotal));
  });

  it('D3 handles 0.1 + 0.2 without float drift', async () => {
    const model = await createModel(base.category.id);
    const { invoice } = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [
        { productModelId: model.id, quantity: 1, price: 0.1 },
        { productModelId: model.id, quantity: 1, price: 0.2 },
      ],
    });
    expect(Number(invoice.currentTotal)).toBe(0.3);
    const state: any = await (service as any).computeInvoiceFinancialState(prisma, invoice.id);
    expect(state.total).toBe(0.3);
  });
});
