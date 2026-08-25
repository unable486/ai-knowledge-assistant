/**
 * 本地 embedding。
 *
 * 为什么不用 API:Anthropic 官方没有 embedding 接口(Claude 只做生成),
 * 而本项目用的中转站 sotamodel.net 只代理 Claude 的生成端点——试过
 * text-embedding-3-small / ada-002 / bge-m3,全部返回 503 model_not_found。
 * 所以只剩本地跑这一条路。
 *
 * 代价是项目里要带 24MB 权重、首次加载几百毫秒;收益是零调用成本、
 * 数据不出本机、不依赖任何外部服务可用性。
 *
 * 权重来源:ModelScope 的 Xenova/bge-small-zh-v1.5 镜像(HuggingFace 在
 * 本机网络下不可达)。weights 不入库,见 docs/rag.md 的下载脚本。
 */

import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

// 只读本地文件。allowRemoteModels = false 是关键:缺文件时立刻报错,
// 而不是卡在一个连不上的域名上等超时。
env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = path.join(currentDirectory, 'models')

const modelId = 'bge-small-zh-v1.5'

/** 向量维度。换模型必须同步改,vectorStore 用它校验旧索引是否还能用。 */
export const embeddingDimensions = 512

/**
 * bge 系列是非对称检索:查询侧要加指令前缀,文档侧不加。
 * 加错(两边都加或都不加)不会报错,只会让检索质量悄悄变差。
 */
const queryInstruction = '为这个句子生成表示以用于检索相关文章：'

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null

function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = pipeline('feature-extraction', modelId, { dtype: 'q8' })
  }
  return pipelinePromise
}

async function encode(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  const extractor = await getPipeline()
  // pooling 必须是 cls,不是 mean——bge 用 [CLS] token 做句向量。
  // 用错了向量空间对不上,检索结果会明显变差但不会报错。
  // normalize 让向量成单位长度,余弦相似度退化成点积。
  const output = await extractor(texts, { pooling: 'cls', normalize: true })
  return output.tolist() as number[][]
}

/** 文档侧:不加指令前缀。 */
export function embedPassages(texts: string[]): Promise<number[][]> {
  return encode(texts)
}

/** 查询侧:加指令前缀。 */
export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await encode([`${queryInstruction}${text}`])
  return vector
}

/** 启动时预热,把 24MB 权重的加载成本从首个请求挪到启动阶段。 */
export async function warmUpEmbedder(): Promise<void> {
  await encode(['预热'])
}
