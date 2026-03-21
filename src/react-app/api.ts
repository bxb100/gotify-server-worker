import type {CurrentUser} from './CurrentUser';
import type {SnackReporter} from './snack/SnackManager';

interface IErrorResponse {
    error?: string;
    errorDescription?: string;
}

interface IApiContext {
    currentUser: CurrentUser;
    snack: SnackReporter;
}

type RequestBody = BodyInit | object | null | undefined;

export interface IApiRequestInit extends Omit<RequestInit, 'body' | 'headers'> {
    auth?: boolean;
    body?: RequestBody;
    handleError?: boolean;
    headers?: HeadersInit;
}

export class HttpError<T = unknown> extends Error {
    public readonly status: number;
    public readonly statusText: string;
    public readonly data: T | null;

    public constructor(response: Response, data: T | null) {
        super(`${response.statusText || 'Request failed'} (code: ${response.status}).`);
        this.name = 'HttpError';
        this.status = response.status;
        this.statusText = response.statusText;
        this.data = data;
    }
}

let apiContext: IApiContext | null = null;

export const initApiClient = (currentUser: CurrentUser, snack: SnackReporter) => {
    apiContext = {currentUser, snack};
};

export const isHttpError = (error: unknown): error is HttpError =>
    error instanceof HttpError;

export const requestJson = async <T>(url: string, init: IApiRequestInit = {}): Promise<T> => {
    const response = await request(url, init);
    const text = await response.text();
    return text === '' ? (undefined as T) : (JSON.parse(text) as T);
};

export const requestText = async (url: string, init: IApiRequestInit = {}): Promise<string> => {
    const response = await request(url, init);
    return response.text();
};

export const requestVoid = async (url: string, init: IApiRequestInit = {}): Promise<void> => {
    await request(url, init);
};

const request = async (url: string, init: IApiRequestInit): Promise<Response> => {
    const {auth = true, body, handleError = true, headers: rawHeaders, ...rest} = init;
    const headers = new Headers(rawHeaders);
    const resolvedBody = resolveBody(body, headers);

    if (auth && !headers.has('X-Gotify-Key')) {
        headers.set('X-Gotify-Key', apiContext?.currentUser.token() ?? '');
    }

    try {
        const response = await fetch(url, {
            ...rest,
            body: resolvedBody,
            headers,
        });

        if (!response.ok) {
            const error = new HttpError(response, await parseResponseBody(response));
            if (handleError) {
                handleRequestError(error);
            }
            throw error;
        }

        return response;
    } catch (error) {
        if (handleError && !isHttpError(error)) {
            handleRequestError(error);
        }
        throw error;
    }
};

const handleRequestError = (error: unknown) => {
    if (!apiContext) {
        return;
    }

    if (!isHttpError(error)) {
        apiContext.snack('Gotify server is not reachable, try refreshing the page.');
        return;
    }

    if (error.status === 401) {
        void apiContext.currentUser
            .tryAuthenticate()
            .then(() => apiContext?.snack('Could not complete request.'))
            .catch(() => {});
    }

    if (error.status === 400 || error.status === 403 || error.status === 500) {
        const data = error.data as IErrorResponse | null;
        const message = [data?.error ?? error.statusText, data?.errorDescription]
            .filter(Boolean)
            .join(': ');

        apiContext.snack(message);
    }
};

const parseResponseBody = async (response: Response): Promise<unknown> => {
    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
        return response.json();
    }

    const text = await response.text();
    return text === '' ? null : text;
};

const resolveBody = (body: RequestBody, headers: Headers): BodyInit | null | undefined => {
    if (body === undefined || body === null) {
        return body;
    }

    if (isBodyInit(body)) {
        return body;
    }

    if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json');
    }

    return JSON.stringify(body);
};

const isBodyInit = (body: RequestBody): body is BodyInit =>
    typeof body === 'string' ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream);
