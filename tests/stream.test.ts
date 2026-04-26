import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

function waitForMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('timed out waiting for WebSocket message')),
      1000
    )

    socket.addEventListener(
      'message',
      (event) => {
        clearTimeout(timeout)
        resolve(String(event.data))
      },
      { once: true }
    )
  })
}

describe('StreamHub', () => {
  it('broadcasts published payloads to newly connected WebSockets', async () => {
    const id = env.STREAM_HUB.idFromName('unit-test-user')
    const stub = env.STREAM_HUB.get(id)
    const response = await stub.fetch('https://stream.internal/stream', {
      headers: { Upgrade: 'websocket' }
    })

    expect(response.status).toBe(101)
    const socket = response.webSocket
    expect(socket).toBeDefined()

    if (!socket) {
      throw new Error('WebSocket upgrade response missing socket')
    }

    socket.accept()

    try {
      const received = waitForMessage(socket)
      const payload = JSON.stringify({
        id: 1,
        appid: 1,
        message: 'latest',
        title: 'Unit test',
        priority: 5,
        date: '2026-04-26T00:00:00.000Z'
      })

      const publishResponse = await stub.fetch(
        'https://stream.internal/publish',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: payload
        }
      )

      expect(publishResponse.status).toBe(204)
      await expect(received).resolves.toBe(payload)
    } finally {
      socket.close(1000, 'test finished')
    }
  })
})
