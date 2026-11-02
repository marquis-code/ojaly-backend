import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/user.schema';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Membership, MembershipDocument } from '../memberships/membership.schema';
import { Plan, PlanDocument } from '../plans/plan.schema';
import { Subscription, SubscriptionDocument } from '../plans/subscription.schema';
import { Coupon, CouponDocument } from '../plans/coupon.schema';
import { Payment, PaymentDocument } from '../payments/payment.schema';
import { WebhookEvent, WebhookEventDocument } from '../payments/webhook-event.schema';
import { WhatsappMessage, WhatsappMessageDocument } from '../whatsapp/whatsapp-message.schema';
import { WhatsappContact, WhatsappContactDocument } from '../whatsapp/whatsapp-contact.schema';
import { AuditLog, AuditLogDocument } from '../audit/audit-log.schema';
import { Product, ProductDocument } from '../products/product.schema';
import { Order, OrderDocument } from '../orders/order.schema';
import { Sale, SaleDocument } from '../sales/sale.schema';
import { RefreshSession, RefreshSessionDocument } from '../auth/refresh-session.schema';
import { SupportNote, SupportNoteDocument } from './support-note.schema';
import { AffiliatesService } from '../affiliates/affiliates.service';
import { PlansService } from '../plans/plans.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { formatNaira } from '../../common/utils/money';
import { AdminNoteTargetQueryDto, CreateAdminNoteDto, UpdateAdminNoteDto } from './admin-notes.dto';
import {
  AdminBusinessQueryDto,
  AdminPaymentQueryDto,
  AdminUpdateUserDto,
  AdminUserQueryDto,
  AuditQueryDto,
  ChangePlanDto,
  CreateCouponDto,
  CreatePlanDto,
  ExtendTrialDto,
  SuspendBusinessDto,
  UpdatePlanDto,
  UpdateServiceChargeDto,
} from './dto/admin.dto';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(Plan.name) private readonly plans: Model<PlanDocument>,
    @InjectModel(Subscription.name) private readonly subscriptions: Model<SubscriptionDocument>,
    @InjectModel(Coupon.name) private readonly coupons: Model<CouponDocument>,
    @InjectModel(Payment.name) private readonly payments: Model<PaymentDocument>,
    @InjectModel(WebhookEvent.name) private readonly webhooks: Model<WebhookEventDocument>,
    @InjectModel(WhatsappMessage.name) private readonly whatsappMessages: Model<WhatsappMessageDocument>,
    @InjectModel(WhatsappContact.name) private readonly whatsappContacts: Model<WhatsappContactDocument>,
    @InjectModel(AuditLog.name) private readonly auditLogModel: Model<AuditLogDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Sale.name) private readonly sales: Model<SaleDocument>,
    @InjectModel(RefreshSession.name) private readonly sessions: Model<RefreshSessionDocument>,
    @InjectModel(SupportNote.name) private readonly supportNotes: Model<SupportNoteDocument>,
    private readonly plansService: PlansService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly paymentsService: PaymentsService,
    private readonly affiliates: AffiliatesService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async dashboard() {
    const since30 = new Date(Date.now() - 30 * 86400000);
    const since24 = new Date(Date.now() - 86400000);
    const [users, verifiedUsers, newUsers, businesses, published, suspended, newBusinesses, subs, mrrRows, paymentAgg, planRows, trialExpiring, failedWebhooks, whatsapp, recentAudit, growth, topBusinesses] =
      await Promise.all([
        this.users.countDocuments({}).exec(),
        this.users.countDocuments({ emailVerifiedAt: { $ne: null } }).exec(),
        this.users.countDocuments({ createdAt: { $gte: since30 } }).exec(),
        this.businesses.countDocuments({}).exec(),
        this.businesses.countDocuments({ storefrontPublished: true }).exec(),
        this.businesses.countDocuments({ isSuspended: true }).exec(),
        this.businesses.countDocuments({ createdAt: { $gte: since30 } }).exec(),
        this.subscriptions.find({ status: { $in: ['active', 'trialing'] } }).lean().exec(),
        this.subscriptions.find({ status: 'active' }).lean().exec(),
        this.payments.aggregate([
          { $match: { status: 'success', paidAt: { $gte: since30 } } },
          { $group: { _id: null, revenue: { $sum: '$amountKobo' }, count: { $sum: 1 } } },
        ]).exec(),
        this.subscriptions.aggregate([{ $group: { _id: '$planKey', count: { $sum: 1 } } }]).exec(),
        this.subscriptions.countDocuments({ status: 'trialing', trialEndsAt: { $lte: new Date(Date.now() + 7 * 86400000) } }).exec(),
        this.webhooks.countDocuments({ status: 'failed' }).exec(),
        this.whatsappHealthData(),
        this.auditLogModel.find({}).sort({ createdAt: -1 }).limit(8).lean().exec(),
        this.growthSeries(14),
        this.sales.aggregate([
          { $match: { soldAt: { $gte: since30 } } },
          { $group: { _id: '$businessId', revenue: { $sum: '$totalKobo' }, sales: { $sum: 1 } } },
          { $sort: { revenue: -1 } },
          { $limit: 5 },
        ]).exec(),
      ]);
    const affiliateMetrics = await this.affiliates.adminOverview();
    const allPlans = await this.plans.find({}).lean().exec();
    const mrr = mrrRows.reduce((sum, s) => {
      const plan = allPlans.find((p) => p.key === s.planKey);
      if (!plan) return sum;
      return sum + (s.billingInterval === 'yearly' ? Math.round(plan.priceYearlyKobo / 12) : plan.priceMonthlyKobo);
    }, 0);
    const businessNames = await this.businesses
      .find({ _id: { $in: topBusinesses.map((b: { _id: string }) => b._id) } })
      .select('name slug')
      .lean()
      .exec();
    return {
      metrics: {
        users,
        verifiedUsers,
        newUsers,
        businesses,
        published,
        suspended,
        newBusinesses,
        activeSubscriptions: subs.filter((s) => s.status === 'active').length,
        trials: subs.filter((s) => s.status === 'trialing').length,
        mrrKobo: mrr,
        revenue30Kobo: paymentAgg[0]?.revenue || 0,
        payments30: paymentAgg[0]?.count || 0,
        trialExpiring,
        failedWebhooks,
      },
      planDistribution: planRows.map((p: { _id: string; count: number }) => ({ planKey: p._id, count: p.count })),
      growth,
      topBusinesses: topBusinesses.map((b: { _id: string; revenue: number; sales: number }) => ({
        businessId: b._id,
        name: businessNames.find((x) => String(x._id) === b._id)?.name || 'Unknown',
        slug: businessNames.find((x) => String(x._id) === b._id)?.slug || '',
        revenueKobo: b.revenue,
        sales: b.sales,
      })),
      whatsapp,
      recentAudit,
      affiliate: affiliateMetrics.metrics,
      integrations: this.integrationStatus(),
    };
  }

  async listUsers(query: AdminUserQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 25;
    const filter: Record<string, unknown> = {};
    if (query.search) {
      const rx = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
    }
    if (query.status === 'active') filter.isActive = true;
    if (query.status === 'disabled') filter.isActive = false;
    if (query.status === 'platform') filter.platformRole = { $ne: null };
    const [items, total] = await Promise.all([
      this.users.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      this.users.countDocuments(filter).exec(),
    ]);
    const memberships = await this.memberships.find({ userId: { $in: items.map((u) => String(u._id)) } }).lean().exec();
    const biz = await this.businesses.find({ _id: { $in: memberships.map((m) => m.businessId) } }).select('name slug').lean().exec();
    return {
      items: items.map((u) => ({
        id: String(u._id),
        name: u.name,
        email: u.email,
        phone: u.phone,
        platformRole: u.platformRole,
        emailVerified: Boolean(u.emailVerifiedAt),
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
        businesses: memberships
          .filter((m) => m.userId === String(u._id))
          .map((m) => ({ id: m.businessId, role: m.role, name: biz.find((b) => String(b._id) === m.businessId)?.name, slug: biz.find((b) => String(b._id) === m.businessId)?.slug })),
      })),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async userDetail(userId: string) {
    const user = await this.users.findById(userId).lean().exec();
    if (!user) throw new NotFoundException('User not found.');
    const memberships = await this.memberships.find({ userId }).lean().exec();
    const businesses = await this.businesses.find({ _id: { $in: memberships.map((m) => m.businessId) } }).lean().exec();
    const subs = await this.subscriptions.find({ businessId: { $in: memberships.map((m) => m.businessId) } }).lean().exec();
    return {
      user: { ...user, id: String(user._id), emailVerified: Boolean(user.emailVerifiedAt) },
      memberships: memberships.map((m) => ({
        ...m,
        business: businesses.find((b) => String(b._id) === m.businessId),
        subscription: subs.find((s) => s.businessId === m.businessId),
      })),
      audit: await this.auditLogModel.find({ actorId: userId }).sort({ createdAt: -1 }).limit(20).lean().exec(),
    };
  }

  async updateUser(actorId: string, userId: string, dto: AdminUpdateUserDto) {
    if (actorId === userId && dto.isActive === false) throw new BadRequestException('You cannot disable your own account.');
    if (actorId === userId && dto.platformRole !== undefined && dto.platformRole !== 'super_admin') {
      throw new BadRequestException('You cannot remove your own super admin access.');
    }
    const user = await this.users.findById(userId).exec();
    if (!user) throw new NotFoundException('User not found.');
    if (dto.isActive !== undefined) user.isActive = dto.isActive;
    if (dto.platformRole !== undefined) user.platformRole = dto.platformRole;
    await user.save();
    if (dto.isActive === false) {
      await this.sessions.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } }).exec();
    }
    await this.audit.record({
      actorId,
      actorType: 'platform_admin',
      action: 'admin.user_updated',
      entity: 'user',
      entityId: userId,
      metadata: { isActive: dto.isActive, platformRole: dto.platformRole },
    });
    return { updated: true };
  }

  async listBusinesses(query: AdminBusinessQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 25;
    const filter: Record<string, unknown> = {};
    if (query.search) {
      const rx = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { slug: rx }, { email: rx }];
    }
    if (query.status === 'published') filter.storefrontPublished = true;
    if (query.status === 'unpublished') filter.storefrontPublished = false;
    if (query.status === 'suspended') filter.isSuspended = true;
    const [items, total] = await Promise.all([
      this.businesses.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      this.businesses.countDocuments(filter).exec(),
    ]);
    const subs = await this.subscriptions.find({ businessId: { $in: items.map((b) => String(b._id)) } }).lean().exec();
    const owners = await this.memberships.find({ businessId: { $in: items.map((b) => String(b._id)) }, role: 'owner' }).lean().exec();
    const ownerUsers = await this.users.find({ _id: { $in: owners.map((o) => o.userId) } }).select('name email').lean().exec();
    const [productCounts, saleCounts] = await Promise.all([
      this.products.aggregate([{ $match: { businessId: { $in: items.map((b) => String(b._id)) } } }, { $group: { _id: '$businessId', count: { $sum: 1 } } }]).exec(),
      this.sales.aggregate([{ $match: { businessId: { $in: items.map((b) => String(b._id)) } } }, { $group: { _id: '$businessId', count: { $sum: 1 }, revenue: { $sum: '$totalKobo' } } }]).exec(),
    ]);
    return {
      items: items.map((b) => {
        const owner = owners.find((o) => o.businessId === String(b._id));
        return {
          id: String(b._id),
          name: b.name,
          slug: b.slug,
          category: b.category,
          owner: owner ? ownerUsers.find((u) => String(u._id) === owner.userId) : null,
          published: b.storefrontPublished,
          suspended: b.isSuspended,
          subscription: subs.find((s) => s.businessId === String(b._id)) || null,
          products: productCounts.find((p) => p._id === String(b._id))?.count || 0,
          sales: saleCounts.find((s) => s._id === String(b._id))?.count || 0,
          revenueKobo: saleCounts.find((s) => s._id === String(b._id))?.revenue || 0,
          createdAt: b.createdAt,
        };
      }),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async businessDetail(businessId: string) {
    const business = await this.businesses.findById(businessId).lean().exec();
    if (!business) throw new NotFoundException('Business not found.');
    const [memberships, sub, planInfo, products, sales, orders, payments, coupons] = await Promise.all([
      this.memberships.find({ businessId }).lean().exec(),
      this.subscriptions.findOne({ businessId }).lean().exec(),
      this.plansService.getPlanForBusiness(businessId),
      this.products.countDocuments({ businessId }).exec(),
      this.sales.aggregate([{ $match: { businessId } }, { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$totalKobo' } } }]).exec(),
      this.orders.countDocuments({ businessId }).exec(),
      this.payments.find({ businessId }).sort({ createdAt: -1 }).limit(10).lean().exec(),
      this.coupons.find({ grantedToBusinessId: businessId }).lean().exec(),
    ]);
    const users = await this.users.find({ _id: { $in: memberships.map((m) => m.userId) } }).select('name email phone isActive lastLoginAt').lean().exec();
    return {
      business,
      plan: this.plansService.toView(planInfo.plan),
      subscription: sub,
      memberships: memberships.map((m) => ({ ...m, user: users.find((u) => String(u._id) === m.userId) })),
      usage: {
        products,
        sales: sales[0]?.count || 0,
        revenueKobo: sales[0]?.revenue || 0,
        orders,
      },
      payments,
      coupons,
      audit: await this.auditLogModel.find({ businessId }).sort({ createdAt: -1 }).limit(20).lean().exec(),
    };
  }

  async changePlan(actorId: string, businessId: string, dto: ChangePlanDto) {
    const business = await this.businesses.findById(businessId).lean().exec();
    if (!business) throw new NotFoundException('Business not found.');
    const plan = await this.plansService.getPlan(dto.planKey);
    const sub = await this.subscriptions.findOne({ businessId }).exec();
    if (sub) {
      const now = new Date();
      const days = dto.interval === 'yearly' ? 365 : 30;
      sub.planKey = plan.key;
      sub.planId = String(plan._id);
      sub.status = 'active';
      sub.billingInterval = dto.interval || 'monthly';
      sub.currentPeriodStart = now;
      sub.currentPeriodEnd = new Date(now.getTime() + days * 86400000);
      sub.adminNote = dto.note || `Plan changed by admin to ${plan.name}`;
      await sub.save();
    } else {
      await this.plansService.activatePlan(businessId, plan.key, { interval: dto.interval });
    }
    await this.audit.record({
      businessId,
      actorId,
      actorType: 'platform_admin',
      action: 'admin.plan_changed',
      entity: 'business',
      entityId: businessId,
      metadata: { planKey: plan.key, interval: dto.interval, note: dto.note },
    });
    return { changed: true, plan: this.plansService.toView(plan) };
  }

  async extendTrial(actorId: string, businessId: string, dto: ExtendTrialDto) {
    const business = await this.businesses.findById(businessId).lean().exec();
    if (!business) throw new NotFoundException('Business not found.');
    let sub: SubscriptionDocument | null = (await this.subscriptions.findOne({ businessId }).exec()) as SubscriptionDocument | null;
    let plan: PlanDocument;
    if (dto.planKey) {
      plan = await this.plansService.getPlan(dto.planKey);
    } else if (sub && sub.planKey !== 'free') {
      plan = await this.plansService.getPlan(sub.planKey);
    } else {
      plan = await this.plansService.getTrialPlan();
    }
    const now = new Date();
    const base = sub?.trialEndsAt && sub.trialEndsAt.getTime() > now.getTime() ? sub.trialEndsAt : now;
    const trialEndsAt = new Date(base.getTime() + dto.days * 86400000);
    if (!sub) {
      sub = await this.plansService.createTrialSubscription(businessId, String(plan._id), plan.key, dto.days, plan.trialMilestoneOrders ?? 0);
      sub.trialEndsAt = trialEndsAt;
      await sub.save();
    } else {
      sub.status = 'trialing';
      sub.planKey = plan.key;
      sub.planId = String(plan._id);
      sub.trialStartedAt = sub.trialStartedAt || now;
      sub.trialEndsAt = trialEndsAt;
      sub.trialMilestoneOrders = plan.trialMilestoneOrders ?? 0;
      sub.milestoneReachedAt = null;
      sub.trialExtensions += 1;
      sub.adminNote = dto.note || `Trial extended ${dto.days} days by admin`;
      await sub.save();
    }
    await this.notifications.create({
      businessId,
      type: 'billing',
      title: `Your trial was extended ${dto.days} days`,
      message: `You now have access to ${plan.name} until ${trialEndsAt.toLocaleDateString('en-NG')}. No payment was taken.`,
      tone: 'success',
      data: { planKey: plan.key, trialEndsAt },
    });
    await this.audit.record({
      businessId,
      actorId,
      actorType: 'platform_admin',
      action: 'admin.trial_extended',
      entity: 'business',
      entityId: businessId,
      metadata: { days: dto.days, planKey: plan.key },
    });
    return { trialEndsAt, planKey: plan.key };
  }

  async suspendBusiness(actorId: string, businessId: string, dto: SuspendBusinessDto) {
    const business = await this.businesses.findByIdAndUpdate(
      businessId,
      { $set: { isSuspended: dto.suspended } },
      { new: true },
    ).exec();
    if (!business) throw new NotFoundException('Business not found.');
    await this.audit.record({
      businessId,
      actorId,
      actorType: 'platform_admin',
      action: dto.suspended ? 'admin.business_suspended' : 'admin.business_restored',
      entity: 'business',
      entityId: businessId,
      metadata: { reason: dto.reason },
    });
    return { suspended: business.isSuspended };
  }

  async updateServiceCharge(actorId: string, businessId: string, dto: UpdateServiceChargeDto) {
    const business = await this.businesses.findById(businessId).exec();
    if (!business) throw new NotFoundException('Business not found.');

    business.serviceChargeEnabled = dto.enabled;
    business.serviceChargeType = dto.type;
    business.serviceChargePercent = dto.percent ?? 0;
    business.serviceChargeFixedKobo = dto.fixedKobo ?? 0;
    await business.save();

    await this.audit.record({
      businessId,
      actorId,
      actorType: 'platform_admin',
      action: 'admin.business_service_charge',
      entity: 'business',
      entityId: businessId,
      metadata: {
        enabled: dto.enabled,
        type: dto.type,
        percent: dto.percent,
        fixedKobo: dto.fixedKobo,
      },
    });

    return {
      updated: true,
      serviceCharge: {
        enabled: business.serviceChargeEnabled,
        type: business.serviceChargeType,
        percent: business.serviceChargePercent,
        fixedKobo: business.serviceChargeFixedKobo,
      },
    };
  }

  async updateProviderFee(actorId: string, businessId: string, dto: { enabled: boolean; type: 'percent' | 'fixed'; percent?: number; fixedKobo?: number }) {
    const business = await this.businesses.findById(businessId).exec();
    if (!business) throw new NotFoundException('Business not found.');
    business.providerFeeEnabled = dto.enabled;
    business.providerFeeType = dto.type;
    business.providerFeePercent = dto.percent ?? 0;
    business.providerFeeFixedKobo = dto.fixedKobo ?? 0;
    await business.save();
    await this.audit.record({
      businessId, actorId, actorType: 'platform_admin',
      action: 'admin.business_provider_fee', entity: 'business', entityId: businessId,
      metadata: { enabled: dto.enabled, type: dto.type, percent: dto.percent, fixedKobo: dto.fixedKobo },
    });
    return {
      updated: true,
      providerFee: {
        enabled: business.providerFeeEnabled, type: business.providerFeeType,
        percent: business.providerFeePercent, fixedKobo: business.providerFeeFixedKobo,
      },
    };
  }

  async listPlans() {
    const plans = await this.plans.find({}).sort({ sortOrder: 1 }).lean().exec();
    const counts = await this.subscriptions.aggregate([{ $group: { _id: '$planKey', count: { $sum: 1 } } }]).exec();
    return plans.map((p) => ({
      ...this.plansService.toView(p as unknown as Plan),
      isActive: p.isActive,
      isTrialPlan: p.isTrialPlan,
      trialMilestoneOrders: p.trialMilestoneOrders,
      paystackPlanCodeMonthly: p.paystackPlanCodeMonthly,
      paystackPlanCodeYearly: p.paystackPlanCodeYearly,
      subscriptions: counts.find((c) => c._id === p.key)?.count || 0,
    }));
  }

  async createPlan(actorId: string, dto: CreatePlanDto) {
    const exists = await this.plans.findOne({ key: dto.key.toLowerCase() }).lean().exec();
    if (exists) throw new BadRequestException('A plan with that key already exists.');
    if (dto.isDefault) await this.plans.updateMany({}, { $set: { isDefault: false } }).exec();
    if (dto.isTrialPlan) await this.plans.updateMany({}, { $set: { isTrialPlan: false } }).exec();
    const plan = await this.plans.create({
      ...dto,
      key: dto.key.toLowerCase(),
      entitlements: { ...(dto.entitlements || {}) },
    });
    await this.audit.record({ actorId, actorType: 'platform_admin', action: 'admin.plan_created', entity: 'plan', entityId: String(plan._id) });
    return plan;
  }

  async updatePlan(actorId: string, key: string, dto: UpdatePlanDto) {
    const plan = await this.plans.findOne({ key }).exec();
    if (!plan) throw new NotFoundException('Plan not found.');
    if (dto.isDefault) await this.plans.updateMany({ key: { $ne: key } }, { $set: { isDefault: false } }).exec();
    if (dto.isTrialPlan) await this.plans.updateMany({ key: { $ne: key } }, { $set: { isTrialPlan: false } }).exec();
    if (dto.name !== undefined) plan.name = dto.name;
    if (dto.description !== undefined) plan.description = dto.description;
    if (dto.priceMonthlyKobo !== undefined) plan.priceMonthlyKobo = dto.priceMonthlyKobo;
    if (dto.priceYearlyKobo !== undefined) plan.priceYearlyKobo = dto.priceYearlyKobo;
    if (dto.trialDays !== undefined) plan.trialDays = dto.trialDays;
    if (dto.trialMilestoneOrders !== undefined) plan.trialMilestoneOrders = dto.trialMilestoneOrders;
    if (dto.isDefault !== undefined) plan.isDefault = dto.isDefault;
    if (dto.isTrialPlan !== undefined) plan.isTrialPlan = dto.isTrialPlan;
    if (dto.isActive !== undefined) plan.isActive = dto.isActive;
    if (dto.paystackPlanCodeMonthly !== undefined) plan.paystackPlanCodeMonthly = dto.paystackPlanCodeMonthly;
    if (dto.paystackPlanCodeYearly !== undefined) plan.paystackPlanCodeYearly = dto.paystackPlanCodeYearly;
    if (dto.marketingFeatures !== undefined) plan.marketingFeatures = dto.marketingFeatures;
    if (dto.entitlements) plan.entitlements = { ...plan.entitlements, ...dto.entitlements };
    await plan.save();
    await this.audit.record({ actorId, actorType: 'platform_admin', action: 'admin.plan_updated', entity: 'plan', entityId: String(plan._id), metadata: { key } });
    return plan;
  }

  async listCoupons() {
    return this.coupons.find({}).sort({ createdAt: -1 }).limit(100).lean().exec();
  }

  async createCoupon(actorId: string, dto: CreateCouponDto) {
    const code = dto.code.toUpperCase();
    const exists = await this.coupons.findOne({ code }).lean().exec();
    if (exists) throw new BadRequestException('That coupon code already exists.');
    const coupon = await this.coupons.create({
      ...dto,
      code,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });
    await this.audit.record({
      businessId: dto.grantedToBusinessId || null,
      actorId,
      actorType: 'platform_admin',
      action: 'admin.coupon_created',
      entity: 'coupon',
      entityId: String(coupon._id),
      metadata: { code, percentOff: dto.percentOff, grantedToBusinessId: dto.grantedToBusinessId },
    });
    return coupon;
  }

  async revokeCoupon(actorId: string, couponId: string) {
    const coupon = await this.coupons.findByIdAndUpdate(couponId, { $set: { isActive: false } }, { new: true }).exec();
    if (!coupon) throw new NotFoundException('Coupon not found.');
    await this.audit.record({ actorId, actorType: 'platform_admin', action: 'admin.coupon_revoked', entity: 'coupon', entityId: couponId });
    return { revoked: true };
  }

  async listPayments(query: AdminPaymentQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 25;
    const filter: Record<string, unknown> = {};
    if (query.status && query.status !== 'all') filter.status = query.status;
    if (query.purpose && query.purpose !== 'all') filter.purpose = query.purpose;
    if (query.search) filter.reference = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const [items, total, totals] = await Promise.all([
      this.payments.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      this.payments.countDocuments(filter).exec(),
      this.payments.aggregate([
        { $match: filter },
        { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amountKobo' } } },
      ]).exec(),
    ]);
    const businesses = await this.businesses.find({ _id: { $in: items.map((p) => p.businessId) } }).select('name slug').lean().exec();
    return {
      items: items.map((p) => ({
        ...p,
        business: businesses.find((b) => String(b._id) === p.businessId) || null,
      })),
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        byStatus: totals.reduce((acc: Record<string, { count: number; amountKobo: number }>, t) => {
          acc[t._id] = { count: t.count, amountKobo: t.amount };
          return acc;
        }, {}),
      },
    };
  }

  async whatsappHealth() {
    const data = await this.whatsappHealthData();
    const recentFailures = await this.whatsappMessages.find({ status: 'failed', direction: 'outbound' }).sort({ createdAt: -1 }).limit(10).lean().exec();
    const provider = this.config.get<string>('whatsapp.provider') || 'cloud';
    const isConfigured = provider === 'evolution'
      ? Boolean(this.config.get('whatsapp.evolutionApiUrl') && this.config.get('whatsapp.evolutionApiKey'))
      : provider === '360dialog'
      ? Boolean(this.config.get('whatsapp.d360ApiKey') && this.config.get('whatsapp.phoneNumberId'))
      : Boolean(this.config.get('whatsapp.accessToken') && this.config.get('whatsapp.phoneNumberId'));
    const identifier = provider === 'evolution'
      ? (this.config.get('whatsapp.evolutionInstance') || this.config.get('whatsapp.platformNumber') || null)
      : (this.config.get('whatsapp.phoneNumberId') || null);
    return {
      configured: isConfigured,
      provider,
      phoneNumberId: identifier,
      webhookUrl: `${this.config.get('apiUrl')}/whatsapp/webhook`,
      ...data,
      recentFailures,
      templates: ['ojaly_daily_summary', 'ojaly_weekly_summary', 'ojaly_low_stock', 'ojaly_debt_reminder'],
    };
  }

  async retryWebhooks() {
    return this.paymentsService.retryFailedWebhooks();
  }

  async listWebhooks() {
    return this.webhooks.find({}).sort({ createdAt: -1 }).limit(100).lean().exec();
  }

  async auditLogList(query: AuditQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 30;
    const filter: Record<string, unknown> = {};
    if (query.action) filter.action = new RegExp(query.action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (query.businessId) filter.businessId = query.businessId;
    if (query.actorId) filter.actorId = query.actorId;
    const [items, total] = await Promise.all([
      this.auditLogModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      this.auditLogModel.countDocuments(filter).exec(),
    ]);
    return { items, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
  }

  async impersonateBusiness(actorId: string, businessId: string) {
    const business = await this.businesses.findById(businessId).lean().exec();
    if (!business) throw new NotFoundException('Business not found.');
    if (business.isSuspended) throw new BadRequestException('Restore this business before impersonating its owner.');
    const owner = await this.memberships.findOne({ businessId, role: 'owner', status: 'active' }).lean().exec();
    if (!owner) throw new NotFoundException('This business has no active owner.');
    const user = await this.users.findById(owner.userId).lean().exec();
    if (!user) throw new NotFoundException('Owner account not found.');
    if (!user.isActive) throw new BadRequestException('The owner account is disabled.');
    if (user.platformRole === 'super_admin') throw new ForbiddenException('Super admin accounts cannot be impersonated.');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const token = await this.jwt.signAsync(
      {
        sub: String(user._id),
        email: user.email,
        businessId,
        role: 'owner',
        platformRole: null,
        tokenType: 'access',
        impersonatorId: actorId,
      },
      { secret: this.config.get<string>('jwt.accessSecret'), expiresIn: '15m' },
    );
    await this.audit.record({
      businessId,
      actorId,
      actorType: 'platform_admin',
      action: 'admin.impersonation_started',
      entity: 'user',
      entityId: String(user._id),
      metadata: { businessName: business.name, expiresAt },
    });
    return {
      token,
      expiresAt,
      business: { id: businessId, name: business.name, slug: business.slug },
      user: { id: String(user._id), name: user.name, email: user.email },
    };
  }

  async notes(query: AdminNoteTargetQueryDto) {
    return this.supportNotes.find({ targetType: query.targetType, targetId: query.targetId }).sort({ pinned: -1, createdAt: -1 }).lean().exec();
  }

  async createNote(actorId: string, dto: CreateAdminNoteDto) {
    await this.assertNoteTarget(dto.targetType, dto.targetId);
    const author = await this.users.findById(actorId).select('name').lean().exec();
    const note = await this.supportNotes.create({
      targetType: dto.targetType,
      targetId: dto.targetId,
      authorId: actorId,
      authorName: author?.name || 'Ojaly admin',
      body: dto.body.trim(),
      pinned: Boolean(dto.pinned),
    });
    await this.audit.record({
      businessId: dto.targetType === 'business' ? dto.targetId : null,
      actorId,
      actorType: 'platform_admin',
      action: 'admin.note_created',
      entity: 'support_note',
      entityId: note._id.toString(),
      metadata: { targetType: dto.targetType, targetId: dto.targetId },
    });
    return note;
  }

  async updateNote(actorId: string, noteId: string, dto: UpdateAdminNoteDto) {
    const note = await this.supportNotes.findById(noteId).exec();
    if (!note) throw new NotFoundException('Note not found.');
    if (dto.body !== undefined) note.body = dto.body.trim();
    if (dto.pinned !== undefined) note.pinned = dto.pinned;
    await note.save();
    await this.audit.record({
      actorId,
      actorType: 'platform_admin',
      action: 'admin.note_updated',
      entity: 'support_note',
      entityId: noteId,
    });
    return note;
  }

  async deleteNote(actorId: string, noteId: string) {
    const note = await this.supportNotes.findByIdAndDelete(noteId).exec();
    if (!note) throw new NotFoundException('Note not found.');
    await this.audit.record({
      actorId,
      actorType: 'platform_admin',
      action: 'admin.note_deleted',
      entity: 'support_note',
      entityId: noteId,
    });
    return { deleted: true };
  }

  private async assertNoteTarget(targetType: 'user' | 'business', targetId: string) {
    const exists = targetType === 'user'
      ? await this.users.exists({ _id: targetId })
      : await this.businesses.exists({ _id: targetId });
    if (!exists) throw new NotFoundException(`${targetType === 'user' ? 'User' : 'Business'} not found.`);
  }

  private integrationStatus() {
    const provider = this.config.get<string>('whatsapp.provider') || 'cloud';
    const isWhatsappConfigured = provider === 'evolution'
      ? Boolean(this.config.get('whatsapp.evolutionApiUrl') && this.config.get('whatsapp.evolutionApiKey'))
      : provider === '360dialog'
      ? Boolean(this.config.get('whatsapp.d360ApiKey') && this.config.get('whatsapp.phoneNumberId'))
      : Boolean(this.config.get('whatsapp.accessToken') && this.config.get('whatsapp.phoneNumberId'));

    return {
      cloudinary: Boolean(this.config.get('cloudinary.cloudName') && this.config.get('cloudinary.apiKey')),
      resend: Boolean(this.config.get('resend.apiKey')),
      paystack: Boolean(this.config.get('paystack.secretKey')),
      whatsapp: isWhatsappConfigured,
      llm: Boolean(this.config.get('llm.apiKey')),
    };
  }

  private async whatsappHealthData() {
    const since = new Date(Date.now() - 86400000);
    const [counts, linked, lastInbound, lastOutbound] = await Promise.all([
      this.whatsappMessages.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { direction: '$direction', status: '$status' }, count: { $sum: 1 } } },
      ]).exec(),
      this.whatsappContacts.countDocuments({ verifiedAt: { $ne: null } }).exec(),
      this.whatsappMessages.findOne({ direction: 'inbound' }).sort({ createdAt: -1 }).select('createdAt').lean().exec(),
      this.whatsappMessages.findOne({ direction: 'outbound', status: 'sent' }).sort({ createdAt: -1 }).select('createdAt').lean().exec(),
    ]);
    const inbound = counts.filter((c) => c._id.direction === 'inbound').reduce((s, c) => s + c.count, 0);
    const outbound = counts.filter((c) => c._id.direction === 'outbound').reduce((s, c) => s + c.count, 0);
    const failed = counts.filter((c) => c._id.status === 'failed').reduce((s, c) => s + c.count, 0);
    const skipped = counts.filter((c) => c._id.status === 'skipped').reduce((s, c) => s + c.count, 0);
    return {
      last24h: { inbound, outbound, failed, skipped },
      linkedNumbers: linked,
      lastInboundAt: lastInbound?.createdAt || null,
      lastOutboundAt: lastOutbound?.createdAt || null,
      counts,
    };
  }

  private async growthSeries(days: number) {
    const since = new Date(Date.now() - days * 86400000);
    const [users, businesses, payments] = await Promise.all([
      this.users.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Africa/Lagos' } }, count: { $sum: 1 } } },
      ]).exec(),
      this.businesses.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Africa/Lagos' } }, count: { $sum: 1 } } },
      ]).exec(),
      this.payments.aggregate([
        { $match: { status: 'success', paidAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt', timezone: 'Africa/Lagos' } }, amount: { $sum: '$amountKobo' } } },
      ]).exec(),
    ]);
    const series: { date: string; users: number; businesses: number; revenueKobo: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      series.push({
        date,
        users: users.find((u) => u._id === date)?.count || 0,
        businesses: businesses.find((b) => b._id === date)?.count || 0,
        revenueKobo: payments.find((p) => p._id === date)?.amount || 0,
      });
    }
    return series;
  }
}
