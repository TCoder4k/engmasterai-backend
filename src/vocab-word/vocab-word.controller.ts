import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { VocabWordService } from './vocab-word.service';
import { CreateVocabWordDto, UpdateVocabWordDto, QueryVocabWordDto } from './dto';
import { JwtAuthGuard, RolesGuard } from '../auth/guard';
import { Roles } from '../auth/decorator';
import { UserRole } from '@prisma/client';

// Same reasoning as every other content module: the app-wide ValidationPipe
// (main.ts) doesn't enable `transform`, so scope one locally to the list query.
const queryPipe = new ValidationPipe({ transform: true });

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
const IMAGE_MAX_SIZE = 5 * 1024 * 1024;

const AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
];
const AUDIO_MAX_SIZE = 10 * 1024 * 1024;

const CSV_MIME_TYPES = ['text/csv', 'application/vnd.ms-excel'];
const CSV_MAX_SIZE = 2 * 1024 * 1024;

@Controller('vocab/words')
export class VocabWordController {
  constructor(private readonly vocabWordService: VocabWordService) {}

  // Admin only — paginated bank list. Declared before ':id' so the static
  // route isn't swallowed by the dynamic one.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('manage')
  async findAllManage(@Query(queryPipe) query: QueryVocabWordDto) {
    return this.vocabWordService.findAllManage(query);
  }

  // Admin only — the codebase's first admin single-item GET (the editor
  // page needs a deep-linkable/refresh-safe load; see the approved plan §2/§5).
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('manage/:id')
  async findOneManage(@Param('id', ParseUUIDPipe) id: string) {
    return this.vocabWordService.findOneManage(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post()
  async create(@Body() dto: CreateVocabWordDto) {
    return this.vocabWordService.create(dto);
  }

  // CSV bulk import. Accepts the two standard CSV mimetypes plus
  // application/octet-stream with a .csv filename fallback — Windows
  // browsers commonly mislabel CSV uploads, and rejecting them outright
  // would make the import unusable for a large share of admins.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async importCsv(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const looksLikeCsvByName = file.originalname?.toLowerCase().endsWith('.csv');
    const isAllowedMimeType =
      CSV_MIME_TYPES.includes(file.mimetype) ||
      (file.mimetype === 'application/octet-stream' && looksLikeCsvByName);

    if (!isAllowedMimeType) {
      throw new BadRequestException('Only CSV files are allowed');
    }

    if (file.size > CSV_MAX_SIZE) {
      throw new BadRequestException('CSV file must not exceed 2MB');
    }

    return this.vocabWordService.importFromCsv(file.buffer);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post(':id/audio')
  @UseInterceptors(FileInterceptor('audio'))
  async setAudio(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    if (!AUDIO_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Only audio files are allowed (MP3, MP4, OGG, WAV, WebM)');
    }
    if (file.size > AUDIO_MAX_SIZE) {
      throw new BadRequestException('Audio file must not exceed 10MB');
    }

    return this.vocabWordService.setAudio(id, file);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post(':id/image')
  @UseInterceptors(FileInterceptor('image'))
  async setImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    if (!IMAGE_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Only image files are allowed (JPEG, PNG, WebP)');
    }
    if (file.size > IMAGE_MAX_SIZE) {
      throw new BadRequestException('Image file must not exceed 5MB');
    }

    return this.vocabWordService.setImage(id, file);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVocabWordDto,
  ) {
    return this.vocabWordService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.vocabWordService.remove(id);
  }

  // Any authenticated user — the visibility seam (architecture H1) lands
  // here. Declared last among GET routes: ':id' is the most general shape,
  // so it must not precede 'manage'/'manage/:id' (it doesn't, above).
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async findOneVisibleToUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req,
  ) {
    return this.vocabWordService.findOneVisibleToUser(id, req.user);
  }
}
