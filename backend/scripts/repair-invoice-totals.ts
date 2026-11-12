/**
 * Repair invoices whose `currentTotal` no longer matches their persisted lines.
 *
 * Usage (from backend/):
 *   npx ts-node scripts/repair-invoice-totals.ts                 # dry run, all invoices
 *   npx ts-node scripts/repair-invoice-totals.ts --apply         # write fixes
 *   npx ts-node scripts/repair-invoice-totals.ts --invoice=123   # single invoice
 *   npx ts-node scripts/repair-invoice-totals.ts --invoice=123 --apply
 *
 * The repair is deterministic: effective price = latest approved price
 * adjustment (fallback to InvoiceItem.price), quantity = sold − returned, and
 * the invoice-level discount factor is derived from the original terms.
 */
import { PrismaClient } from '@prisma/client';
import {
  calculateInvoiceDiscountFactor,
  calculateOutstandingInvoiceTotal,
  roundMoney,
} from '../src/common/invoice-totals.util';

const prisma = new PrismaClient();

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const invoiceArg = argv.find((arg) => arg.startsWith('--invoice='));
  const invoiceId = invoiceArg ? Number(invoiceArg.split('=')[1]) : undefined;

  if (invoiceArg && (!Number.isInteger(invoiceId) || (invoiceId ?? 0) <= 0)) {
    throw new Error(`Invalid --invoice value: ${invoiceArg}`);
  }

  return { apply, invoiceId };
}

async function main() {
  const { apply, invoiceId } = parseArgs(process.argv.slice(2));

  const invoices = await prisma.invoice.findMany({
    where: invoiceId ? { id: invoiceId } : {},
    select: {
      id: true,
      invoiceNumber: true,
      originalTotal: true,
      currentTotal: true,
      discountPercentage: true,
      discountAmount: true,
      items: {
        select: {
          id: true,
          quantity: true,
          price: true,
          priceAdjustments: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { newPrice: true },
          },
        },
      },
      returns: { select: { items: { select: { invoiceItemId: true, quantity: true } } } },
    },
    orderBy: { id: 'asc' },
  });

  if (invoices.length === 0) {
    console.log('No invoices found.');
    return;
  }

  const discountFactorCache = new Map<number, number>();
  let mismatches = 0;

  for (const invoice of invoices) {
    const returnedByItem = new Map<number, number>();
    for (const invoiceReturn of invoice.returns) {
      for (const item of invoiceReturn.items) {
        returnedByItem.set(
          item.invoiceItemId,
          roundMoney((returnedByItem.get(item.invoiceItemId) ?? 0) + Number(item.quantity ?? 1)),
        );
      }
    }

    const factorKey = invoice.id;
    const discountFactor =
      discountFactorCache.get(factorKey) ??
      calculateInvoiceDiscountFactor(
        Number(invoice.originalTotal),
        Number(invoice.discountPercentage ?? 0),
        Number(invoice.discountAmount ?? 0),
      );
    discountFactorCache.set(factorKey, discountFactor);

    const lines = invoice.items.map((item) => {
      const effectivePrice = roundMoney(
        item.priceAdjustments.length > 0 ? Number(item.priceAdjustments[0].newPrice) : Number(item.price),
      );
      const remaining = Math.max(0, roundMoney(Number(item.quantity) - (returnedByItem.get(item.id) ?? 0)));
      return { price: effectivePrice, quantity: remaining };
    });

    const { total: expectedTotal } = calculateOutstandingInvoiceTotal(lines, discountFactor);
    const currentTotal = roundMoney(Number(invoice.currentTotal));

    if (currentTotal === expectedTotal) {
      continue;
    }

    mismatches += 1;
    console.log(
      `${apply ? 'FIX ' : 'DRY '} #${invoice.id} ${invoice.invoiceNumber}: current=${currentTotal.toFixed(2)} expected=${expectedTotal.toFixed(2)}`,
    );

    if (apply) {
      const updated = await prisma.invoice.updateMany({
        where: { id: invoice.id, currentTotal: invoice.currentTotal },
        data: { currentTotal: expectedTotal },
      });
      if (updated.count !== 1) {
        console.warn(`  skipped: invoice #${invoice.id} changed while repairing`);
      }
    }
  }

  console.log(
    `\n${mismatches} invoice(s) ${apply ? 'repaired' : 'need repair (dry run)'} of ${invoices.length} checked.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
