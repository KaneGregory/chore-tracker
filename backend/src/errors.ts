export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(
    message = 'Invalid request body',
    public readonly details?: unknown,
  ) {
    super(400, 'ValidationError', message);
  }
}

export class EmailAlreadyRegisteredError extends AppError {
  constructor() {
    super(409, 'EmailAlreadyRegistered', 'An account with this email already exists');
  }
}

export class InvalidJoinCodeError extends AppError {
  constructor() {
    super(400, 'InvalidJoinCode', 'That household join code is not valid');
  }
}

export class InvalidCredentialsError extends AppError {
  constructor() {
    super(401, 'InvalidCredentials', 'Email or password is incorrect');
  }
}

export class NotAuthenticatedError extends AppError {
  constructor() {
    super(401, 'NotAuthenticated', 'You must be logged in to do that');
  }
}
