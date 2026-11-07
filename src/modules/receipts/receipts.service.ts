import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import PDFDocument from 'pdfkit';
import { Receipt, ReceiptDocument } from './receipt.schema';
import { Invoice, InvoiceDocument } from './invoice.schema';
import { Sale, SaleDocument } from '../sales/sale.schema';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Counter, CounterDocument } from '../plans/counter.schema';
import { MailService } from '../mail/mail.service';
import { receiptEmail, invoiceEmail } from '../mail/email-templates';
import { nextSequence } from '../../common/utils/order-number';
import { randomToken } from '../../common/utils/tokens';
import { formatNaira } from '../../common/utils/money';
import { lagosDisplay } from '../../common/utils/dates';
import { sanitizeText } from '../../common/utils/sanitize';
import type { CreateInvoiceDto, InvoiceQueryDto } from './dto/receipt.dto';

@Injectable()
export class ReceiptsService {
  constructor(
    @InjectModel(Receipt.name) private readonly receipts: Model<ReceiptDocument>,
    @InjectModel(Invoice.name) private readonly invoices: Model<InvoiceDocument>,
    @InjectModel(Sale.name) private readonly sales: Model<SaleDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Counter.name) private readonly counters: Model<CounterDocument>,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async createForSale(sale: SaleDocument | (Sale & { _id: unknown }), sendEmail = true): Promise<ReceiptDocument> {
    const saleDoc = sale as SaleDocument;
    const businessId = saleDoc.businessId;
    const business = await this.businesses.findById(businessId).lean().exec();
    if (!business) throw new NotFoundException('Business not found.');
    const number = await nextSequence(this.counters as unknown as Model<Record<string, unknown>>, businessId, 'receipt', 'RCPT');
    const receipt = await this.receipts.create({
      businessId,
      receiptNumber: number,
      saleId: saleDoc._id.toString(),
      orderId: saleDoc.orderId ?? null,
      customerName: saleDoc.customerName,
      customerEmail: saleDoc.customerEmail,
      customerPhone: saleDoc.customerPhone,
      items: saleDoc.items,
      subtotalKobo: saleDoc.subtotalKobo,
      discountKobo: saleDoc.discountKobo,
      deliveryFeeKobo: saleDoc.deliveryFeeKobo,
      totalKobo: saleDoc.totalKobo,
      amountPaidKobo: saleDoc.amountPaidKobo,
      paymentMethod: saleDoc.paymentMethod,
      publicToken: randomToken(24),
      issuedAt: saleDoc.soldAt || new Date(),
    });
    await this.sales.updateOne({ _id: saleDoc._id }, { $set: { receiptId: receipt._id.toString() } }).exec();
    if (sendEmail && receipt.customerEmail) {
      const mail = receiptEmail({
        businessName: business.name,
        businessLogo: business.logoUrl,
        businessTagline: business.tagline,
        customerName: receipt.customerName,
        receiptNumber: receipt.receiptNumber,
        totalKobo: receipt.totalKobo,
        receiptUrl: `${this.config.get('appUrl')}/receipt/${receipt.publicToken}`,
        items: receipt.items.map((i) => ({ name: i.name, quantity: i.quantity, totalKobo: i.lineTotalKobo })),
      });
      void this.mail.send({
        to: receipt.customerEmail,
        subject: mail.subject,
        html: mail.html,
        template: 'receipt',
        businessId,
        replyTo: business.email || undefined,
      });
    }
    return receipt;
  }

  async removeForSale(businessId: string, saleId: string): Promise<void> {
    await this.receipts.deleteMany({ businessId, saleId }).exec();
  }

  async list(businessId: string, query: { page: number; limit: number; search?: string }) {
    const filter: Record<string, unknown> = { businessId };
    if (query.search) filter.$or = [{ receiptNumber: new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { customerName: new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }];
    const [items, total] = await Promise.all([
      this.receipts.find(filter).sort({ issuedAt: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean().exec(),
      this.receipts.countDocuments(filter).exec(),
    ]);
    return { items, meta: { total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) } };
  }

  async findOne(businessId: string, receiptId: string) {
    const receipt = await this.receipts.findOne({ _id: receiptId, businessId }).lean().exec();
    if (!receipt) throw new NotFoundException('Receipt not found.');
    return receipt;
  }

  async publicReceipt(token: string) {
    const receipt = await this.receipts.findOne({ publicToken: token }).lean().exec();
    if (!receipt) throw new NotFoundException('Receipt not found.');
    const business = await this.businesses.findById(receipt.businessId).select('name slug logoUrl brandColor email publicPhone whatsappNumber address').lean().exec();
    let chatToken: string | null = null;
    if (receipt.saleId) {
      const sale = await this.sales.findOne({ _id: receipt.saleId, businessId: receipt.businessId }).exec();
      if (sale) {
        if (!sale.chatToken) { sale.chatToken = randomToken(24); await sale.save(); }
        chatToken = sale.chatToken;
      }
    }
    return { receipt, business, chatToken };
  }

  async receiptPdf(token: string): Promise<Buffer> {
    const { receipt, business } = await this.publicReceipt(token);
    return this.buildPdf({
      title: 'RECEIPT',
      number: receipt.receiptNumber,
      business,
      customerName: receipt.customerName,
      customerContact: receipt.customerPhone || receipt.customerEmail || '',
      issuedLabel: 'Issued',
      issuedDate: lagosDisplay(receipt.issuedAt, 'd MMM yyyy, h:mm a'),
      dueLabel: 'Payment method',
      dueDate: receipt.paymentMethod,
      items: receipt.items.map((i) => ({ name: i.name, variantName: i.variantName, quantity: i.quantity, unitPriceKobo: i.unitPriceKobo, totalKobo: i.lineTotalKobo })),
      subtotalKobo: receipt.subtotalKobo,
      discountKobo: receipt.discountKobo,
      deliveryFeeKobo: receipt.deliveryFeeKobo,
      totalKobo: receipt.totalKobo,
      amountPaidKobo: receipt.amountPaidKobo,
      note: 'Thank you for supporting a student business.',
    });
  }

  async createInvoice(userId: string, businessId: string, dto: CreateInvoiceDto) {
    const business = await this.businesses.findById(businessId).lean().exec();
    if (!business) throw new NotFoundException('Business not found.');
    if (!dto.items?.length) throw new BadRequestException('Add at least one line item.');
    const items = dto.items.map((i, idx) => {
      const lineTotal = i.quantity * i.unitPriceKobo;
      return {
        productId: i.productId || `custom-${idx}`,
        variantId: null,
        name: sanitizeText(i.name, 120),
        variantName: '',
        sku: '',
        quantity: i.quantity,
        unitPriceKobo: i.unitPriceKobo,
        unitCostKobo: 0,
        discountKobo: 0,
        lineTotalKobo: lineTotal,
        lineCostKobo: 0,
        imageUrl: null,
      };
    });
    const subtotal = items.reduce((s, i) => s + i.lineTotalKobo, 0);
    const discount = dto.discountKobo || 0;
    const delivery = dto.deliveryFeeKobo || 0;
    const total = Math.max(0, subtotal - discount + delivery);
    const number = await nextSequence(this.counters as unknown as Model<Record<string, unknown>>, businessId, 'invoice', 'INV');
    const invoice = await this.invoices.create({
      businessId,
      invoiceNumber: number,
      customerName: sanitizeText(dto.customerName, 100),
      customerEmail: dto.customerEmail || null,
      customerPhone: dto.customerPhone || '',
      customerAddress: sanitizeText(dto.customerAddress, 300),
      items,
      subtotalKobo: subtotal,
      discountKobo: discount,
      deliveryFeeKobo: delivery,
      totalKobo: total,
      dueDate: new Date(dto.dueDate),
      status: 'draft',
      notes: sanitizeText(dto.notes, 1000),
      publicToken: randomToken(24),
      createdBy: userId,
    });
    if (dto.sendEmail && invoice.customerEmail) {
      await this.sendInvoiceEmail(invoice._id.toString(), businessId);
    }
    return invoice;
  }

  async listInvoices(businessId: string, query: InvoiceQueryDto) {
    const filter: Record<string, unknown> = { businessId };
    if (query.status && query.status !== 'all') filter.status = query.status;
    const [items, total] = await Promise.all([
      this.invoices.find(filter).sort({ createdAt: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean().exec(),
      this.invoices.countDocuments(filter).exec(),
    ]);
    return { items, meta: { total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) } };
  }

  async findInvoice(businessId: string, invoiceId: string) {
    const invoice = await this.invoices.findOne({ _id: invoiceId, businessId }).lean().exec();
    if (!invoice) throw new NotFoundException('Invoice not found.');
    return invoice;
  }

  async sendInvoiceEmail(invoiceId: string, businessId: string) {
    const invoice = await this.invoices.findOne({ _id: invoiceId, businessId }).exec();
    if (!invoice) throw new NotFoundException('Invoice not found.');
    if (!invoice.customerEmail) throw new BadRequestException('Add a customer email first.');
    const business = await this.businesses.findById(businessId).lean().exec();
    if (!business) throw new NotFoundException('Business not found.');
    const mail = invoiceEmail({
      businessName: business.name,
      businessLogo: business.logoUrl,
      businessTagline: business.tagline,
      customerName: invoice.customerName,
      invoiceNumber: invoice.invoiceNumber,
      totalKobo: invoice.totalKobo,
      dueDate: lagosDisplay(invoice.dueDate, 'd MMM yyyy'),
      invoiceUrl: `${this.config.get('appUrl')}/invoice/${invoice.publicToken}`,
      paymentUrl: `${this.config.get('appUrl')}/pay/invoice/${invoice.publicToken}`,
    });
    const result = await this.mail.send({
      to: invoice.customerEmail,
      subject: mail.subject,
      html: mail.html,
      template: 'invoice',
      businessId,
      replyTo: business.email || undefined,
    });
    if (result.sent) {
      invoice.status = invoice.status === 'draft' ? 'sent' : invoice.status;
      await invoice.save();
    }
    return { sent: result.sent };
  }

  async publicInvoice(token: string) {
    const invoice = await this.invoices.findOne({ publicToken: token }).lean().exec();
    if (!invoice) throw new NotFoundException('Invoice not found.');
    const business = await this.businesses.findById(invoice.businessId).select('name slug logoUrl brandColor email publicPhone whatsappNumber address').lean().exec();
    return { invoice, business };
  }

  async invoicePdf(token: string): Promise<Buffer> {
    const { invoice, business } = await this.publicInvoice(token);
    return this.buildPdf({
      title: 'INVOICE',
      number: invoice.invoiceNumber,
      business,
      customerName: invoice.customerName,
      customerContact: invoice.customerPhone || invoice.customerEmail || '',
      issuedLabel: 'Due',
      issuedDate: lagosDisplay(invoice.dueDate, 'd MMM yyyy'),
      dueLabel: 'Status',
      dueDate: invoice.status.toUpperCase(),
      items: invoice.items.map((i) => ({ name: i.name, variantName: i.variantName, quantity: i.quantity, unitPriceKobo: i.unitPriceKobo, totalKobo: i.lineTotalKobo })),
      subtotalKobo: invoice.subtotalKobo,
      discountKobo: invoice.discountKobo,
      deliveryFeeKobo: invoice.deliveryFeeKobo,
      totalKobo: invoice.totalKobo,
      amountPaidKobo: invoice.status === 'paid' ? invoice.totalKobo : 0,
      note: invoice.notes || 'Please make payment by the due date.',
    });
  }

  async markInvoicePaid(businessId: string, invoiceId: string) {
    const invoice = await this.invoices.findOneAndUpdate(
      { _id: invoiceId, businessId },
      { $set: { status: 'paid', paidAt: new Date() } },
      { new: true },
    ).exec();
    if (!invoice) throw new NotFoundException('Invoice not found.');
    return invoice;
  }

  async refreshInvoiceStatuses(): Promise<void> {
    await this.invoices.updateMany(
      { status: { $in: ['draft', 'sent'] }, dueDate: { $lt: new Date() } },
      { $set: { status: 'overdue' } },
    ).exec();
  }

  private buildPdf(data: {
    title: string;
    number: string;
    business: { name: string; brandColor?: string; email?: string | null; publicPhone?: string | null; address?: string; logoUrl?: string | null } | null;
    customerName: string;
    customerContact: string;
    issuedLabel: string;
    issuedDate: string;
    dueLabel: string;
    dueDate: string;
    items: { name: string; variantName: string; quantity: number; unitPriceKobo: number; totalKobo: number }[];
    subtotalKobo: number;
    discountKobo: number;
    deliveryFeeKobo: number;
    totalKobo: number;
    amountPaidKobo: number;
    note: string;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `${data.title} ${data.number}` } });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const ink = '#06231A';
      const orange = '#FF5A1F';
      const muted = '#5F6B64';
      const width = doc.page.width - 96;

      doc.rect(0, 0, doc.page.width, 118).fill(ink);
      doc.rect(48, 38, 16, 16).fill(orange);
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(26).text('ojaly', 72, 34);
      doc.fillColor('#A8C0B4').font('Helvetica').fontSize(9).text('RUN YOUR BUSINESS. OWN YOUR NUMBERS.', 72, 64, { characterSpacing: 1 });
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20).text(data.title, 48, 38, { width, align: 'right' });
      doc.fillColor('#A8C0B4').font('Helvetica').fontSize(10).text(`#${data.number}`, 48, 66, { width, align: 'right' });

      doc.y = 150;
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(15).text(data.business?.name || 'Business');
      doc.font('Helvetica').fontSize(9).fillColor(muted);
      if (data.business?.address) doc.text(data.business.address);
      if (data.business?.publicPhone) doc.text(data.business.publicPhone);
      if (data.business?.email) doc.text(data.business.email);

      doc.font('Helvetica-Bold').fontSize(9).fillColor(muted).text('BILLED TO', 330, 150);
      doc.font('Helvetica-Bold').fontSize(12).fillColor(ink).text(data.customerName, 330, 166);
      doc.font('Helvetica').fontSize(9).fillColor(muted).text(data.customerContact || '', 330, 183);
      doc.font('Helvetica').fontSize(9).fillColor(muted).text(`${data.issuedLabel}: ${data.issuedDate}`, 330, 200);
      doc.text(`${data.dueLabel}: ${data.dueDate}`, 330, 214);

      const tableTop = 260;
      doc.rect(48, tableTop - 22, width, 26).fill('#F7F2E8');
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(9).text('ITEM', 56, tableTop - 13);
      doc.text('QTY', 360, tableTop - 13, { width: 40, align: 'right' });
      doc.text('PRICE', 410, tableTop - 13, { width: 60, align: 'right' });
      doc.text('TOTAL', 480, tableTop - 13, { width: 65, align: 'right' });
      let y = tableTop + 10;
      for (const item of data.items) {
        if (y > 690) {
          doc.addPage();
          y = 70;
        }
        doc.fillColor(ink).font('Helvetica-Bold').fontSize(10).text(item.name, 56, y, { width: 280 });
        if (item.variantName) doc.font('Helvetica').fontSize(8).fillColor(muted).text(item.variantName, 56, y + 13, { width: 280 });
        doc.fillColor(ink).font('Helvetica').fontSize(10).text(String(item.quantity), 360, y, { width: 40, align: 'right' });
        doc.text(formatNaira(item.unitPriceKobo, { withSymbol: false }), 410, y, { width: 60, align: 'right' });
        doc.text(formatNaira(item.totalKobo, { withSymbol: false }), 480, y, { width: 65, align: 'right' });
        y += item.variantName ? 36 : 28;
        doc.moveTo(48, y - 6).lineTo(547, y - 6).strokeColor('#EDE7DB').lineWidth(0.7).stroke();
      }

      y += 8;
      const summaryX = 330;
      const summaryW = 217;
      const row = (label: string, value: string, bold = false, color = ink) => {
        doc.fillColor(bold ? ink : muted).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 9).text(label, summaryX, y, { width: 110 });
        doc.fillColor(color).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 9).text(value, summaryX + 110, y, { width: 107, align: 'right' });
        y += bold ? 24 : 20;
      };
      row('Subtotal', formatNaira(data.subtotalKobo));
      if (data.discountKobo > 0) row('Discount', `-${formatNaira(data.discountKobo)}`);
      if (data.deliveryFeeKobo > 0) row('Delivery', formatNaira(data.deliveryFeeKobo));
      doc.moveTo(summaryX, y).lineTo(547, y).strokeColor('#DDD6C8').stroke();
      y += 10;
      row('TOTAL', formatNaira(data.totalKobo), true, orange);
      row('Amount paid', formatNaira(data.amountPaidKobo));

      doc.fillColor(muted).font('Helvetica-Oblique').fontSize(9).text(data.note, 48, 740, { width });
      doc.moveTo(48, 770).lineTo(547, 770).strokeColor('#EDE7DB').stroke();
      doc.fillColor(muted).font('Helvetica').fontSize(8).text('Made with Ojaly · ojaly.org · This document was generated automatically.', 48, 780, { width, align: 'center' });
      doc.end();
    });
  }
}
