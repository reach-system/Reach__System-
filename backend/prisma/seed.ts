import {
  PrismaClient,
  Role,
  ProductModel,
  UnitOfMeasure,
} from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

/* ------------------------------------------------------------------ */
/*  Product catalog — Stocktake 28/9/2026                             */
/* ------------------------------------------------------------------ */

type SeedProduct = {
  category: string;
  name: string;
  isSerialized: boolean;
  quantity: number;
  unit: UnitOfMeasure;
};

/*
 * Serialized:
 * quantity = physical stocktake count.
 *
 * No ProductUnit is created here because real manufacturer barcodes
 * are required for serialized inventory.
 */
const s = (
  category: string,
  name: string,
  quantity: number,
): SeedProduct => ({
  category,
  name,
  isSerialized: true,
  quantity,
  unit: UnitOfMeasure.PIECE,
});

/*
 * Non-serialized:
 * quantity = physical stocktake count (in the product's unit of measure).
 */
const n = (
  category: string,
  name: string,
  quantity: number,
  unit: UnitOfMeasure = UnitOfMeasure.PIECE,
): SeedProduct => ({
  category,
  name,
  isSerialized: false,
  quantity,
  unit,
});

/* ------------------------------------------------------------------ */
/*  Stocktake — 28/9/2026                                             */
/* ------------------------------------------------------------------ */

const PRODUCTS: SeedProduct[] = [
  // ───── HST — Serialized ─────
  s('HST', 'لوحة اطفاء hst', 8),
  s('HST', 'لوحة 2 زون hst', 10),
  s('HST', 'لوحة 4 زون الاقتصادية hst', 9),
  s('HST', 'لوحة 8 زون الاقتصادية hst', 0),
  s('HST', 'لوحة 12 زون الاقتصادية hst', 0),
  s('HST', 'لوحة 16 زون الاقتصادية hst', 3),
  s('HST', 'لوحة 4 زون السيلفر hst', 7),
  s('HST', 'لوحة 8 زون السيلفر hst', 4),
  s('HST', 'لوحة 16 زون السيلفر hst', 5),

  // ───── HST — Non-Serialized ─────
  n('HST', 'كاسر hst', 72),
  n('HST', 'سرينة hst', 64),
  n('HST', 'جرس hst', 4),
  n('HST', 'حساس دخان تقليدي hst', 214),
  n('HST', 'حساس حرارة تقليدي hst', 0),
  n('HST', 'حساس متعدد تقليدي hst', 32),
  n('HST', 'لمبة بيان hst', 139),
  n('HST', 'حساس لهب hst', 8),
  n('HST', 'حساس غاز تقليدي hst', 7),
  n('HST', 'بيم hst', 8),
  n('HST', 'كاسر معنون hst', 20),
  n('HST', 'حساس دخان معنون hst', 202),
  n('HST', 'حساس حرارة معنون hst', 10),
  n('HST', 'حساس متعدد معنون hst', 10),
  n('HST', 'مونتور hst', 8),
  n('HST', 'كنترول hst', 1),
  n('HST', 'انترفيس hst', 4),
  n('HST', 'قاعدة hst', 550),

  // ───── HST — Serialized ─────
  s('HST', 'لوحة 1loop الاقتصادية hst', 2),
  s('HST', 'لوحة 2loop الاقتصادية hst', 0),
  s('HST', 'لوحة 2loop الحمرة hst', 2),
  s('HST', 'لوحة 4loop الحمرة hst', 0),

  // ───── كونفوي — Serialized ─────
  s('كونفوي', 'لوحة اطفاء كونفوي', 5),

  // ───── اسنوير ─────
  n('اسنوير', 'لوحة 4 زون اسنوير', 8),
  n('اسنوير', 'لوحة 8 زون اسنوير', 4),
  n('اسنوير', 'حساس دخان اسنوير', 171),
  n('اسنوير', 'حساس حرارة اسنوير', 76),
  n('اسنوير', 'كاسر اسنوير', 11),
  n('اسنوير', 'سرينة اسنوير', 13),
  n('اسنوير', 'جرس اسنوير', 9),

  // ───── صيني ─────
  n('صيني', 'كاسر صيني', 59),
  n('صيني', 'سرينة صيني', 150),
  n('صيني', 'جرس صيني 24 فولت', 31),
  n('صيني', 'جرس صيني 220 فولت', 19),
  n('صيني', 'لوحة 4 زون صيني', 8),
  n('صيني', 'بيم صيني', 8),
  n('صيني', 'ابورت صيني', 20),
  n('صيني', 'طفاية فاير سيرش 6 كيلو صيني', 0),
  n('صيني', 'طفاية فاير سيرش 2 كيلو صيني', 0),

  // ───── عام ─────
  // الكابل يُخزَّن ويُباع بالمتر: الكمية = عدد اللفات × طول اللفة
  n('عام', 'كابلات الومنيوم 500 متر', 0, UnitOfMeasure.METER),
  n('عام', 'كابلات نحاس 500 متر', 1500, UnitOfMeasure.METER),
  n('عام', 'لفة كابل الومنيوم 410 متر', 410, UnitOfMeasure.METER),
  n('عام', 'لفة كابل الومنيوم 85 متر', 85, UnitOfMeasure.METER),
  n('عام', 'لفة كابل الومنيوم 60 متر', 60, UnitOfMeasure.METER),
  n('عام', 'بطارية 2.3 امبير', 8),
  n('عام', 'بطارية 7 امبير', 30),

  // ───── تاندا ─────
  n('تاندا', 'بيم تاندا', 1),

  // ───── ATS ─────
  n('ATS', 'حساس حرارة تقليدي ats', 195),
  n('ATS', 'قاعدة ats', 195),

  // ───── ابولو ─────
  s('ابولو', 'لوحة اطفاء ابولو', 18),
  n('ابولو', 'لوحة 2 زون ابولو', 8),
  n('ابولو', 'لوحة 8 زون ابولو', 1),
  s('ابولو', 'لوحة 1لوب ابولو', 2),
  s('ابولو', 'لوحة 2 لوب ابولو', 1),
  n('ابولو', 'كاسر ابولو تقليدي', 13),
  n('ابولو', 'حساس دخان ابولو تقليدي', 111),
  n('ابولو', 'حساس حرارة ابولو تقليدي', 1),
  n('ابولو', 'قاعدة ابولو', 112),

  // ───── HLT ─────
  n('HLT', 'حساس دخان تقليدي hlt', 500),
];

/* ------------------------------------------------------------------ */
/*  Clean database                                                     */
/* ------------------------------------------------------------------ */

/*
 * Order matters: children (tables holding the foreign key) must be
 * deleted before their parents. $transaction([...]) runs the operations
 * in the order written, and rolls everything back if one fails.
 */
async function cleanDatabase() {
  await prisma.$transaction([
    prisma.stockConsumption.deleteMany(),
    prisma.stockAdjustment.deleteMany(),

    prisma.invoicePriceAdjustment.deleteMany(),

    prisma.invoiceReturnItem.deleteMany(),
    prisma.invoiceReturn.deleteMany(),

    prisma.invoiceChangeRequestItem.deleteMany(),
    prisma.invoiceChangeRequest.deleteMany(),

    prisma.invoiceItemUnitAssignment.deleteMany(),
    prisma.invoiceItem.deleteMany(),

    prisma.productUnitAuditLog.deleteMany(),
    prisma.invoiceAuditLog.deleteMany(),

    prisma.invoice.deleteMany(),

    // Quotations: QuotationItem points to ProductModel, so it must go
    // before productModel. Placed after invoice assuming
    // Invoice -> Quotation (e.g. Invoice.quotationId).
    prisma.quotationItem.deleteMany(),
    prisma.quotation.deleteMany(),

    prisma.stockReceiptItem.deleteMany(),
    prisma.stockLot.deleteMany(),
    prisma.stockReceipt.deleteMany(),

    prisma.productUnit.deleteMany(),
    prisma.productModel.deleteMany(),
    prisma.category.deleteMany(),

    prisma.supplier.deleteMany(),
    prisma.customer.deleteMany(),

    prisma.expense.deleteMany(),
    prisma.expenseCategory.deleteMany(),

    prisma.attendance.deleteMany(),
    prisma.notification.deleteMany(),

    prisma.idempotencyKey.deleteMany(),
    prisma.systemAuditLog.deleteMany(),

    prisma.employee.deleteMany(),
    prisma.workplace.deleteMany(),

    prisma.appSetting.deleteMany(),
    prisma.invoiceSequence.deleteMany(),
  ]);
}

/* ------------------------------------------------------------------ */
/*  Employees                                                          */
/* ------------------------------------------------------------------ */

async function seedEmployees() {
  console.log('  • Creating employees');

  const create = async (
    name: string,
    username: string,
    password: string,
    role: Role,
  ) =>
    prisma.employee.create({
      data: {
        name,
        username,
        passwordHash: await argon2.hash(password),
        role,
        isActive: true,
      },
    });

  const admin = await create(
    'System Admin',
    'admin',
    'admin123',
    Role.ADMIN,
  );

  const accountant = await create(
    'Accountant User',
    'accountant',
    'accountant123',
    Role.ACCOUNTANT,
  );

  const sales = await create(
    'Sales Representative',
    'sales',
    'sales123',
    Role.SALES,
  );

  const inventory = await create(
    'Inventory Manager',
    'inventory',
    'inventory123',
    Role.INVENTORY,
  );

  return {
    admin,
    accountant,
    sales,
    inventory,
  };
}

/* ------------------------------------------------------------------ */
/*  Attendance kiosk                                                   */
/* ------------------------------------------------------------------ */

async function createKiosk(workplaceId: number) {
  console.log('  • Creating attendance kiosk');

  const existing = await prisma.employee.findUnique({
    where: {
      username: 'kiosk1',
    },
  });

  if (existing) {
    return prisma.employee.update({
      where: {
        id: existing.id,
      },
      data: {
        workplaceId,
        role: Role.ATTENDANCE_KIOSK,
        isActive: true,
      },
    });
  }

  return prisma.employee.create({
    data: {
      name: 'Attendance Kiosk 1',
      username: 'kiosk1',
      passwordHash: await argon2.hash('kiosk123'),
      role: Role.ATTENDANCE_KIOSK,
      workplaceId,
      isActive: true,
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Categories                                                         */
/* ------------------------------------------------------------------ */

async function seedCategories() {
  console.log('  • Creating product categories');

  const names = [...new Set(PRODUCTS.map((p) => p.category))];

  return Promise.all(
    names.map((name) =>
      prisma.category.create({
        data: {
          name,
          isActive: true,
        },
      }),
    ),
  );
}

/* ------------------------------------------------------------------ */
/*  Product Models                                                     */
/* ------------------------------------------------------------------ */

type SeededProduct = {
  model: ProductModel;
  quantity: number;
};

async function seedProductModels(
  categories: Awaited<ReturnType<typeof seedCategories>>,
): Promise<SeededProduct[]> {
  console.log('  • Creating product models');

  const categoryMap = new Map(
    categories.map((category) => [category.name, category.id]),
  );

  const result: SeededProduct[] = [];

  for (const product of PRODUCTS) {
    const categoryId = categoryMap.get(product.category);

    if (!categoryId) {
      throw new Error(
        `Category "${product.category}" not found for "${product.name}"`,
      );
    }

    const model = await prisma.productModel.create({
      data: {
        categoryId,
        name: product.name,
        isSerialized: product.isSerialized,
        unit: product.unit,
        reservedQuantity: 0,
        minStockAlert: 0,
        isActive: true,
      },
    });

    result.push({
      model,
      quantity: product.quantity,
    });
  }

  return result;
}


/* ------------------------------------------------------------------ */
/*  Suppliers, customers, opening stock and test invoices               */
/* ------------------------------------------------------------------ */

async function seedSuppliers() {
  console.log('  • Creating test suppliers');

  const supplierData = [
    { name: 'شركة الأمان لأنظمة الحريق', phone: '01010001001', address: 'القاهرة، مدينة نصر، شارع عباس العقاد' },
    { name: 'المتحدة للتوريدات الهندسية', phone: '01010001002', address: 'الجيزة، المهندسين، شارع جامعة الدول' },
    { name: 'النور للتجارة والتوكيلات', phone: '01010001003', address: 'القاهرة، مصر الجديدة، شارع الحجاز' },
    { name: 'دلتا لمستلزمات الأمن والسلامة', phone: '01010001004', address: 'الإسكندرية، سموحة، شارع فوزي معاذ' },
    { name: 'المصرية للتوريدات الصناعية', phone: '01010001005', address: 'القاهرة، جسر السويس، المنطقة الصناعية' },
    { name: 'مورد تجريبي غير نشط', phone: '01010001006', address: 'عنوان تجريبي لاختبار حالة المورد' },
  ];

  const suppliers = [];
  for (const [index, data] of supplierData.entries()) {
    suppliers.push(await prisma.supplier.create({
      data: { ...data, isActive: index !== supplierData.length - 1 },
    }));
  }
  return suppliers;
}

async function seedCustomers() {
  console.log('  • Creating test customers');

  const customerData = [
    { name: 'شركة دلتا للمقاولات', type: 'COMPANY' as const, phone: '01120002001' },
    { name: 'شركة النخبة للإنشاءات', type: 'COMPANY' as const, phone: '01120002002' },
    { name: 'مؤسسة المستقبل للمشروعات', type: 'COMPANY' as const, phone: '01120002003' },
    { name: 'أحمد محمد علي', type: 'INDIVIDUAL' as const, phone: '01230003001' },
    { name: 'محمود إبراهيم حسن', type: 'INDIVIDUAL' as const, phone: '01230003002' },
    { name: 'يوسف خالد', type: 'INDIVIDUAL' as const, phone: '01230003003' },
    { name: 'عميل بدون رقم هاتف', type: 'INDIVIDUAL' as const, phone: null },
    { name: 'عميل تجريبي غير نشط', type: 'COMPANY' as const, phone: '01120002007', isActive: false },
  ];

  const customers = [];
  for (const data of customerData) {
    const { isActive = true, ...customer } = data;
    customers.push(await prisma.customer.create({
      data: { ...customer, isActive },
    }));
  }
  return customers;
}

async function seedOpeningStock(
  products: SeededProduct[],
  suppliers: Awaited<ReturnType<typeof seedSuppliers>>,
  staff: Awaited<ReturnType<typeof seedEmployees>>,
) {
  console.log('  • Creating priced opening receipts and stock lots');

  const receiptDates = suppliers.slice(0, -1).map(
    (_, index) => new Date(`2026-10-${String(index + 1).padStart(2, '0')}T09:00:00+02:00`),
  );
  const receipts = await Promise.all(suppliers.slice(0, -1).map((supplier, index) =>
    prisma.stockReceipt.create({
      data: {
        employeeId: staff.inventory.id,
        supplierId: supplier.id,
        status: 'PRICED',
        pricedByEmployeeId: staff.accountant.id,
        pricedAt: new Date(receiptDates[index].getTime() + 3 * 60 * 60 * 1000),
        date: receiptDates[index],
      },
    }),
  ));

  const lots = new Map<number, { id: number; remaining: number; cost: number }>();

  for (const [index, product] of products.entries()) {
    if (product.model.isSerialized || product.quantity <= 0) continue;

    const supplierIndex = index % receipts.length;
    const receiptDate = receiptDates[supplierIndex];
    const receipt = receipts[supplierIndex];

    // Synthetic purchase costs are test fixtures, not real supplier quotations.
    const purchasePrice = Number((12 + (index % 17) * 7.5).toFixed(2));
    const lot = await prisma.stockLot.create({
      data: {
        productModelId: product.model.id,
        stockReceiptId: receipt.id,
        supplierId: suppliers[supplierIndex].id,
        quantityReceived: product.quantity,
        quantityRemaining: product.quantity,
        quantityReserved: 0,
        purchasePrice: purchasePrice.toFixed(2),
        receivedDate: receiptDate,
      },
    });
    lots.set(product.model.id, {
      id: lot.id,
      remaining: product.quantity,
      cost: purchasePrice,
    });
  }

  return lots;
}

async function seedTestInvoices(
  products: SeededProduct[],
  customers: Awaited<ReturnType<typeof seedCustomers>>,
  staff: Awaited<ReturnType<typeof seedEmployees>>,
  lots: Map<number, { id: number; remaining: number; cost: number }>,
) {
  console.log('  • Creating test invoices');

  const productByName = new Map(products.map((entry) => [entry.model.name, entry]));
  const requireProduct = (name: string) => {
    const entry = productByName.get(name);
    if (!entry) throw new Error(`Seed product not found: ${name}`);
    if (entry.model.isSerialized) {
      throw new Error(`Test invoice fixture must not select serialized product: ${name}`);
    }
    return entry;
  };

  const smoke = requireProduct('حساس دخان تقليدي hst');
  const siren = requireProduct('سرينة hst');
  const breakGlass = requireProduct('كاسر hst');
  const cable = requireProduct('كابلات نحاس 500 متر');

  const createInvoice = async (args: {
    customerId: number;
    invoiceNumber: string;
    status: 'PENDING_ACCOUNTANT' | 'CONFIRMED' | 'CANCELLED' | 'DELIVERED';
    items: Array<{ product: SeededProduct; quantity: number; price: number }>;
    note: string;
    paymentType: string;
    discountPercentage?: number;
    rejectionReason?: string;
  }) => {
    const subtotal = args.items.reduce((sum, item) => sum + item.quantity * item.price, 0);
    const discountPercentage = args.discountPercentage ?? 0;
    const discountAmount = Number((subtotal * discountPercentage / 100).toFixed(2));
    const total = Number((subtotal - discountAmount).toFixed(2));
    const now = new Date();

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: args.invoiceNumber,
        customerId: args.customerId,
        employeeId: staff.sales.id,
        status: args.status,
        confirmedByEmployeeId: args.status === 'CONFIRMED' || args.status === 'DELIVERED'
          ? staff.accountant.id : null,
        confirmedAt: args.status === 'CONFIRMED' || args.status === 'DELIVERED'
          ? now : null,
        rejectedByEmployeeId: args.status === 'CANCELLED' ? staff.accountant.id : null,
        rejectedAt: args.status === 'CANCELLED' ? now : null,
        rejectionReason: args.rejectionReason ?? null,
        deliveredByEmployeeId: args.status === 'DELIVERED' ? staff.inventory.id : null,
        deliveredAt: args.status === 'DELIVERED' ? now : null,
        paymentType: args.paymentType,
        note: args.note,
        discountPercentage: discountPercentage.toFixed(2),
        discountAmount: discountAmount.toFixed(2),
        date: now,
        originalTotal: total.toFixed(2),
        currentTotal: total.toFixed(2),
        items: {
          create: args.items.map((item) => ({
            productModelId: item.product.model.id,
            quantity: item.quantity,
            price: item.price.toFixed(2),
            costAtSale: args.status === 'DELIVERED'
              ? (lots.get(item.product.model.id)?.cost ?? 0).toFixed(2)
              : null,
            cogsStatus: args.status === 'DELIVERED' ? 'FINAL' : 'PENDING',
          })),
        },
      },
      include: { items: true },
    });

    await prisma.invoiceAuditLog.createMany({
      data: [
        {
          invoiceId: invoice.id,
          employeeId: staff.sales.id,
          action: 'CREATED',
          details: { source: 'SEED_TEST_DATA', note: args.note },
        },
        {
          invoiceId: invoice.id,
          employeeId: staff.sales.id,
          action: 'SENT_FOR_ACCOUNTANT_REVIEW',
          details: { source: 'SEED_TEST_DATA' },
        },
        ...(args.status === 'CONFIRMED' || args.status === 'DELIVERED'
          ? [{
              invoiceId: invoice.id,
              employeeId: staff.accountant.id,
              action: 'CONFIRMED' as const,
              details: { source: 'SEED_TEST_DATA' },
            }]
          : []),
        ...(args.status === 'CANCELLED'
          ? [{
              invoiceId: invoice.id,
              employeeId: staff.accountant.id,
              action: 'REJECTED' as const,
              details: { source: 'SEED_TEST_DATA', reason: args.rejectionReason },
            }]
          : []),
        ...(args.status === 'DELIVERED'
          ? [{
              invoiceId: invoice.id,
              employeeId: staff.inventory.id,
              action: 'DELIVERED' as const,
              details: { source: 'SEED_TEST_DATA' },
            }]
          : []),
      ],
    });

    // Keep the stock ledger consistent with the seeded invoice state.
    if (args.status === 'CONFIRMED') {
      for (const item of args.items) {
        const lot = lots.get(item.product.model.id);
        if (!lot || lot.remaining < item.quantity) {
          throw new Error(`Insufficient seeded stock for confirmed invoice ${args.invoiceNumber}`);
        }
        lot.remaining -= item.quantity;
        await prisma.stockLot.update({
          where: { id: lot.id },
          data: { quantityReserved: { increment: item.quantity } },
        });
        await prisma.productModel.update({
          where: { id: item.product.model.id },
          data: { reservedQuantity: { increment: item.quantity } },
        });
        await prisma.invoiceAuditLog.create({
          data: {
            invoiceId: invoice.id,
            employeeId: staff.accountant.id,
            action: 'STOCK_RESERVED',
            details: { source: 'SEED_TEST_DATA', quantity: item.quantity, stockLotId: lot.id },
          },
        });
      }
    }

    if (args.status === 'DELIVERED') {
      for (const [index, item] of args.items.entries()) {
        const lot = lots.get(item.product.model.id);
        if (!lot || lot.remaining < item.quantity) {
          throw new Error(`Insufficient seeded stock for delivered invoice ${args.invoiceNumber}`);
        }
        lot.remaining -= item.quantity;
        await prisma.stockLot.update({
          where: { id: lot.id },
          data: { quantityRemaining: { decrement: item.quantity } },
        });
        await prisma.stockConsumption.create({
          data: {
            invoiceItemId: invoice.items[index].id,
            stockLotId: lot.id,
            quantity: item.quantity,
            unitCost: lot.cost.toFixed(2),
            totalCost: (lot.cost * item.quantity).toFixed(2),
          },
        });
      }
    }

    return invoice;
  };

  await createInvoice({
    customerId: customers[0].id,
    invoiceNumber: 'INV-000001',
    status: 'PENDING_ACCOUNTANT',
    items: [
      { product: smoke, quantity: 12, price: 185 },
      { product: siren, quantity: 6, price: 240 },
      { product: breakGlass, quantity: 4, price: 135 },
    ],
    note: 'فاتورة اختبار معلقة للمراجعة المحاسبية - توريد مشروع إداري',
    paymentType: 'CASH',
    discountPercentage: 5,
  });

  await createInvoice({
    customerId: customers[1].id,
    invoiceNumber: 'INV-000002',
    status: 'CONFIRMED',
    items: [
      { product: smoke, quantity: 5, price: 190 },
      { product: siren, quantity: 3, price: 250 },
    ],
    note: 'فاتورة اختبار مؤكدة - في انتظار استكمال التسليم',
    paymentType: 'CREDIT',
    discountPercentage: 2,
  });

  await createInvoice({
    customerId: customers[2].id,
    invoiceNumber: 'INV-000003',
    status: 'DELIVERED',
    items: [
      { product: breakGlass, quantity: 2, price: 145 },
      { product: cable, quantity: 25, price: 18 },
    ],
    note: 'فاتورة اختبار تم تسليمها بالكامل',
    paymentType: 'BANK_TRANSFER',
  });

  await createInvoice({
    customerId: customers[3].id,
    invoiceNumber: 'INV-000004',
    status: 'CANCELLED',
    items: [{ product: smoke, quantity: 2, price: 185 }],
    note: 'فاتورة اختبار مرفوضة لاختبار سبب الرفض',
    paymentType: 'CASH',
    rejectionReason: 'بيانات الطلب غير مكتملة - سجل تجريبي',
  });

  await prisma.invoiceSequence.upsert({
    where: { id: 1 },
    update: { currentNumber: 4 },
    create: { id: 1, currentNumber: 4 },
  });

  return 4;
}


/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  console.log('========================================');
  console.log(' PALLET DATABASE SEED');
  console.log(' Stocktake: 28/9/2026');
  console.log('========================================\n');

  /* -------------------------------------------------------------- */
  /* Clean                                                            */
  /* -------------------------------------------------------------- */

  console.log('  • Cleaning existing database');

  await cleanDatabase();

  /* -------------------------------------------------------------- */
  /* Invoice sequence                                                  */
  /* -------------------------------------------------------------- */

  await prisma.invoiceSequence.upsert({
    where: {
      id: 1,
    },
    update: {},
    create: {
      id: 1,
      currentNumber: 0,
    },
  });

  /* -------------------------------------------------------------- */
  /* Workplace                                                         */
  /* -------------------------------------------------------------- */

  console.log('  • Creating workplace');

  const workplace = await prisma.workplace.upsert({
    where: {
      id: 1,
    },
    update: {},
    create: {
      id: 1,
      name: 'Main Branch',
      radiusMeters: 100,
      isActive: true,
    },
  });

  /* -------------------------------------------------------------- */
  /* Employees                                                         */
  /* -------------------------------------------------------------- */

  const staff = await seedEmployees();

  /* -------------------------------------------------------------- */
  /* Attendance kiosk                                                  */
  /* -------------------------------------------------------------- */

  await createKiosk(workplace.id);

  /* -------------------------------------------------------------- */
  /* Categories                                                        */
  /* -------------------------------------------------------------- */

  const categories = await seedCategories();

  /* -------------------------------------------------------------- */
  /* Products                                                          */
  /* -------------------------------------------------------------- */

  const products = await seedProductModels(categories);

  /* -------------------------------------------------------------- */
  /* Suppliers, customers, opening stock and invoices                */
  /* -------------------------------------------------------------- */

  const suppliers = await seedSuppliers();
  const customers = await seedCustomers();
  const openingLots = await seedOpeningStock(products, suppliers, staff);
  const invoiceCount = await seedTestInvoices(products, customers, staff, openingLots);

  /* -------------------------------------------------------------- */
  /* Statistics                                                        */
  /* -------------------------------------------------------------- */

  const serializedProducts = products.filter(
    ({ model }) => model.isSerialized,
  );

  const nonSerializedProducts = products.filter(
    ({ model }) => !model.isSerialized,
  );

  const serializedPhysicalCount = serializedProducts.reduce(
    (total, product) => total + product.quantity,
    0,
  );

  const nonSerializedPhysicalCount = nonSerializedProducts.reduce(
    (total, product) => total + product.quantity,
    0,
  );

  /* -------------------------------------------------------------- */
  /* Result                                                            */
  /* -------------------------------------------------------------- */

  console.log('\n✔ Seed completed successfully\n');

  console.log('========================================');
  console.log('LOGIN ACCOUNTS');
  console.log('========================================');
  console.log('admin      / admin123');
  console.log('accountant / accountant123');
  console.log('sales      / sales123');
  console.log('inventory  / inventory123');
  console.log('kiosk1     / kiosk123');
  console.log('========================================\n');

  console.log('SEED DATA');
  console.log('========================================');
  console.log(
    `Employees:                 ${Object.keys(staff).length + 1}`,
  );
  console.log(`Categories:                ${categories.length}`);
  console.log(`Products:                  ${products.length}`);
  console.log(
    `Serialized models:         ${serializedProducts.length}`,
  );
  console.log(
    `Non-serialized models:     ${nonSerializedProducts.length}`,
  );
  console.log(
    `Serialized stock count:    ${serializedPhysicalCount}`,
  );
  console.log(
    `Non-serialized stock count: ${nonSerializedPhysicalCount}`,
  );
  console.log(`Customers:                 ${customers.length}`);
  console.log(`Suppliers:                 ${suppliers.length}`);
  console.log(`Invoices:                  ${invoiceCount}`);
  console.log(`Opening stock lots:         ${openingLots.size}`);
  console.log('========================================\n');

  console.log('Serialized stocktake:');

  for (const { model, quantity } of serializedProducts) {
    console.log(
      `  • ${model.name}: ${quantity}`,
    );
  }

  console.log('\nNon-serialized stocktake:');

  for (const { model, quantity } of nonSerializedProducts) {
    if (quantity > 0) {
      console.log(
        `  • ${model.name}: ${quantity}`,
      );
    }
  }

  console.log('\n========================================');
  console.log('NOTE');
  console.log('========================================');
  console.log(
    'Test suppliers, customers, invoices and non-serialized opening stock were seeded.',
  );
  console.log(
    'Serialized quantities remain stocktake reference counts; no fake ProductUnit barcodes were generated.',
  );
  console.log(
    'Purchase prices and invoice records are synthetic test fixtures, not real transactions.',
  );
  console.log('========================================\n');
}

/* ------------------------------------------------------------------ */
/*  Execute                                                            */
/* ------------------------------------------------------------------ */

main()
  .catch((error) => {
    console.error('\n✖ Seed failed:\n');
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });