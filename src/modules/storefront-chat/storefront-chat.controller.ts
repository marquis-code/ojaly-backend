import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentBusiness, Permissions } from '../../common/decorators/auth.decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { StorefrontChatService } from './storefront-chat.service';
import { SendStorefrontChatDto, StartStorefrontChatDto } from './storefront-chat.dto';

@ApiTags('Storefront chat')
@ApiBearerAuth()
@Controller('storefront-chats')
export class StorefrontChatController {
  constructor(private readonly chat: StorefrontChatService) {}
  @Get() @Permissions(PERMISSIONS.BOOKINGS_READ) list(@CurrentBusiness() businessId: string) { return this.chat.vendorList(businessId); }
  @Get(':id') @Permissions(PERMISSIONS.BOOKINGS_READ) thread(@CurrentBusiness() businessId: string, @Param('id') id: string) { return this.chat.vendorThread(businessId, id); }
  @Post(':id/messages') @Permissions(PERMISSIONS.BOOKINGS_WRITE) send(@CurrentBusiness() businessId: string, @Param('id') id: string, @Body() dto: SendStorefrontChatDto) { return this.chat.sendVendor(businessId, id, dto.body); }
  @Post(':id/close') @Permissions(PERMISSIONS.BOOKINGS_WRITE) close(@CurrentBusiness() businessId: string, @Param('id') id: string) { return this.chat.close(businessId, id); }
}

@ApiTags('Public storefront chat')
@Public()
@Controller('public/storefront-chats')
export class PublicStorefrontChatController {
  constructor(private readonly chat: StorefrontChatService) {}
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Post('business/:businessId') start(@Param('businessId') businessId: string, @Body() dto: StartStorefrontChatDto) { return this.chat.start(businessId, dto); }
  @Get(':token') thread(@Param('token') token: string) { return this.chat.publicThread(token); }
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post(':token/messages') send(@Param('token') token: string, @Body() dto: SendStorefrontChatDto) { return this.chat.sendCustomer(token, dto.body); }
}
