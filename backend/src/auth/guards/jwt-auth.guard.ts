import { ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = any>(
    err: any,
    user: any,
    info: any,
    context: ExecutionContext,
    status?: any,
  ): TUser {
    const request = context.switchToHttp().getRequest();
    if (request?.headers?.['x-tab-unauthenticated'] === '1') {
      throw new UnauthorizedException('Veuillez vous connecter pour accéder à cette session.');
    }

    const reqUser = super.handleRequest(err, user, info, context, status);
    if (!reqUser) return reqUser;

    if (reqUser.mustChangePassword) {
      const request = context.switchToHttp().getRequest();
      const path: string = request.path || request.url || '';
      const isAllowed = /\/auth\/(change-password|logout|me)($|\?)/.test(path);
      if (!isAllowed) {
        throw new ForbiddenException(
          'Changement de mot de passe obligatoire avant d’accéder à l’application.',
        );
      }
    }

    return reqUser;
  }
}
