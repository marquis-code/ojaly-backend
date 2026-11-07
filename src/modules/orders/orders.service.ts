import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, FilterQuery, Model } from 'mongoose';
import { Order, OrderDocument } from './order.schema';
import { Sale, SaleDocument } from '../sales/sale.schema';
import { Customer, CustomerDocument } from '../customers/customer.schema';
import { Debt, DebtDocument } from '../debts/debt.schema';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Product, ProductDocument } from '../products/product.schema';
import { Counter, CounterDocument } from '../plans/counter.schema';
import { StockService } from '../stock/stock.service';
import { SalesService } from '../sales/sales.service';
import { DebtsService } from '../debts/debts.service';
import { CustomersService } from '../customers/customers.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AlertsService } from '../notifications/alerts.service';
import { PromotionsService } from '../promotions/promotions.service';
import { nextSequence } from '../../common/utils/order-number';
import { randomToken } from '../../common/utils/tokens';
import { normalizeNigerianPhone } from '../../common/utils/phone';
import { sanitizeText } from '../../common/utils/sanitize';
import { formatNaira } from '../../common/utils/money';
import { CancelOrderDto, CreateOrderDto, DeliverOrderDto, OrderPaymentDto, OrderQueryDto } from './dto/order.dto';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Sale.name) private readonly sales: Model<SaleDocument>,
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @InjectModel(Debt.name) private readonly debts: Model<DebtDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Counter.name) private readonly counters: Model<CounterDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly stock: StockService,
    private readonly salesService: SalesService,
    private readonly debtsService: DebtsService,
    private readonly customersService: CustomersService,
    private readonly notifications: NotificationsService,
    private readonly alerts: AlertsService,
    private readonly promotions: PromotionsService,
  ) {}

  async create(userId: string | null, businessId: string, dto: CreateOrderDto, sourceOverride?: string) {
    const phone = normalizeNigerianPhone(dto.customerPhone);
    if (!phone) throw new BadRequestException('Enter a valid customer phone number.');
    const customer = await this.customersService.findOrCreate(businessId, {
      name: sanitizeText(dto.customerName, 100),
      phone,
      email: dto.customerEmail || null,
      address: dto.deliveryAddress || null,
    });
    const orderNumber = await nextSequence(
      this.counters as unknown as Model<Record<string, unknown>>,
      businessId,
      'order',
      'ORD',
    );
    const session = await this.connection.startSession();
    let order!: OrderDocument;
    let lowStock: { productId: string; variantId: string }[] = [];

    try {
      await session.withTransaction(async () => {
        const stockResult = await this.stock.deductLines(
          session,
          businessId,
          dto.items,
          orderNumber,
          'order',
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
        const subtotal = stockResult.lines.reduce((s, l) => s + l.unitPriceKobo * l.quantity, 0);
        const campaign = (sourceOverride === 'storefront' || dto.source === 'storefront')
          ? await this.promotions.platformDiscount(subtotal)
          : null;
        const discount = Math.min(subtotal, (dto.discountKobo || 0) + (campaign?.discountKobo || 0));
        const delivery = Math.max(0, dto.deliveryFeeKobo || 0);
        const total = Math.max(0, subtotal - discount + delivery);
        const amountPaid = Math.min(dto.amountPaidKobo || 0, total);
        if ((dto.amountPaidKobo || 0) > total) throw new BadRequestException('Amount paid cannot be more than the total.');
        const outstanding = total - amountPaid;
        const paymentStatus = amountPaid >= total ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid';
        const items = this.allocateDiscount(stockResult.lines, discount);
        const dueDate = dto.dueDate ? new Date(dto.dueDate) : null;

        const [created] = await this.orders.create(
          [{
            businessId,
            orderNumber,
            status: 'pending',
            source: sourceOverride || dto.source || 'manual',
            customerId: customer._id.toString(),
            customerName: customer.name,
            customerPhone: customer.phone,
            customerEmail: customer.email || dto.customerEmail || null,
            deliveryAddress: sanitizeText(dto.deliveryAddress, 300),
            deliveryDetails: sanitizeText(dto.deliveryDetails, 500),
            items,
            subtotalKobo: subtotal,
            discountKobo: discount,
            deliveryFeeKobo: delivery,
            totalKobo: total,
            amountPaidKobo: amountPaid,
            paymentStatus,
            paymentMethod: dto.paymentMethod || 'cash',
            notes: sanitizeText(dto.notes, 1000),
            whatsappMessage: sanitizeText(dto.whatsappMessage, 2000),
            stockDeducted: true,
            createDebtOnConfirm: true,
            dueDate,
            publicToken: randomToken(24),
            history: [{ status: 'pending', at: new Date(), by: userId, note: 'Order created' }],
          }],
          { session },
        );
        order = created;

        if (dto.createDebtNow && outstanding > 0) {
          const debt = await this.debtsService.createWithinTransaction(
            {
              businessId,
              customerId: customer._id.toString(),
              customerName: order.customerName,
              customerPhone: order.customerPhone,
              customerEmail: order.customerEmail,
              amountKobo: outstanding,
              dueDate: dueDate || new Date(Date.now() + 7 * 86400000),
              orderId: order._id.toString(),
              notes: `Balance from ${orderNumber}`,
              createdBy: userId,
            },
            session,
          );
          order.debtId = debt._id.toString();
          await order.save({ session });
        }

        if (amountPaid >= total) {
          order.status = 'paid';
          order.history.push({ status: 'paid', at: new Date(), by: userId, note: 'Paid in full' });
          await order.save({ session });
          await this.salesService.createFromOrder(order, userId, session);
        }
      });
    } finally {
      await session.endSession();
    }

    const refreshedOrder = await this.orders.findOne({ _id: order._id, businessId }).exec();
    if (refreshedOrder?.saleId) await this.salesService.afterSaleCommitted(refreshedOrder.saleId, businessId);
    await this.alerts.checkMany(businessId, lowStock).catch(() => undefined);
    await this.notifications.create({
      businessId,
      type: 'order',
      title: `New order · ${order.orderNumber}`,
      message: `${order.customerName} ordered ${order.items.reduce((s, i) => s + i.quantity, 0)} item(s) for ${formatNaira(order.totalKobo)}.`,
      tone: 'info',
      data: { orderId: order._id.toString() },
    });
    return this.findOne(businessId, order._id.toString());
  }

  async list(businessId: string, query: OrderQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const filter: FilterQuery<OrderDocument> = { businessId };
    if (query.status && query.status !== 'all') filter.status = query.status;
    if (query.source && query.source !== 'all') filter.source = query.source;
    if (query.search) {
      const rx = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ orderNumber: rx }, { customerName: rx }, { customerPhone: rx }];
    }
    if (query.from || query.to) {
      filter.createdAt = {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(query.to) } : {}),
      };
    }
    const [items, total, counts] = await Promise.all([
      this.orders.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      this.orders.countDocuments(filter).exec(),
      this.orders.aggregate([
        { $match: { businessId } },
        { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$totalKobo' } } },
      ]).exec(),
    ]);
    return {
      items,
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        statusCounts: counts.reduce((acc: Record<string, number>, c) => {
          acc[c._id] = c.count;
          return acc;
        }, {}),
      },
    };
  }

  async findOne(businessId: string, orderId: string) {
    const order = await this.orders.findOne({ _id: orderId, businessId }).lean().exec();
    if (!order) throw new NotFoundException('Order not found.');
    return order;
  }

  async confirm(userId: string, businessId: string, orderId: string) {
    const existing = await this.orders.findOne({ _id: orderId, businessId }).exec();
    if (!existing) throw new NotFoundException('Order not found.');
    if (existing.status !== 'pending') {
      if (['confirmed', 'paid', 'delivered'].includes(existing.status)) return this.findOne(businessId, orderId);
      throw new BadRequestException('A cancelled order cannot be confirmed.');
    }
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const order = await this.orders.findOne({ _id: orderId, businessId }).session(session).exec();
        if (!order) throw new NotFoundException('Order not found.');
        order.status = 'confirmed';
        order.history.push({ status: 'confirmed', at: new Date(), by: userId, note: 'Order confirmed' });
        const outstanding = order.totalKobo - order.amountPaidKobo;
        if (outstanding > 0 && !order.debtId && order.customerId) {
          const debt = await this.debtsService.createWithinTransaction(
            {
              businessId,
              customerId: order.customerId,
              customerName: order.customerName,
              customerPhone: order.customerPhone,
              customerEmail: order.customerEmail,
              amountKobo: outstanding,
              dueDate: order.dueDate || new Date(Date.now() + 7 * 86400000),
              orderId: order._id.toString(),
              notes: `Balance from ${order.orderNumber}`,
              createdBy: userId,
            },
            session,
          );
          order.debtId = debt._id.toString();
        }
        await order.save({ session });
        await this.salesService.createFromOrder(order, userId, session);
      });
    } finally {
      await session.endSession();
    }
    const order = await this.orders.findOne({ _id: orderId, businessId }).exec();
    if (order?.saleId) {
      await this.salesService.afterSaleCommitted(order.saleId, businessId);
    }
    await this.notifications.create({
      businessId,
      type: 'order',
      title: `Order confirmed · ${order?.orderNumber}`,
      message: `${order?.customerName}'s order is confirmed and stock has been reserved.`,
      tone: 'success',
      data: { orderId },
    });
    return this.findOne(businessId, orderId);
  }

  async recordPayment(
    userId: string | null,
    businessId: string,
    orderId: string,
    dto: OrderPaymentDto,
    opts: { fromProvider?: boolean; providerPaymentId?: string; session?: ClientSession } = {},
  ) {
    const ownsSession = !opts.session;
    const session = opts.session || (await this.connection.startSession());
    try {
      if (ownsSession) await session.startTransaction();
      const order = await this.orders.findOne({ _id: orderId, businessId }).session(session).exec();
      if (!order) throw new NotFoundException('Order not found.');
      if (order.status === 'cancelled') throw new BadRequestException('This order was cancelled.');
      const outstanding = order.totalKobo - order.amountPaidKobo;
      if (outstanding <= 0) {
        if (ownsSession) await session.commitTransaction();
        return this.findOne(businessId, orderId);
      }
      if (dto.amountKobo > outstanding) throw new BadRequestException(`Only ${formatNaira(outstanding)} is outstanding on this order.`);

      const hadDebt = Boolean(order.debtId);
      order.amountPaidKobo += dto.amountKobo;
      order.paymentStatus = order.amountPaidKobo >= order.totalKobo ? 'paid' : order.amountPaidKobo > 0 ? 'partial' : 'unpaid';
      order.paymentMethod = dto.method || order.paymentMethod;

      if (order.status === 'pending') {
        order.status = 'confirmed';
        order.history.push({ status: 'confirmed', at: new Date(), by: userId, note: 'Payment received' });
        if (order.customerId && order.totalKobo - order.amountPaidKobo > 0 && !order.debtId) {
          const debt = await this.debtsService.createWithinTransaction(
            {
              businessId,
              customerId: order.customerId,
              customerName: order.customerName,
              customerPhone: order.customerPhone,
              customerEmail: order.customerEmail,
              amountKobo: order.totalKobo - order.amountPaidKobo,
              dueDate: order.dueDate || new Date(Date.now() + 7 * 86400000),
              orderId: order._id.toString(),
              notes: `Balance from ${order.orderNumber}`,
              createdBy: userId,
            },
            session,
          );
          order.debtId = debt._id.toString();
        }
        await order.save({ session });
        await this.salesService.createFromOrder(order, userId, session);
      } else {
        await order.save({ session });
      }

      if (order.debtId && hadDebt) {
        const debt = await this.debts.findOne({ _id: order.debtId, businessId }).session(session).exec();
        if (debt && dto.amountKobo > 0) {
          const applied = Math.min(dto.amountKobo, debt.balanceKobo);
          debt.paidKobo += applied;
          debt.balanceKobo = Math.max(0, debt.principalKobo - debt.paidKobo);
          debt.status = this.debtsService.statusFor(debt.balanceKobo, debt.paidKobo, debt.dueDate);
          debt.payments.push({
            amountKobo: applied,
            method: dto.method || 'cash',
            reference: dto.reference || null,
            note: opts.fromProvider ? 'Paystack payment' : 'Order payment',
            paidAt: new Date(),
            recordedBy: userId,
            paymentId: opts.providerPaymentId || null,
          });
          if (debt.balanceKobo === 0) debt.settledAt = new Date();
          await debt.save({ session });
          await this.customers.updateOne(
            { _id: debt.customerId, businessId },
            { $inc: { outstandingKobo: -applied } },
            { session },
          ).exec();
        }
      }

      if (order.paymentStatus === 'paid') {
        order.status = 'paid';
        order.history.push({ status: 'paid', at: new Date(), by: userId, note: opts.fromProvider ? 'Paid via Paystack' : 'Payment recorded' });
        await order.save({ session });
      }
      if (order.saleId) {
        const sale = await this.sales.findOne({ _id: order.saleId, businessId }).session(session).exec();
        if (sale) {
          sale.amountPaidKobo = Math.min(sale.totalKobo, sale.amountPaidKobo + dto.amountKobo);
          sale.paymentStatus = sale.amountPaidKobo >= sale.totalKobo ? 'paid' : sale.amountPaidKobo > 0 ? 'partial' : 'unpaid';
          sale.paymentMethod = order.paymentMethod;
          await sale.save({ session });
        }
      }
      if (ownsSession) await session.commitTransaction();
    } catch (error) {
      if (ownsSession) await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
    const refreshed = await this.orders.findOne({ _id: orderId, businessId }).exec();
    if (refreshed?.saleId) await this.salesService.afterSaleCommitted(refreshed.saleId, businessId);
    return this.findOne(businessId, orderId);
  }

  async deliver(userId: string, businessId: string, orderId: string, dto: DeliverOrderDto) {
    const order = await this.orders.findOne({ _id: orderId, businessId }).exec();
    if (!order) throw new NotFoundException('Order not found.');
    if (!['confirmed', 'paid'].includes(order.status)) {
      throw new BadRequestException('Confirm the order before marking it delivered.');
    }
    order.status = 'delivered';
    order.history.push({ status: 'delivered', at: new Date(), by: userId, note: sanitizeText(dto.note, 300) || 'Delivered' });
    await order.save();
    return this.findOne(businessId, orderId);
  }

  async cancel(userId: string, businessId: string, orderId: string, dto: CancelOrderDto) {
    const order = await this.orders.findOne({ _id: orderId, businessId }).exec();
    if (!order) throw new NotFoundException('Order not found.');
    if (!['pending', 'confirmed'].includes(order.status)) {
      throw new BadRequestException('Paid or delivered orders cannot be cancelled without a refund. Contact support.');
    }
    if (order.amountPaidKobo > 0) {
      throw new BadRequestException('This order has money attached. Refund the customer before cancelling.');
    }
    if (order.debtId) {
      const debt = await this.debts.findOne({ _id: order.debtId, businessId }).exec();
      if (debt && debt.paidKobo > 0) throw new BadRequestException('This order has debt payments. Settle the records before cancelling.');
    }
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const current = await this.orders.findOne({ _id: orderId, businessId }).session(session).exec();
        if (!current) throw new NotFoundException('Order not found.');
        if (current.stockDeducted) {
          await this.stock.restoreLines(
            session,
            businessId,
            current.items.map((i) => ({
              productId: i.productId,
              variantId: i.variantId || '',
              quantity: i.quantity,
            })),
            current.orderNumber,
            'order',
            current._id.toString(),
            userId,
          );
        }
        if (current.debtId) {
          const debt = await this.debts.findOne({ _id: current.debtId, businessId }).session(session).exec();
          if (debt) {
            await this.customers.updateOne(
              { _id: debt.customerId, businessId },
              { $inc: { outstandingKobo: -debt.balanceKobo } },
              { session },
            ).exec();
            debt.balanceKobo = 0;
            debt.status = 'paid';
            debt.notes = `${debt.notes}\nCancelled with order ${current.orderNumber}`;
            await debt.save({ session });
          }
        }
        if (current.saleId) {
          const sale = await this.sales.findOne({ _id: current.saleId, businessId }).session(session).exec();
          if (sale) {
            sale.notes = `${sale.notes}\nCancelled with order ${current.orderNumber}`;
            await sale.save({ session });
          }
        }
        current.status = 'cancelled';
        current.cancelledAt = new Date();
        current.stockDeducted = false;
        current.history.push({ status: 'cancelled', at: new Date(), by: userId, note: sanitizeText(dto.reason, 300) || 'Cancelled' });
        await current.save({ session });
      });
    } finally {
      await session.endSession();
    }
    return this.findOne(businessId, orderId);
  }

  async publicByToken(token: string) {
    const order = await this.orders.findOne({ publicToken: token }).lean().exec();
    if (!order) throw new NotFoundException('Order not found.');
    const business = await this.businesses.findById(order.businessId).select('name slug logoUrl brandColor whatsappNumber publicPhone').lean().exec();
    return {
      order: {
        id: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        customerName: order.customerName,
        items: order.items.map((i) => ({ name: i.name, variantName: i.variantName, quantity: i.quantity, lineTotalKobo: i.lineTotalKobo })),
        totalKobo: order.totalKobo,
        amountPaidKobo: order.amountPaidKobo,
        createdAt: order.createdAt,
        history: order.history,
      },
      business,
    };
  }

  async countForBusinessSince(businessId: string, since: Date): Promise<number> {
    return this.orders.countDocuments({ businessId, createdAt: { $gte: since } }).exec();
  }

  private allocateDiscount(lines: { productId: string; variantId: string; productName: string; variantName: string; sku: string; quantity: number; unitPriceKobo: number; unitCostKobo: number }[], discount: number) {
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
