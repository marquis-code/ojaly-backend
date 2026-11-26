import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Provider, ProviderDocument } from '../providers/provider.schema';
import { ProvidersService } from '../providers/providers.service';
import { Service, ServiceDocument } from './service.schema';
import { CreateServiceDto, UpdateServiceDto } from './service.dto';

@Injectable()
export class ServicesService {
  constructor(
    @InjectModel(Service.name) private readonly services: Model<ServiceDocument>,
    @InjectModel(Provider.name) private readonly providers: Model<ProviderDocument>,
    private readonly providersService: ProvidersService,
  ) {}

  async list(businessId: string, includeInactive = true) {
    const filter: Record<string, unknown> = { businessId };
    if (!includeInactive) Object.assign(filter, { isActive: true, isPublic: true });
    const items = await this.services.find(filter).sort({ sortOrder: 1, createdAt: 1 }).lean().exec();
    return items.map((s) => this.view(s));
  }

  async categories(businessId: string) {
    const values = await this.services.distinct('category', { businessId, isActive: true }).exec();
    return (values as string[]).filter(Boolean).sort();
  }

  async findOne(businessId: string, id: string) {
    const service = await this.services.findOne({ _id: id, businessId }).lean().exec();
    if (!service) throw new NotFoundException('Service not found.');
    return this.view(service);
  }

  async create(businessId: string, dto: CreateServiceDto) {
    let providerIds = dto.providerIds || [];
    if (!providerIds.length) {
      const owner = await this.providersService.ensureOwnerProvider(businessId);
      providerIds = [String(owner._id)];
    }
    await this.assertProviders(businessId, providerIds);
    const service = await this.services.create({
      businessId,
      name: dto.name,
      description: dto.description || '',
      category: dto.category || 'Services',
      imageUrl: dto.imageUrl || null,
      color: dto.color || '#FF5A1F',
      durationMinutes: dto.durationMinutes,
      showDuration: dto.showDuration ?? dto.durationMinutes > 0,
      quantityEnabled: dto.quantityEnabled ?? false,
      quantityLabel: dto.quantityLabel || 'Quantity',
      minQuantity: dto.minQuantity ?? 1,
      maxQuantity: dto.maxQuantity ?? 20,
      workerPayKobo: dto.workerPayKobo ?? 0,
      bufferBeforeMinutes: dto.bufferBeforeMinutes ?? 0,
      bufferAfterMinutes: dto.bufferAfterMinutes ?? 0,
      priceKobo: dto.priceKobo,
      depositKobo: dto.depositKobo ?? 0,
      requiresDeposit: dto.requiresDeposit ?? false,
      maxBookingsPerSlot: dto.maxBookingsPerSlot ?? 1,
      providerIds,
      addOns: dto.addOns || [],
      isActive: dto.isActive ?? true,
      isPublic: dto.isPublic ?? true,
      sortOrder: dto.sortOrder ?? 0,
    });
    return this.view(service);
  }

  async update(businessId: string, id: string, dto: UpdateServiceDto) {
    const service = await this.services.findOne({ _id: id, businessId }).exec();
    if (!service) throw new NotFoundException('Service not found.');
    if (dto.providerIds !== undefined) {
      await this.assertProviders(businessId, dto.providerIds);
      service.providerIds = dto.providerIds;
    }
    for (const key of ['name', 'description', 'category', 'imageUrl', 'color', 'durationMinutes', 'showDuration', 'quantityEnabled', 'quantityLabel', 'minQuantity', 'maxQuantity', 'workerPayKobo', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'priceKobo', 'depositKobo', 'requiresDeposit', 'maxBookingsPerSlot', 'addOns', 'isActive', 'isPublic', 'sortOrder'] as const) {
      if (dto[key] !== undefined) (service as unknown as Record<string, unknown>)[key] = dto[key];
    }
    await service.save();
    return this.view(service);
  }

  async remove(businessId: string, id: string) {
    const service = await this.services.findOneAndUpdate(
      { _id: id, businessId },
      { $set: { isActive: false, isPublic: false } },
      { new: true },
    ).exec();
    if (!service) throw new NotFoundException('Service not found.');
    return { removed: true };
  }

  async publicList(businessId: string) {
    const items = await this.services.find({
      businessId, isActive: true, isPublic: true,
    }).sort({ sortOrder: 1, createdAt: 1 }).lean().exec();
    return items.map((s) => this.publicView(s));
  }

  async publicOne(businessId: string, id: string) {
    const service = await this.services.findOne({ _id: id, businessId, isActive: true, isPublic: true }).lean().exec();
    if (!service) throw new NotFoundException('Service not found.');
    return this.publicView(service);
  }

  private async assertProviders(businessId: string, ids: string[]) {
    if (!ids.length) return;
    const count = await this.providers.countDocuments({ businessId, _id: { $in: ids }, isActive: true }).exec();
    if (count !== ids.length) throw new BadRequestException('One or more team members are not available for this business.');
  }

  private view(s: ServiceDocument | (Service & { _id: unknown })) {
    const service = s as ServiceDocument;
    return {
      id: String(service._id),
      name: service.name,
      description: service.description,
      category: service.category,
      imageUrl: service.imageUrl,
      color: service.color,
      durationMinutes: service.durationMinutes,
      showDuration: service.showDuration !== false && service.durationMinutes > 0,
      quantityEnabled: Boolean(service.quantityEnabled),
      quantityLabel: service.quantityLabel || 'Quantity',
      minQuantity: service.minQuantity || 1,
      maxQuantity: service.maxQuantity || 20,
      workerPayKobo: service.workerPayKobo || 0,
      bufferBeforeMinutes: service.bufferBeforeMinutes,
      bufferAfterMinutes: service.bufferAfterMinutes,
      priceKobo: service.priceKobo,
      depositKobo: service.depositKobo,
      requiresDeposit: service.requiresDeposit,
      maxBookingsPerSlot: service.maxBookingsPerSlot,
      providerIds: service.providerIds || [],
      addOns: service.addOns || [],
      isActive: service.isActive,
      isPublic: service.isPublic,
      sortOrder: service.sortOrder,
    };
  }

  private publicView(s: ServiceDocument | (Service & { _id: unknown })) {
    return this.view(s);
  }
}
