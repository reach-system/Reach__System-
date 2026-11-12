import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { QuotationsService } from '../src/quotations/quotations.service';
import { formatDateInTimeZone } from '../src/common/quotation-time.util';

jest.setTimeout(60000);

type TestData = {
  categoryId: number;
  modelId: number;
  modelName: string;
  otherModelId: number;
  customerId: number;
  secondCustomerId: number;
  supplierId: number;
  receiptId: number;
  lotId: number;
};

const addDaysToDateOnly = (dateOnly: string, days: number): string => {
  const date = new Date(`${dateOnly}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

describe('Quotations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let quotationsService: QuotationsService;
  let adminId: number;
  let salesId: number;
  let foreignSalesId: number;
  let ids: TestData;
  const tokens: Record<string, string> = {};
  const unique = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const authorize = (token: string) => ({ Authorization: `Bearer ${token}` });

  const createQuotation = (token: string, overrides: Record<string, any> = {}) =>
    request(app.getHttpServer())
      .post('/api/quotations')
      .set(authorize(token))
      .send({
        customerId: ids.customerId,
        validUntil: addDaysToDateOnly(formatDateInTimeZone(new Date()), 14),
        items: [{ productModelId: ids.modelId, quantity: 1, price: 100 }],
        ...overrides,
      });

  const convertQuotation = (
    token: string,
    quotationId: number,
    items: Array<{ productModelId: number; quantity: number; price: number }>,
    overrides: Record<string, any> = {},
  ) =>
    request(app.getHttpServer())
      .post('/api/invoices')
      .set(authorize(token))
      .send({ customerId: ids.customerId, fromQuotationId: quotationId, items, ...overrides });

  const lifecycle = async (token: string, overrides: Record<string, any> = {}) => {
    const created = await createQuotation(token, overrides).expect(201);
    const sent = await request(app.getHttpServer())
      .patch(`/api/quotations/${created.body.id}/send`)
      .set(authorize(token))
      .expect(200);
    return { created: created.body, sent: sent.body };
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    prisma = app.get(PrismaService);
    quotationsService = app.get(QuotationsService);

    const login = async (username: string, password: string) => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username, password })
        .expect(201);
      return response.body.accessToken as string;
    };

    tokens.admin = await login('testadmin', 'admin123');
    tokens.sales = await login('testsales', 'sales123');
    tokens.accountant = await login('testaccountant', 'accountant123');
    tokens.inventory = await login('testinventory', 'inventory123');

    const admin = await prisma.employee.findUniqueOrThrow({ where: { username: 'testadmin' } });
    const sales = await prisma.employee.findUniqueOrThrow({ where: { username: 'testsales' } });
    adminId = admin.id;
    salesId = sales.id;

    const foreignSales = await prisma.employee.create({
      data: {
        name: 'Foreign Sales',
        username: `foreign-sales-${unique()}`,
        passwordHash: await argon2.hash('sales123'),
        role: 'SALES',
        isActive: true,
      },
    });
    foreignSalesId = foreignSales.id;
    tokens.foreignSales = await login(foreignSales.username, 'sales123');
  });

  beforeEach(async () => {
    const stamp = unique();
    const category = await prisma.category.create({
      data: { name: `Quotation Category ${stamp}`, isActive: true },
    });

    const model = await prisma.productModel.create({
      data: {
        categoryId: category.id,
        name: `Quotation Model ${stamp}`,
        isSerialized: false,
        unit: 'PIECE',
        minStockAlert: 5,
        isActive: true,
      },
    });

    const otherModel = await prisma.productModel.create({
      data: {
        categoryId: category.id,
        name: `Quotation Other Model ${stamp}`,
        isSerialized: false,
        unit: 'PIECE',
        minStockAlert: 5,
        isActive: true,
      },
    });

    const customer = await prisma.customer.create({
      data: { name: `Quotation Customer ${stamp}`, type: 'INDIVIDUAL', phone: '+201000000111', isActive: true },
    });

    const secondCustomer = await prisma.customer.create({
      data: { name: `Quotation Second Customer ${stamp}`, type: 'INDIVIDUAL', phone: '+201000000222', isActive: true },
    });

    const supplier = await prisma.supplier.create({
      data: { name: `Quotation Supplier ${stamp}`, phone: '+202000000333', address: 'Test Address', isActive: true },
    });

    const receipt = await prisma.stockReceipt.create({
      data: {
        employeeId: adminId,
        supplierId: supplier.id,
        status: 'PRICED',
        pricedByEmployeeId: adminId,
        pricedAt: new Date(),
        date: new Date(),
      },
    });

    const lot = await prisma.stockLot.create({
      data: {
        productModelId: model.id,
        stockReceiptId: receipt.id,
        supplierId: supplier.id,
        quantityReceived: 50,
        quantityRemaining: 50,
        quantityReserved: 0,
        purchasePrice: 40,
        receivedDate: new Date(),
      },
    });

    // Conversion through the invoice flow requires stock for every quoted model.
    await prisma.stockLot.create({
      data: {
        productModelId: otherModel.id,
        stockReceiptId: receipt.id,
        supplierId: supplier.id,
        quantityReceived: 50,
        quantityRemaining: 50,
        quantityReserved: 0,
        purchasePrice: 45,
        receivedDate: new Date(),
      },
    });

    ids = {
      categoryId: category.id,
      modelId: model.id,
      modelName: model.name,
      otherModelId: otherModel.id,
      customerId: customer.id,
      secondCustomerId: secondCustomer.id,
      supplierId: supplier.id,
      receiptId: receipt.id,
      lotId: lot.id,
    };
  });

  afterEach(async () => {
    await prisma.notification.deleteMany();
    await prisma.stockConsumption.deleteMany();
    await prisma.stockAdjustment.deleteMany();
    await prisma.invoicePriceAdjustment.deleteMany();
    await prisma.invoiceReturnItem.deleteMany();
    await prisma.invoiceReturn.deleteMany();
    await prisma.invoiceChangeRequestItem.deleteMany();
    await prisma.invoiceChangeRequest.deleteMany();
    await prisma.quotationEvent.deleteMany();
    await prisma.quotationItem.deleteMany();
    await prisma.quotation.deleteMany();
    await prisma.quotationSequence.deleteMany();
    await prisma.invoiceItemUnitAssignment.deleteMany();
    await prisma.invoiceItem.deleteMany();
    await prisma.productUnitAuditLog.deleteMany();
    await prisma.invoiceAuditLog.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.stockLot.deleteMany();
    await prisma.stockReceiptItem.deleteMany();
    await prisma.stockReceipt.deleteMany();
    await prisma.productModel.deleteMany();
    await prisma.category.deleteMany();
    await prisma.supplier.deleteMany();
    await prisma.customer.deleteMany();
  });

  afterAll(async () => {
    await prisma.employee.deleteMany({ where: { id: foreignSalesId } });
    await app.close();
  });

  describe('permissions', () => {
    it('denies every quotation endpoint to Accountant and Inventory roles', async () => {
      for (const token of [tokens.accountant, tokens.inventory]) {
        await request(app.getHttpServer()).get('/api/quotations').set(authorize(token)).expect(403);
        await createQuotation(token).expect(403);
        await request(app.getHttpServer()).get('/api/quotations/report?from=2026-01-01&to=2026-12-31').set(authorize(token)).expect(403);
        await request(app.getHttpServer()).get('/api/quotations/report/details?from=2026-01-01&to=2026-12-31').set(authorize(token)).expect(403);
        await request(app.getHttpServer()).delete('/api/quotations/1').set(authorize(token)).expect(403);
      }
    });

    it('lets Sales read all quotations but only mutate their own, and reserves delete/report for Admin', async () => {
      const foreign = await createQuotation(tokens.foreignSales).expect(201);
      const foreignId = foreign.body.id;

      // Sales can read another salesperson's quotation.
      await request(app.getHttpServer()).get(`/api/quotations/${foreignId}`).set(authorize(tokens.sales)).expect(200);

      // ...but cannot mutate it.
      await request(app.getHttpServer())
        .patch(`/api/quotations/${foreignId}`)
        .set(authorize(tokens.sales))
        .send({ items: [{ productModelId: ids.modelId, quantity: 2, price: 100 }] })
        .expect(403);
      await request(app.getHttpServer()).patch(`/api/quotations/${foreignId}/send`).set(authorize(tokens.sales)).expect(403);
      await request(app.getHttpServer()).post(`/api/quotations/${foreignId}/revise`).set(authorize(tokens.sales)).send({}).expect(403);

      // Admin may mutate any quotation.
      await request(app.getHttpServer())
        .patch(`/api/quotations/${foreignId}`)
        .set(authorize(tokens.admin))
        .send({ notes: 'Admin touch' })
        .expect(200);

      // Admin-only surfaces.
      await request(app.getHttpServer()).get('/api/quotations/report?from=2026-01-01&to=2026-12-31').set(authorize(tokens.sales)).expect(403);
      await request(app.getHttpServer()).delete(`/api/quotations/${foreignId}`).set(authorize(tokens.sales)).expect(403);
      await request(app.getHttpServer()).delete(`/api/quotations/${foreignId}`).set(authorize(tokens.admin)).expect(200);
    });
  });

  describe('validation', () => {
    it('rejects unknown product models, inactive customers, past validity and oversized line discounts', async () => {
      const missingModel = await createQuotation(tokens.sales, {
        items: [{ productModelId: 999999, quantity: 1, price: 100 }],
      }).expect(404);
      expect(missingModel.body.code).toBe('PRODUCT_MODEL_NOT_FOUND');

      await prisma.customer.update({ where: { id: ids.customerId }, data: { isActive: false } });
      const inactiveCustomer = await createQuotation(tokens.sales).expect(404);
      expect(inactiveCustomer.body.code).toBe('CUSTOMER_NOT_FOUND');

      await prisma.customer.update({ where: { id: ids.customerId }, data: { isActive: true } });
      const pastValidity = await createQuotation(tokens.sales, { validUntil: '2020-01-01' }).expect(400);
      expect(pastValidity.body.code).toBe('INVALID_VALID_UNTIL');

      const bigLineDiscount = await createQuotation(tokens.sales, {
        items: [{ productModelId: ids.modelId, quantity: 1, price: 100, lineDiscount: 101 }],
      }).expect(400);
      expect(bigLineDiscount.body.code).toBe('INVALID_LINE_DISCOUNT');
    });
  });

  describe('draft lifecycle and server-side totals', () => {
    it('creates a draft with server-computed totals, keeps snapshots and ignores client-supplied totals', async () => {
      const response = await createQuotation(tokens.sales, {
        items: [
          { productModelId: ids.modelId, quantity: 2, price: 100, lineDiscount: 10 },
          { productModelId: ids.otherModelId, quantity: 1, price: 50 },
        ],
        discountPercentage: 10,
        discountAmount: 5,
        // Hostile/naive client values must never be persisted.
        subtotal: 1,
        lineDiscountTotal: 1,
        total: 1,
      }).expect(201);

      expect(response.body.status).toBe('DRAFT');
      expect(response.body.quotationNumber).toMatch(/^Q-\d{4,}$/);
      expect(Number(response.body.subtotal)).toBe(250);
      expect(Number(response.body.lineDiscountTotal)).toBe(10);
      expect(Number(response.body.discountPercentage)).toBe(10);
      expect(Number(response.body.discountAmount)).toBe(5);
      expect(Number(response.body.total)).toBe(211);
      expect(response.body.effectiveStatus).toBe('DRAFT');
      expect(response.body.isExpired).toBe(false);
      expect(response.body.items).toHaveLength(2);
      expect(response.body.events.map((event: { type: string }) => event.type)).toContain('CREATED');

      // Product meta is snapshotted, not joined live.
      await prisma.productModel.update({ where: { id: ids.modelId }, data: { name: 'Renamed After Quote' } });
      const detail = await request(app.getHttpServer())
        .get(`/api/quotations/${response.body.id}`)
        .set(authorize(tokens.sales))
        .expect(200);
      expect(detail.body.items[0].productName).toBe(ids.modelName);
      expect(detail.body.items[0].productName).not.toBe('Renamed After Quote');

      // Quotation is not a financial document: it must not touch stock.
      const lot = await prisma.stockLot.findUniqueOrThrow({ where: { id: ids.lotId } });
      expect(Number(lot.quantityReserved)).toBe(0);

      // No cost/COGS leaks in the response.
      const serialized = JSON.stringify(detail.body);
      expect(serialized).not.toContain('purchasePrice');
      expect(serialized).not.toContain('costPrice');
      expect(serialized).not.toContain('cogs');
    });

    it('edits only DRAFT quotations and records a before/after audit snapshot', async () => {
      const created = await createQuotation(tokens.sales).expect(201);

      const patched = await request(app.getHttpServer())
        .patch(`/api/quotations/${created.body.id}`)
        .set(authorize(tokens.sales))
        .send({
          items: [{ productModelId: ids.modelId, quantity: 1, price: 100, lineDiscount: 10 }],
          notes: 'Updated note',
        })
        .expect(200);

      expect(Number(patched.body.subtotal)).toBe(100);
      expect(Number(patched.body.lineDiscountTotal)).toBe(10);
      expect(Number(patched.body.total)).toBe(90);
      expect(patched.body.notes).toBe('Updated note');

      const updatedEvent = patched.body.events.find((event: { type: string }) => event.type === 'UPDATED');
      expect(updatedEvent).toBeTruthy();
      expect(Number(updatedEvent.metadata.before.total)).toBe(100);
      expect(Number(updatedEvent.metadata.after.total)).toBe(90);

      await request(app.getHttpServer())
        .patch(`/api/quotations/${created.body.id}/send`)
        .set(authorize(tokens.sales))
        .expect(200);

      const locked = await request(app.getHttpServer())
        .patch(`/api/quotations/${created.body.id}`)
        .set(authorize(tokens.sales))
        .send({ notes: 'Too late' })
        .expect(400);
      expect(locked.body.code).toBe('QUOTATION_NOT_EDITABLE');
    });

    it('walks DRAFT -> SENT -> ACCEPTED -> CONVERTED and produces a PENDING_ACCOUNTANT invoice', async () => {
      const created = await createQuotation(tokens.sales, {
        items: [
          { productModelId: ids.modelId, quantity: 2, price: 100, lineDiscount: 10 },
          { productModelId: ids.otherModelId, quantity: 1, price: 50 },
        ],
        discountPercentage: 10,
        discountAmount: 5,
      }).expect(201);

      const sent = await request(app.getHttpServer())
        .patch(`/api/quotations/${created.body.id}/send`)
        .set(authorize(tokens.sales))
        .expect(200);
      expect(sent.body.status).toBe('SENT');
      expect(sent.body.sentAt).toBeTruthy();

      const accepted = await request(app.getHttpServer())
        .patch(`/api/quotations/${created.body.id}/accept`)
        .set(authorize(tokens.sales))
        .expect(200);
      expect(accepted.body.status).toBe('ACCEPTED');
      expect(accepted.body.acceptedAt).toBeTruthy();

      const invoice = await convertQuotation(
        tokens.sales,
        created.body.id,
        [
          { productModelId: ids.modelId, quantity: 2, price: 100 },
          { productModelId: ids.otherModelId, quantity: 1, price: 50 },
        ],
        // The invoice form collapses the quotation's per-line and percentage
        // discounts into one fixed discount before saving; the invoice stores
        // exactly what it receives.
        { discountPercentage: 0, discountAmount: 39, total: 1 },
      ).expect(201);

      expect(invoice.body.status).toBe('PENDING_ACCOUNTANT');
      expect(invoice.body.fromQuotationId).toBe(created.body.id);
      expect(invoice.body.quotationNumber).toBe(created.body.quotationNumber);
      expect(Number(invoice.body.originalTotal)).toBe(250);
      expect(Number(invoice.body.discountPercentage)).toBe(0);
      expect(Number(invoice.body.discountAmount)).toBe(39);
      expect(Number(invoice.body.currentTotal)).toBe(211);

      const converted = await request(app.getHttpServer())
        .get(`/api/quotations/${created.body.id}`)
        .set(authorize(tokens.sales))
        .expect(200);
      expect(converted.body.status).toBe('CONVERTED');
      expect(converted.body.convertedInvoiceId).toBe(invoice.body.id);
      expect(converted.body.convertedInvoice.invoiceNumber).toBe(invoice.body.invoiceNumber);
      expect(converted.body.events.map((event: { type: string }) => event.type)).toContain('CONVERTED');

      // Conversion reserves stock through the normal invoice flow (per model).
      const lot = await prisma.stockLot.findUniqueOrThrow({ where: { id: ids.lotId } });
      const otherLot = await prisma.stockLot.findFirstOrThrow({ where: { productModelId: ids.otherModelId } });
      expect(Number(lot.quantityReserved)).toBe(2);
      expect(Number(otherLot.quantityReserved)).toBe(1);

      // A converted quotation is immutable and cannot be deleted.
      const secondConversion = await convertQuotation(tokens.sales, created.body.id, [
        { productModelId: ids.modelId, quantity: 2, price: 100 },
        { productModelId: ids.otherModelId, quantity: 1, price: 50 },
      ]).expect(409);
      expect(secondConversion.body.code).toBe('QUOTATION_ALREADY_CONVERTED');

      const deletion = await request(app.getHttpServer())
        .delete(`/api/quotations/${created.body.id}`)
        .set(authorize(tokens.admin))
        .expect(400);
      expect(deletion.body.code).toBe('QUOTATION_CONVERTED');
    });

    it('reports exactly which product is short and its available/requested counts', async () => {
      const created = await createQuotation(tokens.sales, {
        items: [{ productModelId: ids.modelId, quantity: 51, price: 100 }],
      }).expect(201);

      await request(app.getHttpServer())
        .patch(`/api/quotations/${created.body.id}/send`)
        .set(authorize(tokens.sales))
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/quotations/${created.body.id}/accept`)
        .set(authorize(tokens.sales))
        .expect(200);

      const shortage = await convertQuotation(tokens.sales, created.body.id, [
        { productModelId: ids.modelId, quantity: 51, price: 100 },
      ]).expect(400);

      expect(shortage.body.code).toBe('INSUFFICIENT_STOCK');
      expect(shortage.body.productName).toBe(ids.modelName);
      expect(Number(shortage.body.available)).toBe(50);
      expect(Number(shortage.body.requested)).toBe(51);
      expect(shortage.body.message).toContain(ids.modelName);
    });
  });

  describe('rejections and revisions', () => {
    it('rejects, records the reason and allows revising the rejected quotation', async () => {
      const { created } = await lifecycle(tokens.sales);

      const rejected = await request(app.getHttpServer())
        .patch(`/api/quotations/${created.id}/reject`)
        .set(authorize(tokens.sales))
        .send({ reason: 'Price too high' })
        .expect(200);
      expect(rejected.body.status).toBe('REJECTED');
      expect(rejected.body.rejectedReason).toBe('Price too high');
      expect(rejected.body.events.some((event: { type: string; message: string }) => event.type === 'REJECTED' && event.message.includes('Price too high'))).toBe(true);

      await request(app.getHttpServer())
        .patch(`/api/quotations/${created.id}/accept`)
        .set(authorize(tokens.sales))
        .expect(400);

      const revision = await request(app.getHttpServer())
        .post(`/api/quotations/${created.id}/revise`)
        .set(authorize(tokens.sales))
        .send({ notes: 'Revised offer' })
        .expect(201);

      expect(revision.body.status).toBe('DRAFT');
      expect(revision.body.revisedFromId).toBe(created.id);
      expect(revision.body.quotationNumber).not.toBe(created.quotationNumber);
      expect(revision.body.notes).toBe('Revised offer');
      expect(Number(revision.body.total)).toBe(Number(created.total));

      const original = await request(app.getHttpServer())
        .get(`/api/quotations/${created.id}`)
        .set(authorize(tokens.sales))
        .expect(200);
      expect(original.body.status).toBe('REJECTED');
      expect(original.body.revisions.map((row: { id: number }) => row.id)).toContain(revision.body.id);
      expect(original.body.events.map((event: { type: string }) => event.type)).toContain('REVISED');

      // Only SENT / REJECTED / EXPIRED can be revised.
      await request(app.getHttpServer())
        .post(`/api/quotations/${revision.body.id}/revise`)
        .set(authorize(tokens.sales))
        .send({})
        .expect(400);
    });

    it('keeps numbering continuous per quotation', async () => {
      const first = await createQuotation(tokens.sales).expect(201);
      const second = await createQuotation(tokens.sales).expect(201);

      const firstNumber = Number(first.body.quotationNumber.replace('Q-', ''));
      const secondNumber = Number(second.body.quotationNumber.replace('Q-', ''));
      expect(secondNumber).toBe(firstNumber + 1);
    });
  });

  describe('expiry', () => {
    it('blocks accept and convert after the validity instant and lets the sweep persist EXPIRED', async () => {
      const { created } = await lifecycle(tokens.sales);
      const expiredAt = new Date(Date.now() - 60 * 1000);
      await prisma.quotation.update({ where: { id: created.id }, data: { validUntil: expiredAt } });

      const accept = await request(app.getHttpServer())
        .patch(`/api/quotations/${created.id}/accept`)
        .set(authorize(tokens.sales))
        .expect(400);
      expect(['QUOTATION_EXPIRED', 'INVALID_QUOTATION_STATUS']).toContain(accept.body.code);

      const convert = await convertQuotation(tokens.sales, created.id, [
        { productModelId: ids.modelId, quantity: 1, price: 100 },
      ]).expect(400);
      expect(['QUOTATION_EXPIRED', 'INVALID_QUOTATION_STATUS']).toContain(convert.body.code);

      // The scheduled sweep is idempotent and records an EXPIRED event.
      await quotationsService.expireOverdueQuotations();
      await quotationsService.expireOverdueQuotations();

      const expired = await prisma.quotation.findUniqueOrThrow({ where: { id: created.id } });
      expect(expired.status).toBe('EXPIRED');
      const expiredEvents = await prisma.quotationEvent.count({
        where: { quotationId: created.id, type: 'EXPIRED' },
      });
      expect(expiredEvents).toBe(1);
    });

    it('reports effective expiry on read even before the sweep runs', async () => {
      const { created } = await lifecycle(tokens.sales);
      await prisma.quotation.update({
        where: { id: created.id },
        data: { validUntil: new Date(Date.now() - 60 * 1000), status: 'SENT' },
      });

      const detail = await request(app.getHttpServer())
        .get(`/api/quotations/${created.id}`)
        .set(authorize(tokens.sales))
        .expect(200);
      expect(detail.body.status).toBe('SENT');
      expect(detail.body.effectiveStatus).toBe('EXPIRED');
      expect(detail.body.isExpired).toBe(true);
    });
  });

  describe('conversion guards', () => {
    it('refuses DRAFT and mismatched-customer conversions but allows editing and adding items', async () => {
      const draft = await createQuotation(tokens.sales).expect(201);
      const draftConversion = await convertQuotation(tokens.sales, draft.body.id, [
        { productModelId: ids.modelId, quantity: 1, price: 100 },
      ]).expect(400);
      expect(draftConversion.body.code).toBe('INVALID_QUOTATION_STATUS');

      const { created } = await lifecycle(tokens.sales, {
        items: [{ productModelId: ids.modelId, quantity: 2, price: 100 }],
      });

      const customerMismatch = await convertQuotation(tokens.sales, created.id, [
        { productModelId: ids.modelId, quantity: 2, price: 100 },
      ], { customerId: ids.secondCustomerId }).expect(400);
      expect(customerMismatch.body.code).toBe('QUOTATION_CUSTOMER_MISMATCH');

      // Editing the quoted line and adding a brand-new line must be accepted:
      // the quotation is a starting point, not a locked basket.
      const editedInvoice = await convertQuotation(tokens.sales, created.id, [
        { productModelId: ids.modelId, quantity: 3, price: 120 },
        { productModelId: ids.otherModelId, quantity: 1, price: 90 },
      ]).expect(201);
      expect(editedInvoice.body.fromQuotationId).toBe(created.id);

      const invoiceItems = await prisma.invoiceItem.findMany({
        where: { invoiceId: editedInvoice.body.id },
      });
      expect(invoiceItems).toHaveLength(2);
      const editedLine = invoiceItems.find((item) => item.productModelId === ids.modelId);
      expect(Number(editedLine?.quantity)).toBe(3);
      expect(Number(editedLine?.price)).toBe(120);
      expect(Number(editedInvoice.body.originalTotal)).toBe(450);

      const quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: created.id } });
      expect(quotation.status).toBe('CONVERTED');
      expect(quotation.convertedInvoiceId).toBe(editedInvoice.body.id);
    });

    it('allows exactly one invoice when two conversions race', async () => {
      const { created } = await lifecycle(tokens.sales, {
        items: [{ productModelId: ids.modelId, quantity: 2, price: 100 }],
      });
      const body = {
        customerId: ids.customerId,
        fromQuotationId: created.id,
        items: [{ productModelId: ids.modelId, quantity: 2, price: 100 }],
      };

      const [first, second] = await Promise.all([
        request(app.getHttpServer()).post('/api/invoices').set(authorize(tokens.sales)).send(body),
        request(app.getHttpServer()).post('/api/invoices').set(authorize(tokens.sales)).send(body),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);

      const quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: created.id } });
      expect(quotation.status).toBe('CONVERTED');
      expect(quotation.convertedInvoiceId).not.toBeNull();

      const invoices = await prisma.invoice.count();
      expect(invoices).toBe(1);
    });
  });

  describe('list, filters and pagination', () => {
    it('paginates, searches, sorts and decorates rows server-side', async () => {
      const low = await createQuotation(tokens.sales, {
        items: [{ productModelId: ids.modelId, quantity: 1, price: 100 }],
      }).expect(201);
      const mid = await createQuotation(tokens.sales, {
        items: [{ productModelId: ids.modelId, quantity: 1, price: 200 }],
      }).expect(201);
      const high = await createQuotation(tokens.sales, {
        items: [{ productModelId: ids.modelId, quantity: 1, price: 300 }],
      }).expect(201);

      const firstPage = await request(app.getHttpServer())
        .get('/api/quotations?page=1&limit=2&sortBy=total&sortDir=asc')
        .set(authorize(tokens.sales))
        .expect(200);
      expect(firstPage.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
      expect(firstPage.body.data.map((row: { id: number }) => row.id)).toEqual([low.body.id, mid.body.id]);
      expect(firstPage.body.data[0].itemCount).toBe(1);
      expect(firstPage.body.data[0].effectiveStatus).toBe('DRAFT');

      const secondPage = await request(app.getHttpServer())
        .get('/api/quotations?page=2&limit=2&sortBy=total&sortDir=asc')
        .set(authorize(tokens.sales))
        .expect(200);
      expect(secondPage.body.data.map((row: { id: number }) => row.id)).toEqual([high.body.id]);

      const byNumber = await request(app.getHttpServer())
        .get(`/api/quotations?search=${mid.body.quotationNumber}`)
        .set(authorize(tokens.sales))
        .expect(200);
      expect(byNumber.body.data).toHaveLength(1);
      expect(byNumber.body.data[0].id).toBe(mid.body.id);

      const byEmployee = await request(app.getHttpServer())
        .get(`/api/quotations?employeeId=${salesId}`)
        .set(authorize(tokens.sales))
        .expect(200);
      expect(byEmployee.body.meta.total).toBe(3);
    });

    it('separates SENT from overdue EXPIRED, excludes soft-deleted rows and hides detail after deletion', async () => {
      const { created: overdue } = await lifecycle(tokens.sales);
      const { created: open } = await lifecycle(tokens.sales);
      const removed = (await createQuotation(tokens.sales).expect(201)).body;

      await prisma.quotation.update({
        where: { id: overdue.id },
        data: { validUntil: new Date(Date.now() - 60 * 1000), status: 'SENT' },
      });
      await request(app.getHttpServer())
        .delete(`/api/quotations/${removed.id}`)
        .set(authorize(tokens.admin))
        .expect(200);

      const sent = await request(app.getHttpServer())
        .get('/api/quotations?status=SENT')
        .set(authorize(tokens.sales))
        .expect(200);
      expect(sent.body.data.map((row: { id: number }) => row.id)).toEqual([open.id]);

      const expired = await request(app.getHttpServer())
        .get('/api/quotations?status=EXPIRED')
        .set(authorize(tokens.sales))
        .expect(200);
      expect(expired.body.data.map((row: { id: number }) => row.id)).toEqual([overdue.id]);
      expect(expired.body.data[0].effectiveStatus).toBe('EXPIRED');

      const all = await request(app.getHttpServer())
        .get('/api/quotations?limit=100')
        .set(authorize(tokens.sales))
        .expect(200);
      expect(all.body.meta.total).toBe(2);

      await request(app.getHttpServer())
        .get(`/api/quotations/${removed.id}`)
        .set(authorize(tokens.sales))
        .expect(404);
    });

    it('rejects invalid status and date filters', async () => {
      const invalidStatus = await request(app.getHttpServer())
        .get('/api/quotations?status=NOPE')
        .set(authorize(tokens.sales))
        .expect(400);
      expect(invalidStatus.body.code).toBe('INVALID_STATUS');

      const invalidDate = await request(app.getHttpServer())
        .get('/api/quotations?from=11-11-2026')
        .set(authorize(tokens.sales))
        .expect(400);
      expect(invalidDate.body.code).toBe('INVALID_DATE');
    });
  });

  describe('report', () => {
    it('aggregates per status and salesperson, excludes soft-deleted rows and normalises overdue SENT', async () => {
      const today = formatDateInTimeZone(new Date());
      const range = `from=${addDaysToDateOnly(today, -1)}&to=${addDaysToDateOnly(today, 1)}`;
      const customerName = `Report Customer ${unique()}`;
      const customer = await prisma.customer.create({
        data: { name: customerName, type: 'INDIVIDUAL', isActive: true },
      });

      const make = async (price: number) =>
        (await createQuotation(tokens.sales, {
          customerId: customer.id,
          items: [{ productModelId: ids.modelId, quantity: 1, price }],
        }).expect(201)).body;

      const draft = await make(100);
      const sent = await make(200);
      const accepted = await make(300);
      const expired = await make(400);
      const converted = await make(500);
      const overdue = await make(600);
      const deleted = await make(900);

      await prisma.quotation.update({ where: { id: sent.id }, data: { status: 'SENT' } });
      await prisma.quotation.update({ where: { id: accepted.id }, data: { status: 'ACCEPTED' } });
      await prisma.quotation.update({ where: { id: expired.id }, data: { status: 'EXPIRED' } });
      await prisma.quotation.update({ where: { id: converted.id }, data: { status: 'CONVERTED' } });
      await prisma.quotation.update({
        where: { id: overdue.id },
        data: { status: 'SENT', validUntil: new Date(Date.now() - 60 * 1000) },
      });
      await prisma.quotation.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });

      const report = await request(app.getHttpServer())
        .get(`/api/quotations/report?${range}&search=${encodeURIComponent(customerName)}`)
        .set(authorize(tokens.admin))
        .expect(200);

      expect(report.body.summary.totalCount).toBe(6);
      expect(report.body.summary.quotedValue).toBe(2100);
      expect(report.body.summary.convertedCount).toBe(1);
      expect(report.body.summary.convertedValue).toBe(500);
      expect(report.body.summary.conversionRate).toBe(20);
      expect(report.body.summary.averageValue).toBe(350);

      const byStatus = Object.fromEntries(
        report.body.byStatus.map((row: { status: string; count: number; value: number }) => [row.status, row]),
      );
      expect(byStatus.DRAFT).toEqual({ status: 'DRAFT', count: 1, value: 100 });
      expect(byStatus.SENT).toEqual({ status: 'SENT', count: 1, value: 200 });
      expect(byStatus.ACCEPTED).toEqual({ status: 'ACCEPTED', count: 1, value: 300 });
      expect(byStatus.EXPIRED).toEqual({ status: 'EXPIRED', count: 2, value: 1000 });
      expect(byStatus.CONVERTED).toEqual({ status: 'CONVERTED', count: 1, value: 500 });
      expect(byStatus.REJECTED).toEqual({ status: 'REJECTED', count: 0, value: 0 });

      expect(report.body.bySalesperson).toHaveLength(1);
      expect(report.body.bySalesperson[0]).toMatchObject({
        employeeId: salesId,
        count: 6,
        quotedValue: 2100,
        convertedCount: 1,
        convertedValue: 500,
        conversionRate: 16.67,
      });

      const details = await request(app.getHttpServer())
        .get(`/api/quotations/report/details?${range}&search=${encodeURIComponent(customerName)}&all=1`)
        .set(authorize(tokens.admin))
        .expect(200);
      expect(details.body.meta.total).toBe(6);
      expect(details.body.data).toHaveLength(6);
      expect(details.body.data.some((row: { id: number }) => row.id === deleted.id)).toBe(false);

      const expiredDetails = await request(app.getHttpServer())
        .get(`/api/quotations/report/details?${range}&search=${encodeURIComponent(customerName)}&status=EXPIRED`)
        .set(authorize(tokens.admin))
        .expect(200);
      expect(expiredDetails.body.data.map((row: { id: number }) => row.id).sort()).toEqual([expired.id, overdue.id].sort());

      const filtered = await request(app.getHttpServer())
        .get(`/api/quotations/report?${range}&status=EXPIRED&search=${encodeURIComponent(customerName)}`)
        .set(authorize(tokens.admin))
        .expect(200);
      expect(filtered.body.summary.totalCount).toBe(2);
      expect(filtered.body.summary.quotedValue).toBe(1000);
      expect(filtered.body.byStatus).toHaveLength(1);

      const invalidRange = await request(app.getHttpServer())
        .get('/api/quotations/report?from=2026-12-31&to=2026-01-01')
        .set(authorize(tokens.admin))
        .expect(400);
      expect(invalidRange.body.code).toBe('INVALID_DATE_RANGE');
    });
  });
});
