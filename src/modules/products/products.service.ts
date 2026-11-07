import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Product, ProductDocument, ProductVariant } from './product.schema';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { StockService } from '../stock/stock.service';
import { PlansService } from '../plans/plans.service';
import { AlertsService } from '../notifications/alerts.service';
import { AddVariantDto, CreateProductDto, ProductQueryDto, UpdateProductDto, UpdateVariantDto } from './dto/product.dto';
import { makeSlug } from '../../common/utils/slug';
import { sanitizeText, sanitizeUrl } from '../../common/utils/sanitize';

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    private readonly stock: StockService,
    private readonly plans: PlansService,
    private readonly alerts: AlertsService,
  ) {}

  async create(userId: string, businessId: string, dto: CreateProductDto) {
    const count = await this.products.countDocuments({ businessId }).exec();
    await this.plans.assertProductLimit(businessId, count);

    const images = (dto.images || []).map(sanitizeUrl).filter((u): u is string => Boolean(u));
    if (images.length !== (dto.images || []).length) {
      throw new BadRequestException('One or more image links are not valid URLs.');
    }
    const baseSku = this.cleanSku(dto.sku) || this.generateSku(dto.name);
    await this.assertSkuFree(businessId, baseSku);

    const variantInputs = dto.variants?.length
      ? dto.variants
      : [
          {
            name: 'Standard',
            sku: baseSku,
            attributes: {},
            priceKobo: dto.priceKobo ?? 0,
            costPriceKobo: dto.costPriceKobo ?? 0,
            quantity: dto.quantity ?? 0,
            lowStockThreshold: dto.lowStockThreshold ?? 5,
          },
        ];
    if (!dto.variants?.length && dto.priceKobo === undefined) {
      throw new BadRequestException('Add a selling price.');
    }
    if (variantInputs.some((v) => v.priceKobo <= 0)) {
      throw new BadRequestException('Every variant needs a selling price above zero.');
    }
    if (variantInputs.some((v) => v.costPriceKobo > v.priceKobo)) {
      // Allowed, but warn through the API so the UI can make it visible. We do not block loss leaders.
    }

    const usedSkus = new Set<string>();
    const variants: ProductVariant[] = [];
    for (const [index, v] of variantInputs.entries()) {
      let sku = this.cleanSku(v.sku);
      if (!sku) sku = `${baseSku}${variantInputs.length > 1 ? `-${index + 1}` : ''}`;
      if (usedSkus.has(sku)) throw new ConflictException(`SKU ${sku} is used twice on this product.`);
      usedSkus.add(sku);
      await this.assertSkuFree(businessId, sku);
      variants.push({
        _id: new Types.ObjectId(),
        name: sanitizeText(v.name, 80) || this.variantName(v.attributes, index),
        sku,
        attributes: v.attributes || {},
        priceKobo: v.priceKobo,
        costPriceKobo: v.costPriceKobo,
        quantity: v.quantity,
        lowStockThreshold: v.lowStockThreshold ?? dto.lowStockThreshold ?? 5,
        imageUrl: v.imageUrl ? sanitizeUrl(v.imageUrl) : null,
        isActive: true,
        lastLowStockAlertAt: null,
        lowStockAlertActive: false,
      });
    }

    const totals = this.computeTotals(variants);
    const product = await this.products.create({
      businessId,
      name: sanitizeText(dto.name, 120),
      description: sanitizeText(dto.description, 3000),
      category: sanitizeText(dto.category, 60) || 'General',
      sku: baseSku,
      images,
      tags: (dto.tags || []).map((t) => sanitizeText(t, 30)).filter(Boolean),
      variants,
      ...totals,
      lowStockThreshold: dto.lowStockThreshold ?? 5,
      isActive: true,
    });

    const refs = await this.stock.recordInitial(businessId, product, userId);
    await this.businesses.updateOne(
      { _id: businessId, firstProductAt: null },
      {
        $set: { firstProductAt: new Date() },
        $addToSet: { categories: sanitizeText(dto.category, 60) || 'General' },
      },
    ).exec();
    await this.alerts.checkMany(businessId, refs);
    return this.findOne(businessId, product._id.toString());
  }

  async list(businessId: string, query: ProductQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const filter: FilterQuery<ProductDocument> = { businessId };
    if (query.category && query.category !== 'all') filter.category = query.category;
    if (query.status === 'active') filter.isActive = true;
    if (query.status === 'inactive') filter.isActive = false;
    if (query.search) {
      filter.$or = [
        { name: { $regex: this.escapeRegex(query.search), $options: 'i' } },
        { sku: { $regex: this.escapeRegex(query.search), $options: 'i' } },
        { 'variants.sku': { $regex: this.escapeRegex(query.search), $options: 'i' } },
        { category: { $regex: this.escapeRegex(query.search), $options: 'i' } },
      ];
    }
    if (query.status === 'low' || query.status === 'out') {
      const expr =
        query.status === 'out'
          ? { $anyElementTrue: { $map: { input: '$variants', as: 'v', in: { $and: [{ $lte: ['$$v.quantity', 0] }, { $eq: ['$$v.isActive', true] }] } } } }
          : { $anyElementTrue: { $map: { input: '$variants', as: 'v', in: { $and: [{ $gt: ['$$v.quantity', 0] }, { $lte: ['$$v.quantity', '$$v.lowStockThreshold'] }, { $eq: ['$$v.isActive', true] }] } } } };
      const [result] = await this.products.aggregate([
        { $match: { ...filter, $expr: expr } },
        { $sort: { createdAt: -1 } },
        { $facet: { items: [{ $skip: (page - 1) * limit }, { $limit: limit }], total: [{ $count: 'count' }] } },
      ]).exec();
      const items = (result?.items || []).map((p: Record<string, unknown>) => this.withStockState(p));
      const total = result?.total?.[0]?.count || 0;
      return { items, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
    }
    const [items, total] = await Promise.all([
      this.products.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      this.products.countDocuments(filter).exec(),
    ]);
    return {
      items: items.map((p) => this.withStockState(p as unknown as Record<string, unknown>)),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async categories(businessId: string): Promise<string[]> {
    const categories = await this.products.distinct('category', { businessId, isActive: true }).exec();
    return (categories as string[]).filter(Boolean).sort();
  }

  async lowStock(businessId: string) {
    const products = await this.products.find({ businessId, isActive: true }).lean().exec();
    const items = products.flatMap((p) =>
      p.variants
        .filter((v) => v.isActive && v.quantity <= v.lowStockThreshold)
        .map((v) => ({
          productId: p._id.toString(),
          variantId: v._id?.toString(),
          name: p.name,
          variantName: v.name,
          imageUrl: p.images[0] || v.imageUrl,
          quantity: v.quantity,
          threshold: v.lowStockThreshold,
          outOfStock: v.quantity <= 0,
          priceKobo: v.priceKobo,
        })),
    );
    items.sort((a, b) => a.quantity - b.quantity);
    return items;
  }

  async findOne(businessId: string, productId: string) {
    const product = await this.products.findOne({ _id: productId, businessId }).lean().exec();
    if (!product) throw new NotFoundException('Product not found.');
    return this.withStockState(product as unknown as Record<string, unknown>);
  }

  async update(userId: string, businessId: string, productId: string, dto: UpdateProductDto) {
    const product = await this.products.findOne({ _id: productId, businessId }).exec();
    if (!product) throw new NotFoundException('Product not found.');
    if (dto.sku !== undefined) {
      const sku = this.cleanSku(dto.sku);
      if (!sku) throw new BadRequestException('SKU cannot be empty.');
      await this.assertSkuFree(businessId, sku, productId);
      product.sku = sku;
    }
    if (dto.name !== undefined) product.name = sanitizeText(dto.name, 120);
    if (dto.description !== undefined) product.description = sanitizeText(dto.description, 3000);
    if (dto.category !== undefined) product.category = sanitizeText(dto.category, 60) || 'General';
    if (dto.images !== undefined) {
      const images = dto.images.map(sanitizeUrl).filter((u): u is string => Boolean(u));
      product.images = images;
    }
    if (dto.tags !== undefined) product.tags = dto.tags.map((t) => sanitizeText(t, 30)).filter(Boolean);
    if (dto.isActive !== undefined) product.isActive = dto.isActive;
    if (dto.lowStockThreshold !== undefined) {
      product.lowStockThreshold = dto.lowStockThreshold;
      for (const v of product.variants) v.lowStockThreshold = dto.lowStockThreshold;
    }
    if (dto.priceKobo !== undefined) {
      if (dto.priceKobo <= 0) throw new BadRequestException('Selling price must be above zero.');
      for (const v of product.variants) v.priceKobo = dto.priceKobo;
    }
    if (dto.costPriceKobo !== undefined) {
      for (const v of product.variants) v.costPriceKobo = dto.costPriceKobo;
    }
    const totals = this.computeTotals(product.variants);
    product.priceKobo = totals.priceKobo;
    product.costPriceKobo = totals.costPriceKobo;
    product.quantity = totals.quantity;
    await product.save();
    await this.businesses.updateOne(
      { _id: businessId },
      { $addToSet: { categories: product.category } },
    ).exec();
    return this.findOne(businessId, productId);
  }

  async remove(userId: string, businessId: string, productId: string) {
    const product = await this.products.findOne({ _id: productId, businessId }).exec();
    if (!product) throw new NotFoundException('Product not found.');
    await this.stock.purgeProduct(businessId, productId);
    await this.products.deleteOne({ _id: productId, businessId }).exec();
    return { deleted: true, id: productId };
  }

  async removeMany(userId: string, businessId: string, ids: string[]) {
    const unique = [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id));
    if (!unique.length) throw new BadRequestException('Select at least one product.');
    const found = await this.products.find({ _id: { $in: unique }, businessId }).select('_id').lean().exec();
    if (found.length !== unique.length) throw new NotFoundException('One or more products were not found.');
    await Promise.all(found.map((product) => this.stock.purgeProduct(businessId, String(product._id))));
    const result = await this.products.deleteMany({ _id: { $in: unique }, businessId }).exec();
    return { deleted: result.deletedCount || 0 };
  }

  async addVariant(userId: string, businessId: string, productId: string, dto: AddVariantDto) {
    const product = await this.products.findOne({ _id: productId, businessId }).exec();
    if (!product) throw new NotFoundException('Product not found.');
    let sku = this.cleanSku(dto.sku) || `${product.sku}-${product.variants.length + 1}`;
    await this.assertSkuFree(businessId, sku);
    let attempt = 1;
    while (product.variants.some((v) => v.sku === sku)) {
      sku = `${sku}-${attempt++}`;
    }
    product.variants.push({
      _id: new Types.ObjectId(),
      name: sanitizeText(dto.name, 80) || this.variantName(dto.attributes, product.variants.length),
      sku,
      attributes: dto.attributes || {},
      priceKobo: dto.priceKobo,
      costPriceKobo: dto.costPriceKobo,
      quantity: dto.quantity,
      lowStockThreshold: dto.lowStockThreshold ?? product.lowStockThreshold,
      imageUrl: dto.imageUrl ? sanitizeUrl(dto.imageUrl) : null,
      isActive: true,
      lastLowStockAlertAt: null,
      lowStockAlertActive: false,
    });
    const totals = this.computeTotals(product.variants);
    product.priceKobo = totals.priceKobo;
    product.costPriceKobo = totals.costPriceKobo;
    product.quantity = totals.quantity;
    await product.save();
    const refreshed = await this.products.findById(product._id).exec();
    if (refreshed) {
      const refs = await this.stock.recordInitial(businessId, refreshed, userId);
      await this.alerts.checkMany(businessId, refs);
    }
    return this.findOne(businessId, productId);
  }

  async updateVariant(userId: string, businessId: string, productId: string, variantId: string, dto: UpdateVariantDto) {
    const product = await this.products.findOne({ _id: productId, businessId }).exec();
    if (!product) throw new NotFoundException('Product not found.');
    const variant = product.variants.find((v) => v._id?.toString() === variantId);
    if (!variant) throw new NotFoundException('Variant not found.');
    if (dto.sku !== undefined) {
      const sku = this.cleanSku(dto.sku);
      if (!sku) throw new BadRequestException('SKU cannot be empty.');
      await this.assertSkuFree(businessId, sku, productId, variantId);
      variant.sku = sku;
    }
    if (dto.name !== undefined) variant.name = sanitizeText(dto.name, 80);
    if (dto.attributes !== undefined) variant.attributes = dto.attributes;
    if (dto.priceKobo !== undefined) {
      if (dto.priceKobo <= 0) throw new BadRequestException('Selling price must be above zero.');
      variant.priceKobo = dto.priceKobo;
    }
    if (dto.costPriceKobo !== undefined) variant.costPriceKobo = dto.costPriceKobo;
    if (dto.lowStockThreshold !== undefined) variant.lowStockThreshold = dto.lowStockThreshold;
    if (dto.imageUrl !== undefined) variant.imageUrl = dto.imageUrl ? sanitizeUrl(dto.imageUrl) : null;
    if (dto.isActive !== undefined) variant.isActive = dto.isActive;
    const totals = this.computeTotals(product.variants);
    product.priceKobo = totals.priceKobo;
    product.costPriceKobo = totals.costPriceKobo;
    product.quantity = totals.quantity;
    await product.save();
    await this.alerts.checkMany(businessId, [{ productId, variantId }]);
    return this.findOne(businessId, productId);
  }

  async removeVariant(userId: string, businessId: string, productId: string, variantId: string) {
    const product = await this.products.findOne({ _id: productId, businessId }).exec();
    if (!product) throw new NotFoundException('Product not found.');
    if (product.variants.length <= 1) throw new BadRequestException('A product needs at least one variant.');
    const variant = product.variants.find((v) => v._id?.toString() === variantId);
    if (!variant) throw new NotFoundException('Variant not found.');
    if (variant.quantity > 0) throw new BadRequestException('Move the remaining stock to zero before deleting this variant.');
    product.variants = product.variants.filter((v) => v._id?.toString() !== variantId);
    const totals = this.computeTotals(product.variants);
    product.priceKobo = totals.priceKobo;
    product.costPriceKobo = totals.costPriceKobo;
    product.quantity = totals.quantity;
    await product.save();
    return this.findOne(businessId, productId);
  }

  private computeTotals(variants: ProductVariant[]) {
    const active = variants.filter((v) => v.isActive);
    const source = active.length ? active : variants;
    return {
      priceKobo: source.length ? Math.min(...source.map((v) => v.priceKobo)) : 0,
      costPriceKobo: source.length ? Math.min(...source.map((v) => v.costPriceKobo)) : 0,
      quantity: variants.reduce((sum, v) => sum + v.quantity, 0),
    };
  }

  private withStockState(product: Record<string, unknown>) {
    const variants = (product.variants as unknown as ProductVariant[]) || [];
    const lowVariants = variants.filter((v) => v.isActive && v.quantity <= v.lowStockThreshold);
    const total = variants.reduce((s, v) => s + v.quantity, 0);
    return {
      ...product,
      id: String((product as { _id?: unknown })._id ?? product.id),
      quantity: total,
      stockStatus: total <= 0 ? 'out' : lowVariants.length ? 'low' : 'healthy',
      lowStockCount: lowVariants.length,
      variantCount: variants.length,
    };
  }

  private async assertSkuFree(businessId: string, sku: string, excludeProductId?: string, excludeVariantId?: string) {
    if (!sku) return;
    const filter: FilterQuery<ProductDocument> = {
      businessId,
      $or: [{ sku }, { 'variants.sku': sku }],
    };
    const clash = await this.products.findOne(filter).lean().exec();
    if (!clash) return;
    if (excludeProductId && String(clash._id) === excludeProductId) {
      if (!excludeVariantId) return;
      const offending = (clash.variants || []).find(
        (v) => v.sku === sku && v._id?.toString() !== excludeVariantId,
      );
      if (!offending) return;
    }
    throw new ConflictException(`SKU ${sku} is already used by another product.`);
  }

  private cleanSku(sku?: string): string {
    return sanitizeText(sku, 60).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  }

  private generateSku(name: string): string {
    const base = makeSlug(name).replace(/-/g, '').slice(0, 6).toUpperCase() || 'ITEM';
    return `${base}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  }

  private variantName(attributes: Record<string, string> | undefined, index: number): string {
    if (attributes && Object.keys(attributes).length) {
      return Object.values(attributes).join(' / ');
    }
    return index === 0 ? 'Standard' : `Option ${index + 1}`;
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
