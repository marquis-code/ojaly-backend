import { BadRequestException, ConflictException, forwardRef, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, FilterQuery, Model } from 'mongoose';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Customer, CustomerDocument } from '../customers/customer.schema';
import { Counter, CounterDocument } from '../plans/counter.schema';
import { Sale, SaleDocument } from '../sales/sale.schema';
import { Debt, DebtDocument } from '../debts/debt.schema';
import { Provider, ProviderDocument } from '../providers/provider.schema';
import { Service, ServiceDocument } from '../services/service.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { PromotionsService } from '../promotions/promotions.service';
import { PaymentsService } from '../payments/payments.service';
import { RiskService } from '../risk/risk.service';
import { bookingConfirmedEmail, bookingReviewEmail } from '../mail/email-templates';
import { SmsService } from '../sms/sms.service';
import { PackagesService } from '../packages/packages.service';
import { CalendarService } from '../calendar/calendar.service';
import { campusByCode } from '../campus/campus.constants';
import { DebtsService } from '../debts/debts.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { WhatsappClientService } from '../whatsapp/whatsapp-client.service';
import { formatNaira } from '../../common/utils/money';
import { AvailabilityService } from './availability.service';
import { Booking, BookingDocument, BookingStatus } from './booking.schema';
import { nextSequence } from '../../common/utils/order-number';
import { randomToken } from '../../common/utils/tokens';
import { normalizeNigerianPhone } from '../../common/utils/phone';
import { sanitizeText } from '../../common/utils/sanitize';
import { addMinutes, calculateWorkerPayout, localDateKey } from './booking.utils';
import { resolveDateRange, humanRangeLabel, DateRangePreset } from '../../common/utils/dates';
import { addDays, addMonths } from 'date-fns';
import {
  BookingQueryDto, BookingMetricsQueryDto, CancelBookingDto, CreateBookingDto, CreateRecurringBookingDto, RescheduleBookingDto, VerifyTransferPaymentDto,
} from './booking.dto';

@Injectable()
export class BookingsService implements OnModuleInit {
  private readonly logger = new Logger(BookingsService.name);

  async onModuleInit() {
    try {
      const now = new Date();
      const cutoff = new Date(now.getTime() - 15 * 60 * 1000);
      const res = await this.bookings.updateMany(
        {
          status: 'pending',
          paymentStatus: 'unpaid',
          source: { $in: ['storefront', 'marketplace'] },
          $or: [
            { paymentExpiresAt: { $lt: now } },
            { paymentExpiresAt: null, createdAt: { $lt: cutoff } },
          ],
        },
        {
          $set: {
            status: 'cancelled',
            cancelledAt: now,
            cancellationReason: 'Payment not completed within checkout window',
          },
        },
      ).exec();
      if (res.modifiedCount > 0) {
        this.logger.log(`Pruned ${res.modifiedCount} stale unpaid booking(s) on startup`);
      }
    } catch {
      // ignore
    }
  }

  constructor(
    @InjectModel(Booking.name) private readonly bookings: Model<BookingDocument>,
    @InjectModel(Service.name) private readonly services: Model<ServiceDocument>,
    @InjectModel(Provider.name) private readonly providers: Model<ProviderDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @InjectModel(Sale.name) private readonly sales: Model<SaleDocument>,
    @InjectModel(Counter.name) private readonly counters: Model<CounterDocument>,
    @InjectModel(Debt.name) private readonly debtModel: Model<DebtDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly availability: AvailabilityService,
    private readonly debts: DebtsService,
    private readonly receipts: ReceiptsService,
    private readonly waitlist: WaitlistService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
    private readonly whatsapp: WhatsappClientService,
    private readonly promotions: PromotionsService,
    private readonly risk: RiskService,
    @Inject(forwardRef(() => PaymentsService)) private readonly payments: PaymentsService,
    private readonly packages: PackagesService,
    private readonly calendarSync: CalendarService,
    private readonly config: ConfigService,
  ) {}

  async list(businessId: string, query: BookingQueryDto) {
    const business = await this.businesses.findById(businessId).lean().exec();
    if (!business) throw new NotFoundException('Business not found.');

    const now = new Date();
    const cutoff = new Date(now.getTime() - 15 * 60 * 1000);
    await this.bookings.updateMany(
      {
        businessId,
        status: 'pending',
        paymentStatus: 'unpaid',
        source: { $in: ['storefront', 'marketplace'] },
        $or: [
          { paymentExpiresAt: { $lt: now } },
          { paymentExpiresAt: null, createdAt: { $lt: cutoff } },
        ],
      },
      {
        $set: {
          status: 'cancelled',
          cancelledAt: now,
          cancellationReason: 'Payment not completed within checkout window',
        },
      },
    ).exec().catch(() => undefined);

    const filter: FilterQuery<BookingDocument> = { businessId };
    if (query.status && query.status !== 'all') {
      filter.status = query.status;
    } else {
      filter.$nor = [{ status: 'pending', paymentStatus: 'unpaid', source: { $in: ['storefront', 'marketplace'] } }];
    }
    if (query.providerId) filter.providerId = query.providerId;
    if (query.serviceId) filter.serviceId = query.serviceId;
    if (query.search) {
      const rx = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ customerName: rx }, { customerPhone: rx }, { bookingNumber: rx }, { serviceName: rx }];
    }
    if (query.date) {
      const from = new Date(`${query.date}T00:00:00+01:00`);
      const to = new Date(`${query.date}T23:59:59+01:00`);
      filter.startAt = { $gte: from, $lte: to };
    } else {
      if (query.from) filter.startAt = { ...(filter.startAt || {}), $gte: new Date(query.from.length === 10 ? `${query.from}T00:00:00+01:00` : query.from) };
      if (query.to) filter.startAt = { ...(filter.startAt || {}), $lte: new Date(query.to.length === 10 ? `${query.to}T23:59:59.999+01:00` : query.to) };
    }
    const page = query.page || 1;
    const limit = query.limit || 100;
    const [items, total] = await Promise.all([
      this.bookings.find(filter).sort({ startAt: query.sort === 'desc' ? -1 : 1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      this.bookings.countDocuments(filter).exec(),
    ]);
    const today = localDateKey(new Date(), business.timezone || 'Africa/Lagos');
    const todayStart = new Date(`${today}T00:00:00+01:00`);
    const todayEnd = new Date(`${today}T23:59:59+01:00`);
    const [todayCount, upcomingCount, pendingCount] = await Promise.all([
      this.bookings.countDocuments({
        businessId,
        startAt: { $gte: todayStart, $lte: todayEnd },
        status: { $nin: ['cancelled'] },
        $nor: [{ status: 'pending', paymentStatus: 'unpaid', source: { $in: ['storefront', 'marketplace'] } }],
      }).exec(),
      this.bookings.countDocuments({
        businessId,
        startAt: { $gte: new Date() },
        status: { $in: ['pending', 'confirmed'] },
        $nor: [{ status: 'pending', paymentStatus: 'unpaid', source: { $in: ['storefront', 'marketplace'] } }],
      }).exec(),
      this.bookings.countDocuments({
        businessId,
        status: 'pending',
        $nor: [{ paymentStatus: 'unpaid', source: { $in: ['storefront', 'marketplace'] } }],
      }).exec(),
    ]);
    return {
      items: items.map((b) => ({ ...this.view(b), providerFeeKobo: b.providerFeeKobo || 0, providerNetKobo: b.providerNetKobo || 0 })),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
      summary: { today: todayCount, upcoming: upcomingCount, pending: pendingCount },
    };
  }

  async metrics(businessId: string, query: BookingMetricsQueryDto) {
    const business = await this.businesses.findById(businessId).lean().exec();
    if (!business) throw new NotFoundException('Business not found.');
    const preset = (query.range || 'month') as DateRangePreset;
    const range = resolveDateRange(preset, query.from, query.to);
    const bookings = await this.bookings.find({
      businessId,
      startAt: { $gte: range.from, $lte: range.to },
    }).select('status priceKobo amountPaidKobo source marketplaceCampus customerPhone serviceName startAt createdAt').sort({ startAt: 1 }).lean().exec();

    const completed = bookings.filter((b) => b.status === 'completed');
    const pending = bookings.filter((b) => b.status === 'pending');
    const cancelled = bookings.filter((b) => b.status === 'cancelled');
    const noShows = bookings.filter((b) => b.status === 'no_show');
    const marketplace = bookings.filter((b) => b.source === 'marketplace');
    const marketplaceCompleted = marketplace.filter((b) => b.status === 'completed');
    const phones = new Map<string, number>();
    for (const booking of completed) phones.set(booking.customerPhone, (phones.get(booking.customerPhone) || 0) + 1);
    const repeatCustomers = [...phones.values()].filter((count) => count > 1).length;
    const displayStatuses = ['completed', 'no_show'];
    const noShowRate = displayStatuses.reduce((sum, status) => sum + bookings.filter((b) => b.status === status).length, 0) > 0
      ? Math.round((noShows.length / (completed.length + noShows.length)) * 1000) / 10
      : 0;

    const serviceMap = new Map<string, { name: string; bookings: number; revenueKobo: number }>();
    for (const booking of completed) {
      const current = serviceMap.get(booking.serviceName) || { name: booking.serviceName, bookings: 0, revenueKobo: 0 };
      current.bookings += 1;
      current.revenueKobo += booking.priceKobo;
      serviceMap.set(booking.serviceName, current);
    }

    return {
      range: { preset, from: range.from, to: range.to, label: range.label, human: humanRangeLabel(range) },
      summary: {
        bookings: bookings.length,
        completed: completed.length,
        pending: pending.length,
        cancelled: cancelled.length,
        noShows: noShows.length,
        revenueKobo: completed.reduce((sum, b) => sum + b.priceKobo, 0),
        collectedKobo: bookings.filter((b) => b.status !== 'cancelled').reduce((sum, b) => sum + (b.amountPaidKobo || 0), 0),
        marketplaceBookings: marketplace.length,
        marketplaceRevenueKobo: marketplaceCompleted.reduce((sum, b) => sum + b.priceKobo, 0),
        repeatCustomers,
        noShowRate,
      },
      topServices: [...serviceMap.values()].sort((a, b) => b.revenueKobo - a.revenueKobo).slice(0, 5),
      recentBookings: bookings
        .slice()
        .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime())
        .slice(0, 5)
        .map((b) => ({ ...b, id: b._id.toString() })),
    };
  }

  async findOne(businessId: string, id: string) {
    const booking = await this.bookings.findOne({ _id: id, businessId }).lean().exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    return { ...this.view(booking), providerFeeKobo: booking.providerFeeKobo || 0, providerNetKobo: booking.providerNetKobo || 0 };
  }

  async create(
    userId: string,
    businessId: string,
    dto: CreateBookingDto,
    source: 'dashboard' | 'storefront' | 'whatsapp' | 'walk_in' = 'dashboard',
    series?: { id: string; index: number; total: number },
    notify = true,
    overrides?: { priceKobo?: number; durationMinutes?: number; depositKobo?: number; customRequestId?: string },
  ) {
    const [business, service] = await Promise.all([
      this.businesses.findById(businessId).lean().exec(),
      this.services.findOne({ _id: dto.serviceId, businessId, isActive: true }).lean().exec(),
    ]);
    if (!business) throw new NotFoundException('Business not found.');
    if (!service) throw new NotFoundException('Service not found.');
    const phone = normalizeNigerianPhone(dto.customerPhone);
    if (!phone) throw new BadRequestException('Enter a valid Nigerian phone number.');
    if (!this.normalDate(dto.startAt)) throw new BadRequestException('Choose a valid start time.');
    const startAt = new Date(dto.startAt);
    const configuredLocations = business.bookingSettings?.locations || [];
    const location = dto.location ? sanitizeText(dto.location, 100) : '';
    const roomNumber = dto.roomNumber ? sanitizeText(dto.roomNumber, 50) : '';
    if (location && configuredLocations.length && !configuredLocations.includes(location)) throw new BadRequestException('Choose one of the available booking locations.');
    const risk = await this.risk.assessBooking({ businessId, phone, email: dto.customerEmail || null, amountKobo: service.priceKobo, startAt, serviceId: service._id.toString(), reference: `${phone}:${startAt.toISOString()}` });
    const provider = await this.resolveProvider(businessId, service, dto.providerId);
    const addOns = this.selectedAddOns(service, dto.addOnNames || []);
    const packageRedemption = dto.packageCode ? await this.packages.validateRedemption(businessId, dto.packageCode, service._id.toString(), phone) : null;
    const marketplaceCampus = dto.marketplaceCampus ? { code: dto.marketplaceCampus.trim().toUpperCase() } : null;
    const effectiveSource = marketplaceCampus ? 'marketplace' : source;
    if (!location && configuredLocations.length && ['storefront', 'marketplace'].includes(effectiveSource)) throw new BadRequestException('Choose a booking location.');
    const addonMinutes = addOns.reduce((sum, a) => sum + (a.durationMinutes || 0), 0);
    const quantity = service.quantityEnabled ? Math.min(Math.max(1, service.maxQuantity || 20), Math.max(service.minQuantity || 1, Number(dto.quantity || 1))) : 1;
    const serviceDuration = service.durationMinutes > 0 ? service.durationMinutes : Math.max(5, business.bookingSettings?.slotIntervalMinutes || 30);
    const durationMinutes = overrides?.durationMinutes ?? serviceDuration * quantity + addonMinutes;
    const timezone = business.timezone || 'Africa/Lagos';
    await this.availability.assertSlot(businessId, service._id.toString(), startAt, String(provider._id), timezone, durationMinutes, { ignoreWindow: effectiveSource !== 'storefront' && effectiveSource !== 'marketplace' });

    const subtotalKobo = overrides?.priceKobo ?? service.priceKobo * quantity + addOns.reduce((sum, a) => sum + a.priceKobo, 0);
    const promotion = packageRedemption
      ? null
      : (await this.promotions.platformDiscount(subtotalKobo).catch(() => null)) || await this.promotions.newCustomerDiscount({
          customerPhone: phone, customerEmail: dto.customerEmail || null, subtotalKobo,
        }).catch(() => null);
    const discountKobo = promotion?.discountKobo || 0;
    const discountedSubtotalKobo = Math.max(0, subtotalKobo - discountKobo);

    let serviceChargeKobo = 0;
    const serviceChargePercent = business.serviceChargePercent || 0;
    if (business.serviceChargeEnabled) {
      if (business.serviceChargeType === 'fixed') {
        serviceChargeKobo = business.serviceChargeFixedKobo || 0;
      } else {
        serviceChargeKobo = Math.round((discountedSubtotalKobo * serviceChargePercent) / 100);
      }
    }

    let providerFeeKobo = 0;
    const providerFeePercent = business.providerFeePercent || 0;
    if (business.providerFeeEnabled && discountedSubtotalKobo > 0) {
      if (business.providerFeeType === 'fixed') providerFeeKobo = Math.min(discountedSubtotalKobo, business.providerFeeFixedKobo || 0);
      else providerFeeKobo = Math.min(discountedSubtotalKobo, Math.round((discountedSubtotalKobo * providerFeePercent) / 100));
    }
    const providerNetKobo = Math.max(0, discountedSubtotalKobo - providerFeeKobo);
    const totalKobo = discountedSubtotalKobo + serviceChargeKobo;
    const packageValueKobo = packageRedemption ? totalKobo : 0;
    const chargeKobo = packageRedemption ? 0 : totalKobo;
    const marketplaceFeePercent = marketplaceCampus ? (business.marketplaceFeePercent ?? 5) : 0;
    const marketplaceFeeKobo = marketplaceCampus ? Math.round((chargeKobo * marketplaceFeePercent) / 100) : 0;
    const isPublicOnline = ['storefront', 'marketplace'].includes(effectiveSource);
    const depositPercent = business.bookingSettings?.depositPercent || 0;
    const baseDeposit = packageRedemption ? 0 : overrides?.depositKobo !== undefined
      ? Math.min(discountedSubtotalKobo, Math.max(0, overrides.depositKobo))
      : service.requiresDeposit
        ? Math.min(discountedSubtotalKobo, service.depositKobo || Math.round((discountedSubtotalKobo * depositPercent) / 100))
        : 0;
    const collectFull = business.bookingSettings?.paymentCollection === 'full';
    let depositKobo = packageRedemption ? 0 : collectFull ? totalKobo : baseDeposit > 0 ? baseDeposit + serviceChargeKobo : 0;
    if (isPublicOnline && !packageRedemption && chargeKobo > 0 && depositKobo <= 0) {
      depositKobo = totalKobo;
    }
    const requiresPayment = !packageRedemption && chargeKobo > 0 && depositKobo > 0;
    const shouldConfirm = packageRedemption ? true : !isPublicOnline && Boolean(business.bookingSettings?.autoConfirm) && depositKobo <= 0;
    const paymentExpiresAt = isPublicOnline && requiresPayment ? new Date(Date.now() + 15 * 60 * 1000) : null;
    const blockStartAt = addMinutes(startAt, -(service.bufferBeforeMinutes || 0));
    const endAt = addMinutes(startAt, durationMinutes);
    const blockEndAt = addMinutes(endAt, service.bufferAfterMinutes || 0);

    const session = await this.connection.startSession();
    let created!: BookingDocument;
    let customerId: string | null = null;
    try {
      await session.withTransaction(async () => {
        const nowMs = Date.now();
        const rawConflict = await this.bookings.find({
          businessId,
          providerId: String(provider._id),
          status: { $in: ['pending', 'confirmed'] },
          blockStartAt: { $lt: blockEndAt },
          blockEndAt: { $gt: blockStartAt },
        }).session(session).lean().exec();
        const conflict = rawConflict.filter((b) => {
          if (b.status === 'pending' && b.paymentStatus === 'unpaid' && ['storefront', 'marketplace'].includes(b.source)) {
            if (b.paymentExpiresAt && new Date(b.paymentExpiresAt).getTime() < nowMs) return false;
            if (!b.paymentExpiresAt && (b.createdAt ? new Date(b.createdAt).getTime() + 15 * 60 * 1000 < nowMs : false)) return false;
          }
          return true;
        });
        if (conflict.length >= Math.max(1, service.maxBookingsPerSlot || 1)) {
          throw new ConflictException('That time was just taken. Please choose another slot.');
        }
        let customer = await this.customers.findOne({ businessId, phone }).session(session).exec();
        if (!customer) {
          const [newCustomer] = await this.customers.create([{
            businessId, name: sanitizeText(dto.customerName, 100) || 'Customer', phone,
            email: dto.customerEmail || null, totalSpentKobo: 0, outstandingKobo: 0,
          }], { session });
          customer = newCustomer;
        } else if (dto.customerEmail && !customer.email) {
          customer.email = dto.customerEmail;
          await customer.save({ session });
        }
        customerId = customer._id.toString();
        const bookingNumber = await nextSequence(
          this.counters as unknown as Model<Record<string, unknown>>,
          businessId,
          'booking',
          'BKG',
        );
        const [newBooking] = await this.bookings.create([{
          businessId,
          bookingNumber,
          publicToken: randomToken(24),
          serviceId: service._id.toString(),
          serviceName: service.name,
          serviceCategory: service.category,
          serviceImageUrl: service.imageUrl || null,
          providerId: String(provider._id),
          providerName: provider.name,
          providerAvatarUrl: provider.avatarUrl || null,
          providerColor: provider.color || null,
          customerId,
          customerName: customer.name,
          customerPhone: customer.phone,
          customerEmail: customer.email,
          startAt,
          endAt,
          blockStartAt,
          blockEndAt,
          durationMinutes,
          quantity,
          quantityLabel: service.quantityEnabled ? (service.quantityLabel || 'Quantity') : '',
          unitPriceKobo: service.priceKobo,
          capacity: service.maxBookingsPerSlot || 1,
          bufferBeforeMinutes: service.bufferBeforeMinutes || 0,
          bufferAfterMinutes: service.bufferAfterMinutes || 0,
          timezone,
          addOns,
          status: shouldConfirm ? 'confirmed' : 'pending',
          source: effectiveSource,
          location: location || '',
          roomNumber: roomNumber || '',
          workerPayoutKobo: calculateWorkerPayout(service.name, 1),
          workerCount: 1,
          workerIds: [String(provider._id)],
          workerBreakdown: [{ providerId: String(provider._id), providerName: provider.name, amountKobo: calculateWorkerPayout(service.name, 1) }],
          notes: sanitizeText(dto.notes, 2000),
          subtotalKobo: packageRedemption ? 0 : subtotalKobo,
          serviceChargeKobo: packageRedemption ? 0 : serviceChargeKobo,
          serviceChargePercent: business.serviceChargeEnabled ? serviceChargePercent : 0,
          discountKobo,
          promotionLabel: promotion?.label || null,
          providerFeeKobo,
          providerFeePercent: business.providerFeeEnabled ? providerFeePercent : 0,
          providerNetKobo,
          priceKobo: chargeKobo,
          packageValueKobo,
          marketplaceCampus: marketplaceCampus?.code || null,
          marketplaceFeePercent,
          marketplaceFeeKobo,
          customRequestId: overrides?.customRequestId || null,
          packagePurchaseId: packageRedemption?.id || null,
          packageCode: packageRedemption?.redemptionCode || null,
          packageName: packageRedemption?.packageName || null,
          depositKobo,
          amountPaidKobo: 0,
          paymentStatus: packageRedemption ? 'paid' : (dto.paymentMethod === 'direct_transfer' ? 'pending_verification' : 'unpaid'),
          paymentMethod: dto.paymentMethod || null,
          transferSenderName: dto.transferSenderName ? sanitizeText(dto.transferSenderName, 100) : null,
          paymentReference: packageRedemption ? `package:${packageRedemption.redemptionCode}` : null,
          paymentExpiresAt,
          seriesId: series?.id || null,
          seriesIndex: series?.index || 0,
          seriesTotal: series?.total || 1,
          createdBy: userId,
          history: [{
            status: shouldConfirm ? 'confirmed' : 'pending',
            at: new Date(),
            by: userId,
            note: dto.paymentMethod === 'direct_transfer'
              ? `Direct bank transfer submitted by customer (${dto.transferSenderName || 'No sender name'}) · Pending vendor verification`
              : 'Booking created',
          }],
        }], { session });
        created = newBooking;
      });
    } finally {
      await session.endSession();
    }

    if (packageRedemption) {
      try {
        await this.packages.consume(packageRedemption.id, businessId);
      } catch {
        await this.bookings.updateOne({ _id: created._id }, { $set: { status: 'cancelled', cancellationReason: 'Package redemption failed' } }).exec();
        throw new BadRequestException('The package could not be redeemed. No session was used.');
      }
    }
    if (notify && created.status === 'confirmed') {
      await this.notifications.create({
        businessId,
        type: 'booking',
        title: `New booking · ${created.bookingNumber}`,
        message: `${created.customerName} booked ${created.serviceName} with ${created.providerName}.`,
        tone: 'success',
        data: { bookingId: created._id.toString(), startAt: created.startAt.toISOString(), publicToken: created.publicToken },
      });
      await this.sendConfirmation(created, business as unknown as BusinessDocument).catch(() => undefined);
      if (dto.paymentMethod === 'direct_transfer') {
        const vendorPhone = business.whatsappNumber || business.publicPhone;
        if (vendorPhone) {
          const locLine = [created.location, created.roomNumber ? `Room ${created.roomNumber.replace(/^room\s*/i, '')}` : ''].filter(Boolean).join(' · ');
          const whenFormatted = new Intl.DateTimeFormat('en-NG', { timeZone: created.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(created.startAt);
          await this.whatsapp.sendTextDirect(
            businessId,
            vendorPhone,
            `*🔔 Action Required: Verify Bank Transfer · ${business.name}*

👤 *Customer:* ${created.customerName} (${created.customerPhone})
🛠 *Service:* ${created.serviceName}
📅 *When:* ${whenFormatted}${locLine ? `\n🚪 *Location:* ${locLine}` : ''}
💰 *Amount to Confirm:* ${formatNaira(created.priceKobo)}
🏦 *Bank:* ${business.directTransferBankName || 'Bank Transfer'}
📝 *Sender Name:* ${dto.transferSenderName || 'Not stated'}
🔖 *Ref:* ${created.bookingNumber}

👉 *Please check your bank app, then approve or reject on Ojaly:*
${this.config.get('appUrl')}/app/appointments`
          ).catch(() => undefined);
        }
      }
      void this.calendarSync.pushBooking(created).catch(() => undefined);
    }
    return this.view(created);
  }

  async recordPayment(bookingId: string, amountKobo: number, paymentReference: string): Promise<BookingDocument> {
    const booking = await this.bookings.findById(bookingId).exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.status === 'cancelled') throw new BadRequestException('This booking was cancelled.');

    booking.amountPaidKobo = Math.min(booking.priceKobo, (booking.amountPaidKobo || 0) + amountKobo);
    booking.paymentStatus = booking.amountPaidKobo >= booking.priceKobo ? 'paid' : 'deposit_paid';
    booking.paymentReference = paymentReference;
    booking.paymentExpiresAt = null;
    booking.status = 'confirmed';
    booking.history.push({
      status: 'confirmed',
      at: new Date(),
      by: 'paystack',
      note: `Payment of ${formatNaira(amountKobo)} received. Booking confirmed.`,
    });
    await booking.save();

    if (booking.customerId) {
      await this.customers.updateOne(
        { _id: booking.customerId, businessId: booking.businessId },
        { $inc: { totalSpentKobo: amountKobo }, $set: { lastPurchaseAt: new Date() } },
      ).exec().catch(() => undefined);
    }

    const business = await this.businesses.findById(booking.businessId).lean().exec();
    if (business) {
      await this.notifications.create({
        businessId: booking.businessId,
        type: 'booking',
        title: `Payment received · ${booking.bookingNumber}`,
        message: `${booking.customerName} booked ${booking.serviceName} with ${booking.providerName} (Paid ${formatNaira(amountKobo)}).`,
        tone: 'success',
        data: { bookingId: booking._id.toString(), startAt: booking.startAt ? new Date(booking.startAt).toISOString() : '', publicToken: booking.publicToken },
      }).catch(() => undefined);

      await this.sendConfirmation(booking, business as unknown as BusinessDocument).catch(() => undefined);
      void this.calendarSync.pushBooking(booking).catch(() => undefined);
    }

    return booking;
  }

  async verifyTransfer(businessId: string, actorId: string, bookingId: string, dto: VerifyTransferPaymentDto) {
    const booking = await this.bookings.findOne({ _id: bookingId, businessId }).exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    const business = await this.businesses.findById(businessId).exec();
    if (!business) throw new NotFoundException('Business not found.');

    if (dto.action === 'approve') {
      booking.paymentStatus = 'paid';
      booking.amountPaidKobo = booking.priceKobo;
      booking.transferVerifiedAt = new Date();
      booking.transferVerifiedBy = actorId;
      booking.transferRejectionReason = null;
      booking.history.push({
        status: booking.status,
        at: new Date(),
        by: actorId,
        note: `Direct bank transfer verified and marked as paid by vendor`,
      });
      await booking.save();

      if (booking.customerId) {
        await this.customers.updateOne(
          { _id: booking.customerId, businessId },
          { $inc: { totalSpentKobo: booking.priceKobo }, $set: { lastPurchaseAt: new Date() } },
        ).exec().catch(() => undefined);
      }

      await this.notifications.create({
        businessId,
        type: 'booking',
        title: `Payment verified · ${booking.bookingNumber}`,
        message: `Transfer payment for ${booking.customerName} (${formatNaira(booking.priceKobo)}) was approved and marked as paid.`,
        tone: 'success',
        data: { bookingId: booking._id.toString(), publicToken: booking.publicToken },
      }).catch(() => undefined);

      const when = new Intl.DateTimeFormat('en-NG', {
        timeZone: booking.timezone, weekday: 'short', day: 'numeric', month: 'short',
        hour: 'numeric', minute: '2-digit',
      }).format(booking.startAt);
      const loc = [booking.location, booking.roomNumber ? `Room ${booking.roomNumber.replace(/^room\s*/i, '')}` : ''].filter(Boolean).join(' · ');
      const locLine = loc ? `\n🚪 *Location:* ${loc}` : '';

      const customerMsg = `*✅ Payment Verified & Confirmed! · ${business.name}*

Hello ${booking.customerName.split(' ')[0]}! Your bank transfer of ${formatNaira(booking.priceKobo)} for *${booking.serviceName}* has been verified and confirmed!

🛠 *Service:* ${booking.serviceName}
👷 *Team Member:* ${booking.providerName}
📅 *When:* ${when}${locLine}
💰 *Amount Paid:* ${formatNaira(booking.priceKobo)}
🔖 *Booking Ref:* ${booking.bookingNumber}

🔗 *View or manage your booking:*
${this.config.get('appUrl')}/booking/${booking.publicToken}

Thank you for choosing ${business.name}!`;

      if (booking.customerPhone) {
        await this.whatsapp.sendTextDirect(businessId, booking.customerPhone, customerMsg).catch(() => undefined);
      }
    } else {
      booking.paymentStatus = 'unpaid';
      booking.transferRejectionReason = dto.reason || 'Payment could not be verified in bank records';
      booking.history.push({
        status: booking.status,
        at: new Date(),
        by: actorId,
        note: `Direct bank transfer rejected: ${dto.reason || 'Payment could not be verified'}`,
      });
      await booking.save();

      const customerRejectMsg = `*⚠️ Transfer Verification Update · ${business.name}*

Hello ${booking.customerName.split(' ')[0]}, ${business.name} could not verify your bank transfer for booking *${booking.bookingNumber}* (${booking.serviceName}).

📋 *Reason:* ${dto.reason || 'Payment was not found in bank records.'}

Please check your payment or reach out to ${business.name} on ${business.whatsappNumber || business.publicPhone || 'WhatsApp'}:
${this.config.get('appUrl')}/booking/${booking.publicToken}`;

      if (booking.customerPhone) {
        await this.whatsapp.sendTextDirect(businessId, booking.customerPhone, customerRejectMsg).catch(() => undefined);
      }
    }

    return this.view(booking);
  }

  async cancelUnpaidBooking(bookingId: string, reason = 'Payment not completed') {
    return this.bookings.updateOne(
      { _id: bookingId, paymentStatus: 'unpaid', status: 'pending' },
      {
        $set: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancellationReason: reason,
        },
        $push: {
          history: { status: 'cancelled', at: new Date(), by: 'system', note: reason },
        },
      },
    ).exec();
  }

  async createRecurring(userId: string, businessId: string, dto: CreateRecurringBookingDto) {
    const seriesId = randomToken(12);
    const created: { id: string }[] = [];
    for (let index = 0; index < dto.occurrences; index++) {
      const base = new Date(dto.startAt);
      const startAt = index === 0 ? base
        : dto.frequency === 'monthly' ? addMonths(base, index)
          : addDays(base, index * (dto.frequency === 'biweekly' ? 14 : 7));
      try {
        const booking = await this.create(
          userId,
          businessId,
          { ...dto, startAt: startAt.toISOString() },
          'dashboard',
          { id: seriesId, index, total: dto.occurrences },
          index === 0,
        );
        created.push(booking);
      } catch (error) {
        if (created.length) {
          const ids = created.map((b) => b.id);
          await this.bookings.updateMany(
            { _id: { $in: ids }, businessId },
            { $set: { status: 'cancelled', cancelledAt: new Date(), cancellationReason: 'Recurring series could not be completed' } },
          ).exec();
        }
        throw new BadRequestException(`Could not create session ${index + 1}: ${error instanceof Error ? error.message : 'that time is unavailable.'}`);
      }
    }
    return { seriesId, bookings: created };
  }

  async createPublic(businessId: string, dto: CreateBookingDto) {
    return this.create(null as unknown as string, businessId, dto, 'storefront');
  }

  async quotePublic(businessId: string, dto: CreateBookingDto) {
    const [business, service] = await Promise.all([
      this.businesses.findById(businessId).lean().exec(),
      this.services.findOne({ _id: dto.serviceId, businessId, isActive: true }).lean().exec(),
    ]);
    if (!business) throw new NotFoundException('Business not found.');
    if (!service) throw new NotFoundException('Service not found.');
    const phone = normalizeNigerianPhone(dto.customerPhone);
    if (!phone) throw new BadRequestException('Enter a valid Nigerian phone number.');
    if (!this.normalDate(dto.startAt)) throw new BadRequestException('Choose a valid start time.');
    const startAt = new Date(dto.startAt);
    const configuredLocations = business.bookingSettings?.locations || [];
    const location = dto.location ? sanitizeText(dto.location, 100) : '';
    const roomNumber = dto.roomNumber ? sanitizeText(dto.roomNumber, 50) : '';
    if (location && configuredLocations.length && !configuredLocations.includes(location)) {
      throw new BadRequestException('Choose one of the available booking locations.');
    }
    const provider = await this.resolveProvider(businessId, service, dto.providerId);
    const addOns = this.selectedAddOns(service, dto.addOnNames || []);
    const packageRedemption = dto.packageCode ? await this.packages.validateRedemption(businessId, dto.packageCode, service._id.toString(), phone) : null;
    const marketplaceCampus = dto.marketplaceCampus ? { code: dto.marketplaceCampus.trim().toUpperCase() } : null;
    const effectiveSource = marketplaceCampus ? 'marketplace' : 'storefront';
    if (!location && configuredLocations.length) throw new BadRequestException('Choose a booking location.');

    const addonMinutes = addOns.reduce((sum, a) => sum + (a.durationMinutes || 0), 0);
    const quantity = service.quantityEnabled ? Math.min(Math.max(1, service.maxQuantity || 20), Math.max(service.minQuantity || 1, Number(dto.quantity || 1))) : 1;
    const serviceDuration = service.durationMinutes > 0 ? service.durationMinutes : Math.max(5, business.bookingSettings?.slotIntervalMinutes || 30);
    const durationMinutes = serviceDuration * quantity + addonMinutes;
    const timezone = business.timezone || 'Africa/Lagos';
    await this.availability.assertSlot(businessId, service._id.toString(), startAt, String(provider._id), timezone, durationMinutes);

    const subtotalKobo = service.priceKobo * quantity + addOns.reduce((sum, a) => sum + a.priceKobo, 0);
    const promotion = packageRedemption
      ? null
      : (await this.promotions.platformDiscount(subtotalKobo).catch(() => null)) || await this.promotions.newCustomerDiscount({
          customerPhone: phone, customerEmail: dto.customerEmail || null, subtotalKobo,
        }).catch(() => null);
    const discountKobo = promotion?.discountKobo || 0;
    const discountedSubtotalKobo = Math.max(0, subtotalKobo - discountKobo);

    let serviceChargeKobo = 0;
    const serviceChargePercent = business.serviceChargePercent || 0;
    if (business.serviceChargeEnabled) {
      if (business.serviceChargeType === 'fixed') {
        serviceChargeKobo = business.serviceChargeFixedKobo || 0;
      } else {
        serviceChargeKobo = Math.round((discountedSubtotalKobo * serviceChargePercent) / 100);
      }
    }

    let providerFeeKobo = 0;
    const providerFeePercent = business.providerFeePercent || 0;
    if (business.providerFeeEnabled && discountedSubtotalKobo > 0) {
      if (business.providerFeeType === 'fixed') providerFeeKobo = Math.min(discountedSubtotalKobo, business.providerFeeFixedKobo || 0);
      else providerFeeKobo = Math.min(discountedSubtotalKobo, Math.round((discountedSubtotalKobo * providerFeePercent) / 100));
    }
    const providerNetKobo = Math.max(0, discountedSubtotalKobo - providerFeeKobo);
    const totalKobo = discountedSubtotalKobo + serviceChargeKobo;
    const chargeKobo = packageRedemption ? 0 : totalKobo;
    const marketplaceFeePercent = marketplaceCampus ? (business.marketplaceFeePercent ?? 5) : 0;
    const marketplaceFeeKobo = marketplaceCampus ? Math.round((chargeKobo * marketplaceFeePercent) / 100) : 0;

    const depositPercent = business.bookingSettings?.depositPercent || 0;
    const baseDeposit = packageRedemption ? 0
      : service.requiresDeposit
        ? Math.min(discountedSubtotalKobo, service.depositKobo || Math.round((discountedSubtotalKobo * depositPercent) / 100))
        : 0;
    const collectFull = business.bookingSettings?.paymentCollection === 'full';
    let depositKobo = packageRedemption ? 0 : collectFull ? totalKobo : baseDeposit > 0 ? baseDeposit + serviceChargeKobo : 0;
    if (!packageRedemption && chargeKobo > 0 && depositKobo <= 0) {
      depositKobo = totalKobo;
    }
    const requiredKobo = depositKobo;

    return {
      business,
      service,
      provider,
      addOns,
      quantity,
      quantityLabel: service.quantityEnabled ? (service.quantityLabel || 'Quantity') : '',
      phone,
      startAt,
      durationMinutes,
      timezone,
      location,
      roomNumber,
      workerPayoutKobo: calculateWorkerPayout(service.name, 1),
      subtotalKobo,
      discountKobo,
      promotion,
      serviceChargeKobo,
      serviceChargePercent,
      providerFeeKobo,
      providerFeePercent,
      providerNetKobo,
      totalKobo,
      depositKobo,
      requiredKobo,
      marketplaceCampus,
      marketplaceFeePercent,
      marketplaceFeeKobo,
      packageRedemption,
      effectiveSource,
    };
  }

  async createFromPaidCheckout(
    businessId: string,
    draft: Record<string, any>,
    amountPaidKobo: number,
    paymentReference: string,
  ): Promise<BookingDocument> {
    const existing = await this.bookings.findOne({ businessId, paymentReference }).exec();
    if (existing) return existing;

    const [business, service] = await Promise.all([
      this.businesses.findById(businessId).lean().exec(),
      this.services.findOne({ _id: draft.serviceId, businessId }).lean().exec(),
    ]);
    if (!business) throw new NotFoundException('Business not found.');
    if (!service) throw new NotFoundException('Service not found.');

    const phone = normalizeNigerianPhone(draft.customerPhone) || draft.customerPhone;
    const startAt = new Date(draft.startAt);
    const durationMinutes = Number(draft.durationMinutes || service.durationMinutes || business.bookingSettings?.slotIntervalMinutes || 30);
    const blockStartAt = addMinutes(startAt, -(service.bufferBeforeMinutes || 0));
    const endAt = addMinutes(startAt, durationMinutes);
    const blockEndAt = addMinutes(endAt, service.bufferAfterMinutes || 0);
    const timezone = business.timezone || 'Africa/Lagos';

    const session = await this.connection.startSession();
    let created!: BookingDocument;
    try {
      await session.withTransaction(async () => {
        let customer = await this.customers.findOne({ businessId, phone }).session(session).exec();
        if (!customer) {
          const [newCustomer] = await this.customers.create([{
            businessId,
            name: sanitizeText(draft.customerName, 100) || 'Customer',
            phone,
            email: draft.customerEmail || null,
            totalSpentKobo: amountPaidKobo,
            outstandingKobo: 0,
            lastPurchaseAt: new Date(),
          }], { session });
          customer = newCustomer;
        } else {
          customer.totalSpentKobo = (customer.totalSpentKobo || 0) + amountPaidKobo;
          customer.lastPurchaseAt = new Date();
          if (draft.customerEmail && !customer.email) {
            customer.email = draft.customerEmail;
          }
          await customer.save({ session });
        }

        const bookingNumber = await nextSequence(
          this.counters as unknown as Model<Record<string, unknown>>,
          businessId,
          'booking',
          'BKG',
        );

        const totalKobo = Number(draft.totalKobo || 0);
        const depositKobo = Number(draft.depositKobo || 0);
        const paymentStatus = amountPaidKobo >= totalKobo ? 'paid' : 'deposit_paid';

        const [newBooking] = await this.bookings.create([{
          businessId,
          bookingNumber,
          publicToken: randomToken(24),
          serviceId: service._id.toString(),
          serviceName: service.name,
          serviceCategory: service.category,
          serviceImageUrl: service.imageUrl || null,
          providerId: String(draft.providerId),
          providerName: draft.providerName || 'Staff',
          providerAvatarUrl: draft.providerAvatarUrl || null,
          providerColor: draft.providerColor || null,
          customerId: customer._id.toString(),
          customerName: customer.name,
          customerPhone: customer.phone,
          customerEmail: customer.email,
          startAt,
          endAt,
          blockStartAt,
          blockEndAt,
          durationMinutes,
          quantity: Number(draft.quantity || 1),
          quantityLabel: draft.quantityLabel || '',
          unitPriceKobo: Number(draft.unitPriceKobo || service.priceKobo),
          capacity: service.maxBookingsPerSlot || 1,
          bufferBeforeMinutes: service.bufferBeforeMinutes || 0,
          bufferAfterMinutes: service.bufferAfterMinutes || 0,
          timezone,
          addOns: draft.addOns || [],
          status: 'confirmed',
          source: draft.effectiveSource || (draft.marketplaceCampus ? 'marketplace' : 'storefront'),
          location: draft.location || '',
          roomNumber: draft.roomNumber || '',
          workerPayoutKobo: draft.workerPayoutKobo || calculateWorkerPayout(service.name, 1),
          workerCount: 1,
          workerIds: [String(draft.providerId || '')].filter(Boolean),
          workerBreakdown: [{ providerId: String(draft.providerId || ''), providerName: draft.providerName || '', amountKobo: draft.workerPayoutKobo || calculateWorkerPayout(service.name, 1) }],
          notes: sanitizeText(draft.notes, 2000),
          subtotalKobo: Number(draft.subtotalKobo || 0),
          serviceChargeKobo: Number(draft.serviceChargeKobo || 0),
          serviceChargePercent: Number(draft.serviceChargePercent || 0),
          discountKobo: Number(draft.discountKobo || 0),
          promotionLabel: draft.promotionLabel || null,
          providerFeeKobo: Number(draft.providerFeeKobo || 0),
          providerFeePercent: Number(draft.providerFeePercent || 0),
          providerNetKobo: Number(draft.providerNetKobo || 0),
          priceKobo: totalKobo,
          packageValueKobo: 0,
          marketplaceCampus: draft.marketplaceCampus?.code || (typeof draft.marketplaceCampus === 'string' ? draft.marketplaceCampus : null),
          marketplaceFeePercent: Number(draft.marketplaceFeePercent || 0),
          marketplaceFeeKobo: Number(draft.marketplaceFeeKobo || 0),
          customRequestId: null,
          packagePurchaseId: null,
          packageCode: null,
          packageName: null,
          depositKobo,
          amountPaidKobo,
          paymentStatus,
          paymentReference,
          paymentExpiresAt: null,
          seriesId: null,
          seriesIndex: 0,
          seriesTotal: 1,
          createdBy: null,
          history: [{
            status: 'confirmed',
            at: new Date(),
            by: 'paystack',
            note: `Confirmed upon online payment of ${formatNaira(amountPaidKobo)} (ref: ${paymentReference})`,
          }],
        }], { session });

        created = newBooking;
      });
    } finally {
      await session.endSession();
    }

    await this.notifications.create({
      businessId,
      type: 'booking',
      title: `New booking · ${created.bookingNumber}`,
      message: `${created.customerName} booked ${created.serviceName} with ${created.providerName} (Paid ${formatNaira(amountPaidKobo)}).`,
      tone: 'success',
      data: { bookingId: created._id.toString(), startAt: created.startAt.toISOString(), publicToken: created.publicToken },
    }).catch(() => undefined);

    await this.sendConfirmation(created, business as unknown as BusinessDocument).catch(() => undefined);
    void this.calendarSync.pushBooking(created).catch(() => undefined);

    return created;
  }

  async calendarFeedLink(businessId: string) {
    const business = await this.businesses.findById(businessId).exec();
    if (!business) throw new NotFoundException('Business not found.');
    if (!business.calendarToken) {
      business.calendarToken = randomToken(20);
      await business.save();
    }
    return { url: `${this.config.get('apiUrl')}/public/bookings/calendar/${business.calendarToken}.ics` };
  }

  async businessCalendar(token: string) {
    const business = await this.businesses.findOne({ calendarToken: token }).lean().exec();
    if (!business) throw new NotFoundException('Calendar feed not found.');
    const bookings = await this.bookings.find({
      businessId: business._id.toString(), status: { $in: ['pending', 'confirmed'] },
      startAt: { $gte: new Date(Date.now() - 30 * 86400000) },
    }).sort({ startAt: 1 }).limit(500).lean().exec();
    const stamp = (value: Date) => value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const clean = (value: unknown) => String(value || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const events = bookings.flatMap((booking) => [
      'BEGIN:VEVENT',
      `UID:${booking.publicToken}@ojaly.org`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(booking.startAt)}`,
      `DTEND:${stamp(booking.endAt)}`,
      `SUMMARY:${clean(`${booking.customerName} · ${booking.serviceName}`)}`,
      `DESCRIPTION:${clean(`With ${booking.providerName}. Reference ${booking.bookingNumber}. ${booking.notes || ''}`)}`,
      `LOCATION:${clean(business.address || '')}`,
      'STATUS:CONFIRMED',
      'END:VEVENT',
    ]);
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ojaly//Calendar Feed//EN', 'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH', `X-WR-CALNAME:${clean(`${business.name} appointments`)}`,
      ...events, 'END:VCALENDAR',
    ];
    return { filename: `ojaly-${business.slug}-calendar.ics`, content: `${lines.join('\r\n')}\r\n` };
  }

  async calendar(token: string) {
    const booking = await this.bookings.findOne({ publicToken: token }).lean().exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    const business = await this.businesses.findById(booking.businessId).lean().exec();
    const stamp = (value: Date) => value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const clean = (value: unknown) => String(value || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ojaly//Bookings//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${booking.publicToken}@ojaly.org`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(booking.startAt)}`,
      `DTEND:${stamp(booking.endAt)}`,
      `SUMMARY:${clean(`${booking.serviceName} at ${business?.name || 'Ojaly'}`)}`,
      `DESCRIPTION:${clean(`With ${booking.providerName}. Reference ${booking.bookingNumber}. Manage: ${this.config.get('appUrl')}/booking/${booking.publicToken}`)}`,
      `LOCATION:${clean(business?.address || '')}`,
      'STATUS:CONFIRMED',
      'END:VEVENT', 'END:VCALENDAR',
    ];
    return { filename: `ojaly-${booking.bookingNumber}.ics`, content: `${lines.join('\r\n')}\r\n` };
  }

  async lookupPublic(customerPhone: string, bookingNumber: string) {
    const phone = normalizeNigerianPhone(customerPhone);
    const reference = String(bookingNumber || '').trim().toUpperCase();
    if (!phone || reference.length < 4) throw new BadRequestException('Enter the phone number used for the booking and the booking reference.');
    const bookings = await this.bookings.find({ customerPhone: phone, bookingNumber: reference }).sort({ startAt: -1 }).limit(5).lean().exec();
    if (!bookings.length) throw new NotFoundException('No booking matched that phone number and reference.');
    const businessIds = [...new Set(bookings.map((b) => b.businessId))];
    const businesses = await this.businesses.find({ _id: { $in: businessIds } }).lean().exec();
    return bookings.map((booking) => {
      const business = businesses.find((b) => String(b._id) === booking.businessId);
      return {
        bookingNumber: booking.bookingNumber,
        publicToken: booking.publicToken,
        serviceName: booking.serviceName,
        startAt: booking.startAt,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        businessName: business?.name || 'Ojaly business',
        businessSlug: business?.slug || '',
        timezone: booking.timezone || 'Africa/Lagos',
      };
    });
  }

  async byToken(token: string) {
    const booking = await this.bookings.findOne({ publicToken: token }).lean().exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    const business = await this.businesses.findById(booking.businessId).lean().exec();
    return {
      booking: this.view(booking),
      business: business ? {
        id: String(business._id), name: business.name, slug: business.slug,
        logoUrl: business.logoUrl, brandColor: business.brandColor,
        publicPhone: business.publicPhone, whatsappNumber: business.whatsappNumber,
        address: business.address, bookingSettings: business.bookingSettings,
        serviceChargeEnabled: Boolean(business.serviceChargeEnabled),
        serviceChargeType: business.serviceChargeType || 'percent',
        serviceChargePercent: business.serviceChargePercent || 0,
        serviceChargeFixedKobo: business.serviceChargeFixedKobo || 0,
      } : null,
    };
  }

  async updateStatus(
    userId: string,
    businessId: string,
    id: string,
    status: BookingStatus,
    reason?: string,
    opts?: { workerCount?: number; secondProviderId?: string },
  ) {
    if (status === 'completed') return this.complete(userId, businessId, id, opts);
    const booking = await this.bookings.findOne({ _id: id, businessId }).exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.status === 'completed') {
      throw new BadRequestException('A completed booking cannot be changed.');
    }
    if (booking.status === 'cancelled' && status !== 'cancelled') {
      throw new BadRequestException('This booking was cancelled.');
    }
    booking.status = status;
    if (status === 'cancelled') {
      booking.cancelledAt = new Date();
      booking.cancellationReason = reason || 'Cancelled by business';
    }
    if (status === 'no_show') booking.notes = `${booking.notes}\nNo-show recorded`.trim();
    booking.history.push({ status, at: new Date(), by: userId, note: reason || '' });
    await booking.save();
    if (status === 'cancelled') {
      const refundable = Math.max(0, booking.amountPaidKobo - (booking.refundedKobo || 0));
      booking.cancellationType = 'business';
      booking.cancellationPenaltyKobo = 0;
      booking.cancellationRefundKobo = refundable;
      await booking.save();
      if (refundable >= 100) await this.payments.refundBooking(businessId, String(booking._id), refundable).catch(() => undefined);
      await this.waitlist.offerOpening(businessId, booking.serviceId, booking.startAt).catch(() => undefined);
      void this.calendarSync.removeBooking(booking).catch(() => undefined);
    }
    return this.view(booking);
  }

  async cancel(userId: string, businessId: string, id: string, dto: CancelBookingDto) {
    return this.updateStatus(userId, businessId, id, 'cancelled', dto.reason);
  }

  async cancelPublic(token: string, dto: CancelBookingDto) {
    const booking = await this.bookings.findOne({ publicToken: token }).exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    if (['cancelled', 'completed'].includes(booking.status)) throw new BadRequestException('This booking can no longer be cancelled.');
    const business = await this.businesses.findById(booking.businessId).lean().exec();
    const settings = business?.bookingSettings;
    const windowHours = settings?.cancellationWindowHours ?? 24;
    const isLate = booking.startAt.getTime() - Date.now() < windowHours * 3600000;
    const penaltyType = settings?.lateCancellationPenaltyType || 'none';
    if (isLate && penaltyType === 'none') {
      throw new BadRequestException(`Online cancellation closes ${windowHours} hours before the appointment. Please contact the business.`);
    }
    const paid = Math.max(0, booking.amountPaidKobo - (booking.refundedKobo || 0));
    let assessedPenalty = 0;
    if (isLate) {
      assessedPenalty = penaltyType === 'fixed'
        ? Math.max(0, settings?.lateCancellationPenaltyKobo || 0)
        : Math.round((booking.priceKobo * Math.max(0, settings?.lateCancellationPenaltyPercent || 0)) / 100);
    }
    const penalty = Math.min(paid, assessedPenalty);
    const refund = Math.max(0, paid - penalty);
    booking.status = 'cancelled';
    booking.cancelledAt = new Date();
    booking.cancellationReason = dto.reason || (isLate ? 'Late cancellation by customer' : 'Cancelled by customer');
    booking.cancellationType = isLate ? 'late' : 'free';
    booking.cancellationPenaltyKobo = penalty;
    booking.cancellationRefundKobo = refund;
    booking.history.push({ status: 'cancelled', at: new Date(), by: 'customer', note: booking.cancellationReason });
    await booking.save();
    if (refund >= 100) await this.payments.refundBooking(booking.businessId, String(booking._id), refund).catch(() => undefined);
    await this.waitlist.offerOpening(booking.businessId, booking.serviceId, booking.startAt).catch(() => undefined);
    void this.calendarSync.removeBooking(booking).catch(() => undefined);
    return { cancelled: true, booking: this.view(booking), cancellation: { type: isLate ? 'late' : 'free', penaltyKobo: penalty, refundKobo: refund, windowHours } };
  }

  async reschedule(userId: string, businessId: string, id: string, dto: RescheduleBookingDto) {
    const booking = await this.bookings.findOne({ _id: id, businessId }).exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    return this.applyReschedule(booking, dto, userId);
  }

  async reschedulePublic(token: string, dto: RescheduleBookingDto) {
    const booking = await this.bookings.findOne({ publicToken: token }).exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    const business = await this.businesses.findById(booking.businessId).lean().exec();
    if (business?.bookingSettings?.cancellationWindowHours && booking.startAt.getTime() - Date.now() < business.bookingSettings.cancellationWindowHours * 3600000) {
      throw new BadRequestException('Online changes are closed for this appointment. Please contact the business.');
    }
    return this.applyReschedule(booking, dto, null);
  }

  private async applyReschedule(booking: BookingDocument, dto: RescheduleBookingDto, userId: string | null) {
    const oldStartAt = booking.startAt;
    if (['cancelled', 'completed'].includes(booking.status)) throw new BadRequestException('This booking cannot be rescheduled.');
    const service = await this.services.findOne({ _id: booking.serviceId, businessId: booking.businessId }).lean().exec();
    if (!service) throw new NotFoundException('Service not found.');
    const providerId = dto.providerId || booking.providerId;
    const provider = await this.providers.findOne({ _id: providerId, businessId: booking.businessId, isActive: true, isBookable: true }).lean().exec();
    if (!provider) throw new NotFoundException('Team member not found.');
    const startAt = new Date(dto.startAt);
    if (Number.isNaN(startAt.getTime())) throw new BadRequestException('Choose a valid time.');
    await this.availability.assertSlot(booking.businessId, booking.serviceId, startAt, providerId, booking.timezone);
    const duration = booking.durationMinutes;
    const blockStartAt = addMinutes(startAt, -(booking.bufferBeforeMinutes || 0));
    const blockEndAt = addMinutes(addMinutes(startAt, duration), booking.bufferAfterMinutes || 0);
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const conflict = await this.bookings.find({
          _id: { $ne: booking._id }, businessId: booking.businessId, providerId,
          status: { $in: ['pending', 'confirmed'] },
          blockStartAt: { $lt: blockEndAt }, blockEndAt: { $gt: blockStartAt },
        }).session(session).lean().exec();
        if (conflict.length) throw new ConflictException('That time is not available.');
        booking.startAt = startAt;
        booking.endAt = addMinutes(startAt, duration);
        booking.blockStartAt = blockStartAt;
        booking.blockEndAt = blockEndAt;
        booking.providerId = String(provider._id);
        booking.providerName = provider.name;
        booking.providerAvatarUrl = provider.avatarUrl || null;
        booking.providerColor = provider.color || null;
        booking.status = booking.status === 'pending' ? 'pending' : 'confirmed';
        booking.history.push({ status: 'rescheduled', at: new Date(), by: userId, note: `Moved to ${startAt.toISOString()}` });
        await booking.save({ session });
      });
    } finally {
      await session.endSession();
    }
    await this.waitlist.offerOpening(booking.businessId, booking.serviceId, oldStartAt).catch(() => undefined);
    void this.calendarSync.resyncBooking(booking).catch(() => undefined);
    return this.view(booking);
  }

  async roster(businessId: string, id: string) {
    const booking = await this.bookings.findOne({ _id: id, businessId }).lean().exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    const start = new Date(booking.startAt);
    const items = await this.bookings.find({
      businessId, serviceId: booking.serviceId,
      startAt: { $gte: new Date(start.getTime() - 60000), $lte: new Date(start.getTime() + 60000) },
      status: { $ne: 'cancelled' },
    }).sort({ customerName: 1 }).lean().exec();
    return {
      bookingId: booking._id.toString(), startAt: booking.startAt, capacity: booking.capacity || 1,
      booked: items.length,
      items: items.map((item) => ({
        id: item._id.toString(), bookingNumber: item.bookingNumber, customerName: item.customerName,
        customerPhone: item.customerPhone, status: item.status, paymentStatus: item.paymentStatus,
      })),
    };
  }

  async complete(
    userId: string,
    businessId: string,
    id: string,
    opts?: { workerCount?: number; secondProviderId?: string },
  ) {
    const booking = await this.bookings.findOne({ _id: id, businessId }).exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.status === 'cancelled') throw new BadRequestException('A cancelled booking cannot be completed.');
    if (booking.packagePurchaseId) {
      if (booking.status === 'completed') return this.view(booking);
      booking.status = 'completed';
      booking.completedAt = new Date();
      if (!booking.reviewToken) booking.reviewToken = randomToken(24);
      booking.history.push({ status: 'completed', at: new Date(), by: userId, note: `Package ${booking.packageCode}` });
      await booking.save();
      const packageBusiness = await this.businesses.findById(businessId).lean().exec();
      if (packageBusiness) await this.sendReviewRequest(booking, packageBusiness as unknown as BusinessDocument).catch(() => undefined);
      return this.view(booking);
    }
    if (booking.status === 'completed' && booking.saleId) return this.view(booking);
    if (!booking.customerId) throw new BadRequestException('This booking has no customer record.');
    const session = await this.connection.startSession();
    let sale: SaleDocument | null = null;
    let debtId: string | null = null;
    try {
      await session.withTransaction(async () => {
        const saleNumber = await nextSequence(
          this.counters as unknown as Model<Record<string, unknown>>,
          businessId,
          'sale',
          'SALE',
        );
        const total = booking.priceKobo;
        const paid = Math.min(total, booking.amountPaidKobo);
        const status = paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
        const [createdSale] = await this.sales.create([{
          businessId,
          saleNumber,
          customerId: booking.customerId,
          customerName: booking.customerName,
          customerPhone: booking.customerPhone,
          customerEmail: booking.customerEmail,
          items: [{
            productId: `service:${booking.serviceId}`,
            variantId: null,
            name: booking.serviceName,
            variantName: booking.addOns.map((a) => a.name).join(', '),
            sku: '',
            quantity: booking.quantity || 1,
            unitPriceKobo: Math.round(total / Math.max(1, booking.quantity || 1)),
            unitCostKobo: 0,
            discountKobo: 0,
            lineTotalKobo: total,
            lineCostKobo: 0,
            imageUrl: booking.serviceImageUrl,
          }],
          subtotalKobo: total,
          discountKobo: 0,
          deliveryFeeKobo: 0,
          totalKobo: total,
          costKobo: 0,
          grossProfitKobo: total,
          amountPaidKobo: paid,
          paymentStatus: status,
          paymentMethod: paid > 0 ? 'paystack' : 'cash',
          notes: `Service booking ${booking.bookingNumber}`,
          source: 'booking',
          soldAt: booking.startAt,
          createdBy: userId,
        }], { session });
        sale = createdSale;
        if (paid < total && booking.customerId) {
          const debt = await this.debts.createWithinTransaction({
            businessId,
            customerId: booking.customerId,
            customerName: booking.customerName,
            customerPhone: booking.customerPhone,
            customerEmail: booking.customerEmail,
            amountKobo: total - paid,
            dueDate: new Date(Date.now() + 7 * 86400000),
            saleId: createdSale._id.toString(),
            notes: `Balance from service booking ${booking.bookingNumber}`,
            createdBy: userId,
          }, session);
          debtId = debt._id.toString();
          createdSale.debtId = debtId;
          await createdSale.save({ session });
        }
        await this.customers.updateOne(
          { _id: booking.customerId, businessId },
          { $inc: { totalSpentKobo: total, orderCount: 1 }, $set: { lastPurchaseAt: new Date() } },
          { session },
        ).exec();
        const workerCount = (opts?.workerCount === 2) ? 2 : (booking.workerCount || 1);
        const workerPayoutPerPerson = calculateWorkerPayout(booking.serviceName, workerCount as 1 | 2);
        const workerBreakdown = [
          { providerId: booking.providerId, providerName: booking.providerName, amountKobo: workerPayoutPerPerson },
        ];
        const workerIds = [booking.providerId];
        if (workerCount === 2) {
          const secondId = opts?.secondProviderId || (booking.workerIds && booking.workerIds[1]);
          if (secondId) {
            const secondProvider = await this.providers.findById(secondId).lean().exec();
            if (secondProvider) {
              workerIds.push(String(secondProvider._id));
              workerBreakdown.push({
                providerId: String(secondProvider._id),
                providerName: secondProvider.name,
                amountKobo: workerPayoutPerPerson,
              });
            }
          }
        }
        booking.workerCount = workerCount;
        booking.workerPayoutKobo = workerPayoutPerPerson * workerBreakdown.length;
        booking.workerIds = workerIds;
        booking.workerBreakdown = workerBreakdown;

        booking.status = 'completed';
        booking.completedAt = new Date();
        booking.saleId = createdSale._id.toString();
        if (!booking.reviewToken) booking.reviewToken = randomToken(24);
        booking.history.push({ status: 'completed', at: new Date(), by: userId, note: saleNumber });
        await booking.save({ session });
        await this.businesses.updateOne(
          { _id: businessId, firstSaleAt: null },
          { $set: { firstSaleAt: new Date() } },
          { session },
        ).exec();
      });
    } finally {
      await session.endSession();
    }
    if (sale) {
      try {
        const receipt = await this.receipts.createForSale(sale, true);
        await this.sales.updateOne({ _id: (sale as SaleDocument)._id }, { $set: { receiptId: receipt._id.toString() } }).exec();
      } catch (error) {
        this.logger.warn(`Service receipt failed: ${error instanceof Error ? error.message : 'unknown'}`);
      }
    }
    const businessForReview = await this.businesses.findById(businessId).lean().exec();
    if (businessForReview) await this.sendReviewRequest(booking, businessForReview as unknown as BusinessDocument).catch(() => undefined);
    return this.view(booking);
  }

  private async sendReviewRequest(booking: BookingDocument, business: BusinessDocument) {
    if (!booking.reviewToken || booking.reviewedAt || booking.reviewRequestedAt) return;
    const link = `${this.config.get('appUrl')}/review/${booking.reviewToken}`;
    await this.notifications.create({
      businessId: booking.businessId, type: 'booking', tone: 'info',
      title: `Review request ready · ${booking.bookingNumber}`,
      message: `${booking.customerName} can now review ${booking.serviceName}.`,
      data: { bookingId: booking._id.toString(), reviewUrl: link },
    });
    const channels: string[] = [];
    if (booking.customerEmail) {
      const review = bookingReviewEmail({
        customerName: booking.customerName, businessName: business.name,
        businessLogo: business.logoUrl, businessTagline: business.tagline, businessSlug: business.slug,
        serviceName: booking.serviceName, providerName: booking.providerName, reviewUrl: link,
        policy: business.bookingSettings?.policy || null,
      });
      await this.mail.send({
        to: booking.customerEmail,
        subject: review.subject,
        html: review.html,
        template: 'booking_review_request',
        businessId: booking.businessId,
      }).catch(() => undefined);
      channels.push('email');
    }
    if (booking.customerPhone) {
      await this.whatsapp.sendTextDirect(
        booking.businessId,
        booking.customerPhone,
        `Hi ${booking.customerName.split(' ')[0]}! How was your ${booking.serviceName} with ${business.name}? Leave a quick review here: ${link}`,
      ).catch(() => undefined);
      channels.push('whatsapp');
    }
    booking.reviewRequestedAt = new Date();
    booking.reviewRequestChannel = channels.join('+') || 'none';
    await booking.save();
  }

  private async resolveProvider(businessId: string, service: ServiceDocument | (Service & { _id: unknown }), providerId?: string) {
    const filter: Record<string, unknown> = { businessId, isActive: true, isBookable: true };
    if (providerId) {
      if (service.providerIds?.length && !service.providerIds.includes(providerId)) {
        throw new BadRequestException('That team member does not offer this service.');
      }
      filter._id = providerId;
    }
    else if (service.providerIds?.length) filter._id = { $in: service.providerIds };
    const provider = await this.providers.findOne(filter).sort({ sortOrder: 1 }).lean().exec();
    if (!provider) throw new BadRequestException('No team member is available for this service.');
    return provider;
  }

  private selectedAddOns(service: ServiceDocument | (Service & { _id: unknown }), names: string[]) {
    const available = service.addOns || [];
    return names.map((name) => {
      const addon = available.find((a) => a.name === name);
      if (!addon) throw new BadRequestException(`Add-on “${name}” is not available.`);
      return { name: addon.name, priceKobo: addon.priceKobo, durationMinutes: addon.durationMinutes || 0 };
    });
  }

  private normalDate(value: string) {
    const d = new Date(value);
    return !Number.isNaN(d.getTime()) ? d : null;
  }

  private async sendBookingMessages(booking: BookingDocument, business: BusinessDocument, when: string) {
    const provider = await this.providers.findById(booking.providerId).lean().exec();
    const providerPhone = provider?.phone || business.whatsappNumber || business.publicPhone;
    const bookingUrl = `${this.config.get('appUrl')}/booking/${booking.publicToken}`;

    const room = (booking as any).roomNumber ? String((booking as any).roomNumber).trim() : '';
    const loc = booking.location ? booking.location.trim() : '';
    const locationAndRoom = [loc, room ? `Room ${room.replace(/^room\s*/i, '')}` : ''].filter(Boolean).join(' · ');

    const locationLine = locationAndRoom ? `\n🚪 *Room / Location:* ${locationAndRoom}` : '';
    const phoneLine = `\n📞 *Customer Phone:* ${booking.customerPhone}`;
    const notesLine = booking.notes ? `\n📝 *Notes:* ${booking.notes}` : '';
    const payStatus = booking.paymentStatus === 'paid' ? 'Paid' : booking.amountPaidKobo > 0 ? `Partial · ${formatNaira(booking.amountPaidKobo)} paid` : 'Unpaid';

    const providerText = `*🔔 New Booking · ${business.name}*

👤 *Customer:* ${booking.customerName}${phoneLine}${locationLine}
🛠 *Service:* ${booking.serviceName}
👷 *Assigned to:* ${booking.providerName}
📅 *When:* ${when}
💰 *Total:* ${formatNaira(booking.priceKobo)} (${payStatus})
🔖 *Booking Ref:* ${booking.bookingNumber}${notesLine}

🔗 *View booking:*
${bookingUrl}`;

    const customerText = `*✅ Booking Confirmed · ${business.name}*

Hi ${booking.customerName.split(' ')[0]}! Your booking with ${business.name} is confirmed:

🛠 *Service:* ${booking.serviceName}
👷 *Provider:* ${booking.providerName}
📅 *When:* ${when}${locationLine}
💰 *Total:* ${formatNaira(booking.priceKobo)}
🔖 *Booking Ref:* ${booking.bookingNumber}

🔗 *Manage booking:*
${bookingUrl}`;

    const send = async (phone: string | null | undefined, text: string) => {
      if (!phone) return;
      const result = await this.whatsapp.send({ businessId: booking.businessId, phone, text }).catch(() => ({ sent: false }));
      if (!result.sent) await this.sms.send({ to: phone, message: text }).catch(() => undefined);
    };
    await Promise.all([send(providerPhone, providerText), send(booking.customerPhone, customerText)]);
  }

  private async sendConfirmation(booking: BookingDocument, business: BusinessDocument) {
    const when = new Intl.DateTimeFormat('en-NG', {
      timeZone: booking.timezone, weekday: 'short', day: 'numeric', month: 'short',
      hour: 'numeric', minute: '2-digit',
    }).format(booking.startAt);
    const dateLabel = new Intl.DateTimeFormat('en-NG', {
      timeZone: booking.timezone, weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
    }).format(booking.startAt);
    const timeLabel = new Intl.DateTimeFormat('en-NG', {
      timeZone: booking.timezone, hour: 'numeric', minute: '2-digit',
    }).format(booking.startAt);
    await this.notifications.create({
      businessId: booking.businessId,
      type: 'booking',
      title: `Booking confirmed · ${booking.bookingNumber}`,
      message: `${booking.customerName} · ${booking.serviceName} · ${when}`,
      tone: 'success',
      data: { bookingId: booking._id.toString(), publicToken: booking.publicToken },
    });
    await this.sendBookingMessages(booking, business, when).catch(() => undefined);
    if (booking.customerEmail) {
      const confirmation = bookingConfirmedEmail({
        customerName: booking.customerName, businessName: business.name,
        businessLogo: business.logoUrl, businessTagline: business.tagline, businessSlug: business.slug,
        serviceName: booking.serviceName, providerName: booking.providerName,
        dateLabel, timeLabel, durationMinutes: booking.durationMinutes, reference: booking.bookingNumber, location: booking.location || null,
        manageUrl: `${this.config.get('appUrl')}/booking/${booking.publicToken}`,
        calendarUrl: `${this.config.get('apiUrl')}/public/bookings/${booking.publicToken}/calendar.ics`,
        priceKobo: booking.priceKobo, depositKobo: booking.depositKobo || 0,
        policy: business.bookingSettings?.policy || null,
      });
      await this.mail.send({
        to: booking.customerEmail,
        subject: confirmation.subject,
        html: confirmation.html,
        template: 'booking_confirmation',
        businessId: booking.businessId,
      });
    }
  }

  private view(b: BookingDocument | (Booking & { _id: unknown })) {
    const booking = b as BookingDocument;
    return {
      id: String(booking._id),
      bookingNumber: booking.bookingNumber,
      publicToken: booking.publicToken,
      serviceId: booking.serviceId,
      serviceName: booking.serviceName,
      serviceCategory: booking.serviceCategory,
      serviceImageUrl: booking.serviceImageUrl,
      providerId: booking.providerId,
      providerName: booking.providerName,
      providerAvatarUrl: booking.providerAvatarUrl,
      providerColor: booking.providerColor,
      customerId: booking.customerId,
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      customerEmail: booking.customerEmail,
      startAt: booking.startAt,
      endAt: booking.endAt,
      durationMinutes: booking.durationMinutes,
      quantity: booking.quantity || 1,
      quantityLabel: booking.quantityLabel || '',
      unitPriceKobo: booking.unitPriceKobo || 0,
      capacity: booking.capacity || 1,
      packagePurchaseId: booking.packagePurchaseId,
      packageCode: booking.packageCode,
      packageName: booking.packageName,
      packageValueKobo: booking.packageValueKobo || 0,
      marketplaceCampus: booking.marketplaceCampus,
      marketplaceFeePercent: booking.marketplaceFeePercent || 0,
      marketplaceFeeKobo: booking.marketplaceFeeKobo || 0,
      customRequestId: booking.customRequestId || null,
      timezone: booking.timezone,
      addOns: booking.addOns,
      status: booking.status,
      source: booking.source,
      notes: booking.notes,
      discountKobo: booking.discountKobo || 0,
      promotionLabel: booking.promotionLabel || null,
      location: booking.location || '',
      roomNumber: (booking as any).roomNumber || '',
      workerPayoutKobo: (booking as any).workerPayoutKobo || 0,
      workerCount: (booking as any).workerCount || 1,
      workerIds: (booking as any).workerIds || [],
      workerBreakdown: (booking as any).workerBreakdown || [],
      subtotalKobo: booking.subtotalKobo || booking.priceKobo,
      serviceChargeKobo: booking.serviceChargeKobo || 0,
      serviceChargePercent: booking.serviceChargePercent || 0,
      priceKobo: booking.priceKobo,
      depositKobo: booking.depositKobo,
      amountPaidKobo: booking.amountPaidKobo,
      refundedKobo: booking.refundedKobo || 0,
      paymentStatus: booking.paymentStatus,
      paymentMethod: (booking as any).paymentMethod || null,
      transferSenderName: (booking as any).transferSenderName || null,
      transferVerifiedAt: (booking as any).transferVerifiedAt || null,
      transferRejectionReason: (booking as any).transferRejectionReason || null,
      paymentReference: booking.paymentReference,
      seriesId: booking.seriesId,
      seriesIndex: booking.seriesIndex,
      seriesTotal: booking.seriesTotal,
      reviewToken: booking.reviewToken,
      reviewedAt: booking.reviewedAt,
      saleId: booking.saleId,
      cancellationReason: booking.cancellationReason,
      cancellationType: booking.cancellationType || null,
      cancellationPenaltyKobo: booking.cancellationPenaltyKobo || 0,
      cancellationRefundKobo: booking.cancellationRefundKobo || 0,
      cancelledAt: booking.cancelledAt,
      completedAt: booking.completedAt,
      history: booking.history,
      createdAt: booking.createdAt,
    };
  }
}
