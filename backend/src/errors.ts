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

export class UsernameAlreadyTakenError extends AppError {
  constructor() {
    super(409, 'UsernameAlreadyTaken', 'That username is already taken');
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

export class HouseholdNotFoundError extends AppError {
  constructor() {
    super(404, 'HouseholdNotFound', 'That household was not found');
  }
}

export class NotHeadOfHouseholdError extends AppError {
  constructor() {
    super(403, 'NotHeadOfHousehold', 'Only a Head of Household can do that');
  }
}

export class MemberNotFoundError extends AppError {
  constructor() {
    super(404, 'MemberNotFound', 'That person is not a member of this household');
  }
}

export class ZoneNotFoundError extends AppError {
  constructor() {
    super(404, 'ZoneNotFound', 'That zone was not found');
  }
}

export class RootZoneImmutableError extends AppError {
  constructor() {
    super(400, 'RootZoneImmutable', 'The Household zone can’t be removed or moved');
  }
}

export class InvalidZoneMoveError extends AppError {
  constructor() {
    super(400, 'InvalidZoneMove', 'A zone can’t be moved into itself or one of its own zones');
  }
}

export class ChoreNotFoundError extends AppError {
  constructor() {
    super(404, 'ChoreNotFound', 'That chore was not found');
  }
}

export class ChoreNotAssignableError extends AppError {
  constructor() {
    super(400, 'ChoreNotAssignable', 'Only single-time chores can be assigned right now');
  }
}

export class ChoreZoneMismatchError extends AppError {
  constructor() {
    super(400, 'ChoreZoneMismatch', 'That zone is not one of this chore’s zones');
  }
}

export class CannotAssignOthersError extends AppError {
  constructor() {
    super(403, 'CannotAssignOthers', 'Only a Head of Household can assign a chore to someone else');
  }
}

export class ChoreAlreadyAssignedError extends AppError {
  constructor() {
    super(409, 'ChoreAlreadyAssigned', 'That person is already assigned to this chore');
  }
}
