# 时间处理约定

本项目当前约定：

- 后端返回的无时区 `datetime` 字符串表示本地时间
- 前端禁止直接对 API 时间字符串调用 `new Date(value)`
- 前端展示、比较、回写 API 时间时，统一通过 `apps/web/src/shared/lib/dateTime.ts`

推荐用法：

- 解析 API 时间：`parseApiDateTime`
- 展示日期：`formatApiDate`
- 展示日期时间：`formatApiDateTime`
- `datetime-local` 回填：`formatLocalDateTimeInputValue`
- `datetime-local` 回写 API：`formatLocalInputAsApiDateTime`

禁止做法：

- 直接 `new Date(apiString)`
- 直接 `value.replace('T', ' ')`
- 直接 `slice()` 截时间字符串后展示
- 对本地业务时间使用 `toISOString()` 再发给后端
