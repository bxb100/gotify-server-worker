import { action } from 'mobx'

import { requestJson, requestVoid } from '../api'
import { BaseStore } from '../common/BaseStore'
import * as config from '../config'
import { SnackReporter } from '../snack/SnackManager'
import { IClient } from '../types'

export class ClientStore extends BaseStore<IClient> {
  public constructor(private readonly snack: SnackReporter) {
    super()
  }

  protected requestItems = (): Promise<IClient[]> =>
    requestJson<IClient[]>(`${config.get('url')}client`)

  protected requestDelete(id: number): Promise<void> {
    return requestVoid(`${config.get('url')}client/${id}`, {
      method: 'DELETE'
    }).then(() => this.snack('Client deleted'))
  }

  @action
  public update = async (id: number, name: string): Promise<void> => {
    await requestVoid(`${config.get('url')}client/${id}`, {
      method: 'PUT',
      body: { name }
    })
    await this.refresh()
    this.snack('Client updated')
  }

  @action
  public createNoNotifcation = async (name: string): Promise<IClient> => {
    const client = await requestJson<IClient>(`${config.get('url')}client`, {
      method: 'POST',
      body: { name }
    })
    await this.refresh()
    return client
  }

  @action
  public create = async (name: string): Promise<void> => {
    await this.createNoNotifcation(name)
    this.snack('Client added')
  }
}
