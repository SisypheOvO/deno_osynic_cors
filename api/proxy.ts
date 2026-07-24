const defaultOrigins = (process.env.WEBAPP_URLS || "http://localhost:5173")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean)

const allowedOrigins = defaultOrigins.length > 0 ? defaultOrigins : ["*"]

function resolveAllowOrigin(origin: string) {
  if (allowedOrigins[0] === "*") return "*"
  return allowedOrigins.includes(origin) ? origin : ""
}

function corsHeaders(allowOrigin: string) {
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Max-Age": "86400",
    "X-Proxied-By": "Vercel CORS Proxy",
  }
}

async function readBody(req: any) {
  const chunks: Uint8Array[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined
}

export default async function handler(req: any, res: any) {
  const url = new URL(req.url || "/", `https://${req.headers.host || "localhost"}`)
  const origin = req.headers.origin || ""
  const allowOrigin = resolveAllowOrigin(origin)
  const rawPath = (url.searchParams.get("path") || "").replace(/^\/+/, "")
  const targetPath = rawPath ? rawPath : ""

  if (req.method === "OPTIONS") {
    res.statusCode = 204
    for (const [key, value] of Object.entries(corsHeaders(allowOrigin))) {
      res.setHeader(key, value)
    }
    res.end()
    return
  }

  if (!targetPath) {
    res.statusCode = 400
    for (const [key, value] of Object.entries(corsHeaders(allowOrigin))) {
      res.setHeader(key, value)
    }
    res.end("请在路径中提供目标 URL\n例如: /https://osu.ppy.sh/api/get_beatmaps?k=&s=114514")
    return
  }

  if (!targetPath.startsWith("https://osu.ppy.sh/")) {
    res.statusCode = 400
    for (const [key, value] of Object.entries(corsHeaders(allowOrigin))) {
      res.setHeader(key, value)
    }
    res.end("请在路径中提供正确的osu!api调用\n例如: /https://osu.ppy.sh/api/get_beatmaps?k=&s=114514")
    return
  }

  const targetURL = new URL(targetPath)
  for (const [key, value] of url.searchParams.entries()) {
    if (key !== "path") {
      targetURL.searchParams.set(key, value)
    }
  }

  const requestHeaders = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    const normalizedKey = key.toLowerCase()
    if (
      ![
        "host",
        "origin",
        "referer",
        "connection",
        "sec-fetch-mode",
        "sec-fetch-site",
        "sec-fetch-dest",
      ].includes(normalizedKey)
    ) {
      if (typeof value === "string") {
        requestHeaders.set(key, value)
      }
    }
  }

  const requestInit: RequestInit = {
    method: req.method,
    headers: requestHeaders,
  }

  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    requestInit.body = await readBody(req)
  }

  try {
    const response = await fetch(targetURL.toString(), requestInit)
    const responseHeaders = new Headers()

    for (const [key, value] of response.headers.entries()) {
      responseHeaders.set(key, value)
    }

    for (const [key, value] of Object.entries(corsHeaders(allowOrigin))) {
      responseHeaders.set(key, value)
    }

    const responseBody = Buffer.from(await response.arrayBuffer())
    res.statusCode = response.status
    res.statusMessage = response.statusText
    for (const [key, value] of responseHeaders.entries()) {
      res.setHeader(key, value)
    }
    res.end(responseBody)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.statusCode = 500
    for (const [key, value] of Object.entries(corsHeaders(allowOrigin))) {
      res.setHeader(key, value)
    }
    res.end(`代理错误: ${message}`)
  }
}