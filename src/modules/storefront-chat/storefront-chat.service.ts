import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Product, ProductDocument } from '../products/product.schema';
import { Service, ServiceDocument } from '../services/service.schema';
import { Membership, MembershipDocument } from '../memberships/membership.schema';
import { User, UserDocument } from '../users/user.schema';
import { MailService } from '../mail/mail.service';
import { WhatsappClientService } from '../whatsapp/whatsapp-client.service';
import { randomToken } from '../../common/utils/tokens';
import { normalizeNigerianPhone } from '../../common/utils/phone';
import { sanitizeText, escapeHtml } from '../../common/utils/sanitize';
import { StorefrontChatAttachment, StorefrontChatMessage, StorefrontChatMessageDocument, StorefrontConversation, StorefrontConversationDocument } from './storefront-chat.schema';
import { StartStorefrontChatDto } from './storefront-chat.dto';

@Injectable()
export class StorefrontChatService {
  constructor(
    @InjectModel(StorefrontConversation.name) private readonly conversations: Model<StorefrontConversationDocument>,
    @InjectModel(StorefrontChatMessage.name) private readonly messages: Model<StorefrontChatMessageDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Service.name) private readonly services: Model<ServiceDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly mail: MailService,
    private readonly whatsapp: WhatsappClientService,
  ) {}

  async start(businessId: string, dto: StartStorefrontChatDto) {
    const business = await this.businesses.findOne({ _id: businessId, storefrontPublished: true, isSuspended: { $ne: true } }).exec();
    if (!business) throw new NotFoundException('This storefront is not available for chat.');
    const phone = normalizeNigerianPhone(dto.phone) || dto.phone.trim();
    const contextType = dto.contextType || 'general';
    let contextName = sanitizeText(dto.contextName || '', 160);
    let contextId: string | null = dto.contextId || null;
    if (contextType === 'product' && contextId) {
      const product = await this.products.findOne({ _id: contextId, businessId, isActive: true }).select('name').lean().exec();
      if (!product) throw new BadRequestException('That product is no longer available.');
      contextName = product.name;
    } else if (contextType === 'service' && contextId) {
      const service = await this.services.findOne({ _id: contextId, businessId, isActive: true, isPublic: true }).select('name').lean().exec();
      if (!service) throw new BadRequestException('That service is no longer available.');
      contextName = service.name;
    } else {
      contextId = null;
    }
    const conversation = await this.conversations.create({
      businessId, publicToken: randomToken(24), visitorName: sanitizeText(dto.name, 100),
      visitorPhone: phone, visitorEmail: dto.email?.toLowerCase() || null,
      contextType: contextId ? contextType : 'general', contextId, contextName,
      status: 'open', unreadAdmin: 0, unreadVisitor: 0,
    });
    return { token: conversation.publicToken, conversation: this.viewConversation(conversation), messages: [] };
  }

  async publicThread(token: string) {
    const conversation = await this.conversations.findOne({ publicToken: token }).exec();
    if (!conversation) throw new NotFoundException('Conversation not found.');
    await this.messages.updateMany({ conversationId: String(conversation._id), sender: 'business', readByVisitorAt: null }, { $set: { readByVisitorAt: new Date() } }).exec();
    conversation.unreadVisitor = 0;
    await conversation.save();
    return this.thread(conversation, 'visitor');
  }

  async sendCustomer(token: string, body: string, attachments: StorefrontChatAttachment[] = []) {
    const conversation = await this.conversations.findOne({ publicToken: token }).exec();
    if (!conversation) throw new NotFoundException('Conversation not found.');
    if (conversation.status === 'closed') throw new BadRequestException('This conversation is closed.');
    const clean = this.cleanAttachments(attachments);
    if (!body.trim() && !clean.length) throw new BadRequestException('Write a message or attach an image or voice note.');
    const message = await this.messages.create({
      conversationId: String(conversation._id), sender: 'visitor', senderName: conversation.visitorName,
      body: sanitizeText(body, 3000), attachments: clean, readByVisitorAt: new Date(),
    });
    conversation.unreadAdmin += 1;
    conversation.lastMessageAt = new Date();
    conversation.status = 'open';
    await conversation.save();
    await this.notifyVendor(conversation, message).catch(() => undefined);
    return this.viewMessage(message);
  }

  async vendorList(businessId: string) {
    const conversations = await this.conversations.find({ businessId }).sort({ lastMessageAt: -1, createdAt: -1 }).limit(200).lean().exec();
    return conversations.map((conversation) => ({
      ...this.viewConversation(conversation), lastMessage: '', lastSender: null,
    }));
  }

  async vendorThread(businessId: string, id: string) {
    const conversation = await this.conversations.findOne({ _id: id, businessId }).exec();
    if (!conversation) throw new NotFoundException('Conversation not found.');
    await this.messages.updateMany({ conversationId: id, sender: 'visitor', readByAdminAt: null }, { $set: { readByAdminAt: new Date() } }).exec();
    conversation.unreadAdmin = 0;
    await conversation.save();
    return this.thread(conversation, 'admin');
  }

  async sendVendor(businessId: string, id: string, body: string, attachments: StorefrontChatAttachment[] = []) {
    const conversation = await this.conversations.findOne({ _id: id, businessId }).exec();
    if (!conversation) throw new NotFoundException('Conversation not found.');
    if (conversation.status === 'closed') throw new BadRequestException('This conversation is closed.');
    const clean = this.cleanAttachments(attachments);
    if (!body.trim() && !clean.length) throw new BadRequestException('Write a message or attach an image or voice note.');
    const business = await this.businesses.findById(businessId).select('name').lean().exec();
    const message = await this.messages.create({
      conversationId: id, sender: 'business', senderName: business?.name || 'Business',
      body: sanitizeText(body, 3000), attachments: clean, readByAdminAt: new Date(),
    });
    conversation.unreadVisitor += 1;
    conversation.lastMessageAt = new Date();
    await conversation.save();
    return this.viewMessage(message);
  }

  async close(businessId: string, id: string) {
    const conversation = await this.conversations.findOneAndUpdate({ _id: id, businessId }, { $set: { status: 'closed' } }, { new: true }).exec();
    if (!conversation) throw new NotFoundException('Conversation not found.');
    return this.viewConversation(conversation);
  }

  private async thread(conversation: StorefrontConversationDocument, role: 'visitor' | 'admin') {
    const messages = await this.messages.find({ conversationId: String(conversation._id) }).sort({ createdAt: 1 }).limit(500).lean().exec();
    return { conversation: this.viewConversation(conversation), messages: messages.map((message) => this.viewMessage(message, role)) };
  }

  private async notifyVendor(conversation: StorefrontConversationDocument, message: StorefrontChatMessageDocument) {
    if (conversation.lastNotifiedAt && Date.now() - new Date(conversation.lastNotifiedAt).getTime() < 10 * 60 * 1000) return;
    conversation.lastNotifiedAt = new Date();
    await conversation.save();
    const business = await this.businesses.findById(conversation.businessId).lean().exec();
    if (!business) return;
    const owner = await this.memberships.findOne({ businessId: conversation.businessId, role: 'owner', status: 'active' }).lean().exec();
    const user = owner ? await this.users.findById(owner.userId).lean().exec() : null;
    const link = `${process.env.APP_URL || 'https://ojaly.org'}/app/inquiries?thread=${conversation._id.toString()}`;
    const context = conversation.contextName ? ` about ${conversation.contextName}` : '';
    const preview = message.body || 'Sent an image or voice note.';
    const text = `💬 New Ojaly customer message\n\n${conversation.visitorName}${context}:\n"${preview.slice(0, 240)}"\n\nOpen and reply in Ojaly:\n${link}`;
    const phone = user?.phone || business.whatsappNumber || business.publicPhone;
    if (phone) await this.whatsapp.sendTextDirect(conversation.businessId, phone, text).catch(() => undefined);
    const email = business.email || user?.email;
    if (email) await this.mail.send({
      to: email, subject: `New customer message · ${business.name}`, template: 'storefront_chat', businessId: conversation.businessId,
      html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px"><h2>New customer message</h2><p><strong>${escapeHtml(conversation.visitorName)}</strong>${escapeHtml(context)} sent a message:</p><blockquote style="border-left:3px solid #FF5A1F;padding-left:12px;color:#334">${escapeHtml(preview.slice(0, 800))}</blockquote><p><a href="${link}" style="display:inline-block;background:#06231A;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none">Open chat in Ojaly</a></p><p style="color:#66756b;font-size:12px">Reply inside Ojaly so the conversation stays with the customer and their order.</p></div>`,
    }).catch(() => undefined);
  }

  private cleanAttachments(attachments: StorefrontChatAttachment[] = []) {
    return attachments.slice(0, 3).filter((a) => (a.type === 'image' || a.type === 'audio') && /^https?:\/\//.test(a.url));
  }

  private viewConversation(conversation: StorefrontConversation | (StorefrontConversation & { _id: unknown })) {
    return {
      id: String((conversation as { _id: unknown })._id), token: conversation.publicToken,
      businessId: conversation.businessId, name: conversation.visitorName, phone: conversation.visitorPhone, email: conversation.visitorEmail,
      contextType: conversation.contextType, contextId: conversation.contextId, contextName: conversation.contextName,
      status: conversation.status, unreadAdmin: conversation.unreadAdmin || 0, unreadVisitor: conversation.unreadVisitor || 0,
      lastMessageAt: conversation.lastMessageAt, createdAt: (conversation as { createdAt?: Date }).createdAt,
    };
  }

  private viewMessage(message: StorefrontChatMessage | (StorefrontChatMessage & { _id: unknown }), role: 'visitor' | 'admin' = 'admin') {
    return {
      id: String((message as { _id: unknown })._id), sender: message.sender, senderName: message.senderName,
      body: message.body, attachments: message.attachments || [], createdAt: (message as { createdAt?: Date }).createdAt,
      seen: role === 'admin' ? Boolean(message.readByAdminAt) : Boolean(message.readByVisitorAt),
    };
  }
}
