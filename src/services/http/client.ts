import {
  errorStatusResponseInterceptor,
  jsonRequestInterceptor,
  networkErrorInterceptor
} from './interceptors'
import type { Interceptors, RequestContext } from './types'

/**
 * 极简 fetch 封装：只做拦截器链，不隐藏流式响应。
 * 返回原始 Response，SSE 消费仍由调用方按流处理。
 */
export class HttpClient {
  readonly interceptors: Interceptors

  constructor(private readonly baseUrl = '') {
    this.interceptors = {
      request: [jsonRequestInterceptor],
      response: [errorStatusResponseInterceptor],
      error: [networkErrorInterceptor]
    }
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    let context: RequestContext = { url: `${this.baseUrl}${path}`, init }

    for (const interceptor of this.interceptors.request) {
      context = await interceptor(context)
    }

    try {
      let response = await fetch(context.url, context.init)
      for (const interceptor of this.interceptors.response) {
        response = await interceptor(response, context)
      }
      return response
    } catch (error) {
      let finalError = error
      for (const interceptor of this.interceptors.error) {
        finalError = await interceptor(finalError, context)
      }
      throw finalError
    }
  }

  postJson(path: string, payload: unknown, signal?: AbortSignal): Promise<Response> {
    return this.request(path, { method: 'POST', body: JSON.stringify(payload), signal })
  }
}

/** 应用级单例：需要额外拦截器时直接 push 到 httpClient.interceptors。 */
export const httpClient = new HttpClient()
