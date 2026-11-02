import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Service, ServiceDocument } from '../services/service.schema';
import { BookingsService } from '../bookings/bookings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { emailLayout } from '../mail/email-templates';
import { normalizeNigerianPhone } from '../../common/utils/phone';
import { sanitizeText } from '../../common/utils/sanitize';
import { redactContactDetails } from '../../common/utils/redact-contact';
import { formatNaira } from '../../common/utils/money';
import { randomToken } from '../../common/utils/tokens';
import { CustomRequest, CustomRequestDocument, CustomRequestQuote } from './custom-request.schema';
import { CreateCustomQuoteDto, CreateCustomRequestDto } from './custom-request.dto';

@Injectable()
export class CustomRequestsService {
  constructor(
    @InjectModel(CustomRequest.name) private readonly requests: Model<CustomRequestDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Service.name) private readonly services: Model<ServiceDocument>,
    private readonly bookings: BookingsService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
  ) {}

  async createPublic(slug: string, dto: CreateCustomRequestDto) {
    const business = await this.businesses.findOne({ slug: slug.toLowerCase(), storefrontPublished: true }).lean().exec();
    if (!business) throw new NotFoundException('Business not found.');
    const service = await this.services.findOne({ _id: dto.serviceId, businessId: business._id.toString(), isActive: true, isPublic: true }).lean().exec();
    if (!service) throw new NotFoundException('Service not found.');
    const phone = normalizeNigerianPhone(dto.customerPhone);
    if (!phone) throw new BadRequestException('Enter a valid Nigerian phone number.');
    const request = await this.requests.create({
      businessId: business._id.toString(), serviceId: service._id.toString(), serviceName: service.name,
      publicToken: randomToken(24), customerName: sanitizeText(dto.customerName, 100), customerPhone: phone,
      customerEmail: dto.customerEmail || null, style: sanitizeText(dto.style || '', 120),
      length: sanitizeText(dto.length || '', 80), hairOption: dto.hairOption || 'not_sure',
      preferredDate: sanitizeText(dto.preferredDate || '', 20), preferredTime: sanitizeText(dto.preferredTime || '', 20),
      budgetKobo: dto.budgetKobo || 0, notes: sanitizeText(dto.notes || '', 2000),
      referenceUrls: dto.referenceUrls || [], referenceImages: dto.referenceImages || [], status: 'new', quote: null, messages: [],
    });
    await this.notifications.create({
      businessId: business._id.toString(), type: 'custom_request',
      title: `New custom request · ${service.name}`,
      message: `${request.customerName} requested ${request.style || service.name}. Review and quote.`,
      tone: 'info', data: { requestId: request._id.toString() },
    }).catch(() => undefined);
    await this.sendStatusEmail(request, business, 'We received your request', 'Your custom request is with the business. They will reply with a quote or a question.', 'View request');
    return this.publicView(request, business);
  }

  async list(businessId: string) {
    const items = await this.requests.find({ businessId }).sort({ createdAt: -1 }).limit(200).lean().exec();
    return items.map((item) => this.vendorView(item));
  }

  async get(businessId: string, id: string) {
    const request = await this.requests.findOne({ _id: id, businessId }).lean().exec();
    if (!request) throw new NotFoundException('Custom request not found.');
    return this.vendorView(request);
  }

  async byToken(token: string) {
    const request = await this.requests.findOne({ publicToken: token }).lean().exec();
    if (!request) throw new NotFoundException('Request not found.');
    const business = await this.businesses.findById(request.businessId).lean().exec();
    if (!business) throw new NotFoundException('Business not found.');
    if (request.status === 'quoted' && request.quote && request.quote.expiresAt.getTime() < Date.now()) {
      await this.requests.updateOne({ _id: request._id }, { $set: { status: 'expired' } }).exec();
      request.status = 'expired';
    }
    return this.publicView(request, business);
  }

  async quote(businessId: string, id: string, dto: CreateCustomQuoteDto) {
    const request = await this.requests.findOne({ _id: id, businessId }).exec();
    if (!request) throw new NotFoundException('Custom request not found.');
    if (['booked', 'declined'].includes(request.status)) throw new BadRequestException('This request can no longer be quoted.');
    const items = dto.items.filter((item) => item.label && item.amountKobo >= 0);
    if (!items.length) throw new BadRequestException('Add at least one quote item.');
    const totalKobo = items.reduce((sum, item) => sum + item.amountKobo, 0);
    if (totalKobo <= 0) throw new BadRequestException('Quote total must be greater than zero.');
    if (dto.depositKobo > totalKobo) throw new BadRequestException('Deposit cannot exceed the quote total.');
    const rawSlots = dto.slots?.length ? dto.slots : dto.startAt ? [dto.startAt] : [];
    const slots = [...new Set(rawSlots)].map((value) => new Date(value)).filter((date) => !Number.isNaN(date.getTime()) && date.getTime() > Date.now() - 60_000).slice(0, 4);
    if (!slots.length) throw new BadRequestException('Choose at least one valid future appointment time.');
    const startAt = slots[0];
    const expiresAt = new Date(Date.now() + Math.min(168, Math.max(1, dto.expiresInHours || 48)) * 3600_000);
    const quote: CustomRequestQuote = {
      items, totalKobo, depositKobo: dto.depositKobo, durationMinutes: dto.durationMinutes,
      startAt, slots, providerId: dto.providerId || null, note: redactContactDetails(sanitizeText(dto.note || '', 1000)).text,
      expiresAt, createdAt: new Date(), serviceKobo: dto.serviceKobo || 0,
      hairKobo: dto.hairKobo || 0, addOnKobo: dto.addOnKobo || 0,
    };
    request.quote = quote;
    request.status = 'quoted';
    await request.save();
    const business = await this.businesses.findById(businessId).lean().exec();
    if (business) await this.sendStatusEmail(request, business, 'You have a custom quote', `${request.serviceName}: ${formatNaira(totalKobo)} · ${slots.map((slot) => slot.toLocaleString('en-NG', { timeZone: business.timezone || 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })).join(' · ')}. Choose a time and accept inside Ojaly.`, 'Review quote');
    return this.vendorView(request);
  }

  async message(businessId: string, id: string, body: string) {
    const request = await this.requests.findOne({ _id: id, businessId }).exec();
    if (!request) throw new NotFoundException('Custom request not found.');
    const redaction = redactContactDetails(sanitizeText(body, 2000));
    request.messages.push({ sender: 'business', name: 'Business', body: redaction.text, createdAt: new Date(), redacted: redaction.redacted });
    await request.save();
    const business = await this.businesses.findById(businessId).lean().exec();
    if (business) await this.sendStatusEmail(request, business, 'New message about your request', redaction.text, 'Open request');
    return this.vendorView(request);
  }

  async messagePublic(token: string, body: string) {
    const request = await this.requests.findOne({ publicToken: token }).exec();
    if (!request) throw new NotFoundException('Request not found.');
    const redaction = redactContactDetails(sanitizeText(body, 2000));
    request.messages.push({ sender: 'customer', name: request.customerName, body: redaction.text, createdAt: new Date(), redacted: redaction.redacted });
    await request.save();
    await this.notifications.create({
      businessId: request.businessId, type: 'custom_request',
      title: `Customer replied · ${request.serviceName}`,
      message: redaction.text.slice(0, 140), tone: 'info', data: { requestId: request._id.toString() },
    }).catch(() => undefined);
    return this.publicView(request, await this.businesses.findById(request.businessId).lean().exec());
  }

  async decline(businessId: string, id: string, reason?: string) {
    const request = await this.requests.findOne({ _id: id, businessId }).exec();
    if (!request) throw new NotFoundException('Custom request not found.');
    request.status = 'declined';
    request.declinedAt = new Date();
    if (reason) { const redaction = redactContactDetails(sanitizeText(reason, 2000)); request.messages.push({ sender: 'business', name: 'Business', body: redaction.text, createdAt: new Date(), redacted: redaction.redacted }); }
    await request.save();
    return this.vendorView(request);
  }

  async accept(token: string, selectedStartAt?: string) {
    const request = await this.requests.findOne({ publicToken: token }).exec();
    if (!request) throw new NotFoundException('Request not found.');
    if (request.status === 'booked') throw new BadRequestException('This quote is already booked.');
    if (request.status !== 'quoted' || !request.quote) throw new BadRequestException('There is no active quote to accept.');
    if (request.quote.expiresAt.getTime() < Date.now()) {
      request.status = 'expired';
      await request.save();
      throw new BadRequestException('This quote has expired. Ask the business for an updated quote.');
    }
    const quote = request.quote;
    const offeredSlots = (quote.slots?.length ? quote.slots : [quote.startAt]).map((date) => new Date(date).toISOString());
    const chosen = selectedStartAt ? new Date(selectedStartAt) : new Date(quote.startAt);
    if (Number.isNaN(chosen.getTime()) || !offeredSlots.includes(chosen.toISOString())) throw new BadRequestException('Choose one of the times offered in this quote.');
    const booking = await this.bookings.create(
      'custom-request',
      request.businessId,
      {
        serviceId: request.serviceId,
        providerId: quote.providerId || undefined,
        startAt: chosen.toISOString(),
        customerName: request.customerName,
        customerPhone: request.customerPhone,
        customerEmail: request.customerEmail || undefined,
        notes: `${request.style || request.serviceName}\n${request.notes}\nQuote: ${quote.items.map((item: { label: string; amountKobo: number }) => `${item.label} ${formatNaira(item.amountKobo)}`).join(' · ')}${quote.note ? `\n${quote.note}` : ''}`,
      },
      'dashboard',
      undefined,
      true,
      { priceKobo: quote.totalKobo, durationMinutes: quote.durationMinutes, depositKobo: quote.depositKobo, customRequestId: request._id.toString() },
    );
    request.status = 'booked';
    request.acceptedAt = new Date();
    request.bookingId = booking.id;
    request.bookingPublicToken = booking.publicToken;
    await request.save();
    return { request: await this.publicView(request, await this.businesses.findById(request.businessId).lean().exec()), booking };
  }

  private vendorView(request: CustomRequestDocument | (CustomRequest & { _id: unknown })) {
    return {
      id: String((request as { _id: unknown })._id), publicToken: request.publicToken,
      serviceId: request.serviceId, serviceName: request.serviceName,
      customerName: request.customerName, customerPhone: request.customerPhone, customerEmail: request.customerEmail,
      style: request.style, length: request.length, hairOption: request.hairOption,
      preferredDate: request.preferredDate, preferredTime: request.preferredTime, budgetKobo: request.budgetKobo,
      notes: request.notes, referenceUrls: request.referenceUrls || [], referenceImages: request.referenceImages || [], status: request.status,
      quote: request.quote, messages: request.messages, lastMessageRedacted: Boolean(request.messages?.at(-1)?.redacted), bookingId: request.bookingId, bookingPublicToken: request.bookingPublicToken,
      createdAt: (request as { createdAt?: Date }).createdAt,
    };
  }

  private publicView(request: CustomRequest | (CustomRequest & { _id: unknown }), business: Business | null) {
    return {
      ...this.vendorView(request as CustomRequestDocument),
      business: business ? {
        name: business.name, slug: business.slug, logoUrl: business.logoUrl || null,
        bannerUrl: business.bannerUrl || null, tagline: business.tagline || '', address: business.address || '',
        whatsappNumber: business.whatsappNumber || business.publicPhone || null,
        serviceChargeEnabled: Boolean(business.serviceChargeEnabled),
        serviceChargeType: business.serviceChargeType || 'percent',
        serviceChargePercent: business.serviceChargePercent || 0,
        serviceChargeFixedKobo: business.serviceChargeFixedKobo || 0,
        bookingSettings: business.bookingSettings || null,
      } : null,
    };
  }

  private async sendStatusEmail(request: CustomRequestDocument, business: Business, title: string, body: string, cta: string) {
    if (!request.customerEmail) return;
    const url = `https://ojaly.org/request/${request.publicToken}`;
    await this.mail.send({
      to: request.customerEmail,
      subject: `${title} · ${business.name}`,
      template: 'custom_request_update',
      businessId: request.businessId,
      html: emailLayout({
        title, preheader: body,
        badge: { text: 'Custom request', tone: 'orange', icon: '✦' },
        headerType: 'business', businessName: business.name, businessLogo: business.logoUrl,
        businessTagline: business.tagline, businessSlug: business.slug,
        body: `<p style="margin-top:0;">Hi <strong>${request.customerName.split(' ')[0] || 'there'}</strong>,</p><p>${body}</p>`,
        button: { label: cta, url },
        footerNote: 'Keep the conversation and payment inside Ojaly so your quote, booking and receipt stay together.',
      }),
    }).catch(() => undefined);
  }
}
