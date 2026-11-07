import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomToken } from '../../common/utils/tokens';
import { normalizeNigerianPhone } from '../../common/utils/phone';
import { sanitizeText } from '../../common/utils/sanitize';
import { MailService } from '../mail/mail.service';
import { SupportConversation, SupportConversationDocument, SupportMessage, SupportMessageDocument } from './support.schema';

@Injectable()
export class SupportService {
  constructor(
    @InjectModel(SupportConversation.name) private readonly conversations: Model<SupportConversationDocument>,
    @InjectModel(SupportMessage.name) private readonly messages: Model<SupportMessageDocument>,
    private readonly mail: MailService,
  ) {}

  async start(input: { name: string; email: string; phone: string }) {
    const phone = normalizeNigerianPhone(input.phone) || input.phone.trim();
    if (!/^\+?\d{10,15}$/.test(phone.replace(/\s/g, ''))) throw new BadRequestException('Enter a valid phone number.');
    const conversation = await this.conversations.create({
      publicToken: randomToken(24), visitorName: sanitizeText(input.name, 100),
      visitorEmail: input.email.toLowerCase().trim(), visitorPhone: phone,
      status: 'open', unreadAdmin: 0, unreadVisitor: 0,
    });
    await this.mail.send({
      to: 'hello@ojaly.org', subject: `New support chat · ${conversation.visitorName}`,
      template: 'support_chat_started', html: `<p><strong>${conversation.visitorName}</strong> started a support chat.</p><p>Email: ${conversation.visitorEmail}<br>Phone: ${conversation.visitorPhone}</p><p>Open Ojaly Ops → Support inbox to reply.</p>`,
    }).catch(() => undefined);
    return { token: conversation.publicToken, conversation: this.conversationView(conversation), messages: [] };
  }

  async publicThread(token: string) {
    const conversation = await this.conversations.findOne({ publicToken: token }).exec();
    if (!conversation) throw new NotFoundException('Conversation not found.');
    await this.messages.updateMany({ conversationId: String(conversation._id), sender: 'admin', readByVisitorAt: null }, { $set: { readByVisitorAt: new Date() } }).exec();
    conversation.unreadVisitor = 0;
    await conversation.save();
    const messages = await this.messages.find({ conversationId: String(conversation._id) }).sort({ createdAt: 1 }).limit(300).lean().exec();
    return { conversation: this.conversationView(conversation), messages: messages.map((message) => this.messageView(message, 'visitor')) };
  }

  async sendPublic(token: string, body: string) {
    const conversation = await this.conversations.findOne({ publicToken: token }).exec();
    if (!conversation) throw new NotFoundException('Conversation not found.');
    if (conversation.status === 'closed') throw new BadRequestException('This conversation is closed. Start a new chat.');
    const message = await this.messages.create({
      conversationId: String(conversation._id), sender: 'visitor', senderName: conversation.visitorName,
      body: sanitizeText(body, 3000), readByVisitorAt: new Date(),
    });
    conversation.unreadAdmin += 1; conversation.lastMessageAt = new Date(); conversation.status = 'open';
    await conversation.save();
    return this.messageView(message, 'visitor');
  }

  async adminList() {
    const conversations = await this.conversations.find({}).sort({ lastMessageAt: -1, createdAt: -1 }).limit(200).lean().exec();
    const ids = conversations.map((c) => String(c._id));
    const latest = await this.messages.aggregate([
      { $match: { conversationId: { $in: ids } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$conversationId', body: { $first: '$body' }, sender: { $first: '$sender' }, createdAt: { $first: '$createdAt' } } },
    ]).exec();
    const map = new Map(latest.map((m) => [String(m._id), m]));
    return conversations.map((conversation) => ({
      ...this.conversationView(conversation), lastMessage: map.get(String(conversation._id))?.body || '',
      lastSender: map.get(String(conversation._id))?.sender || null,
      lastMessageAt: map.get(String(conversation._id))?.createdAt || conversation.createdAt,
    }));
  }

  async adminThread(id: string) {
    const conversation = await this.conversations.findById(id).exec();
    if (!conversation) throw new NotFoundException('Conversation not found.');
    await this.messages.updateMany({ conversationId: String(conversation._id), sender: 'visitor', readByAdminAt: null }, { $set: { readByAdminAt: new Date() } }).exec();
    conversation.unreadAdmin = 0;
    await conversation.save();
    const messages = await this.messages.find({ conversationId: String(conversation._id) }).sort({ createdAt: 1 }).limit(300).lean().exec();
    return { conversation: this.conversationView(conversation), messages: messages.map((message) => this.messageView(message, 'admin')) };
  }

  async sendAdmin(id: string, body: string, adminName: string) {
    const conversation = await this.conversations.findById(id).exec();
    if (!conversation) throw new NotFoundException('Conversation not found.');
    if (conversation.status === 'closed') throw new BadRequestException('This conversation is closed.');
    const message = await this.messages.create({
      conversationId: String(conversation._id), sender: 'admin', senderName: adminName || 'Ojaly Support',
      body: sanitizeText(body, 3000), readByAdminAt: new Date(),
    });
    conversation.unreadVisitor += 1; conversation.lastMessageAt = new Date();
    await conversation.save();
    return this.messageView(message, 'admin');
  }

  async close(id: string) {
    const conversation = await this.conversations.findByIdAndUpdate(id, { $set: { status: 'closed' } }, { new: true }).exec();
    if (!conversation) throw new NotFoundException('Conversation not found.');
    return this.conversationView(conversation);
  }

  private conversationView(conversation: SupportConversationDocument | SupportConversation) {
    return {
      id: String((conversation as { _id: unknown })._id), token: conversation.publicToken,
      name: conversation.visitorName, email: conversation.visitorEmail, phone: conversation.visitorPhone,
      status: conversation.status, unreadAdmin: conversation.unreadAdmin || 0,
      unreadVisitor: conversation.unreadVisitor || 0, lastMessageAt: conversation.lastMessageAt,
      createdAt: (conversation as { createdAt?: Date }).createdAt,
    };
  }

  private messageView(message: SupportMessageDocument | SupportMessage, role: 'visitor' | 'admin') {
    return {
      id: String((message as { _id: unknown })._id), sender: message.sender, senderName: message.senderName,
      body: message.body, createdAt: (message as { createdAt?: Date }).createdAt,
      seen: role === 'admin' ? Boolean(message.readByAdminAt) : Boolean(message.readByVisitorAt),
    };
  }
}
