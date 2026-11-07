import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WhatsappContact, WhatsappContactDocument } from './whatsapp-contact.schema';
import { WhatsappOtp, WhatsappOtpDocument } from './whatsapp-otp.schema';
import { Product, ProductDocument } from '../products/product.schema';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Membership, MembershipDocument } from '../memberships/membership.schema';
import { Booking, BookingDocument } from '../bookings/booking.schema';
import { SalesService } from '../sales/sales.service';
import { DebtsService } from '../debts/debts.service';
import { ProductsService } from '../products/products.service';
import { StockService } from '../stock/stock.service';
import { SummariesService } from '../summaries/summaries.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { ExpensesService } from '../expenses/expenses.service';
import { WhatsappClientService } from './whatsapp-client.service';
import { ChatParserService, ParsedChatDraft } from './chat-parser.service';
import { normalizeNigerianPhone } from '../../common/utils/phone';
import { formatNaira } from '../../common/utils/money';
import { lagosDisplay } from '../../common/utils/dates';
import { sha256 } from '../../common/utils/tokens';

interface PendingSale {
  type: 'sale';
  createdAt: string;
  items: { productId: string; variantId: string; quantity: number; unitPriceKobo: number; name: string; variantName: string }[];
  customerName: string;
  customerPhone: string;
  amountPaidKobo: number;
  amountOwedKobo: number;
  dueDate: string;
  deliveryFeeKobo: number;
  discountKobo: number;
  totalKobo: number;
  summary: string;
  notes: string;
}

interface LastUndo {
  saleId: string;
  at: string;
  saleNumber: string;
}

const HELP_TEXT = `*Ojaly WhatsApp commands*

Record a sale:
_sold 3 shirts 5000, Tola owes 2000_
_sold 2 hoodies at 8500 each for Tola_

Strict format:
_SALE 2 hoodie @ 8500; CUSTOMER Tola; PHONE 08031234567; PAID 10000; DUE 2026-12-01_
(use one per line; amounts in naira)

Other commands:
EXPENSE 2500 transport — record money you spent
SUMMARY — today's numbers
STOCK — low stock and stock value
OWES — customers who owe you
UNDO — reverse your last sale (15 min)
BOOKINGS — today's appointments
NEXT — your next appointment
HELP — this list
STOP — turn off automatic alerts

Every sale is shown for confirmation first. Reply YES to save, NO to cancel.`;

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(
    @InjectModel(WhatsappContact.name) private readonly contacts: Model<WhatsappContactDocument>,
    @InjectModel(WhatsappOtp.name) private readonly otps: Model<WhatsappOtpDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(Booking.name) private readonly bookings: Model<BookingDocument>,
    private readonly sales: SalesService,
    private readonly debts: DebtsService,
    private readonly productsService: ProductsService,
    private readonly stock: StockService,
    private readonly summaries: SummariesService,
    private readonly receipts: ReceiptsService,
    private readonly expenses: ExpensesService,
    private readonly whatsapp: WhatsappClientService,
    private readonly parser: ChatParserService,
    private readonly config: ConfigService,
  ) {}

  async handleIncoming(input: { phone: string; name?: string; text: string; audioTranscript?: string }): Promise<void> {
    const phone = normalizeNigerianPhone(input.phone) || input.phone;
    const text = String(input.text || '').trim().slice(0, 4000);
    if (!text) return;

    const link = text.match(/^LINK\s+(\d{6})$/i);
    if (link) {
      await this.linkPhone(phone, link[1], input.name);
      return;
    }

    let contact = await this.contacts.findOne({ phone }).exec();
    if (!contact || !contact.verifiedAt || !contact.businessId) {
      const isExplicitBotIntent = /^(help|menu|ojaly|link)\b/i.test(text);
      if (isExplicitBotIntent) {
        await this.whatsapp.sendTextDirect(
          contact?.businessId || '',
          phone,
          'This number is not linked to an Ojaly business yet. Open Ojaly → Settings → WhatsApp to get a 6-digit link code, then send *LINK 123456* here.',
        );
      }
      return;
    }

    const business = await this.businesses.findById(contact.businessId).lean().exec();
    if (!business) {
      await this.whatsapp.sendTextDirect(contact.businessId, phone, 'This business is no longer available.');
      return;
    }

    const command = text.toLowerCase().replace(/[.!?]+$/, '').trim();
    if (command === 'stop') {
      contact.alertsOptOut = true;
      await contact.save();
      await this.reply(contact, 'Okay. Automatic summaries and alerts are off for this number. Send *START* to turn them back on. You can still use commands.');
      return;
    }
    if (command === 'start') {
      contact.alertsOptOut = false;
      await contact.save();
      await this.reply(contact, 'Alerts are back on. 🎯');
      return;
    }
    if (command === 'help' || command === 'menu') {
      await this.reply(contact, HELP_TEXT);
      return;
    }
    if (command === 'bookings' || command === 'today' || command === 'appointments') {
      await this.bookingsCommand(contact, false);
      return;
    }
    if (command === 'next') {
      await this.bookingsCommand(contact, true);
      return;
    }
    if (command === 'summary') {
      const payload = await this.summaries.build(contact.businessId, 'daily');
      await this.reply(contact, payload.text);
      return;
    }
    const expense = text.match(/^(?:expense|spent|spend)\s+(?:₦|N)?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:on\s+)?(.*)$/i);
    if (expense) {
      await this.recordExpense(contact, expense[1], expense[2], input.audioTranscript);
      return;
    }
    if (command === 'stock') {
      await this.stockCommand(contact);
      return;
    }
    if (command === 'owes' || command === 'debts') {
      await this.owesCommand(contact);
      return;
    }
    if (['yes', 'y', 'confirm', 'save'].includes(command)) {
      await this.confirmPending(contact);
      return;
    }
    if (['no', 'n', 'cancel'].includes(command)) {
      contact.pendingAction = null;
      await contact.save();
      await this.reply(contact, 'Cancelled. Nothing was saved.');
      return;
    }
    if (command === 'undo') {
      await this.undoLast(contact);
      return;
    }

    await this.parseSaleIntent(contact, business.name, text, input.audioTranscript);
  }

  private async bookingsCommand(contact: WhatsappContactDocument, nextOnly: boolean) {
    const timeZone = 'Africa/Lagos';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const start = new Date(`${today}T00:00:00+01:00`);
    const end = new Date(start.getTime() + 86400000);
    const query = nextOnly
      ? { businessId: contact.businessId, status: { $in: ['pending', 'confirmed'] }, startAt: { $gte: new Date() } }
      : { businessId: contact.businessId, status: { $in: ['pending', 'confirmed'] }, startAt: { $gte: start, $lt: end } };
    const bookings = await this.bookings.find(query).sort({ startAt: 1 }).limit(nextOnly ? 1 : 12).lean().exec();
    if (!bookings.length) {
      await this.reply(contact, nextOnly ? 'No upcoming appointment is on the calendar.' : 'No confirmed or pending appointments today.');
      return;
    }
    const lines = bookings.map((booking) => {
      const when = new Intl.DateTimeFormat('en-NG', { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(booking.startAt);
      return `• *${when}* — ${booking.customerName} · ${booking.serviceName}${booking.location ? ` · ${booking.location}` : ''}\n  Ref ${booking.bookingNumber} · ${booking.status}`;
    });
    await this.reply(contact, `${nextOnly ? '*Next appointment*' : '*Today’s appointments*'}\n\n${lines.join('\n\n')}`);
  }

  private async linkPhone(phone: string, code: string, displayName?: string): Promise<void> {
    const contact = await this.contacts.findOne({ phone }).exec();
    if (contact && contact.failedAttempts >= 5) {
      await this.whatsapp.sendTextDirect(contact.businessId || '', phone, 'Too many incorrect codes. Get a fresh code from Ojaly → Settings → WhatsApp.');
      return;
    }
    const codeHash = sha256(code);
    const otp = await this.otps.findOne({
      codeHash,
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 }).exec();
    if (!otp) {
      await this.contacts.updateOne({ phone }, { $inc: { failedAttempts: 1 } }, { upsert: true }).exec();
      await this.whatsapp.sendTextDirect('', phone, 'That code is incorrect or expired. Open Ojaly → Settings → WhatsApp and generate a new one.');
      return;
    }
    otp.consumedAt = new Date();
    await otp.save();
    await this.contacts.updateOne(
      { phone },
      {
        $set: {
          businessId: otp.businessId,
          userId: otp.userId,
          verifiedAt: new Date(),
          failedAttempts: 0,
          lastInboundAt: new Date(),
          ...(displayName ? { displayName } : {}),
        },
      },
      { upsert: true },
    ).exec();
    const business = await this.businesses.findById(otp.businessId).select('name').lean().exec();
    await this.whatsapp.sendTextDirect(
      otp.businessId,
      phone,
      `✅ This number is now linked to *${business?.name || 'your business'}*.\n\nSend *HELP* to see the commands. Try: _sold 2 shirts 5000, Tola owes 2000_`,
    );
  }

  private async parseSaleIntent(
    contact: WhatsappContactDocument,
    businessName: string,
    text: string,
    audioTranscript?: string,
  ): Promise<void> {
    try {
      const catalog = await this.products.find({ businessId: contact.businessId, isActive: true }).lean().exec() as unknown as Product[];
      const heuristic = await this.parser.parse(contact.businessId!, text, { allowLlm: false });
      const strict = this.parseStrict(text, catalog);
      let draft = heuristic;
      if (strict.items.length > 0) {
        const total = strict.items.reduce((s, i) => s + i.unitPriceKobo * i.quantity, 0);
        const owed = strict.amountOwedKobo ?? heuristic.amountOwedKobo ?? 0;
        draft = {
          ...heuristic,
          customerName: strict.customerName || heuristic.customerName,
          customerPhone: strict.customerPhone || heuristic.customerPhone,
          deliveryAddress: strict.address || heuristic.deliveryAddress,
          items: strict.items.map((i) => ({
            ...i,
            quotedUnitPriceKobo: i.unitPriceKobo,
            confidence: 0.9,
            rawPhrase: text.slice(0, 200),
          })),
          amountOwedKobo: owed,
          amountPaidKobo: strict.amountPaidKobo ?? heuristic.amountPaidKobo ?? (owed ? Math.max(0, total - owed) : null),
          deliveryFeeKobo: strict.deliveryFeeKobo,
          dueDate: strict.dueDate,
          notes: text.slice(0, 1000),
          parserUsed: 'heuristic',
          confidence: 0.9,
          totals: { subtotalKobo: total, discountKobo: 0, deliveryFeeKobo: strict.deliveryFeeKobo, totalKobo: total + strict.deliveryFeeKobo },
        };
      } else {
        draft = await this.parser.parse(contact.businessId!, text, { allowLlm: true });
      }
      if (!draft.items.length) {
        const names = catalog.slice(0, 5).map((p) => p.name).join(', ');
        await this.reply(contact, `I couldn't find a product in that message.\n\n${draft.unmatched.length ? `Unmatched: ${draft.unmatched.map((u) => u.phrase).join(', ')}\n\n` : ''}Try:\n_sold 2 ${catalog[0]?.name || 'shirts'} 5000, Tola owes 2000_\n\n${names ? `In your catalogue: ${names}` : 'Add a product on Ojaly first.'}\n\nReply HELP for examples.`);
        return;
      }
      if (draft.unmatched.length) {
        await this.reply(contact, `I found ${draft.items.length} item${draft.items.length === 1 ? '' : 's'}, but I couldn't match:\n${draft.unmatched.map((u) => `• ${u.quantity} × ${u.phrase}`).join('\n')}\n\nAdd those products in Ojaly (or use the exact product name), then send the message again. I have not saved anything.`);
        return;
      }
      if (!draft.customerPhone && !draft.customerName) {
        // Still allow walk-in sales, but the summary should be clear.
      }
      const customerName = draft.customerName || 'Walk-in customer';
      const customerPhone = draft.customerPhone || contact.phone;
      const total = draft.totals.totalKobo;
      const owed = draft.amountOwedKobo ?? 0;
      if (owed > total) {
        await this.reply(contact, `The amount owed (${formatNaira(owed)}) is more than the sale total (${formatNaira(total)}). Check the message and send it again.`);
        return;
      }
      const amountPaid = draft.amountPaidKobo != null ? Math.min(draft.amountPaidKobo, total) : Math.max(0, total - owed);
      const amountOwed = Math.max(0, total - amountPaid);
      const lines = draft.items.map((i) => `• ${i.quantity} × ${i.name}${i.variantName && i.variantName !== 'Standard' ? ` (${i.variantName})` : ''} — ${formatNaira(i.unitPriceKobo * i.quantity)}`).join('\n');
      const transcriptNote = audioTranscript ? `🎙️ _"${audioTranscript}"_\n\n` : '';
      const summary = `${transcriptNote}🧾 *Confirm sale for ${businessName}*\n\n${lines}\n\nSubtotal: ${formatNaira(draft.totals.subtotalKobo - draft.totals.discountKobo)}\n${draft.totals.deliveryFeeKobo ? `Delivery: ${formatNaira(draft.totals.deliveryFeeKobo)}\n` : ''}*Total: ${formatNaira(total)}*\nPaid: ${formatNaira(amountPaid)}${amountOwed ? `\nOwed: ${formatNaira(amountOwed)} (due ${lagosDisplay(draft.dueDate, 'd MMM')})` : ''}\nCustomer: ${customerName}\n\nReply *YES* to save, *NO* to cancel. You can undo for 15 minutes after saving.`;
      const pending: PendingSale = {
        type: 'sale',
        createdAt: new Date().toISOString(),
        items: draft.items.map((i) => ({
          productId: i.productId,
          variantId: i.variantId,
          quantity: i.quantity,
          unitPriceKobo: i.quotedUnitPriceKobo ?? i.unitPriceKobo,
          name: i.name,
          variantName: i.variantName,
        })),
        customerName,
        customerPhone,
        amountPaidKobo: amountPaid,
        amountOwedKobo: amountOwed,
        dueDate: draft.dueDate,
        deliveryFeeKobo: draft.totals.deliveryFeeKobo,
        discountKobo: draft.totals.discountKobo,
        totalKobo: total,
        summary,
        notes: draft.notes,
      };
      contact.pendingAction = pending as unknown as Record<string, unknown>;
      await contact.save();
      await this.reply(contact, summary);
    } catch (error) {
      this.logger.warn(`Bot parse failed: ${error instanceof Error ? error.message : 'unknown'}`);
      await this.reply(contact, 'I could not read that sale. Reply HELP for the exact format.');
    }
  }

  private async confirmPending(contact: WhatsappContactDocument): Promise<void> {
    const pending = contact.pendingAction as unknown as PendingSale | null;
    if (!pending || pending.type !== 'sale') {
      await this.reply(contact, 'There is no sale waiting for confirmation. Send a sale message first.');
      return;
    }
    if (Date.now() - new Date(pending.createdAt).getTime() > 15 * 60 * 1000) {
      contact.pendingAction = null;
      await contact.save();
      await this.reply(contact, 'That confirmation expired. Send the sale again and I will keep it fresh.');
      return;
    }
    try {
      const sale = await this.sales.create(contact.userId!, contact.businessId!, {
        customerName: pending.customerName,
        customerPhone: pending.customerPhone,
        items: pending.items.map((i) => ({
          productId: i.productId,
          variantId: i.variantId,
          quantity: i.quantity,
          unitPriceKobo: i.unitPriceKobo,
        })),
        discountKobo: pending.discountKobo,
        deliveryFeeKobo: pending.deliveryFeeKobo,
        amountPaidKobo: pending.amountPaidKobo,
        paymentMethod: 'cash',
        dueDate: pending.dueDate,
        notes: pending.notes,
        source: 'whatsapp',
      });
      contact.pendingAction = null;
      contact.lastUndo = {
        saleId: sale._id.toString(),
        at: new Date().toISOString(),
        saleNumber: sale.saleNumber,
      };
      await contact.save();
      let receiptLine = '';
      if (sale.receiptId) {
        try {
          const receipt = await this.receipts.findOne(contact.businessId!, sale.receiptId);
          receiptLine = `\n🧾 Receipt: ${this.config.get('appUrl')}/receipt/${receipt.publicToken}`;
        } catch {
          receiptLine = '';
        }
      }
      let paymentLine = '';
      if (sale.debtId) {
        const token = await this.debts.publicTokenFor(contact.businessId!, sale.debtId.toString());
        if (token) {
          paymentLine = `\n💳 Payment page: ${this.config.get('appUrl')}/pay/debt/${token}\n(Forward this to the customer — they can pay online if Paystack is connected.)`;
        }
      }
      await this.reply(
        contact,
        `✅ *Saved* · ${sale.saleNumber}\n\nTotal: ${formatNaira(sale.totalKobo)}\nPaid: ${formatNaira(sale.amountPaidKobo)}${sale.paymentStatus !== 'paid' ? `\nOwed: ${formatNaira(sale.totalKobo - sale.amountPaidKobo)}` : ''}\nProfit: ${formatNaira(sale.grossProfitKobo)}${receiptLine}${paymentLine}\n\nReply *UNDO* within 15 minutes to reverse this sale.`,
      );
    } catch (error) {
      await this.reply(contact, `I couldn't save that sale: ${error instanceof Error ? error.message : 'unknown error'}. Nothing was changed. Fix it and reply YES again.`);
    }
  }

  private async undoLast(contact: WhatsappContactDocument): Promise<void> {
    const undo = contact.lastUndo as unknown as LastUndo | null;
    if (!undo) {
      await this.reply(contact, 'There is no recent sale to undo on this number.');
      return;
    }
    if (Date.now() - new Date(undo.at).getTime() > 15 * 60 * 1000) {
      await this.reply(contact, 'That undo window has passed (15 minutes). Open the sale on Ojaly to correct it.');
      return;
    }
    try {
      await this.sales.voidSale(contact.userId!, contact.businessId!, undo.saleId, 'Undone from WhatsApp');
      contact.lastUndo = null;
      await contact.save();
      await this.reply(contact, `↩️ Undone. Sale ${undo.saleNumber} was reversed and stock is back.`);
    } catch (error) {
      await this.reply(contact, `I couldn't undo that sale: ${error instanceof Error ? error.message : 'unknown error'}.`);
    }
  }

  private async stockCommand(contact: WhatsappContactDocument): Promise<void> {
    const [low, summary] = await Promise.all([
      this.productsService.lowStock(contact.businessId!),
      this.stock.summary(contact.businessId!),
    ]);
    const lines = low.slice(0, 10).map((i) => `• ${i.name}${i.variantName !== 'Standard' ? ` (${i.variantName})` : ''}: ${i.quantity <= 0 ? 'OUT' : `${i.quantity} left`}`).join('\n');
    await this.reply(
      contact,
      `📦 *Stock at a glance*\n\nUnits: ${summary.units}\nStock value: ${formatNaira(summary.costValueKobo)}\nRetail value: ${formatNaira(summary.retailValueKobo)}\nLow stock: ${summary.lowStock}\nOut of stock: ${summary.outOfStock}\n\n${lines || 'Everything is healthy. ✅'}\n\nFull stock page: ${this.config.get('appUrl')}/app/stock`,
    );
  }

  private async owesCommand(contact: WhatsappContactDocument): Promise<void> {
    const debts = await this.debts.list(contact.businessId!, { status: 'all', page: 1, limit: 6 });
    const lines = debts.items.filter((d) => d.balanceKobo > 0).map((d) => `• ${d.customerName}: ${formatNaira(d.balanceKobo)} (due ${lagosDisplay(d.dueDate, 'd MMM')})`).join('\n');
    await this.reply(
      contact,
      `🤝 *Money owed to you*\n\nTotal: ${formatNaira(debts.meta.totalOutstandingKobo)}\nOverdue: ${formatNaira(debts.meta.overdueKobo)}\n\n${lines || 'Nobody owes you right now. 🎉'}\n\nDebt book: ${this.config.get('appUrl')}/app/debts`,
    );
  }

  private async recordExpense(
    contact: WhatsappContactDocument,
    rawAmount: string,
    rest: string,
    audioTranscript?: string,
  ): Promise<void> {
    const amountKobo = Math.round(Number(rawAmount.replace(/,/g, '')) * 100);
    if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
      await this.reply(contact, 'That expense amount is not valid. Try: *EXPENSE 2500 transport*');
      return;
    }
    if (amountKobo > 100000000) {
      await this.reply(contact, 'That amount is too large for a single expense. Split it or record it in the app.');
      return;
    }
    const note = rest.trim().slice(0, 300);
    const haystack = note.toLowerCase();
    const category = /transport|bus|taxi|uber|bolt|fuel|keke/.test(haystack) ? 'transport'
      : /data|airtime|internet|wifi|subscription/.test(haystack) ? 'data'
      : /packag|bag|tape|label/.test(haystack) ? 'packaging'
      : /rent|shop|space/.test(haystack) ? 'rent'
      : /ad|promo|boost|flyer/.test(haystack) ? 'ads'
      : /stock|supplier|inventory|restock/.test(haystack) ? 'stock_purchase'
      : 'other';
    try {
      await this.expenses.create(contact.userId!, contact.businessId!, {
        category,
        amountKobo,
        date: new Date().toISOString().slice(0, 10),
        notes: note || 'Recorded from WhatsApp',
        recurrence: 'none',
      });
      const label = category.replace('_', ' ');
      const transcriptNote = audioTranscript ? `🎙️ _"${audioTranscript}"_\n\n` : '';
      await this.reply(contact, `${transcriptNote}✅ *Expense recorded*\n\n${formatNaira(amountKobo)} · ${label}${note ? `\n${note}` : ''}\n\nYour daily summary now includes this cost. Open Ojaly: ${this.config.get('appUrl')}/app/expenses`);
    } catch (error) {
      await this.reply(contact, `I couldn't save that expense: ${error instanceof Error ? error.message : 'unknown error'}.`);
    }
  }

  private parseStrict(text: string, catalog: Product[]): {
    items: { productId: string; variantId: string; quantity: number; unitPriceKobo: number; name: string; variantName: string }[];
    customerName: string | null;
    customerPhone: string | null;
    address: string | null;
    amountOwedKobo: number | null;
    amountPaidKobo: number | null;
    deliveryFeeKobo: number;
    dueDate: string;
  } {
    const cleaned = text.replace(/(?:\+?234|0)[789][01]\d{8}/g, ' ');
    const owesMatch = cleaned.match(/(?:([a-zA-Z][a-zA-Z0-9'.-]+(?:\s+[a-zA-Z][a-zA-Z0-9'.-]+)?)\s+)?(?:owes?|owing|debt|balance)\s+(?:₦|N)?\s*([\d,]+)/i);
    const salesText = cleaned
      .replace(/(?:[a-zA-Z][a-zA-Z0-9'.-]+(?:\s+[a-zA-Z][a-zA-Z0-9'.-]+)?\s+)?(?:owes?|owing|debt|balance)\s+(?:₦|N)?\s*[\d,]+/gi, ' ')
      .replace(/\b(?:paid|paid\s+me|deposit)\s+(?:₦|N)?\s*[\d,]+/gi, ' ')
      .replace(/\b(?:delivery|shipping)\s+(?:₦|N)?\s*[\d,]+/gi, ' ');
    const startsWithSale = /(?:sold|sell|sale)\b/i.test(salesText);
    const matches = startsWithSale
      ? [...salesText.matchAll(/(\d{1,4})\s*(?:x\s*)?([a-z][a-z0-9 &'/.-]{1,60}?)\s+(?:at|for|@|each at)?\s*(?:₦|N)?\s*([\d,]+(?:\.\d{1,2})?)\s*(k?)(?:\s*(each|total))?/gi)]
      : [];
    const items: ReturnType<BotService['parseStrict']>['items'] = [];
    for (const match of matches) {
      const quantity = parseInt(match[1], 10);
      const phrase = match[2].replace(/\b(?:for|to|at|each|total)\b/gi, '').trim();
      const resolved = this.parser.matchProduct(phrase, catalog);
      if (!resolved) continue;
      let unit = Number(match[3].replace(/,/g, '')) * (match[4] ? 1000 : 1) * 100;
      if (match[5]?.toLowerCase() === 'total' && quantity > 0) unit = Math.round(unit / quantity);
      items.push({
        productId: resolved.productId,
        variantId: resolved.variantId,
        quantity,
        unitPriceKobo: unit,
        name: resolved.name,
        variantName: resolved.variantName,
      });
    }
    const phoneMatch = text.match(/(?:\+?234|0)[789][01]\d{8}/);
    const rawCustomerName = (owesMatch?.[1] ? owesMatch[1].trim() : null) ||
      text.match(/CUSTOMER\s+([a-zA-Z][a-zA-Z0-9'.-]+(?:\s+[a-zA-Z][a-zA-Z0-9'.-]+)?)/i)?.[1]?.trim() ||
      text.match(/(?:to|for)\s+([a-zA-Z][a-zA-Z0-9'.-]+(?:\s+[a-zA-Z][a-zA-Z0-9'.-]+)?)\b/i)?.[1]?.trim() ||
      null;
    const customerName = rawCustomerName ? rawCustomerName.charAt(0).toUpperCase() + rawCustomerName.slice(1) : null;
    const address = text.match(/(?:deliver(?:y)?(?:\s+to)?|address)\s+([^.\n,;]{3,120})/i)?.[1]?.trim() || null;
    const delivery = text.match(/(?:delivery|shipping)\s+(?:₦|N)?\s*([\d,]+)/i)?.[1];
    const paid = text.match(/\b(?:paid|deposit)\s+(?:₦|N)?\s*([\d,]+)/i)?.[1];
    const due = text.match(/\bDUE\s+(\d{4}-\d{2}-\d{2})/i)?.[1];
    return {
      items,
      customerName,
      customerPhone: phoneMatch ? normalizeNigerianPhone(phoneMatch[0]) : null,
      address,
      amountOwedKobo: owesMatch ? Number(owesMatch[2].replace(/,/g, '')) * 100 : null,
      amountPaidKobo: paid ? Number(paid.replace(/,/g, '')) * 100 : null,
      deliveryFeeKobo: delivery ? Number(delivery.replace(/,/g, '')) * 100 : 0,
      dueDate: due || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    };
  }

  private async reply(contact: WhatsappContactDocument, text: string): Promise<void> {
    await this.whatsapp.sendTextDirect(contact.businessId || '', contact.phone, text);
  }
}
