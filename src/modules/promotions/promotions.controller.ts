import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PromotionsService } from './promotions.service';

@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Public()
  @Get('public/platform')
  platform() {
    return this.promotions.publicPlatformCampaign();
  }

  @Public()
  @Get('public/new-customer')
  async newCustomer() {
    const promotion = await this.promotions.getNewCustomer();
    return { enabled: Boolean(promotion.enabled), percentOff: promotion.percentOff || 0 };
  }
}
