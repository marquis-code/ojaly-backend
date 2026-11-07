import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Product, ProductDocument } from '../products/product.schema';
import { Membership, MembershipDocument } from '../memberships/membership.schema';
import { User, UserDocument } from '../users/user.schema';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { ServicesService } from '../services/services.service';
import { ProvidersService } from '../providers/providers.service';
import { BookingsService } from '../bookings/bookings.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { ReviewsService } from '../reviews/reviews.service';
import { PackagesService } from '../packages/packages.service';
import type { PackageCheckoutDto } from '../packages/package.dto';
import { CreateWaitlistDto } from '../waitlist/waitlist.dto';
import { AvailabilityService } from '../bookings/availability.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { StorefrontMessage, StorefrontMessageDocument } from './storefront-message.schema';
import { getTemplate } from '../builder/templates';
import { storefrontMessageEmail } from '../mail/email-templates';
import { normalizeNigerianPhone, waLink } from '../../common/utils/phone';
import { sanitizeText } from '../../common/utils/sanitize';
import { formatNaira } from '../../common/utils/money';
import { StorefrontContactDto, StorefrontOrderDto, StorefrontProductQueryDto } from './dto/storefront.dto';
import { CreateBookingDto } from '../bookings/booking.dto';

@Injectable()
export class StorefrontService {
  constructor(
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(StorefrontMessage.name) private readonly messageModel: Model<StorefrontMessageDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly services: ServicesService,
    private readonly providers: ProvidersService,
    private readonly bookings: BookingsService,
    private readonly waitlist: WaitlistService,
    private readonly reviews: ReviewsService,
    private readonly packages: PackagesService,
    private readonly availability: AvailabilityService,
    private readonly config: ConfigService,
  ) {}

  async home(slug: string) {
    const business = await this.requireBusiness({ slug: slug.toLowerCase() });
    const mode = business.businessMode || 'products';
    const [products, categories, services, providers] = await Promise.all([
      mode === 'services' ? Promise.resolve([]) : this.products.find({ businessId: business._id.toString(), isActive: true }).sort({ createdAt: -1 }).limit(8).lean().exec(),
      mode === 'services' ? Promise.resolve([]) : this.products.distinct('category', { businessId: business._id.toString(), isActive: true }).exec(),
      mode === 'products' ? Promise.resolve([]) : this.services.publicList(business._id.toString()),
      mode === 'products' ? Promise.resolve([]) : this.providers.publicList(business._id.toString()),
    ]);
    return {
      business: this.publicBusiness(business),
      template: getTemplate(business.templateKey),
      products: products.map((p) => this.publicProduct(p)),
      categories: (categories as string[]).filter(Boolean),
      productCount: mode === 'services' ? 0 : await this.products.countDocuments({ businessId: business._id.toString(), isActive: true }).exec(),
      services,
      serviceCount: services.length,
      providers,
      businessMode: mode,
    };
  }

  async servicesList(slug: string) {
    const business = await this.requireBusiness({ slug: slug.toLowerCase() });
    const [items, providers, categories] = await Promise.all([
      this.services.publicList(business._id.toString()),
      this.providers.publicList(business._id.toString()),
      this.services.categories(business._id.toString()),
    ]);
    return { business: this.publicBusiness(business), template: getTemplate(business.templateKey), items, providers, categories };
  }

  async serviceDetail(slug: string, id: string) {
    const business = await this.requireBusiness({ slug: slug.toLowerCase() });
    const [service, providers, reviews, packages] = await Promise.all([
      this.services.publicOne(business._id.toString(), id),
      this.providers.publicList(business._id.toString()),
      this.reviews.publishedForBusiness(business._id.toString(), id),
      this.packages.publicList(business._id.toString(), id),
    ]);
    const eligible = providers.filter((p) => !service.providerIds?.length || service.providerIds.includes(p.id));
    return { business: this.publicBusiness(business), template: getTemplate(business.templateKey), service, providers: eligible, reviews, packages };
  }

  async availabilityForService(slug: string, query: { serviceId: string; date: string; providerId?: string; durationMinutes?: number }) {
    const business = await this.requireBusiness({ slug: slug.toLowerCase() });
    return this.availability.forService(business._id.toString(), query.serviceId, query.date, query.providerId, query.durationMinutes);
  }

  async packagesList(slug: string) {
    const business = await this.requireBusiness({ slug: slug.toLowerCase() });
    return { business: this.publicBusiness(business), template: getTemplate(business.templateKey), items: await this.packages.publicList(business._id.toString()) };
  }

  async packageCheckout(slug: string, packageId: string, dto: PackageCheckoutDto) {
    const business = await this.requireBusiness({ slug: slug.toLowerCase() });
    const result = await this.packages.checkout(business._id.toString(), packageId, dto);
    return { ...result, business: this.publicBusiness(business) };
  }

  async joinWaitlist(slug: string, dto: CreateWaitlistDto) {
    const business = await this.requireBusiness({ slug: slug.toLowerCase() });
    const entry = await this.waitlist.join(business._id.toString(), dto);
    return { entry, business: this.publicBusiness(business) };
  }

  async placeBooking(slug: string, dto: CreateBookingDto) {
    const business = await this.requireBusiness({ slug: slug.toLowerCase() });
    const booking = await this.bookings.createPublic(business._id.toString(), dto);
    const sellerNumber = business.whatsappNumber || business.publicPhone;
    const when = new Intl.DateTimeFormat('en-NG', {
      timeZone: booking.timezone, weekday: 'short', day: 'numeric', month: 'short',
      hour: 'numeric', minute: '2-digit',
    }).format(new Date(booking.startAt));
    const message = `Hello ${business.name}! I booked *${booking.serviceName}* with ${booking.providerName} on ${when}.\n\nReference: ${booking.bookingNumber}\nName: ${booking.customerName}\nPhone: ${booking.customerPhone}\n\nManage: ${this.config.get('appUrl')}/booking/${booking.publicToken}`;
    let payment: { authorizationUrl: string; reference: string; amountKobo: number } | null = null;
    if (booking.depositKobo > 0 && booking.paymentStatus === 'unpaid') {
      const email = booking.customerEmail || dto.customerEmail;
      if (!email) throw new BadRequestException('Add your email to pay the booking deposit.');
      const link = await this.payments.publicBookingDepositLink(booking.publicToken, email);
      payment = { authorizationUrl: link.authorizationUrl, reference: link.reference, amountKobo: link.amountKobo };
    }
    return {
      booking,
      business: this.publicBusiness(business),
      payment,
      whatsappUrl: sellerNumber ? waLink(sellerNumber, message) : null,
      whatsappMessage: message,
    };
  }

  async byDomain(domain: string) {
    const clean = domain.toLowerCase().replace(/^www\./, '').split(':')[0];
    const business = await this.businesses.findOne({ customDomain: clean, customDomainVerified: true, storefrontPublished: true }).lean().exec();
    if (!business) throw new NotFoundException('No storefront is connected to this domain.');
    return this.home(business.slug);
  }

  async productsList(slug: string, query: StorefrontProductQueryDto) {
    const business = await this.requireBusiness({ slug: slug.toLowerCase() });
    const filter: Record<string, unknown> = { businessId: business._id.toString(), isActive: true };
    if (query.category && query.category !== 'all') filter.category = query.category;
    if (query.search) {
      const rx = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { description: rx }, { tags: rx }, { category: rx }];
    }
    const page = query.page || 1;
    const limit = query.limit || 24;
    const [items, total] = await Promise.all([
      this.products.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      this.products.countDocuments(filter).exec(),
    ]);
    return {
      business: this.publicBusiness(business),
      template: getTemplate(business.templateKey),
      items: items.map((p) => this.publicProduct(p)),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async product(slug: string, productId: string) {
    const business = await this.requireBusiness({ slug: slug.toLowerCase() });
    const product = await this.products.findOne({ _id: productId, businessId: business._id.toString(), isActive: true }).lean().exec();
    if (!product) throw new NotFoundException('Product not found.');
    const related = await this.products
      .find({ businessId: business._id.toString(), category: product.category, isActive: true, _id: { $ne: product._id } })
      .limit(4)
      .lean()
      .exec();
    return {
      business: this.publicBusiness(business),
      template: getTemplate(business.templateKey),
      product: this.publicProduct(product, true),
      related: related.map((p) => this.publicProduct(p)),
    };
  }

  async placeOrder(slug: string, dto: StorefrontOrderDto) {
    const business = await this.requireBusiness({ slug: slug.toLowerCase() });
    const phone = normalizeNigerianPhone(dto.customerPhone);
    if (!phone) throw new BadRequestException('Enter a valid Nigerian phone number.');
    const order = await this.orders.create(
      null,
      business._id.toString(),
      {
        customerName: sanitizeText(dto.customerName, 100),
        customerPhone: phone,
        customerEmail: dto.customerEmail,
        deliveryAddress: sanitizeText(dto.deliveryAddress, 300),
        deliveryDetails: sanitizeText(dto.deliveryDetails, 500),
        items: dto.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })),
        notes: sanitizeText(dto.notes, 1000),
        source: 'storefront',
      },
      'storefront',
    );
    const publicOrder = await this.orders.publicByToken(order.publicToken);
    const lines = order.items.map((i) => `• ${i.quantity} × ${i.name}${i.variantName !== 'Standard' ? ` (${i.variantName})` : ''} — ${formatNaira(i.lineTotalKobo)}`).join('\n');
    const sellerNumber = business.whatsappNumber || business.publicPhone;
    const message = `Hello ${business.name}! I placed order *${order.orderNumber}* on your website.\n\n${lines}\n\nTotal: ${formatNaira(order.totalKobo)}\nName: ${order.customerName}\nPhone: ${order.customerPhone}${order.deliveryAddress ? `\nDelivery: ${order.deliveryAddress}` : ''}\n\nOrder status: ${this.config.get('appUrl')}/order/${order.publicToken}`;
    let payment: { authorizationUrl: string; reference: string } | null = null;
    if (dto.payOnline) {
      if (!dto.customerEmail) throw new BadRequestException('Add your email to pay online. You can also pay on WhatsApp.');
      const link = await this.payments.publicOrderLink(order.publicToken, dto.customerEmail);
      payment = { authorizationUrl: link.authorizationUrl, reference: link.reference };
    }
    return {
      order: publicOrder.order,
      orderToken: order.publicToken,
      whatsappUrl: sellerNumber ? waLink(sellerNumber, message) : null,
      whatsappMessage: message,
      payment,
      business: publicOrder.business ? this.publicBusiness(business) : null,
    };
  }

  async contact(slug: string, dto: StorefrontContactDto) {
    const business = await this.requireBusiness({ slug: slug.toLowerCase() });
    const phone = normalizeNigerianPhone(dto.phone);
    if (!phone) throw new BadRequestException('Enter a valid Nigerian phone number.');
    const message = await this.messageModel.create({
      businessId: business._id.toString(),
      name: sanitizeText(dto.name, 100),
      phone,
      email: dto.email || null,
      message: sanitizeText(dto.message, 2000),
    });
    await this.notifications.create({
      businessId: business._id.toString(),
      type: 'storefront_message',
      title: `New website message from ${message.name}`,
      message: message.message.slice(0, 140),
      tone: 'info',
      data: { messageId: message._id.toString(), phone },
    });
    const owner = await this.memberships.findOne({ businessId: business._id.toString(), role: 'owner' }).lean().exec();
    if (owner) {
      const user = await this.users.findById(owner.userId).lean().exec();
      if (user?.email) {
        const mail = storefrontMessageEmail({
          businessName: business.name,
          businessLogo: business.logoUrl,
          businessTagline: business.tagline,
          customerName: message.name,
          customerPhone: message.phone,
          message: message.message,
          dashboardUrl: `${this.config.get('appUrl')}/app/notifications`,
        });
        void this.mail.send({
          to: user.email,
          subject: mail.subject,
          html: mail.html,
          template: 'storefront_message',
          businessId: business._id.toString(),
          replyTo: message.email || undefined,
        });
      }
    }
    return { sent: true, whatsappUrl: waLink(phone, `Hi ${message.name}, thanks for messaging ${business.name}. We got your note and we'll reply shortly.`) };
  }

  async embed(slug: string) {
    const business = await this.requireBusiness({ slug: slug.toLowerCase() });
    return {
      business: {
        name: business.name,
        slug: business.slug,
        logoUrl: business.logoUrl,
        brandColor: business.brandColor,
        tagline: business.tagline,
        whatsappNumber: business.whatsappNumber,
      },
      orderLink: `${this.config.get('appUrl')}/s/${business.slug}`,
      currency: 'NGN',
    };
  }

  async messages(businessId: string) {
    return this.messageModel.find({ businessId }).sort({ createdAt: -1 }).limit(100).lean().exec();
  }

  private async requireBusiness(filter: Record<string, unknown>): Promise<BusinessDocument> {
    const business = await this.businesses.findOne({ ...filter, storefrontPublished: true }).exec();
    if (!business) throw new NotFoundException('This storefront is not live yet.');
    return business;
  }

  private publicBusiness(business: BusinessDocument | (Business & { _id: unknown })) {
    const b = business as BusinessDocument;
    return {
      id: b._id.toString(),
      businessMode: b.businessMode || 'products',
      campusCode: b.campusCode || null,
      campusName: b.campusName || null,
      campusVerified: Boolean(b.campusVerified),
      bookingSettings: b.bookingSettings || null,
      orderPolicy: b.orderPolicy || '',
      serviceChargeEnabled: Boolean(b.serviceChargeEnabled),
      serviceChargeType: b.serviceChargeType || 'percent',
      serviceChargePercent: b.serviceChargePercent || 0,
      serviceChargeFixedKobo: b.serviceChargeFixedKobo || 0,
      name: b.name,
      slug: b.slug,
      category: b.category,
      description: b.description,
      logoUrl: b.logoUrl,
      bannerUrl: b.bannerUrl,
      heroVideoUrl: b.heroVideoUrl,
      storyImageUrl: b.storyImageUrl,
      lookbookTitle: b.lookbookTitle,
      lookbook: b.lookbook || [],
      tagline: b.tagline,
      brandColor: b.brandColor,
      templateKey: b.templateKey,
      sections: b.sections,
      socialLinks: b.socialLinks,
      publicPhone: b.publicPhone,
      whatsappNumber: b.whatsappNumber,
      email: b.email,
      address: b.address,
      about: b.about,
      seoTitle: b.seoTitle || `${b.name} — shop online`,
      seoDescription: b.seoDescription || b.tagline || b.description,
      currency: 'NGN',
    };
  }

  private publicProduct(product: ProductDocument | (Product & { _id: unknown }), detail = false) {
    const p = product as ProductDocument;
    const variants = p.variants.filter((v) => v.isActive).map((v) => ({
      id: v._id?.toString(),
      name: v.name,
      attributes: v.attributes,
      priceKobo: v.priceKobo,
      imageUrl: v.imageUrl,
      inStock: v.quantity > 0,
      lowStock: v.quantity > 0 && v.quantity <= v.lowStockThreshold,
    }));
    const inStock = variants.some((v) => v.inStock);
    return {
      id: p._id.toString(),
      name: p.name,
      description: detail ? p.description : p.description?.slice(0, 150) || '',
      category: p.category,
      images: p.images,
      tags: p.tags,
      priceKobo: p.priceKobo,
      variants,
      inStock,
      soldCount: p.soldCount,
      createdAt: p.createdAt,
    };
  }
}
