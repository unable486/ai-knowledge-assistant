/** HTTP 层共享类型与错误定义。 */

export interface RequestContext {
  url: string
  init: RequestInit
}

/** 请求拦截器：可改写 url / headers / body，返回新的上下文。 */
export type RequestInterceptor = (context: RequestContext) => RequestContext | Promise<RequestContext>

/** 响应拦截器：可校验状态、抛出业务错误，或原样透传。 */
export type ResponseInterceptor = (
  response: Response,
  context: RequestContext
) => Response | Promise<Response>

/** 错误拦截器：统一改写异常信息。注意不要吞掉 AbortError。 */
export type ErrorInterceptor = (error: unknown, context: RequestContext) => unknown | Promise<unknown>

export interface Interceptors {
  request: RequestInterceptor[]
  response: ResponseInterceptor[]
  error: ErrorInterceptor[]
}

/** 带 HTTP 状态码的接口错误，便于上层按状态区分处理。 */
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** 请求被用户主动取消（停止生成）时的判定，供各层复用。 */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
