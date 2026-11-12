import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  QuotationEventType,
  QuotationStatus,
  Role,
  UnitOfMeasure,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { normalizeQuantity } from '../common/quantity.util';
import { roundMoney } from '../common/invoice-totals.util';
import {
  calculateQuotationTotals,
  QuotationAmountLine,
} from '../common/quotation-totals.util';
import {
  defaultValidUntil,
  effectiveQuotationStatus,
  isQuotationExpired,
  zonedEndOfDay,
  zonedStartOfDay,
} from '../common/quotation-time.util';
import { assertTransition, canRevise } from './quotation-state.util';
import { CreateQuotationDto, QuotationItemDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { ReviseQuotationDto } from './dto/revise-quotation.dto';

export type QuotationRequester = { sub: number; role: string };

type NormalizedItem = {
  productModelId: number;
  productName: string;
  categoryName: string | null;
  unit: string;
  quantity: number;
  price: number;
  lineDiscount: number;
};

const SORTABLE_FIELDS = new Set([
  'date',
  'quotationNumber',
  'total',
  'validUntil',
  'customerName',
  'status',
  'createdAt',
]);

@Injectable()
export class QuotationsService {
  constructor(
    private prisma: PrismaService,
    private realtimeService: RealtimeService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */

  private notFound(): never {
    throw new NotFoundException({
      code: 'QUOTATION_NOT_FOUND',
      message: 'Quotation not found',
    });
  }

  private assertCanMutate(quotation: { createdById: number }, requester?: QuotationRequester) {
    if (!requester) return;
    if (requester.role === Role.SALES && quotation.createdById !== requester.sub) {
      throw new ForbiddenException({
        code: 'FORBIDDEN_RESOURCE',
        message: 'You can only change your own quotations',
      });
    }
  }

  private normalizeDateOnly(value: string, field: string): Date {
    try {
      return zonedEndOfDay(value);
    } catch {
      throw new BadRequestException({
        code: 'INVALID_DATE',
        message: `${field} must be a valid YYYY-MM-DD date`,
      });
    }
  }

  private statusFilter(
    status: QuotationStatus | undefined,
    now = new Date(),
  ): Prisma.QuotationWhereInput | null {
    if (!status) return null;
    if (status === QuotationStatus.EXPIRED) {
      return {
        OR: [
          { status: QuotationStatus.EXPIRED },
          { status: QuotationStatus.SENT, validUntil: { lt: now } },
        ],
      };
    }
    if (status === QuotationStatus.SENT) {
      return { status: QuotationStatus.SENT, validUntil: { gte: now } };
    }
    return { status };
  }

  private decorate<T extends { status: QuotationStatus; validUntil: Date }>(quotation: T, now = new Date()) {
    const effectiveStatus = effectiveQuotationStatus(quotation.status, quotation.validUntil, now);
    return {
      ...quotation,
      effectiveStatus,
      isExpired: effectiveStatus === QuotationStatus.EXPIRED,
    };
  }

  private async loadCustomer(customerId: number) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, isActive: true, deletedAt: null },
    });
    if (!customer) {
      throw new NotFoundException({
        code: 'CUSTOMER_NOT_FOUND',
        message: 'Customer not found or inactive',
      });
    }
    return customer;
  }

  private async loadModels(items: QuotationItemDto[]) {
    const ids = [...new Set(items.map((item) => item.productModelId))];
    const models = await this.prisma.productModel.findMany({
      where: { id: { in: ids }, isActive: true, deletedAt: null },
      include: { category: { select: { name: true } } },
    });

    if (models.length !== ids.length) {
      const found = new Set(models.map((model) => model.id));
      const missing = ids.filter((id) => !found.has(id));
      throw new NotFoundException({
        code: 'PRODUCT_MODEL_NOT_FOUND',
        message: `Product model(s) not found or inactive: ${missing.join(', ')}`,
      });
    }

    return new Map(models.map((model) => [model.id, model]));
  }

  private normalizeItems(
    items: QuotationItemDto[],
    models: Map<number, { name: string; unit: string; category?: { name: string } | null }>,
  ): NormalizedItem[] {
    return items.map((item, index) => {
      const model = models.get(item.productModelId);
      if (!model) {
        throw new NotFoundException({
          code: 'PRODUCT_MODEL_NOT_FOUND',
          message: `Product model ${item.productModelId} not found`,
        });
      }

      const quantity = normalizeQuantity(item.quantity, model.unit as UnitOfMeasure);
      const price = roundMoney(Math.max(0, item.price));
      const gross = roundMoney(price * quantity);
      const lineDiscount = roundMoney(Math.max(0, item.lineDiscount ?? 0));

      if (lineDiscount > gross) {
        throw new BadRequestException({
          code: 'INVALID_LINE_DISCOUNT',
          message: `Line ${index + 1}: discount cannot exceed the line amount`,
        });
      }

      return {
        productModelId: item.productModelId,
        productName: model.name,
        categoryName: model.category?.name ?? null,
        unit: String(model.unit),
        quantity,
        price,
        lineDiscount,
      };
    });
  }

  private totalsFor(
    items: NormalizedItem[] | { price: number; quantity: number; lineDiscount: number }[],
    discountPercentage: number,
    discountAmount: number,
  ) {
    const lines: QuotationAmountLine[] = items.map((item) => ({
      price: item.price,
      quantity: item.quantity,
      lineDiscount: item.lineDiscount,
    }));
    return calculateQuotationTotals(lines, discountPercentage, discountAmount);
  }

  private async nextNumber(tx: Prisma.TransactionClient): Promise<string> {
    const sequence = await tx.quotationSequence.upsert({
      where: { id: 1 },
      update: { currentNumber: { increment: 1 } },
      create: { id: 1, currentNumber: 1 },
    });
    return `Q-${String(sequence.currentNumber).padStart(4, '0')}`;
  }

  private async addEvent(
    tx: Prisma.TransactionClient,
    quotationId: number,
    type: QuotationEventType,
    actorId: number | null,
    message?: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    await tx.quotationEvent.create({
      data: { quotationId, type, actorId, message, metadata },
    });
  }

  private snapshot(quotation: {
    status: QuotationStatus;
    customerName: string;
    validUntil: Date;
    subtotal: Prisma.Decimal | number;
    lineDiscountTotal: Prisma.Decimal | number;
    discountPercentage: Prisma.Decimal | number;
    discountAmount: Prisma.Decimal | number;
    total: Prisma.Decimal | number;
    items: { productName: string; quantity: number; price: Prisma.Decimal | number; lineDiscount: Prisma.Decimal | number }[];
  }) {
    return {
      status: quotation.status,
      customerName: quotation.customerName,
      validUntil: quotation.validUntil.toISOString(),
      subtotal: Number(quotation.subtotal),
      lineDiscountTotal: Number(quotation.lineDiscountTotal),
      discountPercentage: Number(quotation.discountPercentage),
      discountAmount: Number(quotation.discountAmount),
      total: Number(quotation.total),
      items: quotation.items.map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
        price: Number(item.price),
        lineDiscount: Number(item.lineDiscount),
      })),
    };
  }

  private publish(type: string, quotationId: number, payload?: Record<string, unknown>) {
    this.realtimeService.publish({
      type,
      entity: 'Quotation',
      entityId: quotationId,
      roles: [Role.ADMIN, Role.SALES],
      payload,
    });
  }

  /* ------------------------------------------------------------------ */
  /*  CRUD                                                               */
  /* ------------------------------------------------------------------ */

  async create(requester: QuotationRequester, dto: CreateQuotationDto) {
    const customer = await this.loadCustomer(dto.customerId);
    const models = await this.loadModels(dto.items);
    const items = this.normalizeItems(dto.items, models);

    const validUntil = dto.validUntil
      ? this.normalizeDateOnly(dto.validUntil, 'validUntil')
      : defaultValidUntil();

    if (validUntil.getTime() < Date.now()) {
      throw new BadRequestException({
        code: 'INVALID_VALID_UNTIL',
        message: 'validUntil cannot be in the past',
      });
    }

    const discountPercentage = Math.max(0, Math.min(Number(dto.discountPercentage) || 0, 100));
    const totals = this.totalsFor(items, discountPercentage, Number(dto.discountAmount) || 0);

    const quotation = await this.prisma.$transaction(async (tx) => {
      const quotationNumber = await this.nextNumber(tx);

      const created = await tx.quotation.create({
        data: {
          quotationNumber,
          customerId: customer.id,
          createdById: requester.sub,
          status: QuotationStatus.DRAFT,
          validUntil,
          customerName: customer.name,
          customerPhone: customer.phone?.trim() || null,
          notes: dto.notes?.trim() || null,
          subtotal: totals.subtotal,
          lineDiscountTotal: totals.lineDiscountTotal,
          discountPercentage,
          discountAmount: totals.fixedDiscount,
          total: totals.total,
        },
      });

      await tx.quotationItem.createMany({
        data: items.map((item) => ({ ...item, quotationId: created.id })),
      });

      await this.addEvent(
        tx,
        created.id,
        QuotationEventType.CREATED,
        requester.sub,
        `Quotation ${quotationNumber} created`,
        { customerName: customer.name, itemCount: items.length, total: totals.total },
      );

      return created;
    });

    this.publish('quotation.created', quotation.id, {
      status: quotation.status,
      quotationNumber: quotation.quotationNumber,
    });

    return this.findOne(quotation.id, requester);
  }

  async findAll(params: {
    requester: QuotationRequester;
    search?: string;
    status?: QuotationStatus;
    customerId?: number;
    employeeId?: number;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortDir?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.max(1, Math.min(params.limit ?? 25, 100));
    const skip = (page - 1) * limit;
    const now = new Date();

    const filters: Prisma.QuotationWhereInput[] = [{ deletedAt: null }];

    if (params.search?.trim()) {
      const search = params.search.trim();
      filters.push({
        OR: [
          { quotationNumber: { contains: search, mode: 'insensitive' } },
          { customerName: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (params.customerId) filters.push({ customerId: params.customerId });
    if (params.employeeId) filters.push({ createdById: params.employeeId });

    const statusWhere = this.statusFilter(params.status, now);
    if (statusWhere) filters.push(statusWhere);

    if (params.from || params.to) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (params.from) {
        try {
          dateFilter.gte = zonedStartOfDay(params.from);
        } catch {
          throw new BadRequestException({ code: 'INVALID_DATE', message: 'from must be YYYY-MM-DD' });
        }
      }
      if (params.to) {
        try {
          dateFilter.lte = zonedEndOfDay(params.to);
        } catch {
          throw new BadRequestException({ code: 'INVALID_DATE', message: 'to must be YYYY-MM-DD' });
        }
      }
      filters.push({ date: dateFilter });
    }

    const where: Prisma.QuotationWhereInput = { AND: filters };
    const sortBy = SORTABLE_FIELDS.has(params.sortBy ?? '') ? (params.sortBy as string) : 'date';
    const sortDir: Prisma.SortOrder = params.sortDir === 'asc' ? 'asc' : 'desc';

    const [rows, total] = await Promise.all([
      this.prisma.quotation.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          createdBy: { select: { id: true, name: true } },
          convertedInvoice: { select: { id: true, invoiceNumber: true, status: true } },
          items: { select: { id: true } },
        },
        orderBy: [{ [sortBy]: sortDir }, { id: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.quotation.count({ where }),
    ]);

    return {
      data: rows.map((row) => {
        const { items, ...rest } = row;
        return { ...this.decorate(rest, now), itemCount: items.length };
      }),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number, requester?: QuotationRequester) {
    const quotation = await this.prisma.quotation.findFirst({
      where: { id, deletedAt: null },
      include: {
        customer: { select: { id: true, name: true, phone: true, type: true } },
        createdBy: { select: { id: true, name: true, role: true } },
        items: { orderBy: { id: 'asc' } },
        events: {
          orderBy: { createdAt: 'asc' },
          include: { actor: { select: { id: true, name: true, role: true } } },
        },
        revisedFrom: {
          select: { id: true, quotationNumber: true, status: true, date: true },
        },
        revisions: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { id: true, quotationNumber: true, status: true, date: true, total: true },
        },
        convertedInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            status: true,
            date: true,
            currentTotal: true,
          },
        },
      },
    });

    if (!quotation) this.notFound();

    // Sales may view every quotation (read-only for other people's quotes).
    void requester;

    return this.decorate(quotation);
  }

  async update(id: number, requester: QuotationRequester, dto: UpdateQuotationDto) {
    const current = await this.prisma.quotation.findFirst({
      where: { id, deletedAt: null },
      include: { items: true },
    });
    if (!current) this.notFound();
    this.assertCanMutate(current, requester);

    if (current.status !== QuotationStatus.DRAFT) {
      throw new BadRequestException({
        code: 'QUOTATION_NOT_EDITABLE',
        message: 'Only draft quotations can be edited',
      });
    }

    let customer = await this.loadCustomer(dto.customerId ?? current.customerId);

    let items: NormalizedItem[];
    if (dto.items) {
      const models = await this.loadModels(dto.items);
      items = this.normalizeItems(dto.items, models);
    } else {
      items = current.items.map((item) => ({
        productModelId: item.productModelId,
        productName: item.productName,
        categoryName: item.categoryName,
        unit: item.unit,
        quantity: item.quantity,
        price: Number(item.price),
        lineDiscount: Number(item.lineDiscount),
      }));
    }

    const validUntil = dto.validUntil
      ? this.normalizeDateOnly(dto.validUntil, 'validUntil')
      : current.validUntil;

    if (validUntil.getTime() < Date.now()) {
      throw new BadRequestException({
        code: 'INVALID_VALID_UNTIL',
        message: 'validUntil cannot be in the past',
      });
    }

    const discountPercentage = Math.max(
      0,
      Math.min(Number(dto.discountPercentage ?? current.discountPercentage) || 0, 100),
    );
    const discountAmount = Number(dto.discountAmount ?? current.discountAmount) || 0;
    const totals = this.totalsFor(items, discountPercentage, discountAmount);

    const before = this.snapshot(current);

    const updated = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.quotation.updateMany({
        where: { id, status: QuotationStatus.DRAFT, deletedAt: null },
        data: {
          customerId: customer.id,
          customerName: customer.name,
          customerPhone: customer.phone?.trim() || null,
          validUntil,
          notes: dto.notes !== undefined ? dto.notes.trim() || null : current.notes,
          subtotal: totals.subtotal,
          lineDiscountTotal: totals.lineDiscountTotal,
          discountPercentage,
          discountAmount: totals.fixedDiscount,
          total: totals.total,
        },
      });

      if (claim.count !== 1) {
        throw new ConflictException({
          code: 'QUOTATION_NOT_EDITABLE',
          message: 'This quotation changed while you were editing it. Reload and try again.',
        });
      }

      if (dto.items) {
        await tx.quotationItem.deleteMany({ where: { quotationId: id } });
        await tx.quotationItem.createMany({
          data: items.map((item) => ({ ...item, quotationId: id })),
        });
      }

      const refreshed = await tx.quotation.findUniqueOrThrow({
        where: { id },
        include: { items: true },
      });

      await this.addEvent(
        tx,
        id,
        QuotationEventType.UPDATED,
        requester.sub,
        'Quotation details updated',
        {
          before,
          after: this.snapshot(refreshed),
        },
      );

      return refreshed;
    });

    this.publish('quotation.updated', id, {
      status: updated.status,
      total: Number(updated.total),
    });

    return this.findOne(id, requester);
  }

  /* ------------------------------------------------------------------ */
  /*  Lifecycle                                                          */
  /* ------------------------------------------------------------------ */

  private async loadForLifecycle(id: number) {
    const quotation = await this.prisma.quotation.findFirst({
      where: { id, deletedAt: null },
      include: { items: true },
    });
    if (!quotation) this.notFound();
    return quotation;
  }

  /** Persist EXPIRED for a single row if its validity already ended. */
  private async expireIfNeeded(
    quotation: { id: number; status: QuotationStatus; validUntil: Date },
    actorId?: number | null,
  ): Promise<boolean> {
    if (quotation.status !== QuotationStatus.SENT || !isQuotationExpired(quotation.validUntil)) {
      return false;
    }

    const claimed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.quotation.updateMany({
        where: {
          id: quotation.id,
          status: QuotationStatus.SENT,
          validUntil: { lt: new Date() },
          deletedAt: null,
        },
        data: { status: QuotationStatus.EXPIRED },
      });
      if (result.count === 1) {
        await this.addEvent(
          tx,
          quotation.id,
          QuotationEventType.EXPIRED,
          actorId ?? null,
          'Quotation validity ended',
        );
      }
      return result.count === 1;
    });

    if (claimed) {
      this.publish('quotation.expired', quotation.id, { status: QuotationStatus.EXPIRED });
    }
    return claimed;
  }

  async send(id: number, requester: QuotationRequester) {
    const quotation = await this.loadForLifecycle(id);
    this.assertCanMutate(quotation, requester);
    assertTransition(quotation.status, QuotationStatus.SENT);

    if (isQuotationExpired(quotation.validUntil)) {
      throw new BadRequestException({
        code: 'QUOTATION_EXPIRED',
        message: 'This quotation has expired. Revise it before sending.',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.quotation.updateMany({
        where: { id, status: QuotationStatus.DRAFT, deletedAt: null },
        data: { status: QuotationStatus.SENT, sentAt: new Date() },
      });
      if (claim.count !== 1) {
        throw new ConflictException({
          code: 'INVALID_QUOTATION_STATUS',
          message: 'Quotation was already sent or changed by another user',
        });
      }
      await this.addEvent(
        tx,
        id,
        QuotationEventType.SENT,
        requester.sub,
        'Quotation marked as sent',
      );
      return tx.quotation.findUniqueOrThrow({ where: { id } });
    });

    this.publish('quotation.status', id, { status: result.status });
    return this.findOne(id, requester);
  }

  async accept(id: number, requester: QuotationRequester) {
    const quotation = await this.loadForLifecycle(id);
    this.assertCanMutate(quotation, requester);
    assertTransition(quotation.status, QuotationStatus.ACCEPTED);

    if (await this.expireIfNeeded(quotation, requester.sub)) {
      throw new BadRequestException({
        code: 'QUOTATION_EXPIRED',
        message: 'This quotation has expired and can no longer be accepted',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.quotation.updateMany({
        where: {
          id,
          status: QuotationStatus.SENT,
          validUntil: { gte: new Date() },
          deletedAt: null,
        },
        data: { status: QuotationStatus.ACCEPTED, acceptedAt: new Date() },
      });
      if (claim.count !== 1) {
        throw new ConflictException({
          code: 'INVALID_QUOTATION_STATUS',
          message: 'Quotation was already processed or has expired',
        });
      }
      await this.addEvent(
        tx,
        id,
        QuotationEventType.ACCEPTED,
        requester.sub,
        'Quotation accepted by customer',
      );
      return tx.quotation.findUniqueOrThrow({ where: { id } });
    });

    this.publish('quotation.status', id, { status: result.status });
    return this.findOne(id, requester);
  }

  async reject(id: number, requester: QuotationRequester, reason?: string) {
    const quotation = await this.loadForLifecycle(id);
    this.assertCanMutate(quotation, requester);
    assertTransition(quotation.status, QuotationStatus.REJECTED);

    if (await this.expireIfNeeded(quotation, requester.sub)) {
      throw new BadRequestException({
        code: 'QUOTATION_EXPIRED',
        message: 'This quotation has expired and can no longer be rejected',
      });
    }

    const cleanReason = reason?.trim() || null;

    const result = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.quotation.updateMany({
        where: { id, status: QuotationStatus.SENT, deletedAt: null },
        data: {
          status: QuotationStatus.REJECTED,
          rejectedAt: new Date(),
          rejectedReason: cleanReason,
        },
      });
      if (claim.count !== 1) {
        throw new ConflictException({
          code: 'INVALID_QUOTATION_STATUS',
          message: 'Quotation was already processed by another user',
        });
      }
      await this.addEvent(
        tx,
        id,
        QuotationEventType.REJECTED,
        requester.sub,
        cleanReason ? `Quotation rejected: ${cleanReason}` : 'Quotation rejected',
        cleanReason ? { reason: cleanReason } : undefined,
      );
      return tx.quotation.findUniqueOrThrow({ where: { id } });
    });

    this.publish('quotation.status', id, { status: result.status });
    return this.findOne(id, requester);
  }

  async revise(id: number, requester: QuotationRequester, dto: ReviseQuotationDto) {
    const current = await this.loadForLifecycle(id);
    this.assertCanMutate(current, requester);

    const effective = effectiveQuotationStatus(current.status, current.validUntil);
    if (!canRevise(effective)) {
      throw new BadRequestException({
        code: 'QUOTATION_NOT_REVISABLE',
        message: `A ${effective} quotation cannot be revised`,
      });
    }

    const validUntil = dto.validUntil
      ? this.normalizeDateOnly(dto.validUntil, 'validUntil')
      : defaultValidUntil();

    if (validUntil.getTime() < Date.now()) {
      throw new BadRequestException({
        code: 'INVALID_VALID_UNTIL',
        message: 'validUntil cannot be in the past',
      });
    }

    const items: NormalizedItem[] = current.items.map((item) => ({
      productModelId: item.productModelId,
      productName: item.productName,
      categoryName: item.categoryName,
      unit: item.unit,
      quantity: item.quantity,
      price: Number(item.price),
      lineDiscount: Number(item.lineDiscount),
    }));

    const discountPercentage = Number(current.discountPercentage);
    const discountAmount = Number(current.discountAmount);
    const totals = this.totalsFor(items, discountPercentage, discountAmount);

    const revision = await this.prisma.$transaction(async (tx) => {
      const quotationNumber = await this.nextNumber(tx);

      const created = await tx.quotation.create({
        data: {
          quotationNumber,
          customerId: current.customerId,
          createdById: requester.sub,
          status: QuotationStatus.DRAFT,
          validUntil,
          customerName: current.customerName,
          customerPhone: current.customerPhone,
          notes: dto.notes !== undefined ? dto.notes.trim() || null : current.notes,
          subtotal: totals.subtotal,
          lineDiscountTotal: totals.lineDiscountTotal,
          discountPercentage,
          discountAmount: totals.fixedDiscount,
          total: totals.total,
          revisedFromId: current.id,
        },
      });

      await tx.quotationItem.createMany({
        data: items.map((item) => ({ ...item, quotationId: created.id })),
      });

      await this.addEvent(
        tx,
        current.id,
        QuotationEventType.REVISED,
        requester.sub,
        `Revised as ${quotationNumber}`,
        { revisionId: created.id, revisionNumber: quotationNumber },
      );

      await this.addEvent(
        tx,
        created.id,
        QuotationEventType.CREATED,
        requester.sub,
        `Revision of ${current.quotationNumber}`,
        { revisedFromId: current.id, revisedFromNumber: current.quotationNumber },
      );

      return created;
    });

    this.publish('quotation.revised', revision.id, {
      status: revision.status,
      revisedFromId: current.id,
      quotationNumber: revision.quotationNumber,
    });

    return this.findOne(revision.id, requester);
  }

  async remove(id: number, requester: QuotationRequester) {
    const quotation = await this.loadForLifecycle(id);

    if (quotation.status === QuotationStatus.CONVERTED || quotation.convertedInvoiceId) {
      throw new BadRequestException({
        code: 'QUOTATION_CONVERTED',
        message: 'A converted quotation cannot be deleted',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.quotation.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (claim.count !== 1) {
        throw new ConflictException({
          code: 'QUOTATION_ALREADY_DELETED',
          message: 'Quotation was already deleted',
        });
      }
      await this.addEvent(
        tx,
        id,
        QuotationEventType.DELETED,
        requester.sub,
        'Quotation deleted',
      );
    });

    this.publish('quotation.deleted', id, { quotationNumber: quotation.quotationNumber });
    return { id, deleted: true };
  }

  /* ------------------------------------------------------------------ */
  /*  Expiry job                                                         */
  /* ------------------------------------------------------------------ */

  async expireOverdueQuotations(): Promise<number> {
    const now = new Date();
    const overdue = await this.prisma.quotation.findMany({
      where: {
        status: QuotationStatus.SENT,
        validUntil: { lt: now },
        deletedAt: null,
      },
      select: { id: true },
    });

    let expired = 0;
    for (const quotation of overdue) {
      const claimed = await this.prisma.$transaction(async (tx) => {
        const claim = await tx.quotation.updateMany({
          where: {
            id: quotation.id,
            status: QuotationStatus.SENT,
            validUntil: { lt: new Date() },
            deletedAt: null,
          },
          data: { status: QuotationStatus.EXPIRED },
        });
        if (claim.count === 1) {
          await this.addEvent(
            tx,
            quotation.id,
            QuotationEventType.EXPIRED,
            null,
            'Quotation expired automatically',
          );
        }
        return claim.count === 1;
      });

      if (claimed) {
        expired += 1;
        this.publish('quotation.expired', quotation.id, {
          status: QuotationStatus.EXPIRED,
        });
      }
    }

    return expired;
  }

  /* ------------------------------------------------------------------ */
  /*  Report                                                             */
  /* ------------------------------------------------------------------ */

  private buildReportBase(params: {
    from: string;
    to: string;
    createdById?: number;
    customerId?: number;
    search?: string;
  }): Prisma.QuotationWhereInput {
    let from: Date;
    let to: Date;
    try {
      from = zonedStartOfDay(params.from);
      to = zonedEndOfDay(params.to);
    } catch {
      throw new BadRequestException({
        code: 'INVALID_DATE',
        message: 'from and to must be valid YYYY-MM-DD dates',
      });
    }
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException({
        code: 'INVALID_DATE_RANGE',
        message: 'from must be before to',
      });
    }

    const filters: Prisma.QuotationWhereInput[] = [
      { deletedAt: null },
      { date: { gte: from, lte: to } },
    ];
    if (params.createdById) filters.push({ createdById: params.createdById });
    if (params.customerId) filters.push({ customerId: params.customerId });
    if (params.search?.trim()) {
      const search = params.search.trim();
      filters.push({
        OR: [
          { quotationNumber: { contains: search, mode: 'insensitive' } },
          { customerName: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    return { AND: filters };
  }

  async getReport(params: {
    from: string;
    to: string;
    createdById?: number;
    customerId?: number;
    status?: QuotationStatus;
    search?: string;
  }) {
    const baseWhere = this.buildReportBase(params);
    const now = new Date();

    const groups = await this.prisma.quotation.groupBy({
      by: ['status'],
      where: baseWhere,
      _count: { _all: true },
      _sum: { total: true },
    });

    const byStatus = new Map<QuotationStatus, { count: number; value: number }>();
    for (const status of Object.values(QuotationStatus)) {
      byStatus.set(status, { count: 0, value: 0 });
    }
    for (const group of groups) {
      byStatus.set(group.status, {
        count: group._count._all,
        value: roundMoney(Number(group._sum.total ?? 0)),
      });
    }

    // Move SENT rows whose validity ended into EXPIRED, so the report matches
    // what the list/details show even before the background job runs.
    const overdue = await this.prisma.quotation.aggregate({
      where: {
        AND: [baseWhere, { status: QuotationStatus.SENT, validUntil: { lt: now } }],
      },
      _count: { _all: true },
      _sum: { total: true },
    });
    if (overdue._count._all > 0) {
      const sent = byStatus.get(QuotationStatus.SENT)!;
      const expired = byStatus.get(QuotationStatus.EXPIRED)!;
      byStatus.set(QuotationStatus.SENT, {
        count: Math.max(0, sent.count - overdue._count._all),
        value: roundMoney(Math.max(0, sent.value - Number(overdue._sum.total ?? 0))),
      });
      byStatus.set(QuotationStatus.EXPIRED, {
        count: expired.count + overdue._count._all,
        value: roundMoney(expired.value + Number(overdue._sum.total ?? 0)),
      });
    }

    const statusRows = Object.values(QuotationStatus).map((status) => ({
      status,
      count: byStatus.get(status)!.count,
      value: byStatus.get(status)!.value,
    }));

    const relevantStatus = params.status;
    const filteredStatusRows = relevantStatus
      ? statusRows.filter((row) => row.status === relevantStatus)
      : statusRows;

    const totalCount = filteredStatusRows.reduce((sum, row) => sum + row.count, 0);
    const quotedValue = roundMoney(
      filteredStatusRows.reduce((sum, row) => sum + row.value, 0),
    );
    // When the report is filtered to one status, every KPI must describe that
    // status only. Otherwise a DRAFT-only view would still show every converted
    // quotation and a non-zero conversion rate.
    const converted = relevantStatus
      ? relevantStatus === QuotationStatus.CONVERTED
        ? byStatus.get(QuotationStatus.CONVERTED)!
        : { count: 0, value: 0 }
      : byStatus.get(QuotationStatus.CONVERTED)!;
    const draftCount =
      !relevantStatus || relevantStatus === QuotationStatus.DRAFT
        ? byStatus.get(QuotationStatus.DRAFT)!.count
        : 0;
    const decidedCount = Math.max(0, totalCount - draftCount);
    const conversionRate = decidedCount > 0
      ? roundMoney((converted.count / decidedCount) * 100)
      : 0;

    const salesGroups = await this.prisma.quotation.groupBy({
      by: ['createdById'],
      where: baseWhere,
      _count: { _all: true },
      _sum: { total: true },
    });
    const convertedGroups = await this.prisma.quotation.groupBy({
      by: ['createdById'],
      where: { AND: [baseWhere, { status: QuotationStatus.CONVERTED }] },
      _count: { _all: true },
      _sum: { total: true },
    });
    const convertedByEmployee = new Map(
      convertedGroups.map((group) => [
        group.createdById,
        {
          count: group._count._all,
          value: roundMoney(Number(group._sum.total ?? 0)),
        },
      ]),
    );
    const employeeIds = salesGroups.map((group) => group.createdById);
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, name: true },
    });
    const employeeNames = new Map(employees.map((employee) => [employee.id, employee.name]));

    const bySalesperson = salesGroups
      .map((group) => {
        const convertedForEmployee = convertedByEmployee.get(group.createdById);
        const count = group._count._all;
        return {
          employeeId: group.createdById,
          employeeName: employeeNames.get(group.createdById) ?? `#${group.createdById}`,
          count,
          quotedValue: roundMoney(Number(group._sum.total ?? 0)),
          convertedCount: convertedForEmployee?.count ?? 0,
          convertedValue: convertedForEmployee?.value ?? 0,
          conversionRate: count > 0
            ? roundMoney(((convertedForEmployee?.count ?? 0) / count) * 100)
            : 0,
        };
      })
      .sort((a, b) => b.quotedValue - a.quotedValue);

    return {
      from: params.from,
      to: params.to,
      generatedAt: new Date().toISOString(),
      summary: {
        totalCount,
        quotedValue,
        convertedCount: converted.count,
        convertedValue: converted.value,
        conversionRate,
        averageValue: totalCount > 0 ? roundMoney(quotedValue / totalCount) : 0,
      },
      byStatus: filteredStatusRows,
      bySalesperson,
    };
  }

  async getReportDetails(params: {
    from: string;
    to: string;
    createdById?: number;
    customerId?: number;
    status?: QuotationStatus;
    search?: string;
    page?: number;
    limit?: number;
    all?: boolean;
  }) {
    const baseWhere = this.buildReportBase(params);
    const statusWhere = this.statusFilter(params.status);
    const where: Prisma.QuotationWhereInput = statusWhere
      ? { AND: [baseWhere, statusWhere] }
      : baseWhere;

    const page = Math.max(1, params.page ?? 1);
    const limit = params.all
      ? 5000
      : Math.max(1, Math.min(params.limit ?? 25, 100));
    const skip = params.all ? 0 : (page - 1) * limit;

    const [rows, total] = await Promise.all([
      this.prisma.quotation.findMany({
        where,
        include: {
          createdBy: { select: { id: true, name: true } },
          convertedInvoice: { select: { id: true, invoiceNumber: true } },
          revisedFrom: { select: { id: true, quotationNumber: true } },
          items: { select: { id: true } },
        },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.quotation.count({ where }),
    ]);

    return {
      data: rows.map((row) => {
        const { items, ...rest } = row;
        return { ...this.decorate(rest), itemCount: items.length };
      }),
      meta: {
        page: params.all ? 1 : page,
        limit,
        total,
        totalPages: params.all ? 1 : Math.ceil(total / limit),
        truncated: params.all && total > limit,
      },
    };
  }
}
