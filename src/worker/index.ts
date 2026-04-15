import { hash as hasher } from 'bcryptjs'
import { WorkerEntrypoint } from 'cloudflare:workers'
import { Hono } from 'hono'

import {
  optionalAuth,
  requireAdmin,
  requireApplication,
  requireClient
} from './auth'
import {
  countAdmins,
  createApplication,
  createClient,
  createMessage,
  createUser,
  deleteApplication,
  deleteClient,
  deleteMessage,
  deleteMessagesByApplication,
  deleteMessagesByUser,
  deleteUser,
  ensureBootstrap,
  getApplicationById,
  getApplicationByToken,
  getApplicationsByUser,
  getClientById,
  getClientsByUser,
  getMessageById,
  getMessagesByApplication,
  getMessagesByUser,
  getUserById,
  getUserByName,
  getUsers,
  ping,
  updateApplication,
  updateClient,
  updateUser
} from './db'
import {
  ensurePluginBootstrap,
  getPluginConfig,
  getPluginDisplay,
  listPlugins,
  runScheduledPlugins,
  setPluginConfigById,
  setPluginEnabledById
} from './plugins'
import { StreamHub } from './stream'
import type { AuthState, EnvBindings, PagedMessages } from './types'
import {
  ApiError,
  boolFromEnv,
  buildNextUrl,
  contentTypeFromExtension,
  corsHeaders,
  generateImageName,
  isSupportedImage,
  isUniqueConstraintError,
  jsonError,
  maybeNumber,
  maybeString,
  parseId,
  parsePaging,
  passwordRounds,
  readJsonBody,
  requireNonEmptyString,
  toApplicationExternal,
  toClientExternal,
  toMessageExternal,
  toUserExternal,
  validImageExtension
} from './utils'

type AppEnv = {
  Bindings: EnvBindings
  Variables: {
    auth: AuthState | null
  }
}

const app = new Hono<AppEnv>()

app.use('*', async (c, next) => {
  await Promise.all([ensureBootstrap(c.env), ensurePluginBootstrap(c.env.DB)])
  c.set('auth', null)
  await next()

  if (c.req.header('Upgrade')?.toLowerCase() === 'websocket') {
    return
  }

  const headers = corsHeaders(
    c.req.header('Origin') ?? null,
    c.env.CORS_ALLOW_ORIGIN
  )
  for (const [key, value] of headers.entries()) {
    c.header(key, value)
  }
})

app.options(
  '*',
  (c) =>
    new Response(null, {
      status: 204,
      headers: corsHeaders(
        c.req.header('Origin') ?? null,
        c.env.CORS_ALLOW_ORIGIN
      )
    })
)

app.onError((error) => {
  if (error instanceof ApiError) {
    return jsonError(error.status, error.message)
  }
  // 🛡️ Sentinel: Do not leak internal error messages to the client
  console.error('Unhandled error:', error)
  return jsonError(500, 'internal server error')
})

app.get('/health', async (c) => {
  try {
    await ping(c.env.DB)
    return c.json({ health: 'green', database: 'green' })
  } catch {
    return c.json({ health: 'orange', database: 'red' }, 500)
  }
})

app.get('/version', (c) =>
  c.json({
    version: c.env.GOTIFY_VERSION ?? 'worker-dev',
    commit: c.env.GOTIFY_COMMIT ?? 'unknown',
    buildDate: c.env.GOTIFY_BUILD_DATE ?? new Date().toISOString()
  })
)

app.get('/image/:key', async (c) => {
  if (!c.env.APP_IMAGES) {
    throw new ApiError(404, 'image storage is not configured')
  }
  const key = c.req.param('key')
  const object = await c.env.APP_IMAGES.get(key)
  if (!object) {
    throw new ApiError(404, 'image does not exist')
  }

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  return new Response(object.body, { headers })
})

app.post('/user', optionalAuth, async (c) => {
  const body = await readJsonBody<Record<string, unknown>>(c.req.raw)
  const name = requireNonEmptyString(body.name, 'name')
  const pass = requireNonEmptyString(body.pass, 'pass')
  const admin = Boolean(body.admin)

  const existingUser = await getUserByName(c.env.DB, name)
  if (existingUser) {
    throw new ApiError(400, 'username already exists')
  }

  const auth = c.get('auth')
  const requestedBy = auth ? await getUserById(c.env.DB, auth.userId) : null
  const registrationEnabled = boolFromEnv(c.env.GOTIFY_REGISTRATION, false)

  if (!requestedBy?.admin) {
    const status = requestedBy ? 403 : 401
    if (!registrationEnabled) {
      throw new ApiError(status, 'you are not allowed to access this api')
    }
    if (admin) {
      throw new ApiError(status, 'you are not allowed to create an admin user')
    }
  }

  try {
    const created = await createUser(c.env.DB, {
      name,
      pass: await hasher(pass, passwordRounds(c.env.GOTIFY_PASSWORD_ROUNDS)),
      admin
    })
    return c.json(toUserExternal(created))
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ApiError(400, 'username already exists')
    }
    throw error
  }
})

app.get('/user', requireAdmin, async (c) => {
  const users = await getUsers(c.env.DB)
  return c.json(users.map(toUserExternal))
})

app.get('/user/:id', requireAdmin, async (c) => {
  const id = parseId(c.req.param('id'))
  const user = await getUserById(c.env.DB, id)
  if (!user) {
    throw new ApiError(404, 'user does not exist')
  }
  return c.json(toUserExternal(user))
})

app.post('/user/:id', requireAdmin, async (c) => {
  const id = parseId(c.req.param('id'))
  const body = await readJsonBody<Record<string, unknown>>(c.req.raw)
  const existing = await getUserById(c.env.DB, id)
  if (!existing) {
    throw new ApiError(404, 'user does not exist')
  }

  const nextAdmin = Boolean(body.admin)
  const adminCount = Number((await countAdmins(c.env.DB))?.count ?? 0)
  if (!nextAdmin && Boolean(existing.admin) && adminCount === 1) {
    throw new ApiError(400, 'cannot delete last admin')
  }

  try {
    const updated = await updateUser(c.env.DB, {
      id,
      name: requireNonEmptyString(body.name, 'name'),
      admin: nextAdmin,
      pass:
        typeof body.pass === 'string' && body.pass !== ''
          ? await hasher(
              body.pass,
              passwordRounds(c.env.GOTIFY_PASSWORD_ROUNDS)
            )
          : existing.pass
    })

    return c.json(toUserExternal(updated))
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ApiError(400, 'username already exists')
    }
    throw error
  }
})

app.delete('/user/:id', requireAdmin, async (c) => {
  const id = parseId(c.req.param('id'))
  const user = await getUserById(c.env.DB, id)
  if (!user) {
    throw new ApiError(404, 'user does not exist')
  }
  const adminCount = Number((await countAdmins(c.env.DB))?.count ?? 0)
  if (Boolean(user.admin) && adminCount === 1) {
    throw new ApiError(400, 'cannot delete last admin')
  }
  if (c.env.APP_IMAGES) {
    const apps = await getApplicationsByUser(c.env.DB, id)
    await Promise.all(
      apps
        .filter((appRow) => appRow.image)
        .map((appRow) => c.env.APP_IMAGES!.delete(appRow.image))
    )
  }
  await deleteUser(c.env.DB, id)
  return new Response(null, { status: 200 })
})

app.get('/current/user', requireClient, async (c) => {
  const auth = requireAuth(c.get('auth'))
  const user = await getUserById(c.env.DB, auth.userId)
  if (!user) {
    throw new ApiError(404, 'user does not exist')
  }
  return c.json(toUserExternal(user))
})

app.post('/current/user/password', requireClient, async (c) => {
  const auth = requireAuth(c.get('auth'))
  const user = await getUserById(c.env.DB, auth.userId)
  if (!user) {
    throw new ApiError(404, 'user does not exist')
  }

  const body = await readJsonBody<Record<string, unknown>>(c.req.raw)
  await updateUser(c.env.DB, {
    id: user.id,
    name: user.name,
    admin: Boolean(user.admin),
    pass: await hasher(
      requireNonEmptyString(body.pass, 'pass'),
      passwordRounds(c.env.GOTIFY_PASSWORD_ROUNDS)
    )
  })
  return new Response(null, { status: 200 })
})

app.get('/client', requireClient, async (c) => {
  const auth = requireAuth(c.get('auth'))
  const clients = await getClientsByUser(c.env.DB, auth.userId)
  return c.json(clients.map(toClientExternal))
})

app.post('/client', requireClient, async (c) => {
  const auth = requireAuth(c.get('auth'))
  const body = await readJsonBody<Record<string, unknown>>(c.req.raw)
  const created = await createClient(c.env.DB, {
    name: requireNonEmptyString(body.name, 'name'),
    userId: auth.userId
  })
  return c.json(toClientExternal(created))
})

app.put('/client/:id', requireClient, async (c) => {
  const auth = requireAuth(c.get('auth'))
  const id = parseId(c.req.param('id'))
  const client = await getClientById(c.env.DB, id)
  if (!client || client.user_id !== auth.userId) {
    throw new ApiError(404, `client with id ${id} doesn't exists`)
  }

  const body = await readJsonBody<Record<string, unknown>>(c.req.raw)
  const updated = await updateClient(c.env.DB, {
    id,
    name: requireNonEmptyString(body.name, 'name')
  })
  return c.json(toClientExternal(updated))
})

app.delete('/client/:id', requireClient, async (c) => {
  const auth = requireAuth(c.get('auth'))
  const id = parseId(c.req.param('id'))
  const client = await getClientById(c.env.DB, id)
  if (!client || client.user_id !== auth.userId) {
    throw new ApiError(404, `client with id ${id} doesn't exists`)
  }
  await deleteClient(c.env.DB, id)
  return new Response(null, { status: 200 })
})

app.get('/application', requireClient, async (c) => {
  const auth = requireAuth(c.get('auth'))
  const apps = await getApplicationsByUser(c.env.DB, auth.userId)
  return c.json(apps.map(toApplicationExternal))
})

app.post('/application', requireClient, async (c) => {
  const auth = requireAuth(c.get('auth'))
  const body = await readJsonBody<Record<string, unknown>>(c.req.raw)
  try {
    const created = await createApplication(c.env.DB, {
      userId: auth.userId,
      name: requireNonEmptyString(body.name, 'name'),
      description: maybeString(body.description),
      defaultPriority: maybeNumber(body.defaultPriority, 0),
      sortKey: typeof body.sortKey === 'string' ? body.sortKey : undefined
    })
    return c.json(toApplicationExternal(created))
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ApiError(400, 'sort key is not unique')
    }
    throw error
  }
})

app.put('/application/:id', requireClient, async (c) => {
  const auth = requireAuth(c.get('auth'))
  const id = parseId(c.req.param('id'))
  const appRow = await getApplicationById(c.env.DB, id)
  if (!appRow || appRow.user_id !== auth.userId) {
    throw new ApiError(404, `app with id ${id} doesn't exists`)
  }

  const body = await readJsonBody<Record<string, unknown>>(c.req.raw)
  try {
    const updated = await updateApplication(c.env.DB, {
      id,
      name: requireNonEmptyString(body.name, 'name'),
      description: maybeString(body.description),
      defaultPriority: maybeNumber(body.defaultPriority, 0),
      sortKey:
        typeof body.sortKey === 'string' && body.sortKey.trim() !== ''
          ? body.sortKey
          : appRow.sort_key,
      image: appRow.image
    })
    return c.json(toApplicationExternal(updated))
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ApiError(400, 'sort key is not unique')
    }
    throw error
  }
})

app.delete('/application/:id', requireClient, async (c) => {
  const auth = requireAuth(c.get('auth'))
  const id = parseId(c.req.param('id'))
  const appRow = await getApplicationById(c.env.DB, id)
  if (!appRow || appRow.user_id !== auth.userId) {
    throw new ApiError(404, `app with id ${id} doesn't exists`)
  }
  if (appRow.internal) {
    throw new ApiError(400, 'cannot delete internal application')
  }
  if (appRow.image && c.env.APP_IMAGES) {
    await c.env.APP_IMAGES.delete(appRow.image)
  }
  await deleteApplication(c.env.DB, id)
  return new Response(null, { status: 200 })
})

app.post('/application/:id/image', requireClient, async (c) => {
  if (!c.env.APP_IMAGES) {
    throw new ApiError(501, 'image storage is not configured')
  }

  const auth = requireAuth(c.get('auth'))
  const id = parseId(c.req.param('id'))
  const appRow = await getApplicationById(c.env.DB, id)
  if (!appRow || appRow.user_id !== auth.userId) {
    throw new ApiError(404, `app with id ${id} doesn't exists`)
  }

  const form = await c.req.formData()
  const uploaded = form.get('file')
  if (!(uploaded instanceof File)) {
    throw new ApiError(400, "file with key 'file' must be present")
  }

  const extension = uploaded.name.includes('.')
    ? `.${uploaded.name.split('.').pop() ?? ''}`
    : ''

  if (!validImageExtension(extension)) {
    throw new ApiError(400, 'invalid file extension')
  }

  const bytes = await uploaded.arrayBuffer()
  if (!isSupportedImage(bytes)) {
    throw new ApiError(400, 'file must be an image')
  }

  const imageName = generateImageName(extension)
  await c.env.APP_IMAGES.put(imageName, bytes, {
    httpMetadata: {
      contentType: uploaded.type || contentTypeFromExtension(extension)
    }
  })

  if (appRow.image) {
    await c.env.APP_IMAGES.delete(appRow.image)
  }

  const updated = await updateApplication(c.env.DB, {
    id: appRow.id,
    name: appRow.name,
    description: appRow.description,
    defaultPriority: appRow.default_priority,
    sortKey: appRow.sort_key,
    image: imageName
  })
  return c.json(toApplicationExternal(updated))
})

app.delete('/application/:id/image', requireClient, async (c) => {
  if (!c.env.APP_IMAGES) {
    throw new ApiError(501, 'image storage is not configured')
  }

  const auth = requireAuth(c.get('auth'))
  const id = parseId(c.req.param('id'))
  const appRow = await getApplicationById(c.env.DB, id)
  if (!appRow || appRow.user_id !== auth.userId) {
    throw new ApiError(404, `app with id ${id} doesn't exists`)
  }
  if (!appRow.image) {
    throw new ApiError(
      400,
      `app with id ${id} does not have a customized image`
    )
  }

  await c.env.APP_IMAGES.delete(appRow.image)
  const updated = await updateApplication(c.env.DB, {
    id: appRow.id,
    name: appRow.name,
    description: appRow.description,
    defaultPriority: appRow.default_priority,
    sortKey: appRow.sort_key,
    image: ''
  })
  return c.json(toApplicationExternal(updated))
})

app.get('/message', requireClient, async (c) => {
  const auth = requireAuth(c.get('auth'))
  const { limit, since } = parsePaging(new URL(c.req.url))
  const rows = await getMessagesByUser(c.env.DB, auth.userId, limit + 1, since)
  return c.json(buildPagedMessages(rows, limit, c.req.url))
})

app.get('/application/:id/message', requireClient, async (c) => {
  const auth = requireAuth(c.get('auth'))
  const id = parseId(c.req.param('id'))
  const appRow = await getApplicationById(c.env.DB, id)
  if (!appRow || appRow.user_id !== auth.userId) {
    throw new ApiError(404, 'application does not exist')
  }
  const { limit, since } = parsePaging(new URL(c.req.url))
  const rows = await getMessagesByApplication(c.env.DB, id, limit + 1, since)
  return c.json(buildPagedMessages(rows, limit, c.req.url))
})

app.delete('/message', requireClient, async (c) => {
  const auth = requireAuth(c.get('auth'))
  await deleteMessagesByUser(c.env.DB, auth.userId)
  return new Response(null, { status: 200 })
})

app.delete('/application/:id/message', requireClient, async (c) => {
  const auth = requireAuth(c.get('auth'))
  const id = parseId(c.req.param('id'))
  const appRow = await getApplicationById(c.env.DB, id)
  if (!appRow || appRow.user_id !== auth.userId) {
    throw new ApiError(404, 'application does not exists')
  }
  await deleteMessagesByApplication(c.env.DB, id)
  return new Response(null, { status: 200 })
})

app.delete('/message/:id', requireClient, async (c) => {
  const auth = requireAuth(c.get('auth'))
  const id = parseId(c.req.param('id'))
  const message = await getMessageById(c.env.DB, id)
  if (!message) {
    throw new ApiError(404, 'message does not exist')
  }
  const appRow = await getApplicationById(c.env.DB, message.application_id)
  if (!appRow || appRow.user_id !== auth.userId) {
    throw new ApiError(404, 'message does not exist')
  }
  await deleteMessage(c.env.DB, id)
  return new Response(null, { status: 200 })
})

app.post('/message', requireApplication, async (c) => {
  const auth = requireAuth(c.get('auth'))
  const body = await readJsonBody<Record<string, unknown>>(c.req.raw)
  const application = await getApplicationByToken(c.env.DB, auth.token)
  if (!application) {
    throw new ApiError(
      401,
      'you need to provide a valid access token or user credentials to access this api'
    )
  }

  const title = maybeString(body.title).trim() || application.name
  const priority =
    body.priority === undefined
      ? application.default_priority
      : maybeNumber(body.priority, application.default_priority)

  const extras =
    body.extras &&
    typeof body.extras === 'object' &&
    !Array.isArray(body.extras)
      ? JSON.stringify(body.extras)
      : null

  const created = await createMessage(c.env.DB, {
    applicationId: application.id,
    message: requireNonEmptyString(body.message, 'message'),
    title,
    priority,
    extras,
    date: new Date().toISOString()
  })

  const external = toMessageExternal(created)
  await publishToUserStream(c.env, auth.userId, external)
  return c.json(external)
})

app.get('/stream', requireClient, async (c) => {
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    throw new ApiError(400, 'websocket upgrade required')
  }

  const auth = requireAuth(c.get('auth'))
  const id = c.env.STREAM_HUB.idFromName(`user:${auth.userId}`)
  const stub = c.env.STREAM_HUB.get(id)
  return stub.fetch(c.req.raw)
})

app.get('/plugin', requireClient, async (c) =>
  c.json(await listPlugins(c.env.DB))
)

app.get('/plugin/:id/config', requireClient, async (c) => {
  const id = parseId(c.req.param('id'))
  return new Response(await getPluginConfig(c.env.DB, id), {
    headers: { 'content-type': 'application/x-yaml; charset=utf-8' }
  })
})

app.post('/plugin/:id/config', requireClient, async (c) => {
  const id = parseId(c.req.param('id'))
  await setPluginConfigById({ env: c.env }, id, await c.req.raw.text())
  return new Response(null, { status: 204 })
})

app.get('/plugin/:id/display', requireClient, async (c) => {
  const id = parseId(c.req.param('id'))
  return new Response(await getPluginDisplay({ env: c.env }, id), {
    headers: { 'content-type': 'text/markdown; charset=utf-8' }
  })
})

app.post('/plugin/:id/enable', requireClient, async (c) => {
  const id = parseId(c.req.param('id'))
  await setPluginEnabledById({ env: c.env }, id, true)
  return new Response(null, { status: 204 })
})

app.post('/plugin/:id/disable', requireClient, async (c) => {
  const id = parseId(c.req.param('id'))
  await setPluginEnabledById({ env: c.env }, id, false)
  return new Response(null, { status: 204 })
})

app.notFound(() => jsonError(404, 'Not Found'))

function requireAuth(auth: AuthState | null): AuthState {
  if (!auth) {
    throw new ApiError(500, 'authentication context missing')
  }
  return auth
}

function buildPagedMessages(
  rows: Awaited<ReturnType<typeof getMessagesByUser>>,
  limit: number,
  requestUrl: string
): PagedMessages {
  const hasNext = rows.length > limit
  const visible = hasNext ? rows.slice(0, rows.length - 1) : rows
  const last = visible.at(-1)
  return {
    paging: {
      size: visible.length,
      limit,
      since: hasNext && last ? last.id : 0,
      next:
        hasNext && last ? buildNextUrl(requestUrl, limit, last.id) : undefined
    },
    messages: visible.map(toMessageExternal)
  }
}

async function publishToUserStream(
  env: EnvBindings,
  userId: number,
  payload: unknown
): Promise<void> {
  const id = env.STREAM_HUB.idFromName(`user:${userId}`)
  const stub = env.STREAM_HUB.get(id)
  await stub.fetch('https://stream.internal/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  })
}

export { StreamHub }

export default class GotifyWorker extends WorkerEntrypoint<EnvBindings> {
  public fetch(request: Request): Response | Promise<Response> {
    return app.fetch(request, this.env, this.ctx)
  }

  public scheduled(controller: ScheduledController): void {
    this.ctx.waitUntil(
      Promise.all([
        ensureBootstrap(this.env),
        ensurePluginBootstrap(this.env.DB)
      ]).then(() => runScheduledPlugins({ env: this.env }, controller))
    )
  }
}
