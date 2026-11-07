import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingDocument } from '../bookings/booking.schema';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { BRAND, emailLayout } from '../mail/email-templates';
import { escapeHtml } from '../../common/utils/sanitize';
import { redactContactDetails } from '../../common/utils/redact-contact';
import { sanitizeText } from '../../common/utils/sanitize';
import { BookingMessage, BookingMessageDocument } from './booking-message.schema';
import { SendBookingMessageDto } from './booking-message.dto';

@Injectable()
export class BookingMessagesService {
  constructor(
    @InjectModel(BookingMessage.name) private readonly messages: Model<BookingMessageDocument>,
    @InjectModel(Booking.name) private readonly bookings: Model<BookingDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
  ) {}

  async inbox(businessId: string) {
    const recent = await this.messages.find({ businessId }).sort({ createdAt: -1 }).limit(1000).lean().exec();
    const latest = new Map<string, typeof recent[number]>();
    for (const message of recent) if (!latest.has(message.bookingId)) latest.set(message.bookingId, message);
    const bookingIds = [...latest.keys()];
    if (!bookingIds.length) return [];
    const [bookings, unread] = await Promise.all([
      this.bookings.find({ _id: { $in: bookingIds }, businessId }).select('bookingNumber customerName customerPhone serviceName startAt status location').lean().exec(),
      this.messages.aggregate([
        { $match: { businessId, sender: 'customer', readByBusinessAt: null } },
        { $group: { _id: '$bookingId', count: { $sum: 1 } } },
      ]).exec(),
    ]);
    const unreadMap = new Map(unread.map((item) => [String(item._id), Number(item.count)]));
    return bookings.map((booking) => {
      const last = latest.get(String((booking as Booking & { _id: unknown })._id));
      return {
        bookingId: String((booking as Booking & { _id: unknown })._id), bookingNumber: booking.bookingNumber,
        customerName: booking.customerName, serviceName: booking.serviceName,
        startAt: booking.startAt, status: booking.status, location: booking.location || '',
        lastMessage: last?.body || '', lastMessageAt: last?.createdAt || null,
        lastSender: last?.sender || null, unread: unreadMap.get(String((booking as Booking & { _id: unknown })._id)) || 0,
      };
    }).sort((a, b) => new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime());
  }

  async vendorThread(businessId: string, bookingId: string) {
    const booking = await this.bookings.findOne({ _id: bookingId, businessId }).lean().exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    await this.messages.updateMany({ businessId, bookingId, sender: 'customer', readByBusinessAt: null }, { $set: { readByBusinessAt: new Date() } }).exec();
    const messages = await this.messages.find({ businessId, bookingId }).sort({ createdAt: 1 }).limit(500).lean().exec();
    return { booking: this.bookingSummary(booking), messages: messages.map((message) => this.view(message, 'vendor')) };
  }

  async sendVendor(businessId: string, bookingId: string, dto: SendBookingMessageDto) {
    const booking = await this.bookings.findOne({ _id: bookingId, businessId }).lean().exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    const business = await this.businesses.findById(businessId).lean().exec();
    if (!business) throw new NotFoundException('Business not found.');
    const message = await this.createMessage({ businessId, booking, sender: 'business', senderName: business.name, dto });
    if (booking.customerEmail) {
      await this.mail.send({
        to: booking.customerEmail,
        subject: `New message from ${business.name} · ${booking.bookingNumber}`,
        template: 'booking_message',
        businessId,
        html: emailLayout({
          title: `New message from ${business.name}`,
          preheader: `A message about your ${booking.serviceName} appointment.`,
          badge: { text: 'Booking message', tone: 'orange', icon: '✦' },
          headerType: 'business', businessName: business.name, businessLogo: business.logoUrl,
          businessTagline: business.tagline, businessSlug: business.slug,
          body: `<p style="margin-top:0;">Hi <strong>${booking.customerName.split(' ')[0] || 'there'}</strong>,</p><p>${business.name} sent you a message about <strong>${booking.serviceName}</strong> (${booking.bookingNumber}).</p><div style="margin:16px 0;padding:14px 16px;border-radius:12px;background:${BRAND.cream};border:1px solid ${BRAND.border};">${escapeHtml(message.body)}</div>`,
          button: { label: 'View conversation', url: `${this.configUrl()}/booking/${booking.publicToken}` },
          footerNote: 'Reply inside Ojaly so the conversation stays with your booking.',
        }),
      }).catch(() => undefined);
    }
    return this.view(message, 'vendor');
  }

  async publicThread(token: string) {
    const booking = await this.bookingByToken(token);
    await this.messages.updateMany({ businessId: booking.businessId, bookingId: String((booking as Booking & { _id: unknown })._id), sender: 'business', readByCustomerAt: null }, { $set: { readByCustomerAt: new Date() } }).exec();
    const messages = await this.messages.find({ bookingId: String((booking as Booking & { _id: unknown })._id) }).sort({ createdAt: 1 }).limit(500).lean().exec();
    return { booking: this.bookingSummary(booking), messages: messages.map((message) => this.view(message, 'customer')) };
  }

  async sendCustomer(token: string, dto: SendBookingMessageDto) {
    const booking = await this.bookingByToken(token);
    const message = await this.createMessage({
      businessId: booking.businessId,
      booking,
      sender: 'customer',
      senderName: booking.customerName,
      dto,
    });
    await this.notifications.create({
      businessId: booking.businessId, type: 'booking', tone: 'info',
      title: `New customer message · ${booking.bookingNumber}`,
      message: message.body.slice(0, 140) || 'New attachment',
      data: { bookingId: String((booking as Booking & { _id: unknown })._id) },
    }).catch(() => undefined);
    return this.view(message, 'customer');
  }

  async markCustomerRead(token: string) {
    const booking = await this.bookingByToken(token);
    await this.messages.updateMany({ bookingId: String((booking as Booking & { _id: unknown })._id), sender: 'business', readByCustomerAt: null }, { $set: { readByCustomerAt: new Date() } }).exec();
    return { read: true };
  }

  async markVendorRead(businessId: string, bookingId: string) {
    await this.messages.updateMany({ businessId, bookingId, sender: 'customer', readByBusinessAt: null }, { $set: { readByBusinessAt: new Date() } }).exec();
    return { read: true };
  }

  private async createMessage(input: { businessId: string; booking: Booking; sender: 'customer' | 'business'; senderName: string; dto: SendBookingMessageDto }) {
    const body = sanitizeText(input.dto.body || '', 3000);
    const attachments = (input.dto.attachments || []).slice(0, 3);
    if (!body && !attachments.length) throw new BadRequestException('Write a message or attach a photo.');
    const redaction = redactContactDetails(body);
    const message = await this.messages.create({
      businessId: input.businessId, bookingId: String((input.booking as Booking & { _id: unknown })._id), bookingNumber: input.booking.bookingNumber,
      sender: input.sender, senderName: input.senderName, body: redaction.text,
      attachments, redacted: redaction.redacted,
      readByBusinessAt: input.sender === 'business' ? new Date() : null,
      readByCustomerAt: input.sender === 'customer' ? new Date() : null,
    });
    return message;
  }

  private async bookingByToken(token: string) {
    const booking = await this.bookings.findOne({ publicToken: token }).lean().exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    return booking;
  }

  private bookingSummary(booking: Booking) {
    return {
      id: String((booking as Booking & { _id: unknown })._id), bookingNumber: booking.bookingNumber, publicToken: booking.publicToken,
      serviceName: booking.serviceName, customerName: booking.customerName,
      startAt: booking.startAt, status: booking.status, location: booking.location || '',
    };
  }

  private view(message: BookingMessage | (BookingMessage & { _id: unknown }), role: 'vendor' | 'customer') {
    return {
      id: String((message as { _id: unknown })._id), sender: message.sender, senderName: message.senderName,
      body: message.body, attachments: message.attachments || [], redacted: Boolean(message.redacted),
      createdAt: (message as { createdAt?: Date }).createdAt,
      seen: message.sender === 'business' ? Boolean(message.readByCustomerAt) : Boolean(message.readByBusinessAt),
    };
  }

  private configUrl() {
    return process.env.APP_URL || 'https://ojaly.org';
  }
}
