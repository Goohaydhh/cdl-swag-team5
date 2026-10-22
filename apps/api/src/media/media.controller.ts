import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { GifSearchQuery } from '@swag/protocol';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentPrincipal, Public, Scopes } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ApiError } from '../common/api-error';
import { UuidParam, ZodPipe } from '../common/zod.pipe';
import { GifsService } from './gifs.service';
import { MAX_UPLOAD_BYTES, MediaService } from './media.service';

const PreviewQuery = z.object({ exp: z.coerce.number().int(), sig: z.string().regex(/^[0-9a-f]{64}$/) });

@Controller()
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly gifs: GifsService,
  ) {}

  /** Multipart field `file`: a PNG or WebP drawing, at most 1 MB. */
  @Scopes('parent', 'child', 'device')
  @Post('media')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  upload(@CurrentPrincipal() p: Principal, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw ApiError.validation('Send the image in a multipart field named "file"');
    return this.media.uploadImage(p, file.buffer);
  }

  @Scopes('parent', 'child', 'device')
  @Get('media/:id')
  url(@CurrentPrincipal() p: Principal, @Param('id', UuidParam) id: string) {
    return this.media.signedUrl(p, id);
  }

  /** Public, but only reachable through a signed link from `GET media/:id`. */
  @Public()
  @Get('media/:id/raw')
  async raw(
    @Param('id', UuidParam) id: string,
    @Query(new ZodPipe(PreviewQuery)) q: z.infer<typeof PreviewQuery>,
    @Res() res: Response,
  ) {
    const { data, mime } = await this.media.readSigned(id, q.exp, q.sig);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(data);
  }

  @Scopes('parent', 'child', 'device')
  @Get('gifs/search')
  search(@CurrentPrincipal() p: Principal, @Query(new ZodPipe(GifSearchQuery)) q: GifSearchQuery) {
    return this.gifs.search(p, q.q, q.offset);
  }

  /** Public, but only reachable through a signed link from a search result. */
  @Public()
  @Get('gifs/:id/preview')
  async preview(
    @Param('id') id: string,
    @Query(new ZodPipe(PreviewQuery)) q: z.infer<typeof PreviewQuery>,
    @Res() res: Response,
  ) {
    const { data, mime } = await this.gifs.preview(id, q.exp, q.sig);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=900');
    res.send(data);
  }
}
