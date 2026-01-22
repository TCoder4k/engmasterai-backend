import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard that validates JWT tokens using the 'jwt' strategy
 * Extends Passport's AuthGuard for JWT authentication
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
