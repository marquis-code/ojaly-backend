import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, FilterQuery, Model } from 'mongoose';
import { Sale, SaleDocument } from './sale.schema';
import { Order, OrderDocument } from '../orders/order.schema';
import { Customer, CustomerDocument } from '../customers/customer.schema';
import { Debt, DebtDocument } from '../debts/debt.schema';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Counter, CounterDocument } from '../plans/counter.schema';
import { StockService, StockLineSnapshot } from '../stock/stock.service';
import { DebtsService } from '../debts/debts.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AlertsService } from '../notifications/alerts.service';
import { nextSequence } from '../../common/utils/order-number';
import { normalizeNigerianPhone } from '../../common/utils/phone';
import { resolveDateRange } from '../../common/utils/dates';
import { sanitizeText } from '../../common/utils/sanitize';
import { randomToken } from '../../common/utils/tokens';
import { CreateSaleDto, SaleQueryDto } from './dto/sale.dto';
import type { PaymentStatus } from './sale.schema';

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    @InjectModel(Sale.name) private readonly sales: Model<SaleDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @InjectModel(Debt.name) private readonly debtModel: Model<DebtDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Counter.name) private readonly counters: Model<CounterDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly stock: StockService,
    private readonly debts: DebtsService,
    private readonly receipts: ReceiptsService,
    private readonly notifications: NotificationsService,
    private readonly alerts: AlertsService,
  ) {}

  async create(userId: string, businessId: string, dto: CreateSaleDto) {
    if (!dto.items.length) throw new BadRequestException('Add at least one item to the sale.');
    const saleNumber = await nextSequence(
      this.counters as unknown as Model<Record<string, unknown>>,
      businessId,
      'sale',
      'SALE',
    );
    const session = await this.connection.startSession();
    let sale!: SaleDocument;
    let lowStock: { productId: string; variantId: string }[] = [];
    let debtId: string | null = null;

    try {
      await session.withTransaction(async () => {
        const stockResult = await this.stock.deductLines(
          session,
          businessId,
          dto.items,
          saleNumber,
          'sale',
          '',
          userId,
        );
        lowStock = stockResult.lowStock;

        for (const [index, line] of stockResult.lines.entries()) {
          const override = dto.items[index]?.unitPriceKobo;
          if (override !== undefined) {
            if (override < 0) throw new BadRequestException('A price cannot be negative.');
            line.unitPriceKobo = override;
          }
        }

        const subtotal = stockResult.lines.reduce((sum, line) => sum + line.unitPriceKobo * line.quantity, 0);
        const discount = Math.min(dto.discountKobo || 0, subtotal);
        const delivery = Math.max(0, dto.deliveryFeeKobo || 0);
        const total = Math.max(0, subtotal - discount + delivery);
        const cost = stockResult.lines.reduce((sum, line) => sum + line.unitCostKobo * line.quantity, 0);
        const amountPaid = Math.min(dto.amountPaidKobo ?? total, total);
        if ((dto.amountPaidKobo || 0) > total) throw new BadRequestException('Amount paid cannot be more than the sale total.');
        const paymentStatus: PaymentStatus = amountPaid >= total ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid';
        const soldAt = dto.soldAt ? new Date(dto.soldAt) : new Date();

        let customer: CustomerDocument | null = null;
        if (dto.customerId) {
          customer = await this.customers.findOne({ _id: dto.customerId, businessId }).session(session).exec();
          if (!customer) throw new NotFoundException('Customer not found.');
        } else if (dto.customerPhone) {
          const phone = normalizeNigerianPhone(dto.customerPhone);
          if (!phone) throw new BadRequestException('Enter a valid customer phone number.');
          customer = await this.customers.findOne({ businessId, phone }).session(session).exec();
          if (!customer) {
            const [created] = await this.customers.create(
              [{
                businessId,
                name: sanitizeText(dto.customerName, 100) || 'Customer',
                phone,
                email: dto.customerEmail || null,
                totalSpentKobo: 0,
                outstandingKobo: 0,
              }],
              { session },
            );
            customer = created;
          }
        }

        const items = this.allocateDiscount(stockResult.lines, discount);
        const [createdSale] = await this.sales.create(
          [{
            businessId,
            saleNumber,
            chatToken: randomToken(24),
            customerId: customer?._id.toString() ?? null,
            customerName: customer?.name || sanitizeText(dto.customerName, 100) || 'Walk-in customer',
            customerPhone: customer?.phone || dto.customerPhone || '',
            customerEmail: customer?.email || dto.customerEmail || null,
            items,
            subtotalKobo: subtotal,
            discountKobo: discount,
            deliveryFeeKobo: delivery,
            totalKobo: total,
            costKobo: cost,
            grossProfitKobo: total - cost,
            amountPaidKobo: amountPaid,
            paymentStatus,
            paymentMethod: dto.paymentMethod || 'cash',
            notes: sanitizeText(dto.notes, 1000),
            source: dto.source || 'manual',
            soldAt,
            createdBy: userId,
          }],
          { session },
        );
        sale = createdSale;

        if (paymentStatus !== 'paid' && customer) {
          const dueDate = dto.dueDate
            ? new Date(dto.dueDate)
            : new Date(Date.now() + 7 * 86400000);
          const debt = await this.debts.createWithinTransaction(
            {
              businessId,
              customerId: customer._id.toString(),
              customerName: sale.customerName,
              customerPhone: sale.customerPhone,
              customerEmail: sale.customerEmail,
              amountKobo: total - amountPaid,
              dueDate,
              saleId: sale._id.toString(),
              notes: `Balance from ${saleNumber}`,
              createdBy: userId,
            },
            session,
          );
          debtId = debt._id.toString();
          sale.debtId = debtId;
          await sale.save({ session });
        }

        if (customer) {
          await this.customers.updateOne(
            { _id: customer._id, businessId },
            {
              $inc: { totalSpentKobo: total, orderCount: 1 },
              $set: { lastPurchaseAt: soldAt },
            },
            { session },
          ).exec();
        }
        await this.businesses.updateOne(
          { _id: businessId, firstSaleAt: null },
          { $set: { firstSaleAt: soldAt } },
        ).session(session).exec();
      });
    } finally {
      await session.endSession();
    }

    try {
      const receipt = await this.receipts.createForSale(sale, true);
      await this.sales.updateOne({ _id: sale._id }, { $set: { receiptId: receipt._id.toString() } }).exec();
      sale.receiptId = receipt._id.toString();
    } catch (error) {
      this.logger.warn(`Receipt generation failed for ${saleNumber}: ${error instanceof Error ? error.message : 'unknown'}`);
    }
    await this.alerts.checkMany(businessId, lowStock).catch(() => undefined);
    await this.notifications.create({
      businessId,
      type: 'sale',
      title: `Sale recorded · ${sale.saleNumber}`,
      message: `${sale.customerName} bought ${sale.items.reduce((s, i) => s + i.quantity, 0)} item(s).`,
      tone: 'success',
      data: { saleId: sale._id.toString(), totalKobo: sale.totalKobo },
    });
    return this.findOne(businessId, sale._id.toString());
  }

  /**
   * Creates the sale that represents a confirmed order. Stock was already deducted
   * when the order was created, so this method never touches inventory.
   */
  async createFromOrder(order: OrderDocument, userId: string | null, session: ClientSession): Promise<SaleDocument> {
    if (order.saleId) {
      const existing = await this.sales.findOne({ _id: order.saleId, businessId: order.businessId }).session(session).exec();
      if (existing) return existing;
    }
    const saleNumber = await nextSequence(
      this.counters as unknown as Model<Record<string, unknown>>,
      order.businessId,
      'sale',
      'SALE',
    );
    const subtotal = order.subtotalKobo;
    const cost = order.items.reduce((s, i) => s + i.lineCostKobo, 0);
    const items = order.items.map((i) => ({
      productId: i.productId,
      variantId: i.variantId,
      name: i.name,
      variantName: i.variantName,
      sku: i.sku,
      quantity: i.quantity,
      unitPriceKobo: i.unitPriceKobo,
      unitCostKobo: i.unitCostKobo,
      discountKobo: i.discountKobo,
      lineTotalKobo: i.lineTotalKobo,
      lineCostKobo: i.lineCostKobo,
      imageUrl: i.imageUrl,
    }));
    const [sale] = await this.sales.create(
      [{
        businessId: order.businessId,
        saleNumber,
        chatToken: randomToken(24),
        orderId: order._id.toString(),
        customerId: order.customerId,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        customerEmail: order.customerEmail,
        items,
        subtotalKobo: order.subtotalKobo,
        discountKobo: order.discountKobo,
        deliveryFeeKobo: order.deliveryFeeKobo,
        totalKobo: order.totalKobo,
        costKobo: cost,
        grossProfitKobo: order.totalKobo - cost,
        amountPaidKobo: order.amountPaidKobo,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        debtId: order.debtId,
        notes: order.notes,
        source: order.source,
        soldAt: new Date(),
        createdBy: userId,
      }],
      { session },
    );
    order.saleId = sale._id.toString();
    await order.save({ session });
    if (order.customerId) {
      await this.customers.updateOne(
        { _id: order.customerId, businessId: order.businessId },
        { $inc: { totalSpentKobo: order.totalKobo, orderCount: 1 }, $set: { lastPurchaseAt: new Date() } },
        { session },
      ).exec();
    }
    await this.businesses.updateOne(
      { _id: order.businessId, firstSaleAt: null },
      { $set: { firstSaleAt: new Date() } },
    ).session(session).exec();
    return sale;
  }

  async afterSaleCommitted(saleId: string, businessId: string): Promise<void> {
    const sale = await this.sales.findOne({ _id: saleId, businessId }).exec();
    if (!sale || sale.receiptId) return;
    try {
      const receipt = await this.receipts.createForSale(sale, true);
      await this.sales.updateOne({ _id: sale._id }, { $set: { receiptId: receipt._id.toString() } }).exec();
    } catch (error) {
      this.logger.warn(`Receipt generation failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }


  async voidSale(userId: string, businessId: string, saleId: string, reason: string) {
    const sale = await this.sales.findOne({ _id: saleId, businessId }).exec();
    if (!sale) throw new NotFoundException('Sale not found.');
    if (sale.orderId) throw new BadRequestException('This sale came from an order. Cancel the order instead.');
    if (sale.paymentMethod === 'paystack') throw new BadRequestException('Paystack payments must be refunded in Paystack before voiding this sale.');
    if (sale.debtId) {
      const debt = await this.debtModel.findOne({ _id: sale.debtId, businessId }).exec();
      if (debt && debt.paidKobo > 0) throw new BadRequestException('This sale has debt payments attached. Settle it manually before voiding.');
    }
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const current = await this.sales.findOne({ _id: saleId, businessId }).session(session).exec();
        if (!current) throw new NotFoundException('Sale not found.');
        if (current.stockRestored) return;
        await this.stock.restoreLines(
          session,
          businessId,
          current.items.map((i) => ({
            productId: i.productId,
            variantId: i.variantId || '',
            quantity: i.quantity,
          })),
          current.saleNumber,
          'sale_void',
          current._id.toString(),
          userId,
        );
        if (current.debtId) {
          const debt = await this.debtModel.findOne({ _id: current.debtId, businessId }).session(session).exec();
          if (debt) {
            await this.customers.updateOne(
              { _id: debt.customerId, businessId },
              { $inc: { outstandingKobo: -debt.balanceKobo } },
              { session },
            ).exec();
            await this.debtModel.deleteOne({ _id: debt._id }).session(session).exec();
          }
        }
        if (current.customerId) {
          await this.customers.updateOne(
            { _id: current.customerId, businessId },
            { $inc: { totalSpentKobo: -current.totalKobo, orderCount: -1 } },
            { session },
          ).exec();
        }
        await this.sales.deleteOne({ _id: current._id }).session(session).exec();
      });
    } finally {
      await session.endSession();
    }
    await this.receipts.removeForSale(businessId, saleId);
    return { voided: true, saleNumber: sale.saleNumber, reason };
  }

  async list(businessId: string, query: SaleQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const filter: FilterQuery<SaleDocument> = { businessId };
    if (query.period && query.period !== 'all') {
      const range = resolveDateRange(query.period === 'month' ? 'month' : query.period === 'week' ? 'week' : 'today');
      filter.soldAt = { $gte: range.from, $lte: range.to };
    } else if (query.from || query.to) {
      filter.soldAt = {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(query.to) } : {}),
      };
    }
    if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
    if (query.search) {
      const rx = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ saleNumber: rx }, { customerName: rx }, { customerPhone: rx }];
    }
    const [items, total, aggregate] = await Promise.all([
      this.sales.find(filter).sort({ soldAt: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      this.sales.countDocuments(filter).exec(),
      this.sales.aggregate([
        { $match: filter },
        { $group: { _id: null, revenue: { $sum: '$totalKobo' }, profit: { $sum: '$grossProfitKobo' }, count: { $sum: 1 } } },
      ]).exec(),
    ]);
    return {
      items,
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        revenueKobo: aggregate[0]?.revenue || 0,
        profitKobo: aggregate[0]?.profit || 0,
      },
    };
  }

  async findOne(businessId: string, saleId: string) {
    const sale = await this.sales.findOne({ _id: saleId, businessId }).lean().exec();
    if (!sale) throw new NotFoundException('Sale not found.');
    return sale;
  }

  async resendReceipt(businessId: string, saleId: string) {
    const sale = await this.sales.findOne({ _id: saleId, businessId }).exec();
    if (!sale) throw new NotFoundException('Sale not found.');
    if (sale.receiptId) {
      const existing = await this.receipts.findOne(businessId, sale.receiptId);
      if (existing.customerEmail) {
        return { sent: true, receiptToken: existing.publicToken };
      }
    }
    const receipt = await this.receipts.createForSale(sale, true);
    await this.sales.updateOne({ _id: sale._id }, { $set: { receiptId: receipt._id.toString() } }).exec();
    return { sent: Boolean(receipt.customerEmail), receiptToken: receipt.publicToken };
  }

  private allocateDiscount(lines: StockLineSnapshot[], discount: number) {
    const subtotal = lines.reduce((s, l) => s + l.unitPriceKobo * l.quantity, 0);
    let remaining = discount;
    return lines.map((line, index) => {
      const gross = line.unitPriceKobo * line.quantity;
      let share = 0;
      if (discount > 0) {
        share = index === lines.length - 1 ? Math.min(remaining, gross) : Math.min(Math.round((gross / subtotal) * discount), gross);
        remaining -= share;
      }
      return {
        productId: line.productId,
        variantId: line.variantId,
        name: line.productName,
        variantName: line.variantName,
        sku: line.sku,
        quantity: line.quantity,
        unitPriceKobo: line.unitPriceKobo,
        unitCostKobo: line.unitCostKobo,
        discountKobo: share,
        lineTotalKobo: gross - share,
        lineCostKobo: line.unitCostKobo * line.quantity,
        imageUrl: null,
      };
    });
  }
}
