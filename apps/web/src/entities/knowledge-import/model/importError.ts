export function formatKnowledgeImportError(message: string | null | undefined): string {
  const normalized = (message || '').trim()
  if (!normalized) {
    return '识别失败，请稍后重试。'
  }
  if (normalized.includes('未配置 DASHSCOPE_API_KEY')) {
    return `${normalized}\n请先在后端进程环境中设置 DASHSCOPE_API_KEY。`
  }
  if (normalized.includes('WinError 10061') || normalized.includes('连接被拒绝')) {
    return `${normalized}\n请检查 DASHSCOPE_BASE_URL 是否被覆盖成错误地址；本地代理或网关是否拦截；目标主机和端口是否可达；DASHSCOPE_API_KEY 是否已配置。`
  }
  if (normalized.includes('百炼接口网络异常')) {
    return `${normalized}\n请检查网络连通性，以及 DASHSCOPE_BASE_URL 和 DASHSCOPE_API_KEY 是否配置正确。`
  }
  return normalized
}

