import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHmac, timingSafeEqual } from 'crypto';
import { Connection, Model } from 'mongoose';
import { Payment, PaymentDocument } from './payment.schema';
import { WebhookEvent, WebhookEventDocument } from './webhook-event.schema';
import { Order, OrderDocument } from '../orders/order.schema';
import { Debt, DebtDocument } from '../debts/debt.schema';
import { Invoice, InvoiceDocument } from '../receipts/invoice.schema';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Membership, MembershipDocument } from '../memberships/membership.schema';
import { User, UserDocument } from '../users/user.schema';
import { Subscription, SubscriptionDocument } from '../plans/subscription.schema';
import { Coupon, CouponDocument } from '../plans/coupon.schema';
import { Booking, BookingDocument } from '../bookings/booking.schema';
import { PackagePurchase, PackagePurchaseDocument } from '../packages/package.schema';
import { Sale, SaleDocument } from '../sales/sale.schema';
import { Counter, CounterDocument } from '../plans/counter.schema';
import { Customer, CustomerDocument } from '../customers/customer.schema';
import { ReceiptsService } from '../receipts/receipts.service';
import { BookingsService } from '../bookings/bookings.service';
import { nextSequence } from '../../common/utils/order-number';
import { PlansService } from '../plans/plans.service';
import { OrdersService } from '../orders/orders.service';
import { DebtsService } from '../debts/debts.service';
import { PaystackService } from './paystack.service';
import { AuditService } from '../audit/audit.service';
import { AffiliatesService } from '../affiliates/affiliates.service';
import { randomToken } from '../../common/utils/tokens';
import { formatNaira } from '../../common/utils/money';
import { SubscriptionCheckoutDto, CreatePaymentLinkDto } from './dto/payment.dto';

interface ProviderData {
  id?: number;
  status?: string;
  reference?: string;
  amount?: number;
  channel?: string;
  paid_at?: string;
  plan?: string;
  subscription_code?: string;
  customer?: { email?: string };
  metadata?: Record<string, unknown>;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Payment.name) private readonly payments: Model<PaymentDocument>,
    @InjectModel(WebhookEvent.name) private readonly webhookEvents: Model<WebhookEventDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Debt.name) private readonly debts: Model<DebtDocument>,
    @InjectModel(Invoice.name) private readonly invoices: Model<InvoiceDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Subscription.name) private readonly subscriptions: Model<SubscriptionDocument>,
    @InjectModel(Coupon.name) private readonly coupons: Model<CouponDocument>,
    @InjectModel(Booking.name) private readonly bookings: Model<BookingDocument>,
    @InjectModel(PackagePurchase.name) private readonly packagePurchases: Model<PackagePurchaseDocument>,
    @InjectModel(Sale.name) private readonly sales: Model<SaleDocument>,
    @InjectModel(Counter.name) private readonly counters: Model<CounterDocument>,
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    private readonly receipts: ReceiptsService,
    @InjectConnection() private readonly connection: Connection,
    private readonly paystack: PaystackService,
    private readonly plans: PlansService,
    private readonly ordersService: OrdersService,
    private readonly debtsService: DebtsService,
    @Inject(forwardRef(() => BookingsService)) private readonly bookingsService: BookingsService,
    private readonly audit: AuditService,
    private readonly affiliates: AffiliatesService,
    private readonly config: ConfigService,
  ) {}

  async createOrderLink(userId: string, businessId: string, orderId: string, dto: CreatePaymentLinkDto) {
    const order = await this.orders.findOne({ _id: orderId, businessId }).lean().exec();
    if (!order) throw new NotFoundException('Order not found.');
    const outstanding = order.totalKobo - order.amountPaidKobo;
    if (outstanding <= 0) throw new BadRequestException('This order is already fully paid.');
    const email = await this.resolveEmail(businessId, dto.email || order.customerEmail || undefined);
    const reference = this.reference('ord');
    const initialized = await this.paystack.initialize({
      email,
      amountKobo: outstanding,
      reference,
      callbackUrl: `${this.config.get('appUrl')}/payment/callback`,
      metadata: { purpose: 'order', orderId, businessId, customerName: order.customerName },
    });
    await this.payments.create({
      reference,
      businessId,
      purpose: 'order',
      orderId,
      amountKobo: outstanding,
      email,
      status: 'pending',
      authorizationUrl: initialized.authorizationUrl,
      accessCode: initialized.accessCode,
      createdBy: userId,
      metadata: { orderNumber: order.orderNumber },
    });
    return { reference, authorizationUrl: initialized.authorizationUrl, amountKobo: outstanding, publicKey: this.paystack.publicKey };
  }

  async createDebtLink(userId: string, businessId: string, debtId: string, dto: CreatePaymentLinkDto) {
    const debt = await this.debts.findOne({ _id: debtId, businessId }).lean().exec();
    if (!debt) throw new NotFoundException('Debt not found.');
    if (debt.balanceKobo <= 0) throw new BadRequestException('This debt is already settled.');
    const email = await this.resolveEmail(businessId, dto.email || debt.customerEmail || undefined);
    const reference = this.reference('dbt');
    const initialized = await this.paystack.initialize({
      email,
      amountKobo: debt.balanceKobo,
      reference,
      callbackUrl: `${this.config.get('appUrl')}/payment/callback`,
      metadata: { purpose: 'debt', debtId, businessId, customerName: debt.customerName },
    });
    await this.payments.create({
      reference,
      businessId,
      purpose: 'debt',
      debtId,
      amountKobo: debt.balanceKobo,
      email,
      status: 'pending',
      authorizationUrl: initialized.authorizationUrl,
      accessCode: initialized.accessCode,
      createdBy: userId,
      metadata: { customerName: debt.customerName },
    });
    return { reference, authorizationUrl: initialized.authorizationUrl, amountKobo: debt.balanceKobo, publicKey: this.paystack.publicKey };
  }

  async createInvoiceLink(userId: string, businessId: string, invoiceId: string, dto: CreatePaymentLinkDto) {
    const invoice = await this.invoices.findOne({ _id: invoiceId, businessId }).lean().exec();
    if (!invoice) throw new NotFoundException('Invoice not found.');
    if (invoice.status === 'paid') throw new BadRequestException('This invoice is already paid.');
    const email = await this.resolveEmail(businessId, dto.email || invoice.customerEmail || undefined);
    const reference = this.reference('inv');
    const initialized = await this.paystack.initialize({
      email,
      amountKobo: invoice.totalKobo,
      reference,
      callbackUrl: `${this.config.get('appUrl')}/payment/callback`,
      metadata: { purpose: 'invoice', invoiceId, businessId, invoiceNumber: invoice.invoiceNumber },
    });
    await this.payments.create({
      reference,
      businessId,
      purpose: 'invoice',
      invoiceId,
      amountKobo: invoice.totalKobo,
      email,
      status: 'pending',
      authorizationUrl: initialized.authorizationUrl,
      accessCode: initialized.accessCode,
      createdBy: userId,
    });
    return { reference, authorizationUrl: initialized.authorizationUrl, amountKobo: invoice.totalKobo, publicKey: this.paystack.publicKey };
  }

  async createBookingDepositLink(userId: string, businessId: string, bookingId: string, dto: CreatePaymentLinkDto) {
    const booking = await this.bookings.findOne({ _id: bookingId, businessId }).lean().exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.status === 'cancelled') throw new BadRequestException('This booking was cancelled.');
    const outstanding = Math.max(0, booking.priceKobo - booking.amountPaidKobo);
    const amountKobo = booking.depositKobo > 0 ? Math.min(booking.depositKobo, outstanding) : outstanding;
    if (amountKobo < 100) throw new BadRequestException('This booking has no deposit outstanding.');
    const email = await this.resolveEmail(businessId, dto.email || booking.customerEmail || undefined);
    const reference = this.reference('bkg');
    const initialized = await this.paystack.initialize({
      email,
      amountKobo,
      reference,
      callbackUrl: `${this.config.get('appUrl')}/payment/callback`,
      metadata: { purpose: 'booking', bookingId, businessId, bookingNumber: booking.bookingNumber },
    });
    await this.payments.create({
      reference, businessId, purpose: 'booking', bookingId,
      amountKobo, email, status: 'pending',
      authorizationUrl: initialized.authorizationUrl,
      accessCode: initialized.accessCode,
      createdBy: userId,
      metadata: { bookingNumber: booking.bookingNumber, customerName: booking.customerName },
    });
    return { reference, authorizationUrl: initialized.authorizationUrl, amountKobo, publicKey: this.paystack.publicKey };
  }

  async initializeStorefrontBookingPayment(
    businessId: string,
    customerEmail: string,
    amountKobo: number,
    bookingDraft: Record<string, unknown>,
  ) {
    const email = await this.resolveEmail(businessId, customerEmail);
    const reference = this.reference('bkg');
    const initialized = await this.paystack.initialize({
      email,
      amountKobo,
      reference,
      callbackUrl: `${this.config.get('appUrl')}/payment/callback`,
      metadata: {
        purpose: 'booking',
        businessId,
        customerName: (bookingDraft.customerName as string) || 'Customer',
        customerPhone: (bookingDraft.customerPhone as string) || '',
        bookingDraft,
      },
    });
    await this.payments.create({
      reference,
      businessId,
      purpose: 'booking',
      bookingId: null,
      amountKobo,
      email,
      status: 'pending',
      authorizationUrl: initialized.authorizationUrl,
      accessCode: initialized.accessCode,
      createdBy: null,
      metadata: {
        bookingDraft,
        customerName: (bookingDraft.customerName as string) || 'Customer',
      },
    });
    return { reference, authorizationUrl: initialized.authorizationUrl, amountKobo, publicKey: this.paystack.publicKey };
  }

  async refundBooking(businessId: string, bookingId: string, amountKobo?: number) {
    const booking = await this.bookings.findOne({ _id: bookingId, businessId }).exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.status === 'completed') throw new BadRequestException('A completed appointment has already been settled as a sale. Refund the sale instead.');
    const paid = booking.amountPaidKobo - (booking.refundedKobo || 0);
    if (paid <= 0) throw new BadRequestException('There is no refundable payment on this booking.');
    const amount = amountKobo ? Math.min(amountKobo, paid) : paid;
    if (amount < 100) throw new BadRequestException('The refund amount must be at least ₦1.');
    const payment = await this.payments.findOne({
      businessId, bookingId, purpose: 'booking', status: 'success',
    }).sort({ createdAt: -1 }).exec();
    if (!payment) throw new BadRequestException('No successful payment was found for this booking.');
    await this.paystack.refund(payment.reference, amount);
    booking.refundedKobo = (booking.refundedKobo || 0) + amount;
    booking.paymentStatus = booking.refundedKobo >= booking.amountPaidKobo ? 'refunded' : 'deposit_paid';
    booking.history.push({ status: 'refund', at: new Date(), by: 'paystack', note: `${amount} kobo refunded` });
    await booking.save();
    if (booking.paymentStatus === 'refunded') await this.payments.updateOne({ _id: payment._id }, { $set: { status: 'reversed' } }).exec();
    return { refunded: true, amountKobo: amount, bookingId: booking._id.toString(), paymentReference: payment.reference };
  }

  async publicPackagePurchaseLink(token: string, email?: string) {
    const purchase = await this.packagePurchases.findOne({ publicToken: token }).lean().exec();
    if (!purchase) throw new NotFoundException('Package purchase not found.');
    if (purchase.status === 'active') throw new BadRequestException('This package is already active.');
    if (purchase.status === 'cancelled') throw new BadRequestException('This package purchase was cancelled.');
    const resolved = email || purchase.customerEmail || (await this.resolveEmail(purchase.businessId, undefined));
    const reference = this.reference('pkg');
    const initialized = await this.paystack.initialize({
      email: resolved,
      amountKobo: purchase.priceKobo,
      reference,
      callbackUrl: `${this.config.get('appUrl')}/package/${purchase.publicToken}?paid=1`,
      metadata: { purpose: 'package', packagePurchaseId: purchase._id.toString(), businessId: purchase.businessId, packageName: purchase.packageName },
    });
    await this.payments.create({
      reference, businessId: purchase.businessId, purpose: 'package', packagePurchaseId: purchase._id.toString(),
      amountKobo: purchase.priceKobo, email: resolved, status: 'pending',
      authorizationUrl: initialized.authorizationUrl, accessCode: initialized.accessCode,
      metadata: { packageName: purchase.packageName, customerName: purchase.customerName },
    });
    return { reference, authorizationUrl: initialized.authorizationUrl, amountKobo: purchase.priceKobo };
  }

  async publicBookingDepositLink(token: string, email?: string) {
    const booking = await this.bookings.findOne({ publicToken: token }).lean().exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.status === 'cancelled') throw new BadRequestException('This booking was cancelled.');
    if (booking.status === 'pending' && booking.paymentExpiresAt && new Date(booking.paymentExpiresAt).getTime() < Date.now()) {
      throw new BadRequestException('The checkout window for this appointment has expired. Please select a time and book again.');
    }
    if (booking.amountPaidKobo >= booking.priceKobo) throw new BadRequestException('This booking is already paid.');
    const outstanding = booking.priceKobo - booking.amountPaidKobo;
    const depositOutstanding = booking.depositKobo - booking.amountPaidKobo;
    const amountKobo = booking.depositKobo > 0 && depositOutstanding > 0
      ? Math.max(100, Math.min(depositOutstanding, outstanding))
      : outstanding;
    const resolved = email || booking.customerEmail || (await this.resolveEmail(booking.businessId, undefined));
    const reference = this.reference('pbkg');
    const initialized = await this.paystack.initialize({
      email: resolved,
      amountKobo,
      reference,
      callbackUrl: `${this.config.get('appUrl')}/payment/callback`,
      metadata: { purpose: 'booking', bookingId: booking._id.toString(), businessId: booking.businessId, bookingNumber: booking.bookingNumber },
    });
    await this.payments.create({
      reference, businessId: booking.businessId, purpose: 'booking', bookingId: booking._id.toString(),
      amountKobo, email: resolved, status: 'pending',
      authorizationUrl: initialized.authorizationUrl,
      accessCode: initialized.accessCode,
      metadata: { public: true, bookingNumber: booking.bookingNumber },
    });
    return { reference, authorizationUrl: initialized.authorizationUrl, amountKobo };
  }

  async publicDebtLink(token: string, email: string) {
    const debt = await this.debts.findOne({ publicToken: token }).lean().exec();
    if (!debt) throw new NotFoundException('Payment link not found.');
    if (debt.balanceKobo <= 0) throw new BadRequestException('This debt is already settled.');
    const reference = this.reference('pdbt');
    const initialized = await this.paystack.initialize({
      email,
      amountKobo: debt.balanceKobo,
      reference,
      callbackUrl: `${this.config.get('appUrl')}/payment/callback`,
      metadata: { purpose: 'debt', debtId: debt._id.toString(), businessId: debt.businessId, customerName: debt.customerName },
    });
    await this.payments.create({
      reference,
      businessId: debt.businessId,
      purpose: 'debt',
      debtId: debt._id.toString(),
      amountKobo: debt.balanceKobo,
      email,
      status: 'pending',
      authorizationUrl: initialized.authorizationUrl,
      accessCode: initialized.accessCode,
      metadata: { public: true },
    });
    return { reference, authorizationUrl: initialized.authorizationUrl, amountKobo: debt.balanceKobo };
  }

  async publicOrderLink(token: string, email?: string) {
    const order = await this.orders.findOne({ publicToken: token }).lean().exec();
    if (!order) throw new NotFoundException('Order not found.');
    const outstanding = order.totalKobo - order.amountPaidKobo;
    if (outstanding <= 0) throw new BadRequestException('This order is already fully paid.');
    if (order.status === 'cancelled') throw new BadRequestException('This order was cancelled.');
    const resolved = email || order.customerEmail || (await this.resolveEmail(order.businessId, undefined));
    const reference = this.reference('pord');
    const initialized = await this.paystack.initialize({
      email: resolved,
      amountKobo: outstanding,
      reference,
      callbackUrl: `${this.config.get('appUrl')}/payment/callback`,
      metadata: { purpose: 'order', orderId: order._id.toString(), businessId: order.businessId, orderNumber: order.orderNumber },
    });
    await this.payments.create({
      reference,
      businessId: order.businessId,
      purpose: 'order',
      orderId: order._id.toString(),
      amountKobo: outstanding,
      email: resolved,
      status: 'pending',
      authorizationUrl: initialized.authorizationUrl,
      accessCode: initialized.accessCode,
      metadata: { public: true, orderNumber: order.orderNumber },
    });
    return { reference, authorizationUrl: initialized.authorizationUrl, amountKobo: outstanding };
  }

  async publicInvoiceLink(token: string, email?: string) {
    const invoice = await this.invoices.findOne({ publicToken: token }).lean().exec();
    if (!invoice) throw new NotFoundException('Invoice not found.');
    if (invoice.status === 'paid') throw new BadRequestException('This invoice is already paid.');
    const resolved = email || (await this.resolveEmail(invoice.businessId, invoice.customerEmail || undefined));
    const reference = this.reference('pinv');
    const initialized = await this.paystack.initialize({
      email: resolved,
      amountKobo: invoice.totalKobo,
      reference,
      callbackUrl: `${this.config.get('appUrl')}/payment/callback`,
      metadata: { purpose: 'invoice', invoiceId: invoice._id.toString(), businessId: invoice.businessId },
    });
    await this.payments.create({
      reference,
      businessId: invoice.businessId,
      purpose: 'invoice',
      invoiceId: invoice._id.toString(),
      amountKobo: invoice.totalKobo,
      email: resolved,
      status: 'pending',
      authorizationUrl: initialized.authorizationUrl,
      accessCode: initialized.accessCode,
      metadata: { public: true },
    });
    return { reference, authorizationUrl: initialized.authorizationUrl, amountKobo: invoice.totalKobo };
  }

  async subscriptionCheckout(userId: string, businessId: string, dto: SubscriptionCheckoutDto) {
    const plan = await this.plans.getPlan(dto.planKey);
    const interval = dto.interval || 'monthly';
    let amount = interval === 'yearly' ? plan.priceYearlyKobo : plan.priceMonthlyKobo;
    if (amount <= 0) throw new BadRequestException('The free plan does not need checkout. You are already on it.');
    let discount = 0;
    let coupon: CouponDocument | null = null;
    if (dto.couponCode) {
      coupon = await this.coupons.findOne({ code: dto.couponCode.toUpperCase(), isActive: true }).exec();
      if (!coupon) throw new BadRequestException('That coupon code is not valid.');
      if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) throw new BadRequestException('That coupon has expired.');
      if (coupon.maxRedemptions !== null && coupon.redeemedCount >= coupon.maxRedemptions) throw new BadRequestException('That coupon has been fully used.');
      if (coupon.grantedToBusinessId && coupon.grantedToBusinessId !== businessId) throw new BadRequestException('That coupon is not available to your business.');
      discount = Math.min(amount, coupon.amountOffKobo + Math.round((amount * coupon.percentOff) / 100));
      amount = Math.max(0, amount - discount);
      if (amount < 100) amount = 100;
    }
    const business = await this.businesses.findById(businessId).lean().exec();
    if (!business) throw new NotFoundException('Business not found.');
    const email = await this.resolveEmail(businessId, business.email || undefined);
    const reference = this.reference('sub');
    const planCode = !coupon && interval === 'yearly' ? plan.paystackPlanCodeYearly : !coupon ? plan.paystackPlanCodeMonthly : null;
    if (!planCode && !this.paystack.isConfigured) {
      throw new BadRequestException('Subscription payments are not configured yet. Add Paystack keys to enable upgrades.');
    }
    const initialized = await this.paystack.initialize({
      email,
      amountKobo: amount,
      reference,
      callbackUrl: `${this.config.get('appUrl')}/payment/callback`,
      planCode,
      metadata: {
        purpose: 'subscription',
        businessId,
        planKey: plan.key,
        interval,
        couponCode: coupon?.code || null,
        discountKobo: discount,
      },
    });
    const payment = await this.payments.create({
      reference,
      businessId,
      purpose: 'subscription',
      amountKobo: amount,
      email,
      status: 'pending',
      authorizationUrl: initialized.authorizationUrl,
      accessCode: initialized.accessCode,
      createdBy: userId,
      metadata: { planKey: plan.key, interval, couponCode: coupon?.code || null, discountKobo: discount },
    });
    const sub = await this.subscriptions.findOne({ businessId }).exec();
    if (sub) {
      sub.paystackEmailToken = reference;
      await sub.save();
    }
    return {
      reference,
      authorizationUrl: initialized.authorizationUrl,
      amountKobo: amount,
      discountKobo: discount,
      paymentId: payment._id.toString(),
    };
  }

  async verifyAndSettle(reference: string) {
    let payment = await this.payments.findOne({ reference }).lean().exec();
    if (!payment) throw new NotFoundException('Payment not found.');
    if (payment.status !== 'success') {
      const verified = await this.paystack.verify(reference);
      if (!verified) return { status: payment.status, payment, nextUrl: null };
      if (verified.status !== 'success') {
        await this.payments.updateOne({ reference, status: { $in: ['pending', 'processing'] } }, { $set: { status: 'failed' } }).exec();
        return { status: 'failed' as const, payment, nextUrl: null };
      }
      await this.settlePayment(reference, verified as unknown as ProviderData, null);
      payment = await this.payments.findOne({ reference }).lean().exec();
    }
    return { status: 'success' as const, payment, nextUrl: await this.nextUrlFor(payment) };
  }


  private async handleRenewalCharge(data: ProviderData): Promise<void> {
    const email = data.customer?.email;
    const query: Record<string, unknown> = { status: { $in: ['active', 'trialing'] } };
    if (data.subscription_code) query.paystackSubscriptionCode = data.subscription_code;
    else if (email) query.billingEmail = email;
    else return;
    const subscription = await this.subscriptions.findOne(query).exec();
    if (!subscription) return;
    const interval: 'monthly' | 'yearly' = subscription.billingInterval === 'yearly' ? 'yearly' : 'monthly';
    await this.plans.renewSubscription(subscription.businessId, interval);
    if (data.reference) {
      await this.payments.updateOne(
        { reference: data.reference },
        {
          $setOnInsert: {
            businessId: subscription.businessId,
            purpose: 'subscription',
            amountKobo: Number(data.amount || 0),
            email: email || subscription.billingEmail || null,
            status: 'success',
            paidAt: data.paid_at ? new Date(data.paid_at) : new Date(),
            channel: data.channel || null,
            providerTransactionId: data.id ? String(data.id) : null,
            metadata: { renewal: true, planKey: subscription.planKey, interval },
          },
        },
        { upsert: true },
      ).exec();
    }
    await this.audit.record({
      businessId: subscription.businessId,
      actorId: null,
      actorType: 'payment_provider',
      action: 'subscription.renewed',
      entity: 'subscription',
      entityId: subscription._id.toString(),
      metadata: { interval, reference: data.reference },
    });
  }

  private async nextUrlFor(payment: Record<string, unknown> | null): Promise<string | null> {
    if (!payment) return null;
    if (payment.purpose === 'order' && payment.orderId) {
      const order = await this.orders.findById(payment.orderId).select('publicToken').lean().exec();
      if (order?.publicToken) return `/order/${order.publicToken}`;
    }
    if (payment.purpose === 'debt' && payment.debtId) {
      const debt = await this.debts.findById(payment.debtId).select('publicToken').lean().exec();
      if (debt?.publicToken) return `/pay/debt/${debt.publicToken}?paid=1`;
    }
    if (payment.purpose === 'invoice' && payment.invoiceId) {
      const invoice = await this.invoices.findById(payment.invoiceId).select('publicToken').lean().exec();
      if (invoice?.publicToken) return `/invoice/${invoice.publicToken}?paid=1`;
    }
    if (payment.purpose === 'booking' && payment.bookingId) {
      const booking = await this.bookings.findById(payment.bookingId).select('publicToken').lean().exec();
      if (booking?.publicToken) return `/booking/${booking.publicToken}?paid=1`;
    }
    if (payment.purpose === 'package' && payment.packagePurchaseId) {
      const purchase = await this.packagePurchases.findById(payment.packagePurchaseId).select('publicToken').lean().exec();
      if (purchase?.publicToken) return `/package/${purchase.publicToken}?paid=1`;
    }
    return null;
  }

  async retryFailedWebhooks(): Promise<{ retried: number }> {
    const failed = await this.webhookEvents.find({ provider: 'paystack', status: 'failed' }).sort({ createdAt: 1 }).limit(20).exec();
    let retried = 0;
    for (const event of failed) {
      try {
        const payload = event.payload as Record<string, unknown>;
        const data = (payload.data || {}) as ProviderData;
        if (event.eventType === 'charge.success' && data.reference) {
          await this.settlePayment(data.reference, data, event._id.toString());
          await this.webhookEvents.updateOne(
            { _id: event._id },
            { $set: { status: 'processed', processedAt: new Date(), error: null }, $inc: { attempts: 1 } },
          ).exec();
          retried++;
        } else {
          await this.webhookEvents.updateOne({ _id: event._id }, { $set: { status: 'ignored' } }).exec();
        }
      } catch (error) {
        await this.webhookEvents.updateOne(
          { _id: event._id },
          { $inc: { attempts: 1 }, $set: { error: error instanceof Error ? error.message : 'unknown' } },
        ).exec();
      }
    }
    return { retried };
  }

  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined, body: Record<string, unknown>) {
    const secret = this.paystack.webhookSecret;
    if (!secret) throw new UnauthorizedException('Webhook secret not configured.');
    if (!rawBody || !signature) throw new UnauthorizedException('Missing webhook signature.');
    const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
    const sig = Buffer.from(signature);
    const exp = Buffer.from(expected);
    if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) {
      throw new UnauthorizedException('Invalid webhook signature.');
    }
    const event = String(body.event || 'unknown');
    const data = (body.data || {}) as ProviderData;
    const eventId = `${event}:${data.id ?? data.reference ?? randomToken(8)}`;
    let record: WebhookEventDocument | null = null;
    try {
      record = await this.webhookEvents.create({
        provider: 'paystack',
        eventId,
        eventType: event,
        status: 'received',
        attempts: 1,
        payload: body,
      });
    } catch {
      return { received: true, duplicate: true };
    }
    try {
      if (event === 'charge.success' && data.reference) {
        const local = await this.payments.findOne({ reference: data.reference }).lean().exec();
        if (local) await this.settlePayment(data.reference, data, eventId);
        else await this.handleRenewalCharge(data);
      } else if (event === 'charge.failed' && data.reference) {
        await this.payments.updateOne({ reference: data.reference, status: { $in: ['pending', 'processing'] } }, { $set: { status: 'failed' } }).exec();
      } else if (event === 'subscription.create') {
        const email = data.customer?.email;
        if (email) {
          await this.subscriptions.updateMany({ billingEmail: email }, { $set: { paystackSubscriptionCode: data.subscription_code || null } }).exec();
        }
      } else if (event === 'subscription.disable') {
        if (data.subscription_code) {
          await this.subscriptions.updateMany({ paystackSubscriptionCode: data.subscription_code }, { $set: { status: 'cancelled', cancelledAt: new Date() } }).exec();
        }
      } else if (event === 'invoice.payment_failed' && data.reference) {
        await this.payments.updateOne({ reference: data.reference }, { $set: { status: 'failed' } }).exec();
      }
      await this.webhookEvents.updateOne({ _id: record._id }, { $set: { status: 'processed', processedAt: new Date() } }).exec();
    } catch (error) {
      this.logger.error(`Webhook ${event} failed: ${error instanceof Error ? error.message : 'unknown'}`);
      await this.webhookEvents.updateOne(
        { _id: record._id },
        { $set: { status: 'failed', error: error instanceof Error ? error.message : 'unknown' } },
      ).exec();
      // Acknowledge to prevent Paystack retry storms; our admin retry job can replay.
    }
    return { received: true };
  }

  private async settlePayment(reference: string, data: ProviderData, eventId: string | null): Promise<void> {
    const claimed = await this.payments.findOneAndUpdate(
      { reference, status: { $in: ['pending', 'processing'] } },
      { $set: { status: 'processing' } },
      { new: true },
    ).exec();
    if (!claimed) {
      const existing = await this.payments.findOne({ reference }).lean().exec();
      if (existing?.status === 'success') return;
      throw new ConflictException('Payment is already being processed.');
    }
    try {
      const paidAmount = Number(data.amount ?? claimed.amountKobo);
      if (paidAmount < claimed.amountKobo) throw new BadGatewayException('Paid amount is less than expected.');
      if (claimed.purpose === 'order' && claimed.orderId) {
        await this.ordersService.recordPayment(
          claimed.createdBy,
          claimed.businessId,
          claimed.orderId,
          {
            amountKobo: claimed.amountKobo,
            method: 'paystack',
            reference: claimed.reference,
            note: 'Paid via Paystack',
          },
          { fromProvider: true, providerPaymentId: data.id ? String(data.id) : undefined },
        );
      } else if (claimed.purpose === 'debt' && claimed.debtId) {
        await this.debtsService.recordPayment(
          claimed.createdBy || '',
          claimed.businessId,
          claimed.debtId,
          {
            amountKobo: claimed.amountKobo,
            method: 'paystack',
            reference: claimed.reference,
            note: 'Paid via Paystack',
          },
        );
      } else if (claimed.purpose === 'invoice' && claimed.invoiceId) {
        await this.invoices.updateOne(
          { _id: claimed.invoiceId, businessId: claimed.businessId },
          { $set: { status: 'paid', paidAt: new Date(), paymentId: claimed._id.toString() } },
        ).exec();
      } else if (claimed.purpose === 'package' && claimed.packagePurchaseId) {
        const purchase = await this.packagePurchases.findOne({ _id: claimed.packagePurchaseId, businessId: claimed.businessId }).exec();
        if (!purchase) throw new NotFoundException('Package purchase not found.');
        if (purchase.status !== 'active') {
          purchase.status = 'active';
          purchase.paymentStatus = 'paid';
          purchase.amountPaidKobo = claimed.amountKobo;
          purchase.paymentReference = claimed.reference;
          purchase.purchasedAt = new Date();
          await purchase.save();
        }
        if (!purchase.saleId) {
          const saleNumber = await nextSequence(this.counters as unknown as Model<Record<string, unknown>>, purchase.businessId, 'sale', 'SALE');
          const [sale] = await this.sales.create([{
            businessId: purchase.businessId, saleNumber, customerId: purchase.customerId,
            customerName: purchase.customerName, customerPhone: purchase.customerPhone, customerEmail: purchase.customerEmail,
            items: [{ productId: `package:${purchase.packageId}`, variantId: null, name: `Package: ${purchase.packageName}`, variantName: `${purchase.sessionsTotal} session${purchase.sessionsTotal === 1 ? '' : 's'}`, sku: '', quantity: 1, unitPriceKobo: purchase.priceKobo, unitCostKobo: 0, discountKobo: 0, lineTotalKobo: purchase.priceKobo, lineCostKobo: 0, imageUrl: null }],
            subtotalKobo: purchase.priceKobo, discountKobo: 0, deliveryFeeKobo: 0, totalKobo: purchase.priceKobo, costKobo: 0, grossProfitKobo: purchase.priceKobo,
            amountPaidKobo: claimed.amountKobo, paymentStatus: 'paid', paymentMethod: 'paystack',
            notes: `Prepaid package · code ${purchase.redemptionCode}`, source: 'package', soldAt: new Date(),
          }]);
          purchase.saleId = sale._id.toString();
          await purchase.save();
          if (purchase.customerId) await this.customers.updateOne({ _id: purchase.customerId, businessId: purchase.businessId }, { $inc: { totalSpentKobo: purchase.priceKobo, orderCount: 1 }, $set: { lastPurchaseAt: new Date() } }).exec();
          await this.receipts.createForSale(sale, true).catch(() => undefined);
        }
      } else if (claimed.purpose === 'booking') {
        if (claimed.bookingId) {
          await this.bookingsService.recordPayment(claimed.bookingId, claimed.amountKobo, claimed.reference);
        } else if ((claimed.metadata as Record<string, any>)?.bookingDraft) {
          const booking = await this.bookingsService.createFromPaidCheckout(
            claimed.businessId,
            (claimed.metadata as Record<string, any>).bookingDraft,
            claimed.amountKobo,
            claimed.reference,
          );
          claimed.bookingId = booking._id.toString();
          await this.payments.updateOne({ _id: claimed._id }, { $set: { bookingId: booking._id.toString() } }).exec();
        }
      } else if (claimed.purpose === 'subscription') {
        const metadata = claimed.metadata || {};
        const planKey = String(metadata.planKey || '');
        const interval = metadata.interval === 'yearly' ? 'yearly' : 'monthly';
        const couponCode = metadata.couponCode ? String(metadata.couponCode) : null;
        await this.plans.activatePlan(claimed.businessId, planKey, {
          interval,
          paystackSubscriptionCode: data.subscription_code || undefined,
          billingEmail: claimed.email || undefined,
        });
        if (couponCode) {
          await this.coupons.updateOne(
            { code: couponCode, $or: [{ maxRedemptions: null }, { $expr: { $lt: ['$redeemedCount', '$maxRedemptions'] } }] },
            { $inc: { redeemedCount: 1 } },
          ).exec();
        }
        try {
          await this.affiliates.recordSubscriptionPayment(claimed.businessId, claimed.amountKobo);
        } catch (error) {
          // A referral ledger failure must never block or reverse a paid subscription.
          this.logger.warn(`Affiliate commission failed: ${error instanceof Error ? error.message : 'unknown'}`);
        }
      }
      await this.payments.updateOne(
        { _id: claimed._id },
        {
          $set: {
            status: 'success',
            paidAt: data.paid_at ? new Date(data.paid_at) : new Date(),
            channel: data.channel || null,
            providerTransactionId: data.id ? String(data.id) : null,
          },
        },
      ).exec();
      await this.audit.record({
        businessId: claimed.businessId,
        actorId: claimed.createdBy,
        actorType: 'payment_provider',
        action: 'payment.success',
        entity: 'payment',
        entityId: claimed._id.toString(),
        metadata: { reference, purpose: claimed.purpose, amountKobo: claimed.amountKobo, eventId },
      });
    } catch (error) {
      await this.payments.updateOne({ _id: claimed._id, status: 'processing' }, { $set: { status: 'pending' } }).exec();
      throw error;
    }
  }

  async list(businessId: string, opts: { page: number; limit: number; purpose?: string; status?: string }) {
    const filter: Record<string, unknown> = { businessId };
    if (opts.purpose) filter.purpose = opts.purpose;
    if (opts.status) filter.status = opts.status;
    const [items, total] = await Promise.all([
      this.payments.find(filter).sort({ createdAt: -1 }).skip((opts.page - 1) * opts.limit).limit(opts.limit).lean().exec(),
      this.payments.countDocuments(filter).exec(),
    ]);
    return { items, meta: { total, page: opts.page, limit: opts.limit, pages: Math.ceil(total / opts.limit) } };
  }

  async getPayment(reference: string) {
    const payment = await this.payments.findOne({ reference }).lean().exec();
    if (!payment) throw new NotFoundException('Payment not found.');
    return payment;
  }

  getPaymentConfig() {
    return {
      provider: 'paystack',
      configured: this.paystack.isConfigured,
      publicKey: this.paystack.publicKey,
    };
  }

  async publicDebtContext(token: string) {
    const context = await this.debtsService.publicByToken(token);
    return {
      ...context,
      paystackConfigured: this.paystack.isConfigured,
      publicKey: this.paystack.publicKey,
    };
  }

  private async resolveEmail(businessId: string, customerEmail?: string): Promise<string> {
    if (customerEmail) return customerEmail;
    const business = await this.businesses.findById(businessId).lean().exec();
    if (business?.email) return business.email;
    const owner = await this.memberships.findOne({ businessId, role: 'owner' }).lean().exec();
    if (owner) {
      const user = await this.users.findById(owner.userId).select('email').lean().exec();
      if (user?.email) return user.email;
    }
    throw new BadRequestException('Add an email address to the customer or your business before creating a payment link.');
  }

  private reference(prefix: string): string {
    return `OJALY-${prefix.toUpperCase()}-${Date.now()}-${randomToken(4).toUpperCase()}`;
  }
}
