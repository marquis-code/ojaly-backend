import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
import { addMinutes, localDateKey } from './booking.utils';
import { resolveDateRange, humanRangeLabel, DateRangePreset } from '../../common/utils/dates';
import { addDays, addMonths } from 'date-fns';
import {
  BookingQueryDto, BookingMetricsQueryDto, CancelBookingDto, CreateBookingDto, CreateRecurringBookingDto, RescheduleBookingDto,
} from './booking.dto';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

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
    private readonly packages: PackagesService,
    private readonly calendarSync: CalendarService,
    private readonly config: ConfigService,
  ) {}

  async list(businessId: string, query: BookingQueryDto) {
    const business = await this.businesses.findById(businessId).lean().exec();
    if (!business) throw new NotFoundException('Business not found.');
    const filter: FilterQuery<BookingDocument> = { businessId };
    if (query.status && query.status !== 'all') filter.status = query.status;
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
      if (query.from) filter.startAt = { ...(filter.startAt || {}), $gte: new Date(query.from) };
      if (query.to) filter.startAt = { ...(filter.startAt || {}), $lte: new Date(query.to) };
    }
    const page = query.page || 1;
    const limit = query.limit || 100;
    const [items, total] = await Promise.all([
      this.bookings.find(filter).sort({ startAt: 1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      this.bookings.countDocuments(filter).exec(),
    ]);
    const today = localDateKey(new Date(), business.timezone || 'Africa/Lagos');
    const todayStart = new Date(`${today}T00:00:00+01:00`);
    const todayEnd = new Date(`${today}T23:59:59+01:00`);
    const [todayCount, upcomingCount, pendingCount] = await Promise.all([
      this.bookings.countDocuments({ businessId, startAt: { $gte: todayStart, $lte: todayEnd }, status: { $nin: ['cancelled'] } }).exec(),
      this.bookings.countDocuments({ businessId, startAt: { $gte: new Date() }, status: { $in: ['pending', 'confirmed'] } }).exec(),
      this.bookings.countDocuments({ businessId, status: 'pending' }).exec(),
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
    const provider = await this.resolveProvider(businessId, service, dto.providerId);
    const addOns = this.selectedAddOns(service, dto.addOnNames || []);
    const packageRedemption = dto.packageCode ? await this.packages.validateRedemption(businessId, dto.packageCode, service._id.toString(), phone) : null;
    const marketplaceCampus = dto.marketplaceCampus ? { code: dto.marketplaceCampus.trim().toUpperCase() } : null;
    const effectiveSource = marketplaceCampus ? 'marketplace' : source;
    const addonMinutes = addOns.reduce((sum, a) => sum + (a.durationMinutes || 0), 0);
    const durationMinutes = overrides?.durationMinutes ?? service.durationMinutes + addonMinutes;
    const timezone = business.timezone || 'Africa/Lagos';
    await this.availability.assertSlot(businessId, service._id.toString(), startAt, String(provider._id), timezone, durationMinutes, { ignoreWindow: effectiveSource !== 'storefront' && effectiveSource !== 'marketplace' });

    const subtotalKobo = overrides?.priceKobo ?? service.priceKobo + addOns.reduce((sum, a) => sum + a.priceKobo, 0);

    let serviceChargeKobo = 0;
    const serviceChargePercent = business.serviceChargePercent || 0;
    if (business.serviceChargeEnabled) {
      if (business.serviceChargeType === 'fixed') {
        serviceChargeKobo = business.serviceChargeFixedKobo || 0;
      } else {
        serviceChargeKobo = Math.round((subtotalKobo * serviceChargePercent) / 100);
      }
    }

    let providerFeeKobo = 0;
    const providerFeePercent = business.providerFeePercent || 0;
    if (business.providerFeeEnabled && subtotalKobo > 0) {
      if (business.providerFeeType === 'fixed') providerFeeKobo = Math.min(subtotalKobo, business.providerFeeFixedKobo || 0);
      else providerFeeKobo = Math.min(subtotalKobo, Math.round((subtotalKobo * providerFeePercent) / 100));
    }
    const providerNetKobo = Math.max(0, subtotalKobo - providerFeeKobo);
    const totalKobo = subtotalKobo + serviceChargeKobo;
    const packageValueKobo = packageRedemption ? totalKobo : 0;
    const chargeKobo = packageRedemption ? 0 : totalKobo;
    const marketplaceFeePercent = marketplaceCampus ? (business.marketplaceFeePercent ?? 5) : 0;
    const marketplaceFeeKobo = marketplaceCampus ? Math.round((chargeKobo * marketplaceFeePercent) / 100) : 0;
    const depositPercent = business.bookingSettings?.depositPercent || 0;
    const baseDeposit = packageRedemption ? 0 : overrides?.depositKobo !== undefined
      ? Math.min(subtotalKobo, Math.max(0, overrides.depositKobo))
      : service.requiresDeposit
        ? Math.min(subtotalKobo, service.depositKobo || Math.round((subtotalKobo * depositPercent) / 100))
        : 0;
    const collectFull = business.bookingSettings?.paymentCollection === 'full';
    const depositKobo = packageRedemption ? 0 : collectFull ? totalKobo : baseDeposit > 0 ? baseDeposit + serviceChargeKobo : 0;
    const shouldConfirm = packageRedemption ? true : Boolean(business.bookingSettings?.autoConfirm) && depositKobo <= 0;
    const blockStartAt = addMinutes(startAt, -(service.bufferBeforeMinutes || 0));
    const endAt = addMinutes(startAt, durationMinutes);
    const blockEndAt = addMinutes(endAt, service.bufferAfterMinutes || 0);

    const session = await this.connection.startSession();
    let created!: BookingDocument;
    let customerId: string | null = null;
    try {
      await session.withTransaction(async () => {
        const conflict = await this.bookings.find({
          businessId,
          providerId: String(provider._id),
          status: { $in: ['pending', 'confirmed'] },
          blockStartAt: { $lt: blockEndAt },
          blockEndAt: { $gt: blockStartAt },
        }).session(session).lean().exec();
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
          capacity: service.maxBookingsPerSlot || 1,
          bufferBeforeMinutes: service.bufferBeforeMinutes || 0,
          bufferAfterMinutes: service.bufferAfterMinutes || 0,
          timezone,
          addOns,
          status: shouldConfirm ? 'confirmed' : 'pending',
          source: effectiveSource,
          notes: sanitizeText(dto.notes, 2000),
          subtotalKobo: packageRedemption ? 0 : subtotalKobo,
          serviceChargeKobo: packageRedemption ? 0 : serviceChargeKobo,
          serviceChargePercent: business.serviceChargeEnabled ? serviceChargePercent : 0,
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
          paymentStatus: packageRedemption ? 'paid' : 'unpaid',
          paymentReference: packageRedemption ? `package:${packageRedemption.redemptionCode}` : null,
          seriesId: series?.id || null,
          seriesIndex: series?.index || 0,
          seriesTotal: series?.total || 1,
          createdBy: userId,
          history: [{ status: shouldConfirm ? 'confirmed' : 'pending', at: new Date(), by: userId, note: 'Booking created' }],
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
    if (notify) await this.notifications.create({
      businessId,
      type: 'booking',
      title: `New booking · ${created.bookingNumber}`,
      message: `${created.customerName} booked ${created.serviceName} with ${created.providerName}.`,
      tone: 'success',
      data: { bookingId: created._id.toString(), startAt: created.startAt.toISOString() },
    });
    if (notify) await this.sendConfirmation(created, business as unknown as BusinessDocument).catch(() => undefined);
    void this.calendarSync.pushBooking(created).catch(() => undefined);
    return this.view(created);
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

  async updateStatus(userId: string, businessId: string, id: string, status: BookingStatus, reason?: string) {
    if (status === 'completed') return this.complete(userId, businessId, id);
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
    const windowHours = business?.bookingSettings?.cancellationWindowHours ?? 24;
    if (booking.startAt.getTime() - Date.now() < windowHours * 3600000) {
      throw new BadRequestException(`Online cancellation closes ${windowHours} hours before the appointment. Please contact the business.`);
    }
    booking.status = 'cancelled';
    booking.cancelledAt = new Date();
    booking.cancellationReason = dto.reason || 'Cancelled by customer';
    booking.history.push({ status: 'cancelled', at: new Date(), by: 'customer', note: booking.cancellationReason });
    await booking.save();
    await this.waitlist.offerOpening(booking.businessId, booking.serviceId, booking.startAt).catch(() => undefined);
    void this.calendarSync.removeBooking(booking).catch(() => undefined);
    return { cancelled: true, booking: this.view(booking) };
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

  async recordPayment(bookingId: string, amountKobo: number, reference: string) {
    const booking = await this.bookings.findById(bookingId).exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.status === 'cancelled') throw new BadRequestException('This booking was cancelled.');
    booking.amountPaidKobo = Math.min(booking.priceKobo, booking.amountPaidKobo + amountKobo);
    booking.paymentStatus = booking.amountPaidKobo >= booking.priceKobo ? 'paid' : 'deposit_paid';
    booking.paymentReference = reference;
    if (booking.status === 'pending') booking.status = 'confirmed';
    booking.history.push({ status: 'payment', at: new Date(), by: 'paystack', note: `${amountKobo} kobo received` });
    await booking.save();
    return this.view(booking);
  }

  async complete(userId: string, businessId: string, id: string) {
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
            quantity: 1,
            unitPriceKobo: total,
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
    if (!booking.reviewToken) return;
    const link = `${this.config.get('appUrl')}/review/${booking.reviewToken}`;
    await this.notifications.create({
      businessId: booking.businessId, type: 'booking', tone: 'info',
      title: `Review request ready · ${booking.bookingNumber}`,
      message: `${booking.customerName} can now review ${booking.serviceName}.`,
      data: { bookingId: booking._id.toString(), reviewUrl: link },
    });
    if (!booking.customerEmail) return;
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
    });
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
    const providerText = `New booking with ${business.name}: ${booking.customerName} booked ${booking.serviceName} with ${booking.providerName} for ${when}. Ref ${booking.bookingNumber}. Total ${formatNaira(booking.priceKobo)}. View: ${bookingUrl}`;
    const customerText = `Booking confirmed with ${business.name}: ${booking.serviceName} with ${booking.providerName} on ${when}. Ref ${booking.bookingNumber}. Manage: ${bookingUrl}`;
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
        dateLabel, timeLabel, durationMinutes: booking.durationMinutes, reference: booking.bookingNumber,
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
      subtotalKobo: booking.subtotalKobo || booking.priceKobo,
      serviceChargeKobo: booking.serviceChargeKobo || 0,
      serviceChargePercent: booking.serviceChargePercent || 0,
      priceKobo: booking.priceKobo,
      depositKobo: booking.depositKobo,
      amountPaidKobo: booking.amountPaidKobo,
      refundedKobo: booking.refundedKobo || 0,
      paymentStatus: booking.paymentStatus,
      paymentReference: booking.paymentReference,
      seriesId: booking.seriesId,
      seriesIndex: booking.seriesIndex,
      seriesTotal: booking.seriesTotal,
      reviewToken: booking.reviewToken,
      reviewedAt: booking.reviewedAt,
      saleId: booking.saleId,
      cancellationReason: booking.cancellationReason,
      cancelledAt: booking.cancelledAt,
      completedAt: booking.completedAt,
      history: booking.history,
      createdAt: booking.createdAt,
    };
  }
}
