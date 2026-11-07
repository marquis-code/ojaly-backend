import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Sale, SaleDocument } from '../sales/sale.schema';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Receipt, ReceiptDocument } from '../receipts/receipt.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { randomToken } from '../../common/utils/tokens';
import { sanitizeText, escapeHtml } from '../../common/utils/sanitize';
import { redactContactDetails } from '../../common/utils/redact-contact';
import { SaleAttachment, SaleMessage, SaleMessageDocument } from './sale-message.schema';
import { SendSaleMessageDto } from './sale-message.dto';

@Injectable()
export class SaleMessagesService {
  constructor(
    @InjectModel(SaleMessage.name) private readonly messages: Model<SaleMessageDocument>,
    @InjectModel(Sale.name) private readonly sales: Model<SaleDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Receipt.name) private readonly receipts: Model<ReceiptDocument>,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
  ) {}

  async inbox(businessId: string) {
    const recent = await this.messages.find({ businessId }).sort({ createdAt: -1 }).limit(1000).lean().exec();
    const latest = new Map<string, typeof recent[number]>();
    for (const message of recent) if (!latest.has(message.saleId)) latest.set(message.saleId, message);
    const ids = [...latest.keys()];
    if (!ids.length) return [];
    const [sales, unread] = await Promise.all([
      this.sales.find({ _id: { $in: ids }, businessId }).select('saleNumber customerName customerEmail customerPhone totalKobo soldAt').lean().exec(),
      this.messages.aggregate([{ $match: { businessId, sender: 'customer', readByBusinessAt: null } }, { $group: { _id: '$saleId', count: { $sum: 1 } } }]).exec(),
    ]);
    const unreadMap = new Map(unread.map((item) => [String(item._id), Number(item.count)]));
    return sales.map((sale) => {
      const last = latest.get(String((sale as Sale & { _id: unknown })._id));
      return {
        saleId: String((sale as Sale & { _id: unknown })._id), saleNumber: sale.saleNumber, customerName: sale.customerName,
        totalKobo: sale.totalKobo, soldAt: sale.soldAt, lastMessage: last?.body || '', lastMessageAt: last?.createdAt || null,
        lastSender: last?.sender || null, unread: unreadMap.get(String((sale as Sale & { _id: unknown })._id)) || 0,
      };
    }).sort((a, b) => new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime());
  }

  async vendorThread(businessId: string, saleId: string) {
    const sale = await this.sales.findOne({ _id: saleId, businessId }).lean().exec();
    if (!sale) throw new NotFoundException('Sale not found.');
    await this.messages.updateMany({ businessId, saleId, sender: 'customer', readByBusinessAt: null }, { $set: { readByBusinessAt: new Date() } }).exec();
    const messages = await this.messages.find({ businessId, saleId }).sort({ createdAt: 1 }).limit(500).lean().exec();
    return { sale: this.summary(sale), messages: messages.map((message) => this.view(message)) };
  }

  async sendVendor(businessId: string, saleId: string, dto: SendSaleMessageDto) {
    const sale = await this.sales.findOne({ _id: saleId, businessId }).exec();
    if (!sale) throw new NotFoundException('Sale not found.');
    const business = await this.businesses.findById(businessId).lean().exec();
    if (!business) throw new NotFoundException('Business not found.');
    const message = await this.create({ businessId, sale, sender: 'business', senderName: business.name, dto });
    if (sale.customerEmail) {
      const receipt = sale.receiptId ? await this.receipts.findById(sale.receiptId).select('publicToken').lean().exec() : null;
      const chatUrl = receipt?.publicToken ? `${process.env.APP_URL || 'https://ojaly.org'}/receipt/${receipt.publicToken}` : `${process.env.APP_URL || 'https://ojaly.org'}`;
      await this.mail.send({
        to: sale.customerEmail, subject: `New message from ${business.name} · ${sale.saleNumber}`, template: 'sale_message', businessId,
        html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px"><h2>${escapeHtml(business.name)} sent you a message</h2><p>Hi ${escapeHtml(sale.customerName.split(' ')[0] || 'there')},</p><p>${escapeHtml(message.body || 'You received an attachment.')}</p><p>This is about sale <strong>${escapeHtml(sale.saleNumber)}</strong>.</p><p><a href="${chatUrl}" style="display:inline-block;background:#06231A;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none">Open your receipt and chat</a></p><p style="color:#66756b;font-size:12px">Reply inside Ojaly so your conversation stays with the sale.</p></div>`,
      }).catch(() => undefined);
    }
    return this.view(message);
  }

  async publicThread(token: string) {
    const sale = await this.saleByToken(token);
    await this.messages.updateMany({ saleId: String((sale as Sale & { _id: unknown })._id), sender: 'business', readByCustomerAt: null }, { $set: { readByCustomerAt: new Date() } }).exec();
    const messages = await this.messages.find({ saleId: String((sale as Sale & { _id: unknown })._id) }).sort({ createdAt: 1 }).limit(500).lean().exec();
    return { sale: this.summary(sale), messages: messages.map((message) => this.view(message)) };
  }

  async sendCustomer(token: string, dto: SendSaleMessageDto) {
    const sale = await this.saleByToken(token);
    const message = await this.create({ businessId: sale.businessId, sale, sender: 'customer', senderName: sale.customerName, dto });
    await this.notifications.create({
      businessId: sale.businessId, type: 'sale', tone: 'info',
      title: `New customer message · ${sale.saleNumber}`,
      message: message.body.slice(0, 140) || 'New attachment',
      data: { saleId: String((sale as Sale & { _id: unknown })._id) },
    }).catch(() => undefined);
    return this.view(message);
  }

  async markVendorRead(businessId: string, saleId: string) {
    await this.messages.updateMany({ businessId, saleId, sender: 'customer', readByBusinessAt: null }, { $set: { readByBusinessAt: new Date() } }).exec();
    return { read: true };
  }

  async markCustomerRead(token: string) {
    const sale = await this.saleByToken(token);
    await this.messages.updateMany({ saleId: String((sale as Sale & { _id: unknown })._id), sender: 'business', readByCustomerAt: null }, { $set: { readByCustomerAt: new Date() } }).exec();
    return { read: true };
  }

  async ensureToken(saleId: string): Promise<string | null> {
    const sale = await this.sales.findById(saleId).exec();
    if (!sale) return null;
    if (!sale.chatToken) { sale.chatToken = randomToken(24); await sale.save(); }
    return sale.chatToken;
  }

  private async saleByToken(token: string) {
    const sale = await this.sales.findOne({ chatToken: token }).exec();
    if (!sale) throw new NotFoundException('Sale chat not found.');
    return sale;
  }

  private async create(input: { businessId: string; sale: SaleDocument; sender: 'customer' | 'business'; senderName: string; dto: SendSaleMessageDto }) {
    const body = sanitizeText(input.dto.body || '', 3000);
    const attachments = (input.dto.attachments || []).slice(0, 3).filter((a) => (a.type === 'image' || a.type === 'audio') && /^https?:\/\//.test(a.url)) as SaleAttachment[];
    if (!body && !attachments.length) throw new BadRequestException('Write a message or attach an image or voice note.');
    const redaction = redactContactDetails(body);
    return this.messages.create({
      businessId: input.businessId, saleId: String((input.sale as Sale & { _id: unknown })._id), saleNumber: input.sale.saleNumber,
      sender: input.sender, senderName: input.senderName, body: redaction.text, attachments,
      readByBusinessAt: input.sender === 'business' ? new Date() : null,
      readByCustomerAt: input.sender === 'customer' ? new Date() : null,
    });
  }

  private summary(sale: Sale) {
    return { id: String((sale as Sale & { _id: unknown })._id), saleNumber: sale.saleNumber, customerName: sale.customerName, customerEmail: sale.customerEmail || '', totalKobo: sale.totalKobo, soldAt: sale.soldAt, items: sale.items.map((item) => ({ name: item.name, quantity: item.quantity })) };
  }

  private view(message: SaleMessage | (SaleMessage & { _id: unknown })) {
    return { id: String((message as { _id: unknown })._id), sender: message.sender, senderName: message.senderName, body: message.body, attachments: message.attachments || [], createdAt: (message as { createdAt?: Date }).createdAt, seen: message.sender === 'business' ? Boolean(message.readByCustomerAt) : Boolean(message.readByBusinessAt) };
  }
}
