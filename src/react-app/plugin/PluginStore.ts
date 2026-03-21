import {action} from 'mobx';
import {BaseStore} from '../common/BaseStore';
import * as config from '../config';
import {SnackReporter} from '../snack/SnackManager';
import {IPlugin} from '../types';
import {requestJson, requestText, requestVoid} from '../api';

export class PluginStore extends BaseStore<IPlugin> {
    public onDelete: () => void = () => {};

    public constructor(private readonly snack: SnackReporter) {
        super();
    }

    public requestConfig = (id: number): Promise<string> =>
        requestText(`${config.get('url')}plugin/${id}/config`);

    public requestDisplay = (id: number): Promise<string> =>
        requestText(`${config.get('url')}plugin/${id}/display`);

    protected requestItems = (): Promise<IPlugin[]> =>
        requestJson<IPlugin[]>(`${config.get('url')}plugin`);

    protected requestDelete = (): Promise<void> => {
        this.snack('Cannot delete plugin');
        throw new Error('Cannot delete plugin');
    };

    public getName = (id: number): string => {
        const plugin = this.getByIDOrUndefined(id);
        return id === -1 ? 'All Plugins' : plugin !== undefined ? plugin.name : 'unknown';
    };

    @action
    public changeConfig = async (id: number, newConfig: string): Promise<void> => {
        await requestVoid(`${config.get('url')}plugin/${id}/config`, {
            method: 'POST',
            body: newConfig,
            headers: {'content-type': 'application/x-yaml'},
        });
        this.snack(`Plugin config updated`);
        await this.refresh();
    };

    @action
    public changeEnabledState = async (id: number, enabled: boolean): Promise<void> => {
        await requestVoid(`${config.get('url')}plugin/${id}/${enabled ? 'enable' : 'disable'}`, {
            method: 'POST',
        });
        this.snack(`Plugin ${enabled ? 'enabled' : 'disabled'}`);
        await this.refresh();
    };
}
