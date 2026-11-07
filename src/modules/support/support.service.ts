import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomToken } from '../../common/utils/tokens';
import { normalizeNigerianPhone } from '../../common/utils/phone';
import { escapeHtml, sanitizeText } from '../../common/utils/sanitize';
import { MailService } from '../mail/mail.service';
import { SupportAttachment, SupportConversation, SupportConversationDocument, SupportMessage, SupportMessageDocument } from './support.schema';

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
      status: 'open', unreadAdmin: 1, unreadVisitor: 1,
    });
    const welcome = await this.messages.create({
      conversationId: String(conversation._id), sender: 'admin', senderName: 'Ojaly Support',
      body: `Hi ${conversation.visitorName.split(' ')[0] || 'there'} — thanks for reaching out. An Ojaly team member will reply here shortly. You can send images or voice notes if that helps.`,
      readByAdminAt: new Date(),
    });
    conversation.lastMessageAt = new Date();
    await conversation.save();
    await this.mail.send({
      to: 'hello@ojaly.org', subject: `New support chat · ${conversation.visitorName}`,
      template: 'support_chat_started', html: `<p><strong>${conversation.visitorName}</strong> started a support chat.</p><p>Email: ${conversation.visitorEmail}<br>Phone: ${conversation.visitorPhone}</p><p>Open Ojaly Ops → Support inbox to reply.</p>`,
    }).catch(() => undefined);
    return { token: conversation.publicToken, conversation: this.conversationView(conversation), messages: [this.messageView(welcome, 'visitor')] };
  }

  async publicThread(token: string) {
    const conversation = await this.conversations.findOne({ publicToken: token }).exec();
    if (!conversation) throw new NotFoundException('Conversation not found.');
    await this.messages.updateMany({ conversationId: String(conversation._id), sender: 'admin', readByVisitorAt: null }, { $set: { readByVisitorAt: new Date() } }).exec();
    conversation.unreadVisitor = 0;
    await conversation.save();
    const messages = await this.messages.find({ conversationId: String(conversation._id) }).sort({ createdAt: 1 }).limit(300).lean().exec();
    return { conversation: this.conversationView(conversation), messages: messages.map((message) => this.messageView(message, 'visitor')), typing: { visitor: this.isTyping(conversation.visitorTypingAt), admin: this.isTyping(conversation.adminTypingAt) } };
  }

  async sendPublic(token: string, body: string, attachments: SupportAttachment[] = []) {
    const conversation = await this.conversations.findOne({ publicToken: token }).exec();
    if (!conversation) throw new NotFoundException('Conversation not found.');
    if (conversation.status === 'closed') throw new BadRequestException('This conversation is closed. Start a new chat.');
    const clean = this.cleanAttachments(attachments);
    if (!body.trim() && !clean.length) throw new BadRequestException('Write a message or attach a file.');
    const message = await this.messages.create({
      conversationId: String(conversation._id), sender: 'visitor', senderName: conversation.visitorName,
      body: sanitizeText(body, 3000), attachments: clean, readByVisitorAt: new Date(),
    });
    conversation.unreadAdmin += 1; conversation.lastMessageAt = new Date(); conversation.status = 'open'; conversation.visitorTypingAt = null;
    await conversation.save();
    await this.mail.send({
      to: 'hello@ojaly.org', subject: `New support message · ${conversation.visitorName}`,
      template: 'support_chat_message',
      html: `<p><strong>${conversation.visitorName}</strong> sent a support message.</p><p>${escapeHtml(message.body || 'Attachment sent')}</p><p>Email: ${conversation.visitorEmail}<br>Phone: ${conversation.visitorPhone}</p><p>Reply in Ojaly Ops → Support inbox.</p>`,
    }).catch(() => undefined);
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
    return { conversation: this.conversationView(conversation), messages: messages.map((message) => this.messageView(message, 'admin')), typing: { visitor: this.isTyping(conversation.visitorTypingAt), admin: this.isTyping(conversation.adminTypingAt) } };
  }

  async sendAdmin(id: string, body: string, adminName: string, attachments: SupportAttachment[] = []) {
    const conversation = await this.conversations.findById(id).exec();
    if (!conversation) throw new NotFoundException('Conversation not found.');
    if (conversation.status === 'closed') throw new BadRequestException('This conversation is closed.');
    const clean = this.cleanAttachments(attachments);
    if (!body.trim() && !clean.length) throw new BadRequestException('Write a message or attach a file.');
    const message = await this.messages.create({
      conversationId: String(conversation._id), sender: 'admin', senderName: adminName || 'Ojaly Support',
      body: sanitizeText(body, 3000), attachments: clean, readByAdminAt: new Date(),
    });
    conversation.unreadVisitor += 1; conversation.lastMessageAt = new Date(); conversation.adminTypingAt = null;
    await conversation.save();
    return this.messageView(message, 'admin');
  }

  async setVisitorTyping(token: string) {
    const conversation = await this.conversations.findOne({ publicToken: token }).exec();
    if (!conversation || conversation.status === 'closed') return { typing: false };
    conversation.visitorTypingAt = new Date();
    await conversation.save();
    return { typing: true };
  }

  async setAdminTyping(id: string) {
    const conversation = await this.conversations.findById(id).exec();
    if (!conversation || conversation.status === 'closed') return { typing: false };
    conversation.adminTypingAt = new Date();
    await conversation.save();
    return { typing: true };
  }

  private isTyping(value: Date | null | undefined) { return Boolean(value && Date.now() - new Date(value).getTime() < 5000); }

  async close(id: string) {
    const conversation = await this.conversations.findByIdAndUpdate(id, { $set: { status: 'closed' } }, { new: true }).exec();
    if (!conversation) throw new NotFoundException('Conversation not found.');
    return this.conversationView(conversation);
  }

  private cleanAttachments(attachments: SupportAttachment[] = []) {
    return attachments.slice(0, 3).filter((item) => (item.type === 'image' || item.type === 'audio') && /^https?:\/\//.test(item.url));
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
      body: message.body, attachments: message.attachments || [], createdAt: (message as { createdAt?: Date }).createdAt,
      seen: role === 'admin' ? Boolean(message.readByAdminAt) : Boolean(message.readByVisitorAt),
    };
  }
}
