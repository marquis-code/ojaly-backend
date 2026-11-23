import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentBusiness, Permissions } from '../../common/decorators/auth.decorators';
import { Public } from '../../common/decorators/public.decorator';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ReviewsService } from './reviews.service';
import { ReplyReviewDto, ReviewQueryDto, SubmitReviewDto, UpdateReviewDto } from './review.dto';

@ApiTags('Reviews')
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Public()
  @Get('public/reviews/:token')
  context(@Param('token') token: string) {
    return this.reviews.context(token);
  }

  @Public()
  @Post('public/reviews/:token')
  submit(@Param('token') token: string, @Body() dto: SubmitReviewDto) {
    return this.reviews.submit(token, dto);
  }

  @ApiBearerAuth()
  @Get('reviews')
  @Permissions(PERMISSIONS.BOOKINGS_READ)
  list(@CurrentBusiness() businessId: string, @Query() query: ReviewQueryDto) {
    return this.reviews.list(businessId, query);
  }

  @ApiBearerAuth()
  @Post('reviews/:id/reply')
  @Permissions(PERMISSIONS.BOOKINGS_WRITE)
  reply(@CurrentBusiness() businessId: string, @Param('id') id: string, @Body() dto: ReplyReviewDto) {
    return this.reviews.reply(businessId, id, dto);
  }

  @ApiBearerAuth()
  @Patch('reviews/:id')
  @Permissions(PERMISSIONS.BOOKINGS_WRITE)
  update(@CurrentBusiness() businessId: string, @Param('id') id: string, @Body() dto: UpdateReviewDto) {
    return this.reviews.setStatus(businessId, id, dto.status);
  }

  @ApiBearerAuth()
  @Delete('reviews/:id')
  @Permissions(PERMISSIONS.BOOKINGS_WRITE)
  remove(@CurrentBusiness() businessId: string, @Param('id') id: string) {
    return this.reviews.remove(businessId, id);
  }
}
