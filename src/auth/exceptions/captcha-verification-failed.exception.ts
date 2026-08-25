import { HttpException, HttpStatus } from '@nestjs/common';

export class CaptchaVerificationFailedException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'CAPTCHA verification failed. Please try again.',
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}
