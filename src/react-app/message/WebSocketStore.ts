import {SnackReporter} from '../snack/SnackManager';
import {CurrentUser} from '../CurrentUser';
import * as config from '../config';
import {IMessage} from '../types';
import {isHttpError} from '../api';

export class WebSocketStore {
    private wsActive = false;
    private ws: WebSocket | null = null;

    public constructor(
        private readonly snack: SnackReporter,
        private readonly currentUser: CurrentUser
    ) {}

    public listen = (callback: (msg: IMessage) => void) => {
        if (!this.currentUser.token() || this.wsActive) {
            return;
        }
        this.wsActive = true;

        const wsUrl = config.get('url').replace('http', 'ws').replace('https', 'wss');
        const ws = new WebSocket(wsUrl + 'stream?token=' + this.currentUser.token());

        ws.onerror = (e) => {
            this.wsActive = false;
            console.log('WebSocket connection errored', e);
        };

        ws.onmessage = (data) => callback(JSON.parse(data.data));

        ws.onclose = () => {
            this.wsActive = false;
            this.currentUser
                .tryAuthenticate()
                .then(() => {
                    this.snack('WebSocket connection closed, trying again in 30 seconds.');
                    setTimeout(() => this.listen(callback), 30000);
                })
                .catch((error: unknown) => {
                    if (isHttpError(error) && error.status === 401) {
                        this.snack('Could not authenticate with client token, logging out.');
                    }
                });
        };

        this.ws = ws;
    };

    public close = () => this.ws?.close(1000, 'WebSocketStore#close');
}
