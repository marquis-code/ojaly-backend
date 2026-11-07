import { ForbiddenException, Injectable, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Plan, PlanDocument, FREE_ENTITLEMENTS, Entitlements } from './plan.schema';
import { Subscription, SubscriptionDocument } from './subscription.schema';

export interface PlanView {
  id: string;
  key: string;
  name: string;
  description: string;
  priceMonthlyKobo: number;
  priceYearlyKobo: number;
  entitlements: Entitlements;
  trialDays: number;
  isDefault: boolean;
  isTrialPlan: boolean;
  marketingFeatures: string[];
}

export const DEFAULT_PLANS: Array<Partial<Plan> & { key: string; name: string }> = [
  {
    key: 'free',
    name: 'Free',
    description: 'Everything you need to know your numbers and sell online.',
    priceMonthlyKobo: 0,
    priceYearlyKobo: 0,
    isDefault: true,
    isTrialPlan: false,
    sortOrder: 1,
    entitlements: FREE_ENTITLEMENTS,
    marketingFeatures: [
      'Unlimited sales & debts',
      '25 products',
      'Auto-generated storefront',
      'Profit dashboard',
      'WhatsApp order links',
      '2 storefront templates',
    ],
  },
  {
    key: 'hustle',
    name: 'Hustle',
    description: 'For the business that is moving fast and needs more room.',
    priceMonthlyKobo: 250000,
    priceYearlyKobo: 2400000,
    isDefault: false,
    isTrialPlan: true,
    trialDays: 30,
    sortOrder: 2,
    entitlements: {
      ...FREE_ENTITLEMENTS,
      productLimit: 500,
      staffSeats: 2,
      advancedReports: true,
      csvExport: true,
      pdfExport: true,
      templates: ['lagos-pop', 'market-bright', 'editorial-green', 'midnight-studio', 'campus-ink'],
    },
    marketingFeatures: [
      '500 products',
      '2 staff seats',
      'All reports + CSV & PDF export',
      '5 storefront templates',
      'Low-stock WhatsApp alerts',
      'Debt reminder automation',
    ],
  },
  {
    key: 'boss',
    name: 'Boss',
    description: 'Own the whole operation, including your own domain.',
    priceMonthlyKobo: 600000,
    priceYearlyKobo: 5760000,
    isDefault: false,
    isTrialPlan: false,
    sortOrder: 3,
    entitlements: {
      ...FREE_ENTITLEMENTS,
      productLimit: null,
      staffSeats: 10,
      customDomain: true,
      advancedReports: true,
      csvExport: true,
      pdfExport: true,
      templates: ['lagos-pop', 'market-bright', 'editorial-green', 'midnight-studio', 'campus-ink', 'sunset-grid', 'soft-serve'],
      prioritySupport: true,
    },
    marketingFeatures: [
      'Unlimited products',
      '10 staff seats',
      'Custom domain',
      'All 7 templates',
      'Priority support',
      'Embedded order widget',
    ],
  },
];

@Injectable()
export class PlansService implements OnApplicationBootstrap {
  constructor(
    @InjectModel(Plan.name) private readonly plans: Model<PlanDocument>,
    @InjectModel(Subscription.name) private readonly subscriptions: Model<SubscriptionDocument>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureDefaults();
  }

  async ensureDefaults(): Promise<void> {
    for (const plan of DEFAULT_PLANS) {
      await this.plans.updateOne(
        { key: plan.key },
        { $setOnInsert: plan },
        { upsert: true },
      ).exec();
    }
    // New templates are additive: existing plans pick them up without losing
    // custom plan edits or entitlements.
    for (const plan of DEFAULT_PLANS) {
      const templates = plan.entitlements?.templates || [];
      for (const template of templates) {
        await this.plans.updateOne(
          { key: plan.key, 'entitlements.templates': { $ne: template } },
          { $addToSet: { 'entitlements.templates': template } },
        ).exec();
      }
    }
    // Every business gets a full 30 days. Existing trial plans created during
    // the earlier 14-day launch are brought up to the same policy.
    await this.plans.updateOne({ key: 'hustle' }, { $set: { trialDays: 30 } }).exec();
    const activeTrials = await this.subscriptions.find({ status: 'trialing', trialStartedAt: { $ne: null } }).exec();
    for (const subscription of activeTrials) {
      if (!subscription.trialStartedAt) continue;
      const fullTrialEnd = new Date(new Date(subscription.trialStartedAt).getTime() + 30 * 86400000);
      if (!subscription.trialEndsAt || subscription.trialEndsAt < fullTrialEnd) {
        subscription.trialEndsAt = fullTrialEnd;
        await subscription.save();
      }
    }
  }

  async listPublic(): Promise<PlanView[]> {
    const plans = await this.plans.find({ isActive: true }).sort({ sortOrder: 1 }).lean().exec();
    return plans.map((p) => this.toView(p));
  }

  async getPlan(key: string): Promise<PlanDocument> {
    const plan = await this.plans.findOne({ key, isActive: true }).exec();
    if (!plan) throw new NotFoundException('That plan is not available.');
    return plan;
  }

  async getDefaultPlan(): Promise<PlanDocument> {
    return (
      (await this.plans.findOne({ isDefault: true, isActive: true }).exec()) ||
      (await this.plans.findOne({ isActive: true }).sort({ sortOrder: 1 }).exec()) ||
      (await this.plans.findOne({ key: 'free' }).exec())!
    );
  }

  async getTrialPlan(): Promise<PlanDocument> {
    return (
      (await this.plans.findOne({ isTrialPlan: true, isActive: true }).sort({ sortOrder: 1 }).exec()) ||
      (await this.getDefaultPlan())
    );
  }

  async getSubscription(businessId: string): Promise<SubscriptionDocument | null> {
    return this.subscriptions.findOne({ businessId }).exec();
  }

  async getPlanForBusiness(businessId: string): Promise<{ plan: PlanDocument; subscription: SubscriptionDocument | null; entitlements: Entitlements }> {
    const subscription = await this.subscriptions.findOne({ businessId }).exec();
    if (subscription?.status === 'trialing' && subscription.trialEndsAt && subscription.trialEndsAt.getTime() <= Date.now()) {
      subscription.status = 'expired';
      await subscription.save();
    }
    let plan: PlanDocument | null = null;
    if (subscription && ['trialing', 'active', 'past_due'].includes(subscription.status)) {
      plan = await this.plans.findOne({ key: subscription.planKey }).exec();
    }
    if (!plan) plan = await this.getDefaultPlan();
    return {
      plan,
      subscription,
      entitlements: { ...FREE_ENTITLEMENTS, ...(plan.entitlements || {}) },
    };
  }

  async createTrialSubscription(
    businessId: string,
    planId: string,
    planKey: string,
    trialDays: number,
    trialMilestoneOrders: number,
  ): Promise<SubscriptionDocument> {
    const now = new Date();
    return this.subscriptions.create({
      businessId,
      planKey,
      planId,
      status: trialDays > 0 ? 'trialing' : 'active',
      trialStartedAt: trialDays > 0 ? now : null,
      trialEndsAt: trialDays > 0 ? new Date(now.getTime() + trialDays * 86400000) : null,
      trialMilestoneOrders,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 86400000),
    });
  }

  async activatePlan(
    businessId: string,
    planKey: string,
    opts: { interval?: 'monthly' | 'yearly'; paystackSubscriptionCode?: string; amountKobo?: number; billingEmail?: string } = {},
  ): Promise<SubscriptionDocument> {
    const plan = await this.getPlan(planKey);
    const now = new Date();
    const days = opts.interval === 'yearly' ? 365 : 30;
    return (await this.subscriptions.findOneAndUpdate(
      { businessId },
      {
        $set: {
          planKey,
          planId: plan._id.toString(),
          status: 'active',
          billingInterval: opts.interval || 'monthly',
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + days * 86400000),
          paystackSubscriptionCode: opts.paystackSubscriptionCode || null,
          billingEmail: opts.billingEmail || null,
          cancelledAt: null,
        },
        $unset: { milestoneReachedAt: 1 },
      },
      { new: true, upsert: true },
    ).exec()) as SubscriptionDocument;
  }

  async renewSubscription(businessId: string, interval: 'monthly' | 'yearly'): Promise<void> {
    const sub = await this.subscriptions.findOne({ businessId }).exec();
    if (!sub) return;
    const days = interval === 'yearly' ? 365 : 30;
    const base = sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() > Date.now() ? sub.currentPeriodEnd : new Date();
    sub.status = 'active';
    sub.billingInterval = interval;
    sub.currentPeriodStart = new Date();
    sub.currentPeriodEnd = new Date(base.getTime() + days * 86400000);
    await sub.save();
  }

  async downgradeToFree(businessId: string, reason: string): Promise<void> {
    const free = await this.getDefaultPlan();
    await this.subscriptions.updateOne(
      { businessId },
      {
        $set: {
          planKey: free.key,
          planId: free._id.toString(),
          status: 'expired',
          adminNote: reason,
        },
      },
    ).exec();
  }

  entitlementsToView(e: Entitlements): Entitlements {
    return { ...FREE_ENTITLEMENTS, ...e };
  }

  toView(plan: Plan | (Plan & { _id: unknown })): PlanView {
    const p = plan as Plan & { _id?: unknown; id?: string };
    return {
      id: p.id || String(p._id),
      key: p.key,
      name: p.name,
      description: p.description,
      priceMonthlyKobo: p.priceMonthlyKobo,
      priceYearlyKobo: p.priceYearlyKobo,
      entitlements: this.entitlementsToView(p.entitlements),
      trialDays: p.trialDays,
      isDefault: p.isDefault,
      isTrialPlan: p.isTrialPlan,
      marketingFeatures: p.marketingFeatures,
    };
  }

  async assertProductLimit(businessId: string, currentCount: number): Promise<void> {
    const { entitlements, plan } = await this.getPlanForBusiness(businessId);
    if (entitlements.productLimit !== null && currentCount >= entitlements.productLimit) {
      throw new ForbiddenException(
        `Your ${plan.name} plan allows ${entitlements.productLimit} products. Upgrade to add more.`,
      );
    }
  }

  async assertStaffSeat(businessId: string, currentStaff: number): Promise<void> {
    const { entitlements, plan } = await this.getPlanForBusiness(businessId);
    if (currentStaff >= entitlements.staffSeats) {
      throw new ForbiddenException(
        `Your ${plan.name} plan allows ${entitlements.staffSeats} staff seat${entitlements.staffSeats === 1 ? '' : 's'}. Upgrade to add more.`,
      );
    }
  }

  async assertTemplate(businessId: string, templateKey: string): Promise<void> {
    const { entitlements, plan } = await this.getPlanForBusiness(businessId);
    if (!entitlements.templates.includes(templateKey)) {
      throw new ForbiddenException(`The ${templateKey} template is not included in your ${plan.name} plan.`);
    }
  }

  async assertFeature(businessId: string, feature: keyof Entitlements): Promise<void> {
    const { entitlements, plan } = await this.getPlanForBusiness(businessId);
    if (!entitlements[feature]) {
      throw new ForbiddenException(`That feature is not included in your ${plan.name} plan.`);
    }
  }

  async recordTrialMilestone(businessId: string, orders: number): Promise<void> {
    const sub = await this.subscriptions.findOne({ businessId }).exec();
    if (
      sub?.status === 'trialing' &&
      !sub.milestoneReachedAt &&
      sub.trialMilestoneOrders > 0 &&
      orders >= sub.trialMilestoneOrders
    ) {
      sub.milestoneReachedAt = new Date();
      await sub.save();
    }
  }
}
