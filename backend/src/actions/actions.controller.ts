import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response as ExpressResponse } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { ActionsService } from './actions.service';
import { CreateActionDto } from './dto/create-action.dto';
import { UpdateActionDto } from './dto/update-action.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

interface AuthRequest extends Request {
  user: { id: number; email: string; roles: string[] };
}

interface UploadedActionFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller('api/v1')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ActionsController {
  constructor(private readonly service: ActionsService) {}

  @Post('watch-items/:id/actions')
  @Roles('ADMIN', 'RESPONSABLE_VEILLE', 'REFERENT_LABORATOIRE')
  create(
    @Param('id', ParseIntPipe) itemId: number,
    @Body() dto: CreateActionDto,
    @Req() req: AuthRequest,
  ) {
    return this.service.create(itemId, dto, req.user);
  }

  @Get('watch-items/:id/actions')
  @Roles('ADMIN', 'RESPONSABLE_VEILLE', 'REFERENT_LABORATOIRE')
  findByItem(
    @Param('id', ParseIntPipe) itemId: number,
    @Req() req: AuthRequest,
  ) {
    return this.service.findByItem(itemId, req.user);
  }

  @Get('actions')
  @Roles('ADMIN', 'RESPONSABLE_VEILLE', 'REFERENT_LABORATOIRE')
  findAll(@Req() req: AuthRequest) {
    return this.service.findAll(req.user);
  }

  @Get('actions/my-pending-count')
  @Roles('ADMIN', 'RESPONSABLE_VEILLE', 'REFERENT_LABORATOIRE')
  countMyPending(@Req() req: AuthRequest) {
    return this.service.countPendingForUser(req.user.id);
  }

  @Patch('actions/:id')
  @Roles('ADMIN', 'RESPONSABLE_VEILLE', 'REFERENT_LABORATOIRE')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateActionDto,
    @Req() req: AuthRequest,
  ) {
    return this.service.update(id, dto, req.user);
  }

  @Post('actions/:id/attachment')
  @Roles('ADMIN', 'RESPONSABLE_VEILLE', 'REFERENT_LABORATOIRE')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 15 * 1024 * 1024, files: 1 },
    }),
  )
  async uploadAttachment(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: UploadedActionFile | undefined,
    @Req() req: AuthRequest,
  ) {
    if (!file) throw new BadRequestException('Fichier requis (PDF, image, doc...).');
    const uploadDir = path.resolve(process.cwd(), 'uploads', 'actions');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const filePath = path.join(uploadDir, safeName);
    fs.writeFileSync(filePath, file.buffer);

    return this.service.update(
      id,
      {
        attachmentName: file.originalname,
        attachmentPath: safeName,
        attachmentMime: file.mimetype,
        attachmentSize: file.size,
      },
      req.user,
    );
  }

  @Get('actions/:id/attachment')
  @Roles('ADMIN', 'RESPONSABLE_VEILLE', 'REFERENT_LABORATOIRE', 'LECTEUR')
  async downloadAttachment(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthRequest,
    @Res() res: ExpressResponse,
  ) {
    const action = await this.service.findOne(id, req.user);
    if (!action || !action.attachmentPath) {
      throw new NotFoundException('Aucune pièce jointe trouvée pour cette action.');
    }
    const uploadDir = path.resolve(process.cwd(), 'uploads', 'actions');
    const filePath = path.join(uploadDir, action.attachmentPath);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Fichier physique introuvable sur le serveur.');
    }
    res.setHeader('Content-Type', action.attachmentMime || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(action.attachmentName || 'justificatif')}"`,
    );
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  }

  @Delete('actions/:id')
  @Roles('ADMIN', 'RESPONSABLE_VEILLE', 'REFERENT_LABORATOIRE')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthRequest,
  ) {
    return this.service.remove(id, req.user);
  }
}
