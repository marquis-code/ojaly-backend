import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentBusiness, Permissions } from '../../common/decorators/auth.decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { SaleMessagesService } from './sale-messages.service';
import { SendSaleMessageDto } from './sale-message.dto';

@ApiTags('Sale messages')
@ApiBearerAuth()
@Controller('sale-messages')
export class SaleMessagesController {
  constructor(private readonly messages: SaleMessagesService) {}
  @Get('inbox') @Permissions(PERMISSIONS.SALES_READ) inbox(@CurrentBusiness() businessId: string) { return this.messages.inbox(businessId); }
  @Get(':saleId') @Permissions(PERMISSIONS.SALES_READ) thread(@CurrentBusiness() businessId: string, @Param('saleId') saleId: string) { return this.messages.vendorThread(businessId, saleId); }
  @Post(':saleId') @Permissions(PERMISSIONS.SALES_WRITE) send(@CurrentBusiness() businessId: string, @Param('saleId') saleId: string, @Body() dto: SendSaleMessageDto) { return this.messages.sendVendor(businessId, saleId, dto); }
  @Post(':saleId/read') @Permissions(PERMISSIONS.SALES_READ) read(@CurrentBusiness() businessId: string, @Param('saleId') saleId: string) { return this.messages.markVendorRead(businessId, saleId); }
}

@ApiTags('Public sale messages')
@Public()
@Controller('public/sale-messages')
export class PublicSaleMessagesController {
  constructor(private readonly messages: SaleMessagesService) {}
  @Get(':token') thread(@Param('token') token: string) { return this.messages.publicThread(token); }
  @Post(':token') send(@Param('token') token: string, @Body() dto: SendSaleMessageDto) { return this.messages.sendCustomer(token, dto); }
  @Post(':token/read') read(@Param('token') token: string) { return this.messages.markCustomerRead(token); }
}
