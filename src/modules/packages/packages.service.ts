import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Customer, CustomerDocument } from '../customers/customer.schema';
import { Service, ServiceDocument } from '../services/service.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { normalizeNigerianPhone } from '../../common/utils/phone';
import { randomToken } from '../../common/utils/tokens';
import { sanitizeText } from '../../common/utils/sanitize';
import { CreateServicePackageDto, PackageCheckoutDto, UpdateServicePackageDto } from './package.dto';
import { PackagePurchase, PackagePurchaseDocument, ServicePackage, ServicePackageDocument } from './package.schema';

@Injectable()
export class PackagesService {
  constructor(
    @InjectModel(ServicePackage.name) private readonly packages: Model<ServicePackageDocument>,
    @InjectModel(PackagePurchase.name) private readonly purchaseModel: Model<PackagePurchaseDocument>,
    @InjectModel(Service.name) private readonly services: Model<ServiceDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @Inject(forwardRef(() => PaymentsService)) private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(businessId: string, includeInactive = true) {
    const filter: Record<string, unknown> = { businessId };
    if (!includeInactive) Object.assign(filter, { isActive: true, isPublic: true });
    const items = await this.packages.find(filter).sort({ sortOrder: 1, createdAt: 1 }).lean().exec();
    return items.map((item) => this.packageView(item));
  }

  async publicList(businessId: string, serviceId?: string) {
    const items = await this.packages.find({ businessId, isActive: true, isPublic: true, ...(serviceId ? { serviceId } : {}) }).sort({ sortOrder: 1, createdAt: 1 }).lean().exec();
    return items.map((item) => this.packageView(item));
  }

  async create(businessId: string, dto: CreateServicePackageDto) {
    const service = await this.services.findOne({ _id: dto.serviceId, businessId, isActive: true }).lean().exec();
    if (!service) throw new NotFoundException('Service not found.');
    const item = await this.packages.create({
      businessId,
      name: dto.name,
      description: dto.description || '',
      serviceId: service._id.toString(),
      serviceName: service.name,
      sessions: dto.sessions,
      priceKobo: dto.priceKobo,
      validityDays: dto.validityDays ?? 30,
      isMembership: dto.isMembership ?? false,
      isActive: dto.isActive ?? true,
      isPublic: dto.isPublic ?? true,
      sortOrder: dto.sortOrder ?? 0,
    });
    return this.packageView(item);
  }

  async update(businessId: string, id: string, dto: UpdateServicePackageDto) {
    const item = await this.packages.findOne({ _id: id, businessId }).exec();
    if (!item) throw new NotFoundException('Package not found.');
    if (dto.serviceId) {
      const service = await this.services.findOne({ _id: dto.serviceId, businessId, isActive: true }).lean().exec();
      if (!service) throw new NotFoundException('Service not found.');
      item.serviceId = service._id.toString();
      item.serviceName = service.name;
    }
    for (const key of ['name', 'description', 'sessions', 'priceKobo', 'validityDays', 'isMembership', 'isActive', 'isPublic', 'sortOrder'] as const) {
      if (dto[key] !== undefined) (item as unknown as Record<string, unknown>)[key] = dto[key];
    }
    await item.save();
    return this.packageView(item);
  }

  async remove(businessId: string, id: string) {
    const item = await this.packages.findOneAndUpdate({ _id: id, businessId }, { $set: { isActive: false, isPublic: false } }, { new: true }).exec();
    if (!item) throw new NotFoundException('Package not found.');
    return { removed: true };
  }

  async listPurchases(businessId: string) {
    const items = await this.purchaseModel.find({ businessId }).sort({ createdAt: -1 }).limit(200).lean().exec();
    return items.map((item) => this.purchaseView(item));
  }

  async publicByToken(token: string) {
    const purchase = await this.purchaseModel.findOne({ publicToken: token }).lean().exec();
    if (!purchase) throw new NotFoundException('Package not found.');
    const business = await this.businesses.findById(purchase.businessId).lean().exec();
    const item = await this.packages.findById(purchase.packageId).lean().exec();
    return {
      purchase: this.purchaseView(purchase),
      package: item ? this.packageView(item) : null,
      business: business ? { name: business.name, slug: business.slug, brandColor: business.brandColor, logoUrl: business.logoUrl } : null,
    };
  }

  async checkout(businessId: string, packageId: string, dto: PackageCheckoutDto) {
    const item = await this.packages.findOne({ _id: packageId, businessId, isActive: true, isPublic: true }).lean().exec();
    if (!item) throw new NotFoundException('Package not found.');
    const phone = normalizeNigerianPhone(dto.customerPhone);
    if (!phone) throw new BadRequestException('Enter a valid Nigerian phone number.');
    let customer = await this.customers.findOne({ businessId, phone }).exec();
    if (!customer) {
      customer = await this.customers.create({
        businessId, name: sanitizeText(dto.customerName, 100), phone,
        email: dto.customerEmail || null, totalSpentKobo: 0, outstandingKobo: 0,
      });
    }
    const publicToken = randomToken(24);
    const redemptionCode = randomToken(5).toUpperCase();
    const expiresAt = new Date(Date.now() + item.validityDays * 86400000);
    const purchase = await this.purchaseModel.create({
      businessId,
      packageId: item._id.toString(),
      packageName: item.name,
      serviceId: item.serviceId,
      serviceName: item.serviceName,
      customerId: customer._id.toString(),
      customerName: customer.name,
      customerPhone: customer.phone,
      customerEmail: dto.customerEmail || customer.email || null,
      sessionsTotal: item.sessions,
      sessionsRemaining: item.sessions,
      priceKobo: item.priceKobo,
      amountPaidKobo: 0,
      paymentStatus: 'unpaid',
      status: 'pending',
      publicToken,
      redemptionCode,
      expiresAt,
    });
    await this.notifications.create({
      businessId, type: 'booking', tone: 'info',
      title: `Package checkout started · ${item.name}`,
      message: `${customer.name} started buying ${item.name}.`,
      data: { purchaseId: purchase._id.toString() },
    });
    const payment = await this.payments.publicPackagePurchaseLink(publicToken, dto.customerEmail || customer.email || undefined);
    return { purchase: this.purchaseView(purchase), payment };
  }

  async validateRedemption(businessId: string, code: string, serviceId: string, phone?: string) {
    const normalized = phone ? normalizeNigerianPhone(phone) : null;
    const purchase = await this.purchaseModel.findOne({
      businessId,
      redemptionCode: code.trim().toUpperCase(),
      serviceId,
      status: 'active',
      sessionsRemaining: { $gt: 0 },
      expiresAt: { $gt: new Date() },
      ...(normalized ? { customerPhone: normalized } : {}),
    }).exec();
    if (!purchase) throw new BadRequestException('That package code is not valid for this service, or it has expired.');
    return this.purchaseView(purchase);
  }

  async consume(purchaseId: string, businessId: string) {
    const purchase = await this.purchaseModel.findOneAndUpdate(
      { _id: purchaseId, businessId, status: 'active', sessionsRemaining: { $gt: 0 }, expiresAt: { $gt: new Date() } },
      { $inc: { sessionsRemaining: -1 } },
      { new: true },
    ).exec();
    if (!purchase) throw new BadRequestException('That package has no sessions left.');
    if (purchase.sessionsRemaining <= 0) {
      purchase.status = 'exhausted';
      await purchase.save();
    }
    return this.purchaseView(purchase);
  }

  async settle(purchaseId: string, reference: string) {
    const purchase = await this.purchaseModel.findById(purchaseId).exec();
    if (!purchase) throw new NotFoundException('Package purchase not found.');
    if (purchase.status === 'active') return this.purchaseView(purchase);
    purchase.status = 'active';
    purchase.paymentStatus = 'paid';
    purchase.amountPaidKobo = purchase.priceKobo;
    purchase.paymentReference = reference;
    purchase.purchasedAt = new Date();
    purchase.expiresAt = new Date(Date.now() + 30 * 86400000);
    await purchase.save();
    await this.notifications.create({
      businessId: purchase.businessId, type: 'booking', tone: 'success',
      title: `Package purchased · ${purchase.packageName}`,
      message: `${purchase.customerName} now has ${purchase.sessionsRemaining} session${purchase.sessionsRemaining === 1 ? '' : 's'} (code ${purchase.redemptionCode}).`,
      data: { purchaseId: purchase._id.toString() },
    });
    return this.purchaseView(purchase);
  }

  private packageView(item: ServicePackage | (ServicePackage & { _id: unknown })) {
    const p = item as ServicePackageDocument;
    return {
      id: p._id.toString(), name: p.name, description: p.description,
      serviceId: p.serviceId, serviceName: p.serviceName,
      sessions: p.sessions, priceKobo: p.priceKobo, validityDays: p.validityDays,
      isMembership: p.isMembership, isActive: p.isActive, isPublic: p.isPublic, sortOrder: p.sortOrder,
    };
  }

  private purchaseView(item: PackagePurchase | (PackagePurchase & { _id: unknown })) {
    const p = item as PackagePurchaseDocument;
    return {
      id: p._id.toString(), packageId: p.packageId, packageName: p.packageName,
      serviceId: p.serviceId, serviceName: p.serviceName,
      customerId: p.customerId, customerName: p.customerName, customerPhone: p.customerPhone, customerEmail: p.customerEmail,
      sessionsTotal: p.sessionsTotal, sessionsRemaining: p.sessionsRemaining,
      priceKobo: p.priceKobo, amountPaidKobo: p.amountPaidKobo, paymentStatus: p.paymentStatus,
      status: p.status, publicToken: p.publicToken, redemptionCode: p.redemptionCode,
      purchasedAt: p.purchasedAt, expiresAt: p.expiresAt, createdAt: p.createdAt,
    };
  }
}
