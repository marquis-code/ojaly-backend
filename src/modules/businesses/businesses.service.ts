import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { promises as dns } from 'dns';
import { Model } from 'mongoose';
import { Business, BusinessDocument } from './business.schema';
import { Membership, MembershipDocument } from '../memberships/membership.schema';
import { User, UserDocument } from '../users/user.schema';
import { Product, ProductDocument } from '../products/product.schema';
import { Order, OrderDocument } from '../orders/order.schema';
import { Service, ServiceDocument } from '../services/service.schema';
import { PlansService } from '../plans/plans.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { STAFF_DEFAULT_PERMISSIONS } from '../../common/constants/permissions';
import { randomToken, sha256 } from '../../common/utils/tokens';
import { normalizeNigerianPhone } from '../../common/utils/phone';
import { staffInviteEmail } from '../mail/email-templates';
import { PaystackService } from '../payments/paystack.service';
import {
  CustomDomainDto,
  InviteStaffDto,
  UpdateBusinessDto,
  UpdateStaffDto,
} from './dto/business.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';

@Injectable()
export class BusinessesService {
  constructor(
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Service.name) private readonly services: Model<ServiceDocument>,
    private readonly plans: PlansService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly paystack: PaystackService,
  ) {}

  async findById(businessId: string): Promise<BusinessDocument> {
    const business = await this.businesses.findById(businessId).exec();
    if (!business) throw new NotFoundException('Business not found.');
    return business;
  }

  async current(businessId: string) {
    const business = await this.findById(businessId);
    const [planInfo, products, staff, ordersThisMonth] = await Promise.all([
      this.plans.getPlanForBusiness(businessId),
      this.products.countDocuments({ businessId, isActive: true }).exec(),
      this.memberships.countDocuments({ businessId, role: 'staff', status: 'active' }).exec(),
      this.orders.countDocuments({
        businessId,
        createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      }).exec(),
    ]);
    const sub = planInfo.subscription;
    return {
      business,
      plan: this.plans.toView(planInfo.plan),
      subscription: sub
        ? {
            planKey: sub.planKey,
            status: sub.status,
            trialEndsAt: sub.trialEndsAt,
            trialMilestoneOrders: sub.trialMilestoneOrders,
            milestoneReachedAt: sub.milestoneReachedAt,
            currentPeriodEnd: sub.currentPeriodEnd,
            billingInterval: sub.billingInterval,
            couponCode: sub.couponCode,
          }
        : null,
      entitlements: planInfo.entitlements,
      usage: {
        products,
        productLimit: planInfo.entitlements.productLimit,
        staff,
        staffSeats: planInfo.entitlements.staffSeats,
        ordersThisMonth,
        month: new Date().toISOString().slice(0, 7),
      },
      storefront: {
        path: `/s/${business.slug}`,
        subdomain: `${business.slug}.${this.config.get('publicRootDomain')}`,
        customDomain: business.customDomain,
        published: business.storefrontPublished,
      },
    };
  }

  async settlementBanks() {
    return this.paystack.listBanks();
  }

  async resolveSettlementAccount(dto: { bankCode: string; accountNumber: string }) {
    const resolved = await this.paystack.resolveAccount(dto.accountNumber, dto.bankCode);
    return resolved;
  }

  async addSettlementAccount(user: AuthenticatedUser, businessId: string, dto: { bankCode: string; accountNumber: string }) {
    const business = await this.findById(businessId);
    if (business.settlementAccounts.length >= 5) throw new BadRequestException('You can save up to 5 settlement accounts.');
    if (business.settlementAccounts.some((account) => account.bankCode === dto.bankCode && account.accountNumber === dto.accountNumber)) {
      throw new ConflictException('That settlement account is already saved.');
    }
    const banks = await this.paystack.listBanks();
    const bank = banks.find((item) => item.code === dto.bankCode);
    if (!bank) throw new BadRequestException('Choose a valid bank.');
    const resolved = await this.paystack.resolveAccount(dto.accountNumber, dto.bankCode);
    const account = {
      id: randomToken(10), bankName: bank.name, bankCode: dto.bankCode,
      accountNumber: dto.accountNumber, accountName: resolved.accountName,
    };
    business.settlementAccounts.push(account);
    if (!business.settlementPrimaryAccountId) business.settlementPrimaryAccountId = account.id;
    await business.save();
    await this.audit.record({
      businessId, actorId: user.id, actorType: 'owner', action: 'business.settlement_account_added',
      entity: 'business', entityId: businessId, metadata: { bankName: bank.name, accountLast4: dto.accountNumber.slice(-4) },
    });
    return { accounts: business.settlementAccounts, primaryAccountId: business.settlementPrimaryAccountId };
  }

  async setPrimarySettlementAccount(user: AuthenticatedUser, businessId: string, accountId: string) {
    const business = await this.findById(businessId);
    if (!business.settlementAccounts.some((account) => account.id === accountId)) throw new NotFoundException('Settlement account not found.');
    business.settlementPrimaryAccountId = accountId;
    await business.save();
    await this.audit.record({ businessId, actorId: user.id, actorType: 'owner', action: 'business.settlement_account_primary', entity: 'business', entityId: businessId, metadata: { accountId } });
    return { accounts: business.settlementAccounts, primaryAccountId: business.settlementPrimaryAccountId };
  }

  async removeSettlementAccount(user: AuthenticatedUser, businessId: string, accountId: string) {
    const business = await this.findById(businessId);
    const account = business.settlementAccounts.find((item) => item.id === accountId);
    if (!account) throw new NotFoundException('Settlement account not found.');
    business.settlementAccounts = business.settlementAccounts.filter((item) => item.id !== accountId);
    if (business.settlementPrimaryAccountId === accountId) business.settlementPrimaryAccountId = business.settlementAccounts[0]?.id || null;
    await business.save();
    await this.audit.record({ businessId, actorId: user.id, actorType: 'owner', action: 'business.settlement_account_removed', entity: 'business', entityId: businessId, metadata: { bankName: account.bankName, accountLast4: account.accountNumber.slice(-4) } });
    return { accounts: business.settlementAccounts, primaryAccountId: business.settlementPrimaryAccountId };
  }

  async update(user: AuthenticatedUser, businessId: string, dto: UpdateBusinessDto) {
    const business = await this.findById(businessId);
    const update: Record<string, unknown> = {};
    const allowed = [
      'name', 'category', 'businessMode', 'description', 'logoUrl', 'bannerUrl', 'heroVideoUrl', 'storyImageUrl', 'lookbookTitle', 'lookbook', 'tagline',
      'brandColor', 'templateKey', 'sections', 'socialLinks', 'publicPhone',
      'whatsappNumber', 'email', 'address', 'about', 'orderPolicy', 'seoTitle', 'seoDescription',
      'settlementBankName', 'settlementBankCode', 'settlementAccountNumber', 'settlementAccountName',
    ] as const;
    for (const key of allowed) {
      if (dto[key] !== undefined) update[key] = dto[key];
    }
    if (dto.whatsappNumber) {
      const phone = normalizeNigerianPhone(dto.whatsappNumber);
      if (!phone) throw new BadRequestException('Enter a valid WhatsApp number.');
      update.whatsappNumber = phone;
    }
    if (dto.publicPhone) {
      const phone = normalizeNigerianPhone(dto.publicPhone);
      if (!phone) throw new BadRequestException('Enter a valid phone number.');
      update.publicPhone = phone;
    }
    if (dto.templateKey) await this.plans.assertTemplate(businessId, dto.templateKey);
    if (dto.bookingSettings) {
      const current = business.bookingSettings || {
        enabled: false, autoConfirm: true, leadTimeMinutes: 120, windowDays: 60,
        slotIntervalMinutes: 30, cancellationWindowHours: 24, depositPercent: 0,
        reminderHoursBefore: 24, weeklyHours: [], closedDates: [], policy: '',
      };
      update.bookingSettings = {
        ...current,
        ...dto.bookingSettings,
        weeklyHours: dto.bookingSettings.weeklyHours ?? current.weeklyHours,
        closedDates: dto.bookingSettings.closedDates ?? current.closedDates,
      };
    }
    if (dto.summarySettings) {
      const current = business.summarySettings || {
        dailyEnabled: true, weeklyEnabled: true, sendTime: '20:00', weeklyDay: 1,
        channels: { whatsapp: true, email: true },
      };
      update.summarySettings = {
        ...current,
        ...dto.summarySettings,
        channels: { ...current.channels, ...(dto.summarySettings.channels || {}) },
      };
    }
    if (dto.alertSettings) {
      update.alertSettings = { ...(business.alertSettings || {}), ...dto.alertSettings };
    }
    if (dto.category && !business.categories.includes(dto.category)) {
      update.categories = [...business.categories, dto.category];
    }
    const updated = await this.businesses.findByIdAndUpdate(businessId, { $set: update }, { new: true }).exec();
    if (!updated) throw new NotFoundException('Business not found.');
    await this.audit.record({
      businessId,
      actorId: user.id,
      action: 'business.updated',
      entity: 'business',
      entityId: businessId,
      metadata: { fields: Object.keys(update) },
    });
    return updated;
  }

  async staff(businessId: string) {
    const memberships = await this.memberships.find({ businessId }).sort({ role: 1, createdAt: 1 }).lean().exec();
    const users = await this.users
      .find({ _id: { $in: memberships.map((m) => m.userId) } })
      .select('name email phone avatarUrl emailVerifiedAt isActive lastLoginAt')
      .lean()
      .exec();
    return memberships.map((m) => {
      const u = users.find((x) => String(x._id) === m.userId);
      return {
        id: m._id.toString(),
        userId: m.userId,
        role: m.role,
        permissions: m.role === 'owner' ? ['all'] : m.permissions,
        status: m.status,
        joinedAt: m.joinedAt,
        user: u
          ? {
              name: u.name,
              email: u.email,
              phone: u.phone,
              avatarUrl: u.avatarUrl,
              verified: Boolean(u.emailVerifiedAt),
              lastLoginAt: u.lastLoginAt,
            }
          : null,
      };
    });
  }

  async inviteStaff(user: AuthenticatedUser, businessId: string, dto: InviteStaffDto) {
    const business = await this.findById(businessId);
    const staffCount = await this.memberships.countDocuments({ businessId, role: 'staff', status: 'active' }).exec();
    await this.plans.assertStaffSeat(businessId, staffCount);

    let invitee = await this.users.findOne({ email: dto.email }).exec();
    let isNew = false;
    if (!invitee) {
      invitee = await this.users.create({
        name: dto.name,
        email: dto.email,
        passwordHash: await bcrypt.hash(randomToken(24), 12),
        emailVerifiedAt: null,
      });
      isNew = true;
    }
    if (!invitee.isActive) throw new BadRequestException('That account is disabled.');
    const existingMembership = await this.memberships.findOne({ businessId, userId: invitee._id.toString() }).exec();
    if (existingMembership) throw new ConflictException('That person is already on your team.');

    const membership = await this.memberships.create({
      businessId,
      userId: invitee._id.toString(),
      role: 'staff',
      permissions: dto.permissions?.length ? dto.permissions : STAFF_DEFAULT_PERMISSIONS,
      invitedBy: user.id,
    });

    const token = randomToken(32);
    await this.users.updateOne(
      { _id: invitee._id },
      { $set: { passwordResetTokenHash: sha256(token), passwordResetExpiresAt: new Date(Date.now() + 48 * 3600 * 1000) } },
    ).exec();
    const mail = staffInviteEmail(
      invitee.name,
      business.name,
      user.email,
      `${this.config.get('appUrl')}/reset-password?token=${token}&invite=1`,
      business.logoUrl,
    );
    await this.mail.send({
      to: invitee.email,
      subject: mail.subject,
      html: mail.html,
      template: 'staff_invite',
      businessId,
    });
    await this.audit.record({
      businessId,
      actorId: user.id,
      action: 'staff.invited',
      entity: 'membership',
      entityId: membership._id.toString(),
      metadata: { email: dto.email, newAccount: isNew },
    });
    return { id: membership._id.toString(), email: invitee.email, invited: true, newAccount: isNew };
  }

  async updateStaff(user: AuthenticatedUser, businessId: string, membershipId: string, dto: UpdateStaffDto) {
    const membership = await this.memberships.findOne({ _id: membershipId, businessId }).exec();
    if (!membership) throw new NotFoundException('Team member not found.');
    if (membership.role === 'owner') throw new ForbiddenException('The owner account cannot be changed here.');
    if (dto.permissions !== undefined) membership.permissions = dto.permissions;
    if (dto.status !== undefined) membership.status = dto.status;
    await membership.save();
    await this.audit.record({
      businessId,
      actorId: user.id,
      action: 'staff.updated',
      entity: 'membership',
      entityId: membershipId,
      metadata: { permissions: dto.permissions, status: dto.status },
    });
    return membership;
  }

  async removeStaff(user: AuthenticatedUser, businessId: string, membershipId: string) {
    const membership = await this.memberships.findOne({ _id: membershipId, businessId }).exec();
    if (!membership) throw new NotFoundException('Team member not found.');
    if (membership.role === 'owner') throw new ForbiddenException('You cannot remove the owner.');
    membership.status = 'disabled';
    await membership.save();
    await this.audit.record({
      businessId,
      actorId: user.id,
      action: 'staff.removed',
      entity: 'membership',
      entityId: membershipId,
    });
    return { removed: true };
  }

  async onboarding(businessId: string) {
    const business = await this.findById(businessId);
    const [productCount, serviceCount, saleCount] = await Promise.all([
      this.products.countDocuments({ businessId }).exec(),
      this.services.countDocuments({ businessId, isActive: true }).exec(),
      this.orders.countDocuments({ businessId, status: { $in: ['paid', 'delivered'] } }).exec(),
    ]);
    const serviceMode = business.businessMode === 'services' || business.businessMode === 'hybrid';
    const steps = serviceMode ? [
      { key: 'account', label: 'Create your account', done: true, href: '/app' },
      { key: 'brand', label: 'Add your logo', done: Boolean(business.logoUrl), href: '/app/settings?tab=business' },
      { key: 'service', label: 'Add your first service', done: serviceCount > 0, href: '/app/services' },
      { key: 'availability', label: 'Set your availability', done: Boolean(business.bookingSettings?.enabled), href: '/app/bookings/settings' },
      { key: 'publish', label: 'Publish your booking page', done: Boolean(business.storefrontPublished), href: '/app/website' },
      { key: 'booking', label: 'Take your first booking', done: Boolean(business.firstSaleAt), href: '/app/bookings/new' },
    ] : [
      { key: 'account', label: 'Create your account', done: true, href: '/app' },
      { key: 'brand', label: 'Add your logo', done: Boolean(business.logoUrl), href: '/app/settings?tab=business' },
      { key: 'product', label: 'Add your first product', done: productCount > 0, href: '/app/products/new' },
      { key: 'sale', label: 'Record your first sale', done: saleCount > 0 || Boolean(business.firstSaleAt), href: '/app/sales/new' },
      { key: 'profit', label: 'See your first profit number', done: Boolean(business.firstProfitAt), href: '/app/reports' },
    ];
    const completed = steps.filter((s) => s.done).length;
    return { steps, completed, total: steps.length, percent: Math.round((completed / steps.length) * 100), complete: completed === steps.length };
  }

  async markOnboardingStep(businessId: string, step: string) {
    if (!['profit'].includes(step)) throw new BadRequestException('That onboarding step cannot be marked directly.');
    await this.businesses.updateOne({ _id: businessId, firstProfitAt: null }, { $set: { firstProfitAt: new Date() } }).exec();
    return this.onboarding(businessId);
  }

  async setCustomDomain(user: AuthenticatedUser, businessId: string, dto: CustomDomainDto) {
    await this.plans.assertFeature(businessId, 'customDomain');
    const existing = await this.businesses.findOne({ customDomain: dto.domain, _id: { $ne: businessId } }).lean().exec();
    if (existing) throw new ConflictException('That domain is already connected to another store.');
    const updated = await this.businesses.findByIdAndUpdate(
      businessId,
      { $set: { customDomain: dto.domain, customDomainVerified: false } },
      { new: true },
    ).exec();
    await this.audit.record({
      businessId,
      actorId: user.id,
      action: 'business.custom_domain_set',
      entity: 'business',
      entityId: businessId,
      metadata: { domain: dto.domain },
    });
    return { customDomain: updated?.customDomain, verified: false, instructions: this.domainInstructions(dto.domain) };
  }

  async removeCustomDomain(user: AuthenticatedUser, businessId: string) {
    await this.businesses.updateOne(
      { _id: businessId },
      { $set: { customDomain: null, customDomainVerified: false } },
    ).exec();
    await this.audit.record({ businessId, actorId: user.id, action: 'business.custom_domain_removed', entity: 'business', entityId: businessId });
    return { removed: true };
  }

  async verifyCustomDomain(businessId: string) {
    const business = await this.findById(businessId);
    if (!business.customDomain) throw new BadRequestException('Add a custom domain first.');
    let verified = false;
    let reason = 'We could not find the DNS record yet. DNS can take up to 24 hours.';
    const expected = `cname.${this.config.get('publicRootDomain')}`;
    try {
      const cnames = await dns.resolveCname(business.customDomain);
      verified = cnames.some((c) => c.toLowerCase().replace(/\.$/, '') === expected.toLowerCase());
      if (!verified) reason = `Your CNAME points to ${cnames.join(', ')}. Set it to ${expected}.`;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'ENODATA' && code !== 'ENOTFOUND') reason = 'DNS lookup failed. Try again shortly.';
    }
    if (verified) {
      await this.businesses.updateOne({ _id: businessId }, { $set: { customDomainVerified: true } }).exec();
    }
    return { verified, domain: business.customDomain, expectedCname: expected, reason: verified ? 'Domain is verified.' : reason };
  }

  private domainInstructions(domain: string) {
    return {
      type: 'CNAME',
      host: domain.split('.')[0] === 'www' ? 'www' : '@',
      target: `cname.${this.config.get('publicRootDomain')}`,
      note: 'Add this record with your domain provider, then tap Verify. SSL is issued automatically after verification.',
    };
  }
}
