import { compare } from 'bcryptjs'
import { createMiddleware } from 'hono/factory'

import {
  getApplicationByToken,
  getClientByToken,
  getUserById,
  getUserByName,
  touchApplication,
  touchClient
} from './db'
import type { AuthState, EnvBindings, UserRow } from './types'
import {
  ApiError,
  getBasicCredentials,
  getTokenFromRequest,
  isOlderThan
} from './utils'

type AppContext = {
  Bindings: EnvBindings
  Variables: {
    auth: AuthState | null
  }
}

async function getBasicUser(
  env: EnvBindings,
  request: Request
): Promise<UserRow | null> {
  const credentials = getBasicCredentials(request)
  if (!credentials) {
    return null
  }
  const user = await getUserByName(env.DB, credentials.name)
  if (!user) {
    return null
  }
  return (await compare(credentials.pass, user.pass)) ? user : null
}

function setAuth(
  c: { set: (key: 'auth', value: AuthState) => void },
  auth: AuthState
): void {
  c.set('auth', auth)
}

export const optionalAuth = createMiddleware<AppContext>(async (c, next) => {
  const basicUser = await getBasicUser(c.env, c.req.raw)
  if (basicUser) {
    setAuth(c, {
      kind: 'basic',
      userId: basicUser.id,
      token: '',
      user: basicUser
    })
    await next()
    return
  }

  const token = getTokenFromRequest(c.req.raw)
  if (token) {
    const client = await getClientByToken(c.env.DB, token)
    if (client) {
      setAuth(c, { kind: 'optional', userId: client.user_id, token })
      await next()
      return
    }
  }

  c.set('auth', null)
  await next()
})

export const requireClient = createMiddleware<AppContext>(async (c, next) => {
  const basicUser = await getBasicUser(c.env, c.req.raw)
  if (basicUser) {
    setAuth(c, {
      kind: 'basic',
      userId: basicUser.id,
      token: '',
      user: basicUser
    })
    await next()
    return
  }

  const token = getTokenFromRequest(c.req.raw)
  if (!token) {
    throw new ApiError(
      401,
      'you need to provide a valid access token or user credentials to access this api'
    )
  }

  const client = await getClientByToken(c.env.DB, token)
  if (!client) {
    throw new ApiError(
      401,
      'you need to provide a valid access token or user credentials to access this api'
    )
  }

  if (isOlderThan(client.last_used, 5 * 60 * 1000)) {
    await touchClient(c.env.DB, token, new Date().toISOString())
  }

  setAuth(c, { kind: 'client', userId: client.user_id, token })
  await next()
})

export const requireAdmin = createMiddleware<AppContext>(async (c, next) => {
  const basicUser = await getBasicUser(c.env, c.req.raw)
  if (basicUser) {
    if (!basicUser.admin) {
      throw new ApiError(403, 'you are not allowed to access this api')
    }
    setAuth(c, {
      kind: 'basic',
      userId: basicUser.id,
      token: '',
      user: basicUser
    })
    await next()
    return
  }

  const token = getTokenFromRequest(c.req.raw)
  if (!token) {
    throw new ApiError(
      401,
      'you need to provide a valid access token or user credentials to access this api'
    )
  }

  const client = await getClientByToken(c.env.DB, token)
  if (!client) {
    throw new ApiError(
      401,
      'you need to provide a valid access token or user credentials to access this api'
    )
  }

  const user = await getUserById(c.env.DB, client.user_id)
  if (!user?.admin) {
    throw new ApiError(403, 'you are not allowed to access this api')
  }

  if (isOlderThan(client.last_used, 5 * 60 * 1000)) {
    await touchClient(c.env.DB, token, new Date().toISOString())
  }

  setAuth(c, { kind: 'client', userId: client.user_id, token, user })
  await next()
})

export const requireApplication = createMiddleware<AppContext>(
  async (c, next) => {
    const basicUser = await getBasicUser(c.env, c.req.raw)
    if (basicUser) {
      throw new ApiError(403, 'you are not allowed to access this api')
    }

    const token = getTokenFromRequest(c.req.raw)
    if (!token) {
      throw new ApiError(
        401,
        'you need to provide a valid access token or user credentials to access this api'
      )
    }

    const application = await getApplicationByToken(c.env.DB, token)
    if (!application) {
      throw new ApiError(
        401,
        'you need to provide a valid access token or user credentials to access this api'
      )
    }

    if (isOlderThan(application.last_used, 5 * 60 * 1000)) {
      await touchApplication(c.env.DB, token, new Date().toISOString())
    }

    setAuth(c, { kind: 'application', userId: application.user_id, token })
    await next()
  }
)
