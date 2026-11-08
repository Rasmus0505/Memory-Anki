# 0007 进度条只剩 16 格，做题范围却有 36 座宫殿——本地小结算没有跟服务端对账

**状态**：根因已定位、已修复、有回归测试。
**首次记录**：2026-11-08
**影响**：随心进度条显示的卡片数明显少于「做题」范围里的宫殿数（实测 16 格 vs 36 座）；
被本地「结算已完成」吞掉的宫殿在进度条和学科目录上消失，但做题仍会出它们的题。

---

## 1. 用户看到的现象（人话）

点开「做题」，标题写着：

> 本轮纳入复习的 36 座宫殿 · 607 题可做

同一屏背后的进度条却只有十几格。用户自然把它读成「最多 16 座宫殿」——
两个数字都在说「本轮」，却对不上。

这不是文案问题：进度条的每一格是一张卡，而「做题」的每一行是一座宫殿。
两者本来可以不同（一座宫殿可以有多张卡），但**差距不可能大到 16 格对 36 座**。
实测同一轮：服务端还有 45 张未结算卡，分布在 37 座宫殿里；本地进度条只剩 20 张。

## 2. 实际发生的机制

「结算已完成」先在本地压缩，再把动作发给服务端，最后用服务端的回显修正本地。
问题出在第三步：**本地压缩集合只增不减**。

| 位置 | 行为 |
|---|---|
| `compressRoundPlanCards`（`roundPlanCompress.ts`） | 把新 id 并进 `plan.compressedIds`，从不清除 |
| `applyServerCohorts`（`serverRoundPlan.ts`） | 把服务端 `compressed_ids` 与本地集合取并集 |
| `commitHydratedRoundLedger`（`hydrateRoundLedger.ts`） | 最终压缩集合同样取并集 |

服务端的 `compress_completed` 是**有权拒绝**的：一个单元只要还有「已预约但未通过」的重练，
整组就不能结算（`round_compress.py::_unanswered_live_sources`）。本地的
`compressibleRoundPlanIds` 也想拦这种情况，但它只能看到本地计划里的重练卡；
预约中的重练还没插进 feed 时，本地看不见，于是它把整组压缩了。
服务端回显里没有这些 id，而并集逻辑把本地多出来的部分保留了下来。

因为 `compressedIds` 会写进 localStorage，这个偏差跨刷新存活，且下一次结算继续累加。

## 3. 证据（只读真实库 + 真实 localStorage）

2026-11-08 00:00 左右，对运行中的桌面端（`http://127.0.0.1:8012`）做只读取证：

```
服务端 round 5c476846…  original_cards 73
                         compressed_ids 35
                         未压缩卡 45，覆盖 37 座宫殿
                         做题 scope：36 座宫殿 / 607 题
本地 queue-state 同轮    compressedIds 69
                         cardsById 20（进度条只剩 20 张）
两者差集               34 个 id，全部是服务端 completed_ids 里、
                         但仍欠一次通过重练的卡，覆盖 26 座宫殿
```

34 个差集里既有 `review_unit:…` 源卡，也有对应的 `retry:…` 重练 id；
服务端一条都没有压缩。这就是 16 格与 36 座之间缺口的主体。

本地 LevelDB 的取值需要先做 Snappy 解压；取证脚本见
`tmp/leveldb_read.py`（只读，未提交）。

## 4. 修法

**服务端回显是压缩集合的唯一权威，本地只保留仍在飞行中的那一批。**

1. 新增 `replaceCompressedIds`（`roundPlanCompress.ts`）：用给定集合**替换**压缩集合，
   不再并集。`compressRoundPlanCards` 仍保留给本地乐观压缩使用。
2. `compressCompletedPlanCards`（`useImmersiveQueue.ts`）：
   - 成功回显后，用 `replaceCompressedIds(current, echoed)` 落盘；
   - 若回显比本地请求少，或三次都冲突没有回显，再用服务端集合重建一次队列，
     让被拒的卡回到进度条。服务端不可达时不做这一步，本地草稿仍然保留。
3. `commitHydratedRoundLedger`：服务端带 `compressed_ids` 时，
   本地集合先过滤成「服务端已压缩 ∪ 本次在飞 id」，再参与构建与最终集合；
   没有服务端负载（离线）时才沿用本地集合。
4. `applyServerCohorts`：服务端给了压缩列表就替换本地列表，不再并集。
5. `compressibleRoundPlanIds`：源卡只要还有 `retryAvailableAt`（已预约、尚未发布的重练），
   就不再提供给「结算已完成」——从源头上不再请求服务端会拒绝的那一批。

修完后同一份真实数据跑一遍水合：压缩集合回到服务端的 35，
34 张被拒的卡重新进入 `cardsById`，进度条恢复到 45 张、37 座宫殿，
与「做题」的 36 座同一口径（另一座是只含被移除卡的宫殿）。

## 5. 防复发

- `roundPlan.test.ts`：`replaceCompressedIds` 必须替换而非并集；
  有 `retryAvailableAt` 的源卡不得进入可结算集合。
- `hydrateRoundLedger.test.ts`：
  - 本地压了、服务端拒绝的卡必须回到 `cardsById` 与 `orderIds`；
  - 仍在飞行中的 `forceCompressedIds` 在回显前必须保留。
- 实数据回归（临时夹具，不提交）：用上面的真实 round + 本地状态断言
  `compressedIds === server.compressed_ids`，且两张被拒卡回到计划。

## 6. 尚未覆盖

- 只验证了前端水合与压缩逻辑；运行中的桌面端需要重载一次才会用上新构建，
  本地 69 个历史压缩 id 会在那次重载时自动收敛，不需要手工清 localStorage。
- 「做题」仍按宫殿计数、进度条仍按卡片计数，这是有意的两个粒度；
  本次修的是**两边看到的世界不一致**，不是把卡片数改成宫殿数。
