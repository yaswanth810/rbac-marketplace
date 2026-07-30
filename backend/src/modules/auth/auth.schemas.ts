/**
 * JSON Schema objects for auth route request validation.
 * Fastify validates incoming request bodies against these schemas before
 * the handler runs, returning 400 automatically for invalid payloads.
 */

export const loginBodySchema = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email: {
      type: 'string',
      format: 'email',
      maxLength: 320,
    },
    password: {
      type: 'string',
      minLength: 1,
      maxLength: 1024,
    },
  },
  additionalProperties: false,
} as const;

export const loginSchema = {
  body: loginBodySchema,
  response: {
    200: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        expiresIn: { type: 'string' },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string' },
            organizationId: { type: 'string' },
            permissions: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      },
    },
  },
} as const;
