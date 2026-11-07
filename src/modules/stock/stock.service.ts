import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model } from 'mongoose';
import { Product, ProductDocument } from '../products/product.schema';
import { StockMovement, StockMovementDocument, StockMovementType } from './stock-movement.schema';
import { AlertsService } from '../notifications/alerts.service';

export interface StockLineInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
}

export interface StockLineSnapshot {
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  quantity: number;
  unitPriceKobo: number;
  unitCostKobo: number;
}

export interface StockMutationResult {
  lines: StockLineSnapshot[];
  lowStock: { productId: string; variantId: string }[];
  reference: string;
}

@Injectable()
export class StockService {
  constructor(
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(StockMovement.name) private readonly movements: Model<StockMovementDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly alerts: AlertsService,
  ) {}

  async purgeProduct(businessId: string, productId: string) {
    await this.movements.deleteMany({ businessId, productId }).exec();
  }

  async restock(
    userId: string,
    businessId: string,
    productId: string,
    variantId: string,
    quantity: number,
    unitCostKobo?: number,
    note = '',
  ) {
    if (quantity <= 0) throw new BadRequestException('Restock quantity must be at least 1.');
    const session = await this.connection.startSession();
    let lowRef: { productId: string; variantId: string } | null = null;
    try {
      await session.withTransaction(async () => {
        const product = await this.products.findOne({ _id: productId, businessId }).session(session).exec();
        if (!product) throw new NotFoundException('Product not found.');
        const variant = product.variants.find((v) => v._id?.toString() === variantId);
        if (!variant) throw new NotFoundException('Product variant not found.');
        const before = variant.quantity;
        const update: Record<string, unknown> = {
          $inc: { 'variants.$.quantity': quantity, quantity },
          $set: { 'variants.$.lowStockAlertActive': false, lastRestockedAt: new Date() },
        };
        if (unitCostKobo !== undefined) {
          (update.$set as Record<string, unknown>)['variants.$.costPriceKobo'] = unitCostKobo;
        }
        const updated = await this.products.findOneAndUpdate(
          { _id: productId, businessId, 'variants._id': variantId },
          update,
          { new: true, session },
        ).exec();
        if (!updated) throw new ConflictException('Stock changed while updating. Try again.');
        await this.movements.create(
          [{
            businessId,
            productId,
            variantId,
            productName: product.name,
            variantName: variant.name,
            type: 'restock' as StockMovementType,
            quantityDelta: quantity,
            quantityBefore: before,
            quantityAfter: before + quantity,
            unitCostKobo: unitCostKobo ?? variant.costPriceKobo,
            reference: `RESTOCK-${Date.now()}`,
            note,
            userId,
          }],
          { session },
        );
        lowRef = { productId, variantId };
      });
    } finally {
      await session.endSession();
    }
    if (lowRef) await this.alerts.checkMany(businessId, [lowRef]);
    return this.productView(businessId, productId);
  }

  async adjust(
    userId: string,
    businessId: string,
    productId: string,
    variantId: string,
    delta: number,
    note: string,
  ) {
    if (!delta) throw new BadRequestException('Adjustment cannot be zero.');
    const session = await this.connection.startSession();
    let lowRef: { productId: string; variantId: string } | null = null;
    try {
      await session.withTransaction(async () => {
        const product = await this.products.findOne({ _id: productId, businessId }).session(session).exec();
        if (!product) throw new NotFoundException('Product not found.');
        const variant = product.variants.find((v) => v._id?.toString() === variantId);
        if (!variant) throw new NotFoundException('Product variant not found.');
        const before = variant.quantity;
        if (before + delta < 0) throw new BadRequestException(`You only have ${before} in stock.`);
        const updated = await this.products.findOneAndUpdate(
          { _id: productId, businessId, 'variants._id': variantId, 'variants.quantity': { $gte: Math.max(0, -delta) } },
          {
            $inc: { 'variants.$.quantity': delta, quantity: delta },
            $set: delta > 0 ? { 'variants.$.lowStockAlertActive': false } : {},
          },
          { new: true, session },
        ).exec();
        if (!updated) throw new ConflictException('Stock changed while updating. Try again.');
        await this.movements.create(
          [{
            businessId,
            productId,
            variantId,
            productName: product.name,
            variantName: variant.name,
            type: 'adjustment' as StockMovementType,
            quantityDelta: delta,
            quantityBefore: before,
            quantityAfter: before + delta,
            reference: null,
            note,
            userId,
          }],
          { session },
        );
        lowRef = { productId, variantId };
      });
    } finally {
      await session.endSession();
    }
    if (lowRef) await this.alerts.checkMany(businessId, [lowRef]);
    return this.productView(businessId, productId);
  }

  /** Deduct stock atomically inside the caller's transaction. */
  async deductLines(
    session: ClientSession,
    businessId: string,
    items: StockLineInput[],
    reference: string,
    referenceType: string,
    referenceId: string,
    userId?: string | null,
  ): Promise<StockMutationResult> {
    const lines: StockLineSnapshot[] = [];
    const lowStock: { productId: string; variantId: string }[] = [];
    for (const item of items) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new BadRequestException('Every item needs a quantity of at least 1.');
      }
      const product = await this.products.findOne({ _id: item.productId, businessId }).session(session).exec();
      if (!product || !product.isActive) throw new NotFoundException('A product in this sale no longer exists.');
      const variant =
        (item.variantId && product.variants.find((v) => v._id?.toString() === item.variantId)) ||
        product.variants.find((v) => v.isActive) ||
        product.variants[0];
      if (!variant || !variant.isActive) throw new NotFoundException(`${product.name} is not available right now.`);
      const variantId = variant._id!.toString();
      if (variant.quantity < item.quantity) {
        throw new ConflictException(`Only ${variant.quantity} of ${product.name} (${variant.name}) left in stock.`);
      }
      const before = variant.quantity;
      const updated = await this.products.findOneAndUpdate(
        {
          _id: product._id,
          businessId,
          'variants._id': variant._id,
          'variants.quantity': { $gte: item.quantity },
        },
        {
          $inc: { 'variants.$.quantity': -item.quantity, quantity: -item.quantity, soldCount: item.quantity },
        },
        { new: true, session },
      ).exec();
      if (!updated) throw new ConflictException(`Stock for ${product.name} changed. Please try again.`);
      await this.movements.create(
        [{
          businessId,
          productId: product._id.toString(),
          variantId,
          productName: product.name,
          variantName: variant.name,
          type: 'sale' as StockMovementType,
          quantityDelta: -item.quantity,
          quantityBefore: before,
          quantityAfter: before - item.quantity,
          unitCostKobo: variant.costPriceKobo,
          reference,
          referenceType,
          referenceId,
          note: '',
          userId: userId ?? null,
        }],
        { session },
      );
      lines.push({
        productId: product._id.toString(),
        variantId,
        productName: product.name,
        variantName: variant.name,
        sku: variant.sku,
        quantity: item.quantity,
        unitPriceKobo: variant.priceKobo,
        unitCostKobo: variant.costPriceKobo,
      });
      lowStock.push({ productId: product._id.toString(), variantId });
    }
    return { lines, lowStock, reference };
  }

  async restoreLines(
    session: ClientSession,
    businessId: string,
    items: {
      productId: string;
      variantId: string;
      quantity: number;
      productName?: string;
      variantName?: string;
      unitCostKobo?: number;
    }[],
    reference: string,
    referenceType: string,
    referenceId: string,
    userId?: string | null,
  ): Promise<void> {
    for (const item of items) {
      const product = await this.products.findOne({ _id: item.productId, businessId }).session(session).exec();
      if (!product) continue;
      const variant = product.variants.find((v) => v._id?.toString() === item.variantId);
      if (!variant) continue;
      const before = variant.quantity;
      const updated = await this.products.findOneAndUpdate(
        { _id: product._id, businessId, 'variants._id': variant._id },
        {
          $inc: { 'variants.$.quantity': item.quantity, quantity: item.quantity },
          $set: { 'variants.$.lowStockAlertActive': false },
        },
        { new: true, session },
      ).exec();
      if (!updated) continue;
      await this.movements.create(
        [{
          businessId,
          productId: product._id.toString(),
          variantId: item.variantId,
          productName: product.name,
          variantName: variant.name,
          type: 'return' as StockMovementType,
          quantityDelta: item.quantity,
          quantityBefore: before,
          quantityAfter: before + item.quantity,
          unitCostKobo: variant.costPriceKobo,
          reference,
          referenceType,
          referenceId,
          note: 'Stock restored',
          userId: userId ?? null,
        }],
        { session },
      );
    }
  }

  async recordInitial(
    businessId: string,
    product: ProductDocument,
    userId: string,
  ): Promise<{ productId: string; variantId: string }[]> {
    const refs: { productId: string; variantId: string }[] = [];
    const movements = product.variants
      .filter((v) => v.quantity > 0)
      .map((v) => ({
        businessId,
        productId: product._id.toString(),
        variantId: v._id?.toString() ?? null,
        productName: product.name,
        variantName: v.name,
        type: 'initial' as StockMovementType,
        quantityDelta: v.quantity,
        quantityBefore: 0,
        quantityAfter: v.quantity,
        unitCostKobo: v.costPriceKobo,
        reference: 'INITIAL',
        note: 'Opening stock',
        userId,
      }));
    if (movements.length) await this.movements.insertMany(movements);
    for (const v of product.variants) {
      if (v._id) refs.push({ productId: product._id.toString(), variantId: v._id.toString() });
    }
    return refs;
  }

  async list(
    businessId: string,
    opts: {
      page: number;
      limit: number;
      productId?: string;
      type?: string;
      from?: string;
      to?: string;
    },
  ) {
    const filter: Record<string, unknown> = { businessId };
    if (opts.productId) filter.productId = opts.productId;
    if (opts.type) filter.type = opts.type;
    if (opts.from || opts.to) {
      filter.createdAt = {
        ...(opts.from ? { $gte: new Date(opts.from) } : {}),
        ...(opts.to ? { $lte: new Date(opts.to) } : {}),
      };
    }
    const [items, total, inbound, outbound] = await Promise.all([
      this.movements
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((opts.page - 1) * opts.limit)
        .limit(opts.limit)
        .lean()
        .exec(),
      this.movements.countDocuments(filter).exec(),
      this.movements.countDocuments({ ...filter, quantityDelta: { $gt: 0 } }).exec(),
      this.movements.countDocuments({ ...filter, quantityDelta: { $lt: 0 } }).exec(),
    ]);
    return {
      items,
      meta: {
        total,
        page: opts.page,
        limit: opts.limit,
        pages: Math.ceil(total / opts.limit),
        inbound,
        outbound,
      },
    };
  }

  async summary(businessId: string) {
    const products = await this.products
      .find({ businessId, isActive: true })
      .select('quantity priceKobo costPriceKobo variants lowStockThreshold name')
      .lean()
      .exec();
    let units = 0;
    let retailValueKobo = 0;
    let costValueKobo = 0;
    let lowStock = 0;
    let outOfStock = 0;
    for (const p of products) {
      for (const v of p.variants) {
        units += v.quantity;
        retailValueKobo += v.quantity * v.priceKobo;
        costValueKobo += v.quantity * v.costPriceKobo;
        if (v.quantity <= 0) outOfStock++;
        else if (v.quantity <= v.lowStockThreshold) lowStock++;
      }
    }
    return {
      products: products.length,
      units,
      retailValueKobo,
      costValueKobo,
      potentialProfitKobo: retailValueKobo - costValueKobo,
      lowStock,
      outOfStock,
    };
  }

  private async productView(businessId: string, productId: string) {
    const product = await this.products.findOne({ _id: productId, businessId }).lean().exec();
    if (!product) throw new NotFoundException('Product not found.');
    return product;
  }
}
