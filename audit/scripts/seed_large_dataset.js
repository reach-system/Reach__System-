#!/usr/bin/env node
/**
 * seed_large_dataset.js — generates a production-scale dataset for the
 * rich_mangment audit.
 *
 * READ-ONLY WITH RESPECT TO SOURCE CODE. This script only writes to the
 * database pointed to by DATABASE_URL, and only when the operator explicitly
 * opts in. It never DROP/TRUNCATEs and never deletes rows from another run.
 *
 * Usage (PowerShell):
 *   $env:DATABASE_URL = "postgresql://.../rich_scale"
 *   $env:CONFIRM_LARGE_SEED = "YES"
 *   $env:SEED_RUN_ID = "scale01"
 *   $env:INVOICES = "5000000"
 *   node audit/scripts/seed_large_dataset.js
 *
 * See audit/SEED_PLAN.md for the full contract.
 */

'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const RUN = (process.env.SEED_RUN_ID || '').trim();
const CONFIRM = process.env.CONFIRM_LARGE_SEED === 'YES';
const RESET = process.env.SEED_RESET === '1';

const cfg = {
  customers: intEnv('CUSTOMERS', 100000),
  productModels: intEnv('PRODUCT_MODELS', 2000),
  units: intEnv('UNITS', 100000),
  invoices: intEnv('INVOICES', 200000),
  itemsMax: intEnv('ITEMS_PER_INVOICE_MAX', 5),
  employees: intEnv('EMPLOYEES', 40),
  suppliers: intEnv('SUPPLIERS', 200),
  categories: intEnv('CATEGORIES', 40),
  assignments: intEnv('ASSIGNMENTS', 0),
  debtMovements: intEnv('DEBT_MOVEMENTS', Math.floor(intEnv('INVOICES', 200000) * 0.2)),
  auditLogs: intEnv('AUDIT_LOGS', Math.floor(intEnv('INVOICES', 200000) * 0.1)),
  notifications: intEnv('NOTIFICATIONS', 50000),
  batch: intEnv('BATCH', 5000),
  months: intEnv('MONTHS', 36),
};

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return Math.floor(n);
}

function fail(msg) {
  console.error(`\n[seed] REFUSING TO RUN: ${msg}\n`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set.');
if (!CONFIRM) fail('set CONFIRM_LARGE_SEED=YES after verifying the target is disposable.');
if (!RUN || !/^[a-zA-Z0-9_-]{2,24}$/.test(RUN)) fail('set SEED_RUN_ID to 2-24 chars [a-zA-Z0-9_-].');
if (RESET && !CONFIRM) fail('SEED_RESET requires CONFIRM_LARGE_SEED=YES.');

const TAG = `SEED-${RUN}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const q = (ident) => `"${ident.replace(/"/g, '""')}"`;

async function maxId(table) {
  const rows = await prisma.$queryRawUnsafe(`SELECT COALESCE(MAX(id),0)::int AS m FROM ${q(table)}`);
  return Number(rows[0].m);
}

/**
 * Bulk insert using a single UNNEST statement.
 * columns: [{ name, type }]
 * rows: array of objects keyed by column name
 */
async function bulk(table, columns, rows) {
  if (!rows.length) return;
  const cols = columns.map((c) => q(c.name)).join(', ');
  const selects = columns.map((c, i) => `unnest($${i + 1}::${c.type}[])`).join(', ');
  const sql = `INSERT INTO ${q(table)} (${cols}) SELECT ${selects}`;
  const params = columns.map((c) => rows.map((r) => r[c.name] === undefined ? null : r[c.name]));
  await prisma.$executeRawUnsafe(sql, ...params);
}

async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) {
    await fn(items.slice(i, i + size), i);
  }
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const randFloat = (min, max, dp = 2) => Number((min + Math.random() * (max - min)).toFixed(dp));

const AR_FIRST = ['أحمد','محمد','محمود','مصطفى','خالد','يوسف','عمر','علي','حسن','حسين','سارة','مريم','نور','هبة','دينا','رنا','سلمى','منى','إيمان','ياسمين'];
const AR_LAST = ['عبد الله','السيد','حسن','إبراهيم','محمود','فؤاد','كامل','شعبان','العزب','الشريف','سالم','منصور','سعيد','رمضان','فتحي'];
const AR_CAT = ['أثاث','إلكترونيات','أدوات منزلية','ملابس','أحذية','مواد غذائية','مستلزمات مكتبية','ألعاب','أجهزة كهربائية','عطور','أقمشة','عدد يدوية','مستلزمات طبية','زراعة','سيارات','دهانات','سباكة','كهرباء','تنظيف','تغليف'];
const AR_MODEL = ['كرسي','طاولة','دولاب','سرير','تلفاز','هاتف','حاسوب','قميص','حذاء','زيت','أرز','سكر','قلم','دفتر','لعبة','مصباح','عطر','قماش','مفتاح','أنبوب'];

const ARABIC_FIRST = AR_FIRST;
const ARABIC_LAST = AR_LAST;

function personName(i) {
  return `${pick(ARABIC_FIRST)} ${pick(ARABIC_LAST)} ${i}`;
}

function monthsAgoDate(monthsBack, rnd) {
  const now = new Date();
  const d = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() - monthsBack,
    1 + Math.floor(rnd * 27),
    randInt(8, 21),
    randInt(0, 59),
    0, 0
  ));
  return d.toISOString();
}

// Deterministic PRNG so a run can be reproduced from SEED_RUN_ID.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let seedNum = 0;
for (const ch of RUN) seedNum = (seedNum * 31 + ch.charCodeAt(0)) >>> 0;
const rnd = mulberry32(seedNum || 1);

// ---------------------------------------------------------------------------
// Cleanup of the current run (only if explicitly requested)
// ---------------------------------------------------------------------------
async function resetRun() {
  console.log(`[seed] SEED_RESET=1 — deleting rows for ${TAG}`);
  // Order matters: children before parents.
  const like = `${TAG}-%`;
  const statements = [
    `DELETE FROM "InvoiceAuditLog" WHERE "invoiceId" IN (SELECT id FROM "Invoice" WHERE "invoiceNumber" LIKE $1)`,
    `DELETE FROM "InvoiceItemUnitAssignment" WHERE "invoiceItemId" IN (SELECT id FROM "InvoiceItem" WHERE "invoiceId" IN (SELECT id FROM "Invoice" WHERE "invoiceNumber" LIKE $1))`,
    `DELETE FROM "InvoiceItem" WHERE "invoiceId" IN (SELECT id FROM "Invoice" WHERE "invoiceNumber" LIKE $1)`,
    `DELETE FROM "Invoice" WHERE "invoiceNumber" LIKE $1`,
    `DELETE FROM "CustomerDebtMovement" WHERE "customerId" IN (SELECT id FROM "Customer" WHERE name LIKE $1)`,
    `DELETE FROM "Notification" WHERE title LIKE $1`,
    `DELETE FROM "Customer" WHERE name LIKE $1`,
    `DELETE FROM "StockConsumption" WHERE "stockLotId" IN (SELECT id FROM "StockLot" WHERE "productModelId" IN (SELECT id FROM "ProductModel" WHERE name LIKE $1))`,
    `DELETE FROM "StockLot" WHERE "productModelId" IN (SELECT id FROM "ProductModel" WHERE name LIKE $1)`,
    `DELETE FROM "StockReceiptItem" WHERE "productUnitId" IN (SELECT id FROM "ProductUnit" WHERE barcode LIKE $1)`,
    `DELETE FROM "ProductUnit" WHERE barcode LIKE $1`,
    `DELETE FROM "ProductModel" WHERE name LIKE $1`,
    `DELETE FROM "Supplier" WHERE name LIKE $1`,
    `DELETE FROM "Employee" WHERE username LIKE $1`,
    `DELETE FROM "Category" WHERE name LIKE $1`,
    `DELETE FROM "Workplace" WHERE name LIKE $1`,
  ];
  for (const sql of statements) {
    try {
      await prisma.$executeRawUnsafe(sql, like);
    } catch (e) {
      console.warn(`[seed] cleanup skipped (${e.message.split('\n')[0]})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------
async function seed() {
  const started = Date.now();
  console.log('[seed] config:', JSON.stringify(cfg));
  console.log(`[seed] tag: ${TAG}`);

  if (RESET) await resetRun();

  // ---- Workplaces ---------------------------------------------------------
  const wpBase = await maxId('Workplace');
  const workplaces = [
    { id: wpBase, name: `${TAG}-المقر الرئيسي`, latitude: 30.0444, longitude: 31.2357, radiusMeters: 150, isActive: true },
    { id: wpBase + 1, name: `${TAG}-فرع الجيزة`, latitude: 30.0131, longitude: 31.2089, radiusMeters: 120, isActive: true },
    { id: wpBase + 2, name: `${TAG}-المخزن`, latitude: 30.0964, longitude: 31.3260, radiusMeters: 300, isActive: true },
  ];
  await bulk('Workplace', [
    { name: 'id', type: 'int4' }, { name: 'name', type: 'text' },
    { name: 'latitude', type: 'float8' }, { name: 'longitude', type: 'float8' },
    { name: 'radiusMeters', type: 'int4' }, { name: 'isActive', type: 'boolean' },
  ], workplaces);
  console.log(`[seed] workplaces: ${workplaces.length}`);

  // ---- Employees ----------------------------------------------------------
  const empBase = await maxId('Employee');
  const roles = ['ADMIN', 'ACCOUNTANT', 'SALES', 'INVENTORY', 'ATTENDANCE_KIOSK'];
  const employees = [];
  for (let i = 0; i < cfg.employees; i++) {
    const role = i === 0 ? 'ADMIN' : roles[1 + (i % 4)];
    employees.push({
      id: empBase + i,
      name: personName(i),
      role,
      username: `seed_${RUN}_${role.toLowerCase()}_${i}`,
      // Fixed dummy argon2id hash. NOT a usable credential; seeding only.
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$c2VlZHNhbHRzZWVkc2FsdA$0000000000000000000000000000000000000000000',
      isActive: true,
      workplaceId: workplaces[i % workplaces.length].id,
    });
  }
  await bulk('Employee', [
    { name: 'id', type: 'int4' }, { name: 'name', type: 'text' },
    { name: 'role', type: '"Role"' }, { name: 'username', type: 'text' },
    { name: 'passwordHash', type: 'text' }, { name: 'isActive', type: 'boolean' },
    { name: 'workplaceId', type: 'int4' },
  ], employees);
  console.log(`[seed] employees: ${employees.length}`);

  // ---- Categories ---------------------------------------------------------
  const catBase = await maxId('Category');
  const categories = [];
  for (let i = 0; i < cfg.categories; i++) {
    categories.push({ id: catBase + i, name: `${TAG}-${AR_CAT[i % AR_CAT.length]} ${i}`, isActive: true });
  }
  await bulk('Category', [
    { name: 'id', type: 'int4' }, { name: 'name', type: 'text' }, { name: 'isActive', type: 'boolean' },
  ], categories);
  console.log(`[seed] categories: ${categories.length}`);

  // ---- Suppliers ----------------------------------------------------------
  const supBase = await maxId('Supplier');
  const suppliers = [];
  for (let i = 0; i < cfg.suppliers; i++) {
    suppliers.push({
      id: supBase + i,
      name: `${TAG}-مورد ${i}`,
      phone: `010${String(10000000 + i).slice(-8)}`,
      address: `القاهرة - ${i}`,
      isActive: true,
    });
  }
  await bulk('Supplier', [
    { name: 'id', type: 'int4' }, { name: 'name', type: 'text' },
    { name: 'phone', type: 'text' }, { name: 'address', type: 'text' }, { name: 'isActive', type: 'boolean' },
  ], suppliers);
  console.log(`[seed] suppliers: ${suppliers.length}`);

  // ---- Product models -----------------------------------------------------
  const pmBase = await maxId('ProductModel');
  const models = [];
  for (let i = 0; i < cfg.productModels; i++) {
    models.push({
      id: pmBase + i,
      categoryId: categories[i % categories.length].id,
      name: `${TAG}-${AR_MODEL[i % AR_MODEL.length]} ${i}`,
      isSerialized: i % 10 !== 0,
      unit: i % 10 === 0 ? 'METER' : 'PIECE',
      reservedQuantity: 0,
      minStockAlert: randInt(0, 10),
      isActive: true,
    });
  }
  await bulk('ProductModel', [
    { name: 'id', type: 'int4' }, { name: 'categoryId', type: 'int4' },
    { name: 'name', type: 'text' }, { name: 'isSerialized', type: 'boolean' },
    { name: 'unit', type: '"UnitOfMeasure"' }, { name: 'reservedQuantity', type: 'float8' },
    { name: 'minStockAlert', type: 'float8' }, { name: 'isActive', type: 'boolean' },
  ], models);
  console.log(`[seed] product models: ${models.length}`);

  // ---- Product units ------------------------------------------------------
  const unitBase = await maxId('ProductUnit');
  const unitStatuses = [];
  for (let i = 0; i < cfg.units; i++) {
    const r = rnd();
    unitStatuses.push(r < 0.70 ? 'AVAILABLE' : r < 0.90 ? 'SOLD' : r < 0.95 ? 'RESERVED' : 'DAMAGED');
  }
  await inBatches(Array.from({ length: cfg.units }, (_, i) => i), cfg.batch, async (slice) => {
    await bulk('ProductUnit', [
      { name: 'id', type: 'int4' }, { name: 'productModelId', type: 'int4' },
      { name: 'barcode', type: 'text' }, { name: 'status', type: '"ProductUnitStatus"' },
      { name: 'receivedDate', type: 'timestamptz' }, { name: 'purchasePrice', type: 'numeric' },
      { name: 'version', type: 'int4' },
    ], slice.map((i) => ({
      id: unitBase + i,
      productModelId: models[i % models.length].id,
      barcode: `${TAG}-U-${i}`,
      status: unitStatuses[i],
      receivedDate: monthsAgoDate(randInt(0, cfg.months), rnd()),
      purchasePrice: randFloat(20, 800),
      version: 0,
    })));
    if (slice[0] % (cfg.batch * 10) === 0) process.stdout.write(`\r[seed] units: ${slice[0]}`);
  });
  console.log(`\n[seed] units: ${cfg.units}`);

  // ---- Stock receipts + lots ---------------------------------------------
  const receiptBase = await maxId('StockReceipt');
  const lotBase = await maxId('StockLot');
  const receiptCount = Math.max(1, Math.ceil(cfg.productModels / 20));
  const receipts = [];
  for (let i = 0; i < receiptCount; i++) {
    receipts.push({
      id: receiptBase + i,
      employeeId: employees[i % employees.length].id,
      supplierId: suppliers[i % suppliers.length].id,
      status: 'PRICED',
      pricedByEmployeeId: employees[i % employees.length].id,
      pricedAt: monthsAgoDate(randInt(0, cfg.months), rnd()),
      date: monthsAgoDate(randInt(0, cfg.months), rnd()),
    });
  }
  await bulk('StockReceipt', [
    { name: 'id', type: 'int4' }, { name: 'employeeId', type: 'int4' },
    { name: 'supplierId', type: 'int4' }, { name: 'status', type: '"StockReceiptStatus"' },
    { name: 'pricedByEmployeeId', type: 'int4' }, { name: 'pricedAt', type: 'timestamptz' },
    { name: 'date', type: 'timestamptz' },
  ], receipts);
  const lots = models.map((m, i) => ({
    id: lotBase + i,
    productModelId: m.id,
    stockReceiptId: receipts[i % receipts.length].id,
    supplierId: suppliers[i % suppliers.length].id,
    quantityReceived: 100,
    quantityRemaining: 100,
    quantityReserved: 0,
    purchasePrice: randFloat(20, 800),
    receivedDate: monthsAgoDate(randInt(0, cfg.months), rnd()),
  }));
  await bulk('StockLot', [
    { name: 'id', type: 'int4' }, { name: 'productModelId', type: 'int4' },
    { name: 'stockReceiptId', type: 'int4' }, { name: 'supplierId', type: 'int4' },
    { name: 'quantityReceived', type: 'float8' }, { name: 'quantityRemaining', type: 'float8' },
    { name: 'quantityReserved', type: 'float8' }, { name: 'purchasePrice', type: 'numeric' },
    { name: 'receivedDate', type: 'timestamptz' },
  ], lots);
  console.log(`[seed] stock receipts: ${receipts.length}, lots: ${lots.length}`);

  // ---- Customers ----------------------------------------------------------
  const custBase = await maxId('Customer');
  await inBatches(Array.from({ length: cfg.customers }, (_, i) => i), cfg.batch, async (slice) => {
    await bulk('Customer', [
      { name: 'id', type: 'int4' }, { name: 'name', type: 'text' },
      { name: 'type', type: '"CustomerType"' }, { name: 'phone', type: 'text' },
      { name: 'isActive', type: 'boolean' }, { name: 'currentDebt', type: 'numeric' },
    ], slice.map((i) => ({
      id: custBase + i,
      name: `${TAG}-CUST-${i} ${pick(ARABIC_FIRST)} ${pick(ARABIC_LAST)}`,
      type: i % 10 === 0 ? 'COMPANY' : 'INDIVIDUAL',
      phone: `01${randInt(0, 2)}${String(10000000 + i).slice(-8)}`,
      isActive: true,
      currentDebt: 0,
    })));
    if (slice[0] % (cfg.batch * 10) === 0) process.stdout.write(`\r[seed] customers: ${slice[0]}`);
  });
  console.log(`\n[seed] customers: ${cfg.customers}`);

  // ---- Invoices + items ---------------------------------------------------
  const invBase = await maxId('Invoice');
  const itemBase = await maxId('InvoiceItem');
  const salesEmployees = employees.filter((e) => e.role === 'SALES');
  const accountants = employees.filter((e) => e.role === 'ACCOUNTANT');
  const sellers = salesEmployees.length ? salesEmployees : employees;

  let nextItemId = itemBase;
  let totalItems = 0;
  const statusPlan = (i) => {
    const r = rnd();
    if (r < 0.55) return 'CONFIRMED';
    if (r < 0.70) return 'DELIVERED';
    if (r < 0.90) return 'PENDING_ACCOUNTANT';
    return 'CANCELLED';
  };

  await inBatches(Array.from({ length: cfg.invoices }, (_, i) => i), Math.max(1, Math.floor(cfg.batch / 4)), async (slice) => {
    const invoiceRows = [];
    const itemRows = [];
    for (const i of slice) {
      const status = statusPlan(i);
      const customer = custBase + Math.floor(rnd() * cfg.customers);
      const seller = sellers[i % sellers.length];
      const accountant = accountants.length ? accountants[i % accountants.length] : null;
      const monthsBack = Math.floor(rnd() * cfg.months);
      const date = monthsAgoDate(monthsBack, rnd());
      const itemCount = randInt(1, cfg.itemsMax);
      let total = 0;
      for (let k = 0; k < itemCount; k++) {
        const model = models[Math.floor(rnd() * models.length)];
        const qty = model.unit === 'METER' ? randFloat(0.5, 12, 2) : randInt(1, 5);
        const price = randFloat(30, 2500);
        const cost = Number((price * randFloat(0.5, 0.8, 4)).toFixed(2));
        total += qty * price;
        itemRows.push({
          id: nextItemId++,
          invoiceId: invBase + i,
          productModelId: model.id,
          quantity: qty,
          price: price.toFixed(2),
          costAtSale: cost.toFixed(2),
          cogsStatus: (status === 'CONFIRMED' || status === 'DELIVERED') ? 'FINAL' : 'PENDING',
          createdAt: date,
        });
      }
      total = Number(total.toFixed(2));
      invoiceRows.push({
        id: invBase + i,
        invoiceNumber: `${TAG}-INV-${i}`,
        customerId: customer,
        employeeId: seller.id,
        status,
        confirmedByEmployeeId: (status === 'CONFIRMED' || status === 'DELIVERED') && accountant ? accountant.id : null,
        confirmedAt: (status === 'CONFIRMED' || status === 'DELIVERED') ? date : null,
        deliveredByEmployeeId: status === 'DELIVERED' ? seller.id : null,
        deliveredAt: status === 'DELIVERED' ? date : null,
        paymentType: rnd() < 0.5 ? 'CASH' : 'CREDIT',
        discountPercentage: null,
        discountAmount: null,
        date,
        originalTotal: total.toFixed(2),
        currentTotal: total.toFixed(2),
      });
    }
    await bulk('Invoice', [
      { name: 'id', type: 'int4' }, { name: 'invoiceNumber', type: 'text' },
      { name: 'customerId', type: 'int4' }, { name: 'employeeId', type: 'int4' },
      { name: 'status', type: '"InvoiceStatus"' },
      { name: 'confirmedByEmployeeId', type: 'int4' }, { name: 'confirmedAt', type: 'timestamptz' },
      { name: 'deliveredByEmployeeId', type: 'int4' }, { name: 'deliveredAt', type: 'timestamptz' },
      { name: 'paymentType', type: 'text' }, { name: 'discountPercentage', type: 'numeric' },
      { name: 'discountAmount', type: 'numeric' }, { name: 'date', type: 'timestamptz' },
      { name: 'originalTotal', type: 'numeric' }, { name: 'currentTotal', type: 'numeric' },
    ], invoiceRows);
    await bulk('InvoiceItem', [
      { name: 'id', type: 'int4' }, { name: 'invoiceId', type: 'int4' },
      { name: 'productModelId', type: 'int4' }, { name: 'quantity', type: 'float8' },
      { name: 'price', type: 'numeric' }, { name: 'costAtSale', type: 'numeric' },
      { name: 'cogsStatus', type: '"CogsStatus"' }, { name: 'createdAt', type: 'timestamptz' },
    ], itemRows);
    totalItems += itemRows.length;
    if (slice[0] % (cfg.batch * 4) === 0) process.stdout.write(`\r[seed] invoices: ${slice[0]}`);
  });
  console.log(`\n[seed] invoices: ${cfg.invoices}, items: ${totalItems}`);

  // ---- Audit logs (bounded sample) ---------------------------------------
  if (cfg.auditLogs > 0) {
    const logCount = Math.min(cfg.auditLogs, cfg.invoices);
    await inBatches(Array.from({ length: logCount }, (_, i) => i), cfg.batch, async (slice) => {
      await bulk('InvoiceAuditLog', [
        { name: 'invoiceId', type: 'int4' }, { name: 'action', type: '"InvoiceAuditAction"' },
        { name: 'employeeId', type: 'int4' }, { name: 'timestamp', type: 'timestamptz' },
      ], slice.map((i) => ({
        invoiceId: invBase + i,
        action: 'CREATED',
        employeeId: sellers[i % sellers.length].id,
        timestamp: monthsAgoDate(Math.floor(rnd() * cfg.months), rnd()),
      })));
    });
    console.log(`[seed] invoice audit logs: ${logCount}`);
  }

  // ---- Debt movements (synthetic; reconciliation is intentionally not done) 
  if (cfg.debtMovements > 0) {
    const n = Math.min(cfg.debtMovements, cfg.invoices);
    await inBatches(Array.from({ length: n }, (_, i) => i), cfg.batch, async (slice) => {
      await bulk('CustomerDebtMovement', [
        { name: 'customerId', type: 'int4' }, { name: 'employeeId', type: 'int4' },
        { name: 'type', type: '"DebtMovementType"' }, { name: 'amount', type: 'numeric' },
        { name: 'balanceAfter', type: 'numeric' }, { name: 'note', type: 'text' },
        { name: 'createdAt', type: 'timestamptz' },
      ], slice.map((i) => {
        const amount = randFloat(50, 5000);
        return {
          customerId: custBase + (i % cfg.customers),
          employeeId: sellers[i % sellers.length].id,
          type: 'INCREASE',
          amount: amount.toFixed(2),
          balanceAfter: amount.toFixed(2),
          note: `${TAG} synthetic movement`,
          createdAt: monthsAgoDate(Math.floor(rnd() * cfg.months), rnd()),
        };
      }));
    });
    console.log(`[seed] debt movements: ${n}`);
  }

  // ---- Notifications (bounded) -------------------------------------------
  if (cfg.notifications > 0) {
    await inBatches(Array.from({ length: cfg.notifications }, (_, i) => i), cfg.batch, async (slice) => {
      await bulk('Notification', [
        { name: 'employeeId', type: 'int4' }, { name: 'type', type: '"NotificationType"' },
        { name: 'title', type: 'text' }, { name: 'message', type: 'text' },
        { name: 'isRead', type: 'boolean' }, { name: 'createdAt', type: 'timestamptz' },
      ], slice.map((i) => ({
        employeeId: employees[i % employees.length].id,
        type: 'SYSTEM',
        title: `${TAG} إشعار ${i}`,
        message: `${TAG} رسالة تجريبية ${i}`,
        isRead: i % 3 === 0,
        createdAt: monthsAgoDate(Math.floor(rnd() * cfg.months), rnd()),
      })));
    });
    console.log(`[seed] notifications: ${cfg.notifications}`);
  }

  // ---- Sequences ----------------------------------------------------------
  await prisma.$executeRawUnsafe(
    `INSERT INTO "InvoiceSequence" (id, "currentNumber") VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET "currentNumber" = GREATEST("InvoiceSequence"."currentNumber", EXCLUDED."currentNumber")`,
    cfg.invoices
  );

  // Advance every serial sequence to MAX(id) so future inserts do not collide.
  for (const table of ['Workplace','Employee','Category','Supplier','ProductModel','ProductUnit','StockReceipt','StockLot','Customer','Invoice','InvoiceItem','InvoiceAuditLog','CustomerDebtMovement','Notification']) {
    try {
      await prisma.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${q(table)}), 1))`,
        `"${table}"`
      );
    } catch (e) {
      console.warn(`[seed] setval ${table}: ${e.message.split('\n')[0]}`);
    }
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n[seed] done in ${secs}s`);
  console.log('[seed] cleanup for this run:');
  console.log(`  DELETE FROM "Invoice" WHERE "invoiceNumber" LIKE '${TAG}-%';`);
  console.log(`  DELETE FROM "Customer" WHERE name LIKE '${TAG}-%';`);
  console.log(`  DELETE FROM "ProductUnit" WHERE barcode LIKE '${TAG}-%';`);
  console.log(`  DELETE FROM "ProductModel" WHERE name LIKE '${TAG}-%';`);
  console.log(`  DELETE FROM "Supplier" WHERE name LIKE '${TAG}-%';`);
  console.log(`  DELETE FROM "Employee" WHERE username LIKE 'seed_${RUN}_%';`);
  console.log('  -- delete children first; see SEED_PLAN.md');
  console.log('[seed] remember: ANALYZE;');
}

seed()
  .catch((e) => {
    console.error('\n[seed] FAILED:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
