import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { NewsController } from './news.controller';
import { NewsProviderService } from './news-provider.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 3,
    }),
  ],
  controllers: [NewsController],
  providers: [NewsProviderService],
  exports: [NewsProviderService],
})
export class NewsModule {}
