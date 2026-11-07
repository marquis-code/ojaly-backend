import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Product, ProductDocument } from '../products/product.schema';
import { Service, ServiceDocument } from '../services/service.schema';
import { PlansService } from '../plans/plans.service';
import { AuditService } from '../audit/audit.service';
import { UpdateBusinessDto } from '../businesses/dto/business.dto';
import { BusinessesService } from '../businesses/businesses.service';
import { STOREFRONT_TEMPLATES, getTemplate } from './templates';
import type { AuthenticatedUser } from '../../common/types/auth.types';

@Injectable()
export class BuilderService {
  constructor(
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Service.name) private readonly services: Model<ServiceDocument>,
    private readonly plans: PlansService,
    private readonly businessesService: BusinessesService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async get(businessId: string) {
    const business = await this.businesses.findById(businessId).lean().exec();
    if (!business) throw new NotFoundException('Business not found.');
    const planInfo = await this.plans.getPlanForBusiness(businessId);
    const [products, productCount, serviceDocs] = await Promise.all([
      this.products.find({ businessId, isActive: true }).sort({ createdAt: -1 }).limit(8).lean().exec(),
      this.products.countDocuments({ businessId, isActive: true }).exec(),
      business.businessMode === 'products' ? Promise.resolve([]) : this.services.find({ businessId, isActive: true, isPublic: true }).sort({ createdAt: 1 }).limit(16).lean().exec(),
    ]);
    const services = serviceDocs.map((service) => ({ ...service, id: String(service._id) }));
    return {
      business,
      template: getTemplate(business.templateKey),
      templates: STOREFRONT_TEMPLATES.map((t) => ({
        ...t,
        available: !t.isPaid || planInfo.entitlements.templates.includes(t.key),
      })),
      plan: { name: planInfo.plan.name, entitlements: planInfo.entitlements },
      products,
      productCount,
      services,
      serviceCount: services.length,
      providers: [],
      businessMode: business.businessMode,
      urls: {
        path: `/s/${business.slug}`,
        subdomain: `${business.slug}.${this.config.get('publicRootDomain')}`,
        customDomain: business.customDomain,
        embedScript: `<script src="${this.config.get('appUrl')}/embed/ojaly-widget.js" data-ojaly="${business.slug}" data-mode="button" async></script>`,
        orderLink: `${this.config.get('appUrl')}/s/${business.slug}`,
        embedKey: business.embedKey,
      },
    };
  }

  async update(user: AuthenticatedUser, businessId: string, dto: UpdateBusinessDto) {
    return this.businessesService.update(user, businessId, dto);
  }

  async publish(user: AuthenticatedUser, businessId: string) {
    const businessDoc = await this.businesses.findById(businessId).select('businessMode').lean().exec();
    const [productCount, serviceCount] = await Promise.all([
      this.products.countDocuments({ businessId, isActive: true }).exec(),
      this.services.countDocuments({ businessId, isActive: true, isPublic: true }).exec(),
    ]);
    const needsCatalogue = businessDoc?.businessMode !== 'services';
    if ((needsCatalogue && productCount === 0) || (businessDoc?.businessMode === 'services' && serviceCount === 0)) {
      throw new NotFoundException(needsCatalogue ? 'Add at least one product before publishing your storefront.' : 'Add at least one service before publishing your booking page.');
    }
    const business = await this.businesses.findByIdAndUpdate(
      businessId,
      { $set: { storefrontPublished: true, publishedAt: new Date() } },
      { new: true },
    ).exec();
    if (!business) throw new NotFoundException('Business not found.');
    await this.audit.record({ businessId, actorId: user.id, action: 'storefront.published', entity: 'business', entityId: businessId });
    return { published: true, url: `/s/${business.slug}` };
  }

  async unpublish(user: AuthenticatedUser, businessId: string) {
    const business = await this.businesses.findByIdAndUpdate(
      businessId,
      { $set: { storefrontPublished: false } },
      { new: true },
    ).exec();
    if (!business) throw new NotFoundException('Business not found.');
    await this.audit.record({ businessId, actorId: user.id, action: 'storefront.unpublished', entity: 'business', entityId: businessId });
    return { published: false };
  }

  templates() {
    return STOREFRONT_TEMPLATES;
  }
}
