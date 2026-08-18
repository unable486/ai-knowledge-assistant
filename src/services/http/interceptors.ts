import {
  ApiError,
  isAbortError,
  type ErrorInterceptor,
  type RequestInterceptor,
  type ResponseInterceptor
} from './types'

/** 统一补齐 JSON 请求头，已显式设置的不覆盖。 */
export const jsonRequestInterceptor: RequestInterceptor = (context) => {
  const headers = new Headers(context.init.headers)
  if (context.init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  return { ...context, init: { ...context.init, headers } }
}

/** 读取服务端返回的 { error } 文案，失败时回退到状态码提示。 */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.clone().json()
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
      return body.error
    }
  } catch {
    // 非 JSON 响应统一走状态码提示。
  }

  return `请求失败（HTTP ${response.status}）。`
}

/** 非 2xx 一律转成带状态码的 ApiError，上层无需重复判断 response.ok。 */
export const errorStatusResponseInterceptor: ResponseInterceptor = async (response) => {
  if (response.ok) return response
  throw new ApiError(await readErrorMessage(response), response.status)
}

/**
 * 把网络层异常转成可读文案。
 * AbortError 必须原样抛出：上层用它区分"用户停止"与"真失败"。
 */
export const networkErrorInterceptor: ErrorInterceptor = (error) => {
  if (isAbortError(error) || error instanceof ApiError) return error
  if (error instanceof TypeError) {
    return new Error('无法连接对话服务，请确认后端是否已启动。')
  }

  return error
}
