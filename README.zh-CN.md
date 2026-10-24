<h1 align="center">dsh-opencode-go-eta</h1>

<p align="center"><b>DeepSeek Harness 里的 OpenCode Go 额度预测插件 —— 告诉你月额度大约什么时候用完，以及会不会早于续费日。</b></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DeepSeek%20Harness-0.2.x-4d6bfe" alt="DeepSeek Harness 0.2.x"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%E2%89%A522-3c873a" alt="Node >= 22"></a>
  <a href="test"><img src="https://img.shields.io/badge/tests-16%20passing-2ea44f" alt="16 tests passing"></a>
</p>

<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

<p align="center">
  <img src="docs/preview-light.png" alt="OpenCode Go ETA 卡片（浅色）" width="880">
</p>

<details>
<summary>深色主题</summary>

<p align="center">
  <img src="docs/preview-dark.png" alt="OpenCode Go ETA 卡片（深色）" width="880">
</p>
</details>

<h2 align="center">输入框状态栏</h2>

<p align="center">
  <img src="docs/preview-dock.png" alt="输入框状态栏：官方上下文圆环与 Go 胶囊" width="620">
</p>

<p align="center"><sub>官方上下文圆环（54%）与本插件的 Go 胶囊（18%）共用 14px 圆环 / 2px 描边的规格；胶囊是纯文字触发器，点开前不占额外空间。</sub></p>

## 为什么做这个

OpenCode Go 是包月订阅，但控制台只给「已用百分比 + 重置时间」，不会告诉你照当前速度会不会在续费日之前用光——
而这正是决定「提前续费 / 用官方 API 补 / 什么都不做」的关键。

插件只读取官方额度接口，在本地保留一小段采样历史，然后在输入框下方给出结论。它**不读会话日志**：
Go 额度是账号级的，只有官方百分比能看到所有客户端的用量。

## 功能

- **预计耗尽时间**：对当前周期内的采样做 Theil–Sen 稳健拟合，给出 ETA 和置信度，而不是拿单点硬猜。
- **续费日对比**：直接说明月额度会在续费日之前用尽，还是到期前仍有余量。
- **成本建议**：会提前用尽时，对比「立即续费 OpenCode Go」和「溢出部分走官方 API」，价格取自当前模型的公开单价（[models.dev](https://models.dev)，懒加载并缓存 12 小时）与官方模型月额度。
- **合并图表**：历史、预测、现在、ETA、续费日放在同一条时间轴上，左侧带 0–100% 纵轴。
- **原生输入框胶囊**：14px / 2px 的圆环与 DSH 自带的上下文圆环同规格；卡片是液态玻璃材质，深色下自动压低高光层。
- **按模型额度**：Go 的月额度是按模型给的（DeepSeek V4.1 Flash：Go $80 / Go Plus $160；Kimi K3 $15）。卡片同时显示模型名与额度，百分比以控制台为准。
- **不做高频轮询**：每天 4 个本地锚点 + 任务结束 + 启动 + 手动刷新。

## 安装

需要 DeepSeek Harness 0.2.x（Desktop 或 Web profile）与 Node.js ≥ 22。

```powershell
# 从 GitHub 安装
dsh plugin --profile desktop add github:HugoOu/dsh-opencode-go-eta

# 或从本地目录
dsh plugin --profile desktop add link:C:\path\to\dsh-opencode-go-eta
```

安装后完全退出并重启 DSH。输入框下方会出现胶囊，点开是完整卡片。

## 配置

写入 profile 的 `cordis.patch.yml` 可覆盖默认值：

```yaml
- id: opencode-go-eta
  name: dsh-opencode-go-eta
  config:
    apiKeyRef: OPENCODE_GO_API_KEY   # 凭据引用名，不是密钥本身
    anchors: [3, 9, 15, 21]          # 本地整点；空数组 = 关闭定时采样
    sampleIntervalMs: 1200000        # 两次隐式采样的最小间隔
    staleAfterMs: 2700000            # 超过这个时长再读会触发一次采样
    retentionDays: 45
    planName: Go
    planPriceUsd: 10                 # 一期套餐价，用于成本建议
    modelLabel: DeepSeek V4.1 Flash
    modelAllowancesUsd:
      deepseek-v4.1-flash: 80        # Go；Go Plus 改成 160
    pricingModel: deepseek-v4.1-flash
    pricingUrl: https://models.dev/api.json
    pricingTtlMs: 43200000
```

密钥通过 Harness 凭据服务解析（`OPENCODE_GO_API_KEY`），不会进入浏览器。

## 工作方式

| 阶段 | 行为 |
| --- | --- |
| 采样 | 读 `GET /zen/go/v1/usage`（百分比 + 重置时间）和 `GET /console/api/go/status`（金额、周期起止）——03/09/15/21 点、任务结束、启动和手动刷新时。 |
| 历史 | 采样保存在 `$DSH_HOME/opencode-go-eta/samples.json`，保留 45 天，原子写。 |
| 预测 | 丢弃上一个重置点之前的样本，对周期内样本做 Theil–Sen 斜率；少于 3 点或跨度不足 6 小时会显示"采样数据不足"。 |
| 判定 | ETA 与窗口重置、订阅 `endsAt` 比较：到期前用尽 / 到期前不会用尽 / 本周期安全。 |
| 建议 | 溢出 =（续费日预计使用% − 100%）× 模型月额度；续费花 `planPriceUsd`，官方 API 按公开单价支付溢出，取更省的一项。 |

控制台的计量额度是套餐 credit 上限（本机实测 $60），而官方文档给的是**按模型**的月额度
（DeepSeek V4.1 Flash $80）。百分比始终以控制台为准，金额按模型额度显示，两者不会悄悄互相矛盾。

## 开发

```bash
node test/projection.test.mjs   # 10 项纯数学：斜率、重置切分、判定
node test/host.test.mjs         # 2 项宿主：桩 fetch、路由载荷
node test/client.test.mjs       # 4 项浏览器半：槽位注册、渲染、取数
```

无需网络与真实密钥。`preview.html` 用假数据复刻真实样式（`#shot` 隐藏页面外壳，`#shot-dark` 深色）。

## 已知限制

- `/console/api/go/status` 是控制台内部接口，字段变化时会退化为只显示百分比。
- 预测是对自己采样历史的线性外推，不是厂商预测。
- 成本建议假设额度计量与官方 list price 同尺度，token 估算为近似值。
- 插件不保存任何对话或会话数据，只保存额度采样与价格缓存。

## 许可证

[MIT](LICENSE) © 2026 HugoOu

