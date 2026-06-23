import type { ErrorBody } from './schemas.ts'

/**
 * Framework-agnostic domain error. Every backend catches this in one place and
 * maps `.status` straight onto the HTTP response, so error handling stays
 * identical (and comparable) across Elysia, h3, Hono and Nitro.
 */
export class OrchardError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = new.target.name
  }

  /** Carried onto h3/Nitro `HTTPError.data` so the code survives error wrapping. */
  get data(): { error: string } {
    return { error: this.code }
  }

  toBody(): ErrorBody {
    return { error: this.code, message: this.message }
  }
}

export class NotFoundError extends OrchardError {
  constructor(what: string) {
    super(404, 'not_found', `No ${what} here 🤷`)
  }
}

export class ConflictError extends OrchardError {
  constructor(message: string) {
    super(409, 'conflict', message)
  }
}

export class OutOfStockError extends OrchardError {
  constructor(name: string, wantKg: number, haveKg: number) {
    super(409, 'out_of_stock', `Only ${haveKg}kg of ${name} left — you asked for ${wantKg}kg 🧺`)
  }
}

export class UnauthorizedError extends OrchardError {
  constructor() {
    super(401, 'unauthorized', 'Missing or invalid x-orchard-key 🔑')
  }
}
