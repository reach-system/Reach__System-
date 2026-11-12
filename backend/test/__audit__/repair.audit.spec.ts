import { execFileSync } from 'child_process';
import * as path from 'path';
import {
  assertAuditTarget,
  createInvoice,
  createModel,
  currentTotalOf,
  prisma,
  resetAuditDb,
  seedBase,
  type BaseFixture,
} from './audit-db';

const backendRoot = path.resolve(__dirname, '../..');

let base: BaseFixture;

beforeAll(() => {
  assertAuditTarget();
});

beforeEach(async () => {
  await resetAuditDb();
  base = await seedBase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

interface ScriptRun {
  status: number;
  stdout: string;
  stderr: string;
}

function runRepair(args: string[]): ScriptRun {
  const auditUrl = assertAuditTarget();
  try {
    const stdout = execFileSync(
      process.execPath,
      ['-r', 'ts-node/register', path.join(backendRoot, 'scripts/repair-invoice-totals.ts'), ...args],
      {
        cwd: backendRoot,
        env: { ...process.env, DATABASE_URL: auditUrl },
        encoding: 'utf8',
        timeout: 120000,
      },
    );
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const typed = error as { status?: number; stdout?: string; stderr?: string };
    return { status: typed.status ?? 1, stdout: typed.stdout ?? '', stderr: typed.stderr ?? '' };
  }
}

/** Corrupt an invoice the way the old incremental code did after a price change. */
async function createOldBugInvoice(opts: { discountPercentage?: number; wrongTotal: number; newPrice?: number }) {
  const model = await createModel(base.category.id);
  const { invoice, items } = await createInvoice({
    customerId: base.customer.id,
    employeeId: base.sales.id,
    items: [{ productModelId: model.id, quantity: 3, price: 450 }],
    discountPercentage: opts.discountPercentage ?? 0,
    status: 'DELIVERED',
  });
  await prisma.invoicePriceAdjustment.create({
    data: {
      invoiceId: invoice.id,
      invoiceItemId: items[0].id,
      requestedById: base.sales.id,
      approvedById: base.admin.id,
      oldPrice: 450,
      newPrice: opts.newPrice ?? 440,
      appliedQuantity: 3,
      reason: 'audit fixture',
    },
  });
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { currentTotal: opts.wrongTotal },
  });
  return invoice.id;
}

describe('F. Repair script', () => {
  it('F1 dry-run detects exactly the corrupted invoices and writes nothing', async () => {
    const broken1 = await createOldBugInvoice({ wrongTotal: 1340 });
    const broken2 = await createOldBugInvoice({ wrongTotal: 1198, discountPercentage: 10 });
    const model = await createModel(base.category.id);
    const healthy = await createInvoice({
      customerId: base.customer.id,
      employeeId: base.sales.id,
      items: [{ productModelId: model.id, quantity: 2, price: 100 }],
      status: 'DELIVERED',
    });

    const before = {
      broken1: await currentTotalOf(broken1),
      broken2: await currentTotalOf(broken2),
      healthy: await currentTotalOf(healthy.invoice.id),
    };

    const run = runRepair([]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`#${broken1}`);
    expect(run.stdout).toContain(`#${broken2}`);
    expect(run.stdout).not.toContain(`#${healthy.invoice.id} `);
    expect(run.stdout).toMatch(/2 invoice\(s\) need repair \(dry run\) of 3 checked/);

    // Dry-run must not write.
    expect(await currentTotalOf(broken1)).toBe(before.broken1);
    expect(await currentTotalOf(broken2)).toBe(before.broken2);
    expect(await currentTotalOf(healthy.invoice.id)).toBe(before.healthy);
  });

  it('F2 --invoice scopes the run to one invoice', async () => {
    const broken1 = await createOldBugInvoice({ wrongTotal: 1340 });
    const broken2 = await createOldBugInvoice({ wrongTotal: 1198, discountPercentage: 10 });

    const run = runRepair([`--invoice=${broken1}`]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`#${broken1}`);
    expect(run.stdout).not.toContain(`#${broken2}`);
    expect(run.stdout).toMatch(/1 invoice\(s\) need repair \(dry run\) of 1 checked/);
  });

  it('F3 --apply fixes the totals and a second run is idempotent', async () => {
    const broken1 = await createOldBugInvoice({ wrongTotal: 1340 });
    const broken2 = await createOldBugInvoice({ wrongTotal: 1198, discountPercentage: 10 });

    const applied = runRepair(['--apply']);
    expect(applied.status).toBe(0);
    expect(await currentTotalOf(broken1)).toBe(1320);
    expect(await currentTotalOf(broken2)).toBe(1188);

    const second = runRepair(['--apply']);
    expect(second.status).toBe(0);
    expect(second.stdout).toMatch(/0 invoice\(s\) repaired of 2 checked/);
    expect(await currentTotalOf(broken1)).toBe(1320);
    expect(await currentTotalOf(broken2)).toBe(1188);
  });

  it('F4 rejects an invalid --invoice value', async () => {
    const run = runRepair(['--invoice=not-a-number']);
    expect(run.status).not.toBe(0);
    expect(`${run.stdout}${run.stderr}`).toMatch(/Invalid --invoice value/);
  });
});
