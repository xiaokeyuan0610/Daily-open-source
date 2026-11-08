# 每日开源推荐 · Daily Open Source Picks

每天北京时间 10:00，通过 GitHub API 核验实用开源软件，调用 AI 生成 10 项中文精选，归档日报并发到飞书群。

## 首次部署

1. 在 GitHub 新建公开仓库 `xiaokeyuan0610/daily-open-source`，默认分支使用 `main`。
2. 把本目录全部文件上传到仓库，包含 `.github/workflows/daily.yml` 和 `.gitignore`。不要上传真实密钥。
3. 在仓库 Settings → Secrets and variables → Actions → New repository secret 添加：

| Secret | 内容 |
| --- | --- |
| `AI_API_KEY` | MetaRouters 的 API Key，必填 |
| `FEISHU_WEBHOOK_URL` | 飞书群自定义机器人完整 Webhook，必填 |
| `FEISHU_SIGN_SECRET` | 机器人开启签名校验时填写 |

`GITHUB_TOKEN` 由 Actions 自动提供，无需手工创建。代码预设 AI 地址 `https://api.metarouters.org/v1`、模型 `gpt-6-sol`，使用 OpenAI 风格 `/chat/completions` 接口；尚需真实凭据验证服务兼容性及模型可用性。

4. Settings → Actions → General 允许工作流写入仓库。分支保护规则也必须允许归档提交。
5. Actions → 每日实用开源精选 → Run workflow。首次执行会调用付费 AI 接口并向群发送真实日报。检查 reports 目录、群消息和 data/history.json。

## 筛选与去重

搜索十类实用项目，每类最多 20 个候选，逐项核验，最多向 AI 提供 35 个通过核验的项目。要求非归档、非 fork、许可证可被 GitHub 识别、默认分支过去 365 天有提交。许可证不明或候选不足 10 个时停止，不凑数。

许可证和日期由程序从 GitHub 数据注入，AI 无法覆盖；平台、费用、安装方式由 AI 参考 README 描述，无依据应标注待核实。开源许可证识别不等于法律审查或软件安全保证。仓库 README 属于不可信资料，作为数据提供给 AI，不作为执行指令。

历史按仓库全名大小写不敏感去重，已生成但未发送的项目也保留；同一天重复运行复用原日报。重命名仓库可能影响长期去重。

## 归档与发送恢复

先提交 reports/YYYY-MM-DD.md 与 data/history.json，再发送摘要。摘要包含十个项目与完整日报链接；详尽许可证、提交、正式发布和安装说明链接在归档中。

发送前先提交 `sending` 状态；成功后写入 `sent`。网络中断或进程终止可能导致发送结果未知：此时自动重试停止，请先检查群消息。确认未收到后，手动运行并勾选 confirm_resend。若已经收到，手动把当日状态改为 sent 即可。Webhook 无幂等保障，无法承诺网络异常时绝对不重复。

失败显示在 Actions 与 GitHub 通知中；建议在 GitHub 个人通知设置中订阅 Actions 失败邮件。发送失败不再依赖同一 Webhook 报警。归档提交失败时，工作流保留 30 天恢复附件；处理后再重试。

## 调度说明

`0 2 * * *` 是 UTC 02:00，即北京时间 10:00。GitHub 定时任务可能排队延迟，不保证整点到达；公开仓库长期无活动可能停用定时任务。每天成功的归档提交可保持仓库活动，连续失败则需人工检查。

## 本地检查

需要 Node.js 22 或更新版本，无第三方依赖：

```sh
npm test
```

本地运行时通过环境变量传入密钥，执行 `node daily.mjs prepare` 和 `node daily.mjs send`。发送还需 `GITHUB_REPOSITORY=xiaokeyuan0610/daily-open-source`；本地运行不会自动提交，需要自行保存历史。请勿在公开终端记录、源码或 issue 中填写密钥。

## 官方参考

- [GitHub 定时任务及故障排查](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows)
- [GitHub 仓库 API](https://docs.github.com/en/rest/repos/repos)
- [GitHub 提交 API](https://docs.github.com/en/rest/commits/commits)
- [飞书自定义机器人与签名校验](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot?lang=zh-CN)
