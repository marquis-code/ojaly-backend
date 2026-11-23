import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Service, ServiceDocument } from '../services/service.schema';
import { Customer, CustomerDocument } from '../customers/customer.schema';
import { MailService } from '../mail/mail.service';
import { waitlistOpeningEmail } from '../mail/email-templates';
import { NotificationsService } from '../notifications/notifications.service';
import { WhatsappClientService } from '../whatsapp/whatsapp-client.service';
import { SmsService } from '../sms/sms.service';
import { normalizeNigerianPhone } from '../../common/utils/phone';
import { sanitizeText } from '../../common/utils/sanitize';
import { formatNaira } from '../../common/utils/money';
import { CreateWaitlistDto, WaitlistQueryDto } from './waitlist.dto';
import { WaitlistEntry, WaitlistDocument, WaitlistStatus } from './waitlist.schema';

@Injectable()
export class WaitlistService {
  constructor(
    @InjectModel(WaitlistEntry.name) private readonly entries: Model<WaitlistDocument>,
    @InjectModel(Service.name) private readonly services: Model<ServiceDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly whatsapp: WhatsappClientService,
    private readonly sms: SmsService,
  ) {}

  async join(businessId: string, dto: CreateWaitlistDto) {
    const service = await this.services.findOne({ _id: dto.serviceId, businessId, isActive: true, isPublic: true }).lean().exec();
    if (!service) throw new NotFoundException('Service not found.');
    const phone = normalizeNigerianPhone(dto.customerPhone);
    if (!phone) throw new BadRequestException('Enter a valid Nigerian phone number.');
    const from = this.localDate(dto.preferredFrom);
    const to = dto.days ? new Date(from.getTime() + (dto.days - 1) * 86400000) : this.localDate(dto.preferredTo || dto.preferredFrom);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new BadRequestException('Choose a valid date range.');
    if (to < from) throw new BadRequestException('The end of your preferred window must be after the start.');
    if (to.getTime() - from.getTime() > 90 * 86400000) throw new BadRequestException('Choose a waitlist window of 90 days or less.');
    const existing = await this.entries.findOne({ businessId, serviceId: dto.serviceId, customerPhone: phone, status: { $in: ['waiting', 'notified'] } }).lean().exec();
    if (existing) return { ...this.view(existing), already: true };
    const business = await this.businesses.findById(businessId).lean().exec();
    let customer = await this.customers.findOne({ businessId, phone }).exec();
    if (!customer) customer = await this.customers.create({ businessId, name: sanitizeText(dto.customerName, 100), phone, email: dto.customerEmail || null, totalSpentKobo: 0, outstandingKobo: 0, walletBalanceKobo: 0 });
    const paymentEnabled = Boolean(business?.bookingSettings?.waitlistPaymentEnabled) && service.priceKobo > 0;
    const amountKobo = paymentEnabled ? (service.requiresDeposit ? Math.min(service.priceKobo, service.depositKobo || 0) : service.priceKobo) : 0;
    const entry = await this.entries.create({
      businessId,
      serviceId: service._id.toString(),
      serviceName: service.name,
      providerId: dto.providerId || null,
      providerName: null,
      customerId: customer?._id.toString() || null,
      customerName: sanitizeText(dto.customerName, 100),
      customerPhone: phone,
      customerEmail: dto.customerEmail || null,
      preferredFrom: from,
      preferredTo: to,
      preferredStartAt: dto.preferredStartAt ? new Date(dto.preferredStartAt) : null,
      notes: sanitizeText(dto.notes, 500),
      status: 'waiting',
      amountKobo,
      paymentStatus: amountKobo > 0 ? 'unpaid' : 'not_required',
    });
    await this.notifications.create({
      businessId, type: 'booking', tone: 'info',
      title: 'New waitlist request',
      message: `${entry.customerName} wants ${service.name} between ${dto.preferredFrom} and ${to.toISOString().slice(0, 10)}.`,
      data: { waitlistId: entry._id.toString() },
    });
    if (amountKobo <= 0) await this.notifyVendor(entry, business as unknown as BusinessDocument);
    return this.view(entry);
  }

  async list(businessId: string, query: WaitlistQueryDto) {
    const filter: Record<string, unknown> = { businessId };
    if (query.status && query.status !== 'all') filter.status = query.status;
    const entries = await this.entries.find(filter).sort({ preferredFrom: 1, createdAt: 1 }).limit(200).lean().exec();
    return entries.map((entry) => this.view(entry));
  }

  async setStatus(businessId: string, id: string, status: WaitlistStatus) {
    const entry = await this.entries.findOneAndUpdate({ _id: id, businessId }, { $set: { status } }, { new: true }).lean().exec();
    if (!entry) throw new NotFoundException('Waitlist request not found.');
    return this.view(entry);
  }

  async notify(businessId: string, id: string) {
    const entry = await this.entries.findOne({ _id: id, businessId }).exec();
    if (!entry) throw new NotFoundException('Waitlist request not found.');
    const [business, service] = await Promise.all([
      this.businesses.findById(businessId).lean().exec(),
      this.services.findOne({ _id: entry.serviceId, businessId }).lean().exec(),
    ]);
    const when = `${entry.preferredFrom.toISOString().slice(0, 10)} – ${entry.preferredTo.toISOString().slice(0, 10)}`;
    const link = `${this.configUrl()}/s/${business?.slug || ''}/services/${entry.serviceId}`;
    if (entry.customerEmail) {
      const email = waitlistOpeningEmail({
        customerName: entry.customerName, businessName: business?.name || 'your business',
        businessLogo: business?.logoUrl, businessTagline: business?.tagline, businessSlug: business?.slug,
        serviceName: entry.serviceName, windowLabel: when, bookingUrl: link,
      });
      await this.mail.send({
        to: entry.customerEmail,
        subject: email.subject,
        html: email.html,
        template: 'waitlist_opening',
        businessId,
      }).catch(() => undefined);
    }
    if (entry.customerPhone) {
      const whatsapp = await this.whatsapp.send({
        businessId,
        phone: entry.customerPhone,
        text: `Hi ${entry.customerName}! A spot may have opened for ${entry.serviceName} (${when}). Book: ${link}`,
      }).catch(() => ({ sent: false }));
      if (!whatsapp.sent && !entry.customerEmail) {
        await this.sms.send({
          to: entry.customerPhone,
          message: `${business?.name || 'Ojaly'}: a spot may have opened for ${entry.serviceName}. Book: ${link}`,
        }).catch(() => undefined);
      }
    }
    entry.status = 'notified';
    entry.notifiedAt = new Date();
    await entry.save();
    return this.view(entry);
  }

  async offerOpening(businessId: string, serviceId: string, startAt: Date) {
    const entries = await this.entries.find({
      businessId, serviceId, status: 'waiting',
      preferredFrom: { $lte: startAt }, preferredTo: { $gte: startAt },
    }).sort({ preferredFrom: 1, createdAt: 1 }).limit(3).exec();
    let notified = 0;
    for (const entry of entries) {
      try { await this.notify(businessId, entry._id.toString()); notified++; } catch { /* keep the rest of the list intact */ }
    }
    return { notified };
  }

  async refundToWallet(businessId: string, id: string) {
    const entry = await this.entries.findOne({ _id: id, businessId }).exec();
    if (!entry) throw new NotFoundException('Waitlist request not found.');
    if (entry.paymentStatus !== 'paid') throw new BadRequestException('This waitlist payment is not eligible for a wallet refund.');
    const amount = Math.max(0, entry.amountKobo - (entry.refundedKobo || 0));
    if (amount < 100) throw new BadRequestException('There is no refundable balance.');
    const customer = entry.customerId
      ? await this.customers.findOne({ _id: entry.customerId, businessId }).exec()
      : await this.customers.findOne({ businessId, phone: entry.customerPhone }).exec();
    if (!customer) throw new BadRequestException('Customer wallet not found.');
    customer.walletBalanceKobo = (customer.walletBalanceKobo || 0) + amount;
    customer.walletTransactions = [...(customer.walletTransactions || []), { amountKobo: amount, type: 'credit', reason: `Waitlist refund · ${entry.serviceName}`, reference: entry.paymentReference || undefined, createdAt: new Date() }].slice(-100);
    await customer.save();
    entry.refundedKobo = (entry.refundedKobo || 0) + amount;
    entry.paymentStatus = 'refunded';
    entry.status = 'cancelled';
    await entry.save();
    return { ...this.view(entry), walletCreditedKobo: amount };
  }

  private async notifyVendor(entry: WaitlistDocument, business?: BusinessDocument) {
    if (!business) return;
    const phone = business.whatsappNumber || business.publicPhone;
    if (!phone) return;
    const when = `${entry.preferredFrom.toISOString().slice(0, 10)} – ${entry.preferredTo.toISOString().slice(0, 10)}`;
    const pay = entry.paymentStatus === 'paid' ? ` Payment received: ${formatNaira(entry.amountKobo)}.` : '';
    await this.whatsapp.sendTextDirect(
      entry.businessId,
      phone,
      `🕒 New waitlist request${pay}

${entry.customerName} (${entry.customerPhone}) wants ${entry.serviceName} between ${when}.

Open the waitlist in Ojaly: ${this.configUrl()}/app/bookings/waitlist`,
    ).catch(() => undefined);
  }

  async remove(businessId: string, id: string) {
    const result = await this.entries.deleteOne({ _id: id, businessId }).exec();
    if (!result.deletedCount) throw new NotFoundException('Waitlist request not found.');
    return { removed: true };
  }

  private localDate(value: string) {
    return new Date(value.length === 10 ? `${value}T00:00:00+01:00` : value);
  }

  private configUrl() {
    return process.env.APP_URL || 'https://ojaly.org';
  }

  private view(entry: WaitlistEntry | (WaitlistEntry & { _id: unknown })) {
    const e = entry as WaitlistEntry & { _id: unknown };
    return {
      id: String(e._id), serviceId: e.serviceId, serviceName: e.serviceName,
      providerId: e.providerId, providerName: e.providerName,
      customerName: e.customerName, customerPhone: e.customerPhone, customerEmail: e.customerEmail,
      preferredFrom: e.preferredFrom, preferredTo: e.preferredTo, preferredStartAt: e.preferredStartAt,
      notes: e.notes, status: e.status, notifiedAt: e.notifiedAt, customerId: e.customerId,
      paymentStatus: e.paymentStatus || 'not_required', amountKobo: e.amountKobo || 0,
      paymentReference: e.paymentReference || null, paidAt: e.paidAt || null, refundedKobo: e.refundedKobo || 0, createdAt: e.createdAt,
    };
  }
}
