import { AppError } from './errors';

export class QBApiError extends AppError {
  constructor(
    message: string,
    public statusCode: number,
    public qbErrorCode?: string,
    public intuitTid?: string,
  ) {
    super(message, statusCode);
    this.name = 'QBApiError';
  }

  get category(): 'TRANSIENT' | 'AUTH' | 'VALIDATION' | 'FATAL' {
    if (this.statusCode === 401 || this.statusCode === 403) return 'AUTH';
    if (this.statusCode === 429) return 'TRANSIENT';
    if (this.statusCode === 400) return 'VALIDATION';
    return 'FATAL';
  }
}
