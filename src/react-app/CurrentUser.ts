import { detect } from 'detect-browser'
import { observable, runInAction, action } from 'mobx'

import { isHttpError, requestJson, requestVoid } from './api'
import * as config from './config'
import { SnackReporter } from './snack/SnackManager'
import { IClient, IUser } from './types'

const tokenKey = 'gotify-login-key'

export class CurrentUser {
  private tokenCache: string | null = null
  private reconnectTimeoutId: number | null = null
  private reconnectTime = 7500
  @observable accessor loggedIn = false
  @observable accessor refreshKey = 0
  @observable accessor authenticating = true
  @observable accessor user: IUser = { name: 'unknown', admin: false, id: -1 }
  @observable accessor connectionErrorMessage: string | null = null

  public constructor(private readonly snack: SnackReporter) {}

  public token = (): string => {
    if (this.tokenCache !== null) {
      return this.tokenCache
    }

    const localStorageToken = window.localStorage.getItem(tokenKey)
    if (localStorageToken) {
      this.tokenCache = localStorageToken
      return localStorageToken
    }

    return ''
  }

  private readonly setToken = (token: string) => {
    this.tokenCache = token
    window.localStorage.setItem(tokenKey, token)
  }

  public register = async (name: string, pass: string): Promise<boolean> =>
    requestVoid(config.get('url') + 'user', {
      method: 'POST',
      auth: false,
      handleError: false,
      body: { name, pass }
    })
      .then(() => {
        this.snack('User Created. Logging in...')
        this.login(name, pass)
        return true
      })
      .catch((error: unknown) => {
        if (!isHttpError(error)) {
          this.snack('No network connection or server unavailable.')
          return false
        }

        const data = error.data as {
          error?: string
          errorDescription?: string
        } | null
        this.snack(
          `Register failed: ${data?.error ?? 'unknown'}: ${data?.errorDescription ?? ''}`
        )
        return false
      })

  public login = async (username: string, password: string) => {
    runInAction(() => {
      this.loggedIn = false
      this.authenticating = true
    })
    const browser = detect()
    const name =
      (browser && browser.name + ' ' + browser.version) || 'unknown browser'
    requestJson<IClient>(config.get('url') + 'client', {
      method: 'POST',
      auth: false,
      handleError: false,
      body: { name },
      headers: { Authorization: 'Basic ' + btoa(username + ':' + password) }
    })
      .then((client) => {
        this.snack(`A client named '${name}' was created for your session.`)
        this.setToken(client.token)
        this.tryAuthenticate().catch(() => {
          console.log(
            'create client succeeded, but authenticated with given token failed'
          )
        })
      })
      .catch(
        action(() => {
          this.authenticating = false
          return this.snack('Login failed')
        })
      )
  }

  public tryAuthenticate = async (): Promise<IUser> => {
    if (this.token() === '') {
      runInAction(() => {
        this.authenticating = false
      })
      return Promise.reject(new Error('No client token available.'))
    }

    return requestJson<IUser>(config.get('url') + 'current/user', {
      auth: false,
      handleError: false,
      headers: { 'X-Gotify-Key': this.token() }
    })
      .then(
        action((user) => {
          this.user = user
          this.loggedIn = true
          this.authenticating = false
          this.connectionErrorMessage = null
          this.reconnectTime = 7500
          return user
        })
      )
      .catch(
        action((error: unknown) => {
          this.authenticating = false
          if (!isHttpError(error)) {
            this.connectionError('No network connection or server unavailable.')
            return Promise.reject(error)
          }

          if (error.status >= 500) {
            this.connectionError(`${error.statusText} (code: ${error.status}).`)
            return Promise.reject(error)
          }

          this.connectionErrorMessage = null

          if (error.status >= 400 && error.status < 500) {
            this.logout()
          }
          return Promise.reject(error)
        })
      )
  }

  public logout = async () => {
    await requestJson<IClient[]>(config.get('url') + 'client', {
      handleError: false
    })
      .then((clients) =>
        Promise.all(
          clients
            .filter((client) => client.token === this.tokenCache)
            .map((client) =>
              requestVoid(config.get('url') + 'client/' + client.id, {
                method: 'DELETE',
                handleError: false
              })
            )
        )
      )
      .catch(() => Promise.resolve())
    window.localStorage.removeItem(tokenKey)
    this.tokenCache = null
    runInAction(() => {
      this.loggedIn = false
    })
  }

  public changePassword = (pass: string) => {
    requestVoid(config.get('url') + 'current/user/password', {
      method: 'POST',
      body: { pass }
    }).then(() => this.snack('Password changed'))
  }

  public tryReconnect = (quiet = false) => {
    this.tryAuthenticate().catch(() => {
      if (!quiet) {
        this.snack('Reconnect failed')
      }
    })
  }

  private readonly connectionError = (message: string) => {
    this.connectionErrorMessage = message
    if (this.reconnectTimeoutId !== null) {
      window.clearTimeout(this.reconnectTimeoutId)
    }
    this.reconnectTimeoutId = window.setTimeout(
      () => this.tryReconnect(true),
      this.reconnectTime
    )
    this.reconnectTime = Math.min(this.reconnectTime * 2, 120000)
  }
}
