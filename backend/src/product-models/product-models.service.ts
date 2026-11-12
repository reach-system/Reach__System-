import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductLastPriceSource, UnitOfMeasure } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductModelsService {
  constructor(private prisma: PrismaService) {}

  private serializeLastPrice(row: { id: number; price: Prisma.Decimal | number; source: string; sourceInvoiceId?: number | null; effectiveAt: Date; version: number; updatedByEmployeeId?: number | null; updatedBy?: { id: number; name: string } | null; sourceInvoice?: { id: number; invoiceNumber: string } | null } | null) {
    if (!row) return null;
    return {
      id: row.id,
      price: Number(row.price),
      source: row.source,
      sourceInvoiceId: row.sourceInvoiceId ?? null,
      sourceInvoice: row.sourceInvoice ?? null,
      effectiveAt: row.effectiveAt.toISOString(),
      version: row.version,
      updatedByEmployeeId: row.updatedByEmployeeId ?? null,
      updatedBy: row.updatedBy ?? null,
    };
  }

  private serializeModel(model: any) {
    return {
      ...model,
      lastPrice: this.serializeLastPrice(model.lastPrice),
    };
  }

  async findAll(params: {
    categoryId?: number;
    search?: string;
    includeInactive?: boolean;
    page?: number;
    limit?: number;
  }) {
    const { categoryId, search, includeInactive = false, page = 1, limit = 25 } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductModelWhereInput = {
      ...(includeInactive ? {} : { isActive: true, deletedAt: null }),
      ...(categoryId && { categoryId }),
      ...(search && {
        name: { contains: search, mode: 'insensitive' },
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.productModel.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          lastPrice: {
            include: {
              updatedBy: { select: { id: true, name: true } },
              sourceInvoice: { select: { id: true, invoiceNumber: true } },
            },
          },
          _count: {
            select: {
              units: {
                where: { status: 'AVAILABLE' },
              },
            },
          },
        },
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.productModel.count({ where }),
    ]);

    return {
      data: data.map((model) => this.serializeModel(model)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const model = await this.prisma.productModel.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true } },
        lastPrice: {
          include: {
            updatedBy: { select: { id: true, name: true } },
            sourceInvoice: { select: { id: true, invoiceNumber: true } },
          },
        },
        _count: {
          select: {
            units: true,
          },
        },
      },
    });

    if (!model || model.deletedAt) {
      throw new NotFoundException({ code: 'PRODUCT_MODEL_NOT_FOUND', message: 'Product model not found' });
    }

    return this.serializeModel(model);
  }

  async getLastPriceList(params: { categoryId?: number; search?: string; page?: number; limit?: number; includeWithoutPrice?: boolean; }) {
    const { categoryId, search, page = 1, limit = 25, includeWithoutPrice = true } = params;
    const where: Prisma.ProductModelWhereInput = {
      isActive: true,
      deletedAt: null,
      ...(categoryId && { categoryId }),
      ...(search && { name: { contains: search, mode: 'insensitive' } }),
      ...(!includeWithoutPrice && { lastPrice: { isNot: null } }),
    };

    const [models, total] = await Promise.all([
      this.prisma.productModel.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          lastPrice: {
            include: {
              updatedBy: { select: { id: true, name: true } },
              sourceInvoice: { select: { id: true, invoiceNumber: true } },
            },
          },
        },
        orderBy: [{ name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.productModel.count({ where }),
    ]);

    return {
      data: models.map((model) => this.serializeModel(model)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getLastPriceByProductModelId(productModelId: number) {
    const row = await this.prisma.productLastPrice.findUnique({
      where: { productModelId },
      include: {
        updatedBy: { select: { id: true, name: true } },
        sourceInvoice: { select: { id: true, invoiceNumber: true } },
      },
    });
    return this.serializeLastPrice(row);
  }

  async setManualLastPrice(productModelId: number, employeeId: number, price: number | null, expectedVersion?: number) {
    const product = await this.prisma.productModel.findFirst({
      where: { id: productModelId, isActive: true, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException({ code: 'PRODUCT_MODEL_NOT_FOUND', message: 'Product model not found' });
    }

    if (price !== null) {
      const normalized = Number(price);
      if (!Number.isFinite(normalized) || normalized <= 0 || normalized > 1000000000) {
        throw new BadRequestException({ code: 'INVALID_PRICE', message: 'Price must be a positive number' });
      }

      const existing = await this.prisma.productLastPrice.findUnique({ where: { productModelId } });
      if (expectedVersion !== undefined && existing && existing.version !== expectedVersion) {
        throw new ConflictException({
          code: 'STALE_LAST_PRICE',
          message: 'This product price was updated elsewhere. Refresh and try again.',
        });
      }

      if (existing) {
        const updated = await this.prisma.productLastPrice.update({
          where: { productModelId },
          data: {
            price: normalized,
            source: ProductLastPriceSource.MANUAL,
            sourceInvoiceId: null,
            effectiveAt: new Date(),
            updatedByEmployeeId: employeeId,
            version: { increment: 1 },
          },
          include: { updatedBy: { select: { id: true, name: true } } },
        });
        return { ...this.serializeLastPrice(updated), productModelId };
      }

      const created = await this.prisma.productLastPrice.create({
        data: {
          productModelId,
          price: normalized,
          source: ProductLastPriceSource.MANUAL,
          sourceInvoiceId: null,
          effectiveAt: new Date(),
          updatedByEmployeeId: employeeId,
          version: 1,
        },
        include: { updatedBy: { select: { id: true, name: true } } },
      });
      return { ...this.serializeLastPrice(created), productModelId };
    }

    const existing = await this.prisma.productLastPrice.findUnique({ where: { productModelId } });
    if (!existing) {
      return { productModelId, price: null, version: 0 };
    }
    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      throw new ConflictException({
        code: 'STALE_LAST_PRICE',
        message: 'This product price was updated elsewhere. Refresh and try again.',
      });
    }

    await this.prisma.productLastPrice.delete({ where: { productModelId } });
    return { productModelId, price: null, version: 0 };
  }

  async upsertInvoiceLastPrice(
    tx: Prisma.TransactionClient,
    productModelId: number,
    price: number,
    sourceInvoiceId: number,
    effectiveAt: Date,
  ) {
    const normalized = Number(price);
    if (!Number.isFinite(normalized) || normalized < 0 || normalized > 1000000000) {
      throw new BadRequestException({ code: 'INVALID_PRICE', message: 'Price must be a non-negative number' });
    }

    const existing = await tx.productLastPrice.findUnique({ where: { productModelId } });
    if (!existing) {
      return tx.productLastPrice.create({
        data: {
          productModelId,
          price: normalized,
          source: ProductLastPriceSource.INVOICE,
          sourceInvoiceId,
          effectiveAt,
          version: 1,
        },
      });
    }

    if (existing.effectiveAt.getTime() > effectiveAt.getTime()) {
      return existing;
    }

    return tx.productLastPrice.update({
      where: { productModelId },
      data: {
        price: normalized,
        source: ProductLastPriceSource.INVOICE,
        sourceInvoiceId,
        effectiveAt,
        updatedByEmployeeId: null,
        version: { increment: 1 },
      },
    });
  }

  async create(data: {
    categoryId: number;
    name: string;
    minStockAlert?: number;
    isSerialized?: boolean;
    unit?: UnitOfMeasure;
  }) {
    const category = await this.prisma.category.findFirst({
      where: { id: data.categoryId, isActive: true, deletedAt: null },
    });

    if (!category) {
      throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: 'Category not found or inactive' });
    }

    const existing = await this.prisma.productModel.findFirst({
      where: { categoryId: data.categoryId, name: data.name },
    });

    if (existing) {
      throw new ConflictException({ code: 'MODEL_DUPLICATE', message: 'A model with this name already exists in this category' });
    }

    const unit = data.unit ?? UnitOfMeasure.PIECE;
    const isSerialized = unit === UnitOfMeasure.METER ? false : (data.isSerialized ?? true);

    return this.prisma.productModel.create({
      data: {
        categoryId: data.categoryId,
        name: data.name,
        minStockAlert: data.minStockAlert ?? 0,
        isSerialized,
        unit,
      },
      include: {
        category: { select: { id: true, name: true } },
      },
    });
  }

  async update(
    id: number,
    data: {
      name?: string;
      minStockAlert?: number;
      categoryId?: number;
      isSerialized?: boolean;
      unit?: UnitOfMeasure;
    },
  ) {
    const existing = await this.findOne(id);

    if (data.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: data.categoryId, isActive: true, deletedAt: null },
      });
      if (!category) {
        throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: 'Category not found or inactive' });
      }
    }

    const unit = data.unit ?? existing.unit;
    const isSerialized = unit === UnitOfMeasure.METER ? false : data.isSerialized ?? existing.isSerialized;

    if (existing.isSerialized && !isSerialized) {
      const unitCount = await this.prisma.productUnit.count({ where: { productModelId: id } });
      if (unitCount > 0) {
        throw new ConflictException({
          code: 'MODEL_HAS_UNITS',
          message: 'This product already has barcode units, so it cannot be switched to quantity-based stock.',
        });
      }
    }

    return this.prisma.productModel.update({
      where: { id },
      data: {
        ...data,
        unit,
        isSerialized,
      },
      include: {
        category: { select: { id: true, name: true } },
      },
    });
  }

  async deactivate(id: number) {
    await this.findOne(id);

    return this.prisma.productModel.update({
      where: { id },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
      select: { id: true, name: true, isActive: true },
    });
  }
}
