const defaultOrigins = (process.env.WEBAPP_URLS || "http://localhost:5173")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean)

const allowedOrigins = defaultOrigins.length > 0 ? defaultOrigins : ["*"]

function resolveAllowOrigin(origin: string) {
  if (allowedOrigins[0] === "*") return "*"
  return allowedOrigins.includes(origin) ? origin : ""
}

function corsHeaders(allowOrigin: string, requestedHeaders?: string) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": requestedHeaders || "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "X-Proxied-By": "Vercel CORS Proxy",
  }
  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin
  }
  return headers
}

function applyHeaders(res: any, headers: Record<string, string>) {
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value)
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
  const requestedHeaders = req.headers["access-control-request-headers"]

  if (req.method === "OPTIONS") {
    res.statusCode = 204
    applyHeaders(res, corsHeaders(allowOrigin, requestedHeaders))
    res.end()
    return
  }

  const rawPath = (url.searchParams.getAll("path").find(Boolean) || "").replace(/^\/+/, "")

  if (!rawPath) {
    res.statusCode = 400
    applyHeaders(res, corsHeaders(allowOrigin))
    res.end("请在路径中提供osu!api路径\n例如: /api/v2/me")
    return
  }

  // 拼接到固定目标域,并防止路径穿越到其他域
  const targetURL = new URL(rawPath, "https://osu.ppy.sh/")
  if (targetURL.origin !== "https://osu.ppy.sh") {
    res.statusCode = 400
    applyHeaders(res, corsHeaders(allowOrigin))
    res.end("非法的目标路径")
    return
  }

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
        "content-length",
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

  if (["POST", "PUT", "PATCH"].includes(req.method || "")) {
    requestInit.body = await readBody(req)
  }

  try {
    const response = await fetch(targetURL.toString(), requestInit)

    res.statusCode = response.status
    for (const [key, value] of response.headers.entries()) {
      const k = key.toLowerCase()
      // 跳过编码相关头(fetch已解压)和会与CORS冲突的头
      if (["content-encoding", "content-length", "transfer-encoding"].includes(k)) continue
      if (k.startsWith("access-control-")) continue
      res.setHeader(key, value)
    }
    applyHeaders(res, corsHeaders(allowOrigin))

    const responseBody = Buffer.from(await response.arrayBuffer())
    res.end(responseBody)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.statusCode = 500
    applyHeaders(res, corsHeaders(allowOrigin))
    res.end(`代理错误: ${message}`)
  }
}