import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, PlatformRoles } from '../../common/decorators/auth.decorators';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { SupportService } from './support.service';
import { SendSupportMessageDto, StartSupportConversationDto } from './support.dto';

@ApiTags('Support')
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('conversations')
  start(@Body() dto: StartSupportConversationDto) {
    return this.support.start(dto);
  }

  @Public()
  @Get('conversations/:token')
  thread(@Param('token') token: string) {
    return this.support.publicThread(token);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('conversations/:token/messages')
  send(@Param('token') token: string, @Body() dto: SendSupportMessageDto) {
    return this.support.sendPublic(token, dto.body || '', dto.attachments || []);
  }
}

@ApiTags('Admin support')
@ApiBearerAuth()
@Controller('admin/support')
export class SupportAdminController {
  constructor(private readonly support: SupportService) {}

  @PlatformRoles('super_admin', 'support')
  @Get('conversations')
  list() {
    return this.support.adminList();
  }

  @PlatformRoles('super_admin', 'support')
  @Get('conversations/:id')
  thread(@Param('id') id: string) {
    return this.support.adminThread(id);
  }

  @PlatformRoles('super_admin', 'support')
  @Post('conversations/:id/messages')
  send(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: SendSupportMessageDto) {
    return this.support.sendAdmin(id, dto.body || '', user.email || 'Ojaly Support', dto.attachments || []);
  }

  @PlatformRoles('super_admin', 'support')
  @Post('conversations/:id/close')
  close(@Param('id') id: string) {
    return this.support.close(id);
  }
}
