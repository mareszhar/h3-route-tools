import type { RipenTick } from '@orchard/domain'

/** Parse a `text/event-stream` Response body into typed ripeness ticks. */
export async function* readSSE(res: Response): AsyncGenerator<RipenTick> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done)
      break
    buffer += decoder.decode(value, { stream: true })

    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const event = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const data = event.split('\n').find(line => line.startsWith('data:'))
      if (data)
        yield JSON.parse(data.slice(5).trim()) as RipenTick
      boundary = buffer.indexOf('\n\n')
    }
  }
}
