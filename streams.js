// TextDecoder 的流式模式确保中文字符在网络分块边界上不被截断。
async function* textLines(body) {
  if (!body) throw new Error('响应中没有可读取的内容。');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > 256000) throw new Error('响应数据过长。');
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        yield line;
      }
      if (done) { completed = true; break; }
    }
    if (buffer) yield buffer.replace(/\r$/, '');
  } finally {
    if (!completed) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function* readSse(body) {
  let parts = [];
  for await (const line of textLines(body)) {
    if (line === '') {
      if (parts.length) yield parts.join('\n');
      parts = [];
    } else if (line.startsWith('data:')) {
      parts.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (parts.length) yield parts.join('\n');
}

export async function* readNdjson(body) {
  for await (const line of textLines(body)) {
    if (line.trim()) yield JSON.parse(line);
  }
}
