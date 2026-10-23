# 本机复现记录

日期：2026-10-24 · 机器：Arch Linux / RTX 4060 Ti 16 GB / 31 GB RAM
代码基线：`352842f`（复现修复 + 控制台）
全量产物核验：96/96 文件，其中 step4 9 个、step6-7 11 个为完整 CoT 变体

这份记录区分三件事：**真正重跑的确定性步骤**、**依赖发布产物的步骤**、**本机没有条件运行的步骤**。不做“看起来能跑”的推断。

## 结论

| 数据集 | 步骤 2 HGTree | 步骤 6 coarse | 步骤 6 fine | 步骤 7 集成 |
| --- | --- | --- | --- | --- |
| UCF-Crime | ✅ 结构语义完全一致 | ✅ ROC 0.8276 / PR 0.3247 | ✅ ROC 0.8305 / PR 0.4039 | ✅ ROC 0.8474 / PR 0.4189 |
| MSAD | 未运行（无 GEBD 输入） | ✅ ROC 0.8701 / PR 0.6822 | ✅ ROC 0.8671 / PR 0.6899 | ✅ ROC 0.8932 / PR 0.7141 |
| XD-Violence | 未运行（无 GEBD 输入） | ⚠️ ROC 0.8913（发布 0.8936） | ⚠️ ROC 0.8981（发布 0.9004） | ✅ ROC 0.9047 / PR 0.6791 |

- **8 项通过，2 项 warning，0 项失败。** 机器可读结果：[repro/latest.json](../repro/latest.json)。
- UCF-Crime 的步骤 6/7 与发布数值**逐项相等**（290 个视频分数、类别指标）。
- MSAD 的步骤 6 分数逐项相等，类别指标最大差 0.001（numpy 舍入），聚合指标完全相等。
- XD 的步骤 6 分数不完全一致：发布 refine 对 `numpy.argsort` 的 tie 顺序敏感（max segment Δ 0.40 / 0.35，聚合 ROC Δ 0.0023 / 0.0023）。步骤 7 使用发布 refine 作为输入时仍然**精确复现** 0.9047，说明集成逻辑本身一致。

## 环境

没有 conda；系统 Python 是 3.14，而项目的模型依赖需要旧版本。这里用 `uv` 建了独立的 3.11 环境，只装步骤 2/6/7 需要的包（不需要 torch、CUDA、视频或模型权重）。

```bash
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python -r requirements-repro.txt
```

实测版本：

```text
Python 3.11.15
numpy 2.4.6        # 发布 XD similarity pkl 由 numpy 2 序列化，必须 >=2 才能读取
scipy 1.17.1
scikit-learn 1.9.1
matplotlib 3.11.2
NVIDIA GeForce RTX 4060 Ti, 16380 MiB（本流程未使用 GPU）
```

运行全部对账：

```bash
.venv/bin/python scripts/reproduce.py
# 只跑 UCF，或只跑某些步骤
.venv/bin/python scripts/reproduce.py --dataset UCF --steps 2,6,7
# 保留临时输入/日志，便于排查
.venv/bin/python scripts/reproduce.py --keep
```

脚本在 `/tmp` 建立与 `result/` 同构的临时目录，**不会写回 result/**。输入用 symlink，输出与发布 JSON 比对；每项检查的日志路径在报告里。

## 步骤 2：HGTree

从已发布的 GEBD 输出 `result/UCF_Crime_test/.../pred_scenes_th0.5.json` 重新执行：

```bash
.venv/bin/python HGTree_generation.py \
  --json_path <temp>/UCF_Crime_test/EGEBD_x2x3x4_r50_eff_split_out_th0.5/pred_scenes_th0.5.json \
  --threshold kmeans --gamma 0.4 --min_length 1
```

四个输出（`pred.json`、`dfs_coarse_scenes.json`、`dfs_fine_scenes.json`、`dfs_redundant_scenes.json`）与发布文件 **JSON 语义完全相等**。字节级 sha 不同，仅因为视频键的插入顺序不同（当前代码先排序再写出，发布文件是旧顺序）；脚本比较的是解析后的结构。

## 步骤 6/7：refinement + ensemble

使用发布 step-4 分数（含完整 CoT 变体）、step-5 similarity pkl、step-2 树结构：

```bash
# UCF coarse
.venv/bin/python refinement_eval.py --scores_json <temp>/.../DeepSeek-R1-Distill-Qwen-14B_think/max...json
# UCF ensemble
.venv/bin/python correlation_eval.py --coarse_scores_json ... --fine_scores_json ... --beta 0.2
```

参数与发布 `args_dict` 一致：UCF/MSAD `topK=10, nn=10, similarity=VxV, tao=0.1`；XD `topK=15, nn=15, dyn_ratio=0.3, tao=0.1`；beta 分别为 `0.2 / -0.4 / 0.7`。

`scripts/reproduce.py` 会自动选择与输入分数文件同源的 refine 目录（避免 `DeepSeek*` 通配符误选 think / 非 think 两个变体）。

## 为复现做的代码修复

1. **`scripts/fetch_artifacts.py`**：`--verify` 原先对 `stripped_cot` bundle 直接比原始字节，因此“完整 CoT 版”工作区会误报 9 个文件不一致。现在先按发布规则清空 CoT 再算哈希，同时仍接受去 CoT 的发布形态。
2. **MSAD 路径大小写**：`dataset_info/msad` → `dataset_info/MSAD`（Linux 区分大小写）；`correlation_eval.py` 的 `dataset_info/MSAD_test/...` 改为真实路径。
3. **MSAD 硬编码树路径**：`refinement_eval.py` / `correlation_eval.py` 不再读取 `MSAD_test/EGEBD.../dfs_coarse_sences.json`（拼写错误且不是仓库相对路径），改为从输入分数文件向上三层推导 `dfs_coarse_scenes.json`。`refinement_eval.py` 原先还引用了未定义的 `args.vadtree_path`。
4. **按需导入 decord**：`refinement_eval.py` / `correlation_eval.py` 顶层 import `vis_utils` 会拉起 `decord/cv2`，无视频环境直接崩。现在只在 `--visualize` 时导入。
5. **按需导入 scikit-learn-extra**：`HGTree_generation.py` 只在 `--threshold kmedoids` 时需要它。这样默认 kmeans 路径可以在 numpy 2 下运行（发布 XD pkl 需要 numpy 2，而 `scikit-learn-extra 0.3.0` 的 wheel 只兼容 numpy 1.x）。

## 没有运行的步骤

| 步骤 | 需要 | 本机状态 |
| --- | --- | --- |
| 1 EfficientGEBD 边界 | 原始视频 + GEBD 权重 + 其 conda 环境 | ❌ 无视频、无权重 |
| 3 LLaVA-Video caption | 原始视频 + LLaVA-Video-7B-Qwen2 | ❌ 无视频、无 7B 权重 |
| 4 DeepSeek-R1 reasoning | 原始视频 + 14B 权重；temperature=0.6 | ❌ 无视频/权重；本身也不是 bit-reproducible |
| 5 ImageBind similarity | 原始视频 + ImageBind 特征 | ❌ 无视频/权重 |

步骤 2/6/7 的输入来自已恢复的 GitHub Release 产物。要复现步骤 1/3/4/5，需要按 README 下载视频和权重，并接受这些步骤的 GPU 成本。本机 16 GB 显存可以跑 7B/14B 的 4-bit 量化，但会改变数值，不能与发布结果逐项对账。

## 已知偏差

- **XD step 6**：发布 refine 的 `vid_score` 由旧 numpy 的 unstable argsort 生成；numpy 2.4 下 top-K 邻居的 tie 顺序变化，导致 max segment 0.40 的局部差异。聚合 ROC 仅差 0.0023，且 step 7 用发布 refine 可精确复现。报告将其标为 `warning` 而不是 `pass`。
- **发布 per-video 指标文件**：部分 `00vid_metric.json` 与同目录 refine JSON 不同源（例如 UCF fine `Explosion043_x264` 发布指标 0.198，但用发布分数重算是 0.1913，与复现值一致）。因此对账以 **分数 + 聚合 ROC/PR** 为准，per-video 指标只作诊断。
- `result/` 当前保存的是完整 CoT 版本，比发布 `step4-scores` 大；`fetch_artifacts.py --verify` 已兼容。

## 证据

- 机器可读报告：`repro/latest.json`（含环境、每项检查的分数、聚合指标、最大偏差、日志路径）。
- 复现脚本：`scripts/reproduce.py`。
- 依赖锁定：`requirements-repro.txt`。
