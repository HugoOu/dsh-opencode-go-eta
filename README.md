# dsh-opencode-go-eta

OpenCode Go 额度预测插件（DeepSeek Harness / DSH）。

在输入框下方（`conversation.composer.dock`）放一枚小胶囊，点开是一张悬浮仪表卡：本地采样出月额度的消耗速度，推算**预计什么时候用完**，并把它和**套餐续费日**直接对比。

## 它回答什么问题

- 按最近的速度，本月额度大约在 **什么时候见底**？
- 这个时间是在**续费日之前**（会被限流）还是**之后**（用不完）？
- 到续费日预计只用掉多少？
- 三个窗口（5 小时 / 周 / 月）各自还剩多少、什么时候重置？

## 采样节奏（不轮询）

按你的要求，插件不会每 5 分钟去取数：

| 时机 | 说明 |
|---|---|
| 本地锚点 03:00 / 09:00 / 15:00 / 21:00 | 一天 4 次，DSH 在运行且错过该时点才补采 |
| 每次任务结束（`turn/end`） | 任务边界是自然的用量拐点 |
| 插件启动后约 4 秒 | 冷启动先取一次 |
| 打开面板 / 点刷新 | 距上次采样超过 45 分钟才自动取，手动刷新才强制 |

两次隐式采样之间至少间隔 20 分钟（可配），所有采样落盘在
`$DSH_HOME/opencode-go-eta/samples.json`（原子写、默认保留 45 天）。

## 预测算法

- 只在**当前月窗口周期内**取样本；跨过重置点的样本会被丢弃（避免重置那一跌把斜率算成负的）。
- 用 **Theil–Sen 稳健斜率**（对偶斜率中位数）而不是最小二乘，抗单次尖峰。
- 门槛：至少 3 个采样点、跨度 ≥ 6 小时，否则显示「样本不足」而不是硬猜。
- `ETA = (100 − 已用%) / 斜率`，置信度按样本数、跨度与 R² 分档（高 / 中 / 低）。
- 判定：`ETA < 续费日` → **到期前会用完**（警示）；`ETA ≥ 周期重置` → **本周期不会用完**；否则 **到期前用不完**。
- 面板里的预测线是**线性外推**，不是官方预测；接口只给百分比，没有金额明细时按百分比算。

## 额度口径（2026-10 官方文档）

OpenCode Go 的「每月额度」是**按模型**给的美元上限（例如 DeepSeek V4.1 Flash：Go $80 / Go Plus $160；
GLM-5.3-Flash $60；Kimi K3 $15），且每个模型的窗口固定为 5 小时 20%、每周 50%、每月 100%。

而 `/console/api/go/status` 的 `limitMicroCents` 返回的是套餐计量上限（本机实测 $60），百分比也按它计算。
两者口径不同：控制台给的是计量额度，官方文档给的是模型额度。卡片默认按**模型额度**显示金额
（`modelAllowancesUsd`，默认 `deepseek-v4.1-flash: 80`），百分比仍以控制台为准；
Go Plus 用户把配置改成 `160` 即可。
## 成本建议（提前用尽时）

当预测显示额度会在续费日前用尽，卡片会多出一段成本对比：

- **立即续费 OpenCode Go**：显示套餐价（默认 $10/期，`planPriceUsd` 可配），并说明新一期额度与续费日顺延；
- **改用官方 API 支付溢出部分**：溢出额度按本期额度面值折算（`limitMicroCents / 1e8`），
  再按当前模型的官方单价估算 token 量；
- 给出更省的一项及理由。

官方单价来自 [models.dev](https://models.dev/api.json) 的公开目录，按 `pricingModel`（默认当前模型
`deepseek-v4.1-flash`）查找，缓存 12 小时（`pricingTtlMs`），点刷新会强制重新拉取；取不到价格时
只做额度面值对比，不编造单价。注意：额度面值换算假设 Go 的计费口径与官方 list price 同尺度，属于估算。

## 数据来源

| 端点 | 用途 |
|---|---|
| `GET {base}/zen/go/v1/usage` | 三档已用百分比 + `resetsAt`（官方公开接口） |
| `GET {base}/console/api/go/status` | 每档 `usedMicroCents/limitMicroCents`、套餐 `access.startsAt/endsAt`、续费状态（控制台内部接口，字段可能变；失败时降级为只有百分比） |

密钥从 DSH credentials 解析（默认引用 `OPENCODE_GO_API_KEY`），只在宿主进程内使用；
浏览器只读同源路由 `/api/dsh-opencode-go-eta/status`，拿到的只有百分比、金额、时间和日期。

> 不读取 DSH 会话日志：本插件统计的是**账号级**套餐额度，而你可能在 DSH 之外
> 也用同一个 OpenCode Go 账号发请求；只用 DSH 本地日志会系统性低估消耗。
> 官方接口的百分比覆盖所有客户端，因此采样与预测都以它为准。

## 安装（desktop profile）

```powershell
& 'C:\Users\Exception2Rule\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add link:C:\Users\Exception2Rule\Documents\deepseek-harness\default-workspace\plugins\dsh-opencode-go-eta
```

装完**完全退出并重启 DSH Desktop**（宿主插件行只在启动时装配）。

## 配置

在 profile 的 `cordis.patch.yml` 里覆盖 `opencode-go-eta` 行：

```yaml
- id: opencode-go-eta
  name: dsh-opencode-go-eta
  config:
    apiKeyRef: OPENCODE_GO_API_KEY
    baseUrl: https://opencode.ai
    anchors: [3, 9, 15, 21]      # 本地整点，空数组 = 只靠任务结束与手动刷新
    sampleIntervalMs: 1200000    # 两次隐式采样的最小间隔
    staleAfterMs: 2700000        # 打开面板时超过这么久才补采
    retentionDays: 45
    timeoutMs: 15000
    enabled: true
```

## 测试

```powershell
node test\projection.test.mjs   # 纯数学：斜率、重置切分、三态判定
node test\host.test.mjs         # 宿主：桩 fetch + 路由响应
node test\client.test.mjs       # 浏览器半：模块注册、渲染、取数
```

不需要网络与真实密钥。

## 视觉预览

`preview.html` 是静态假数据预览（含深/浅色与三种状态），组件 CSS 与真实插件一致。
