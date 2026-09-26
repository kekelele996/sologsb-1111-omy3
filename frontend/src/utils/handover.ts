import type { DrillHole } from '../types/drill-hole';
import type { DrillRun } from '../types/drill-run';
import type { CoreBox } from '../types/core-box';
import type { LithoLog } from '../types/litho-log';
import type { HandoverCheck, HandoverIssue, HandoverIssueCode, HandoverVerdict } from '../types/handover';
import { boxCapacityOk, gapsWithin, isAnomaly, reachedDepthOf, recoveryOf } from './recovery';

/**
 * 交接体检规则版本：判定口径调整（阈值、阻断/待补归类）时必须升版，
 * 导出的归档 CSV 会携带此版本，便于事后追溯当次结论依据。
 */
export const HANDOVER_RULE_VERSION = 'v1.0';

/** 采取率待补阈值（%）：低于 75% 判待补，与回次异常阈值保持一致 */
export const HANDOVER_RECOVERY_MIN = 75;

export const HANDOVER_RULE_TEXT: Record<HandoverIssueCode, string> = {
  'run-gap': '回次未覆盖已钻深度（断档）',
  'no-run': '尚无回次记录（已钻深度为 0）',
  'box-capacity': '箱位容量不足（格数 × 每格长度 < 箱区间长度）',
  'box-gap': '箱位未覆盖已钻深度（存在已钻未装箱孔段）',
  'low-recovery': `采取率低于 ${HANDOVER_RECOVERY_MIN}%`,
  'litho-gap': '岩性未覆盖已钻深度（岩性空白）',
};

export const HANDOVER_VERDICT_TEXT: Record<HandoverVerdict, { label: string; color: string; description: string }> = {
  blocked: { label: '阻断', color: 'red', description: '回次断档或箱位不足，资料不能随箱交接' },
  pending: { label: '待补', color: 'orange', description: '采取率偏低或岩性空白，补齐资料后再交接' },
  ready: { label: '可交接', color: 'green', description: '回次、箱位、岩性与采取率均满足交接要求' },
};

function formatGaps(gaps: Array<{ from: number; to: number }>): string {
  return gaps.map((g) => `${g.from}~${g.to}m`).join('、');
}

/** 单孔交接体检：按规则版本 v1.0 判定阻断 / 待补 / 可交接 */
export function buildHandoverCheck(hole: DrillHole, runs: DrillRun[], boxes: CoreBox[], lithos: LithoLog[]): HandoverCheck {
  const holeRuns = runs.filter((run) => run.holeId === hole.id);
  const holeBoxes = boxes.filter((box) => box.holeId === hole.id);
  const holeLithos = lithos.filter((log) => log.holeId === hole.id);

  const reachedDepth = reachedDepthOf(holeRuns);
  const totalFootage = holeRuns.reduce((sum, run) => sum + run.footage, 0);
  const totalCore = holeRuns.reduce((sum, run) => sum + run.coreLength, 0);
  const averageRecovery = recoveryOf(totalCore, totalFootage);
  const lowRuns = holeRuns.filter((run) => isAnomaly(run.recovery)).sort((a, b) => a.recovery - b.recovery);

  // —— 阻断项 ——
  const issues: HandoverIssue[] = [];

  let runGaps: Array<{ from: number; to: number }> = [];
  if (reachedDepth <= 0) {
    issues.push({ code: 'no-run', level: 'blocked', message: HANDOVER_RULE_TEXT['no-run'] });
  } else {
    runGaps = gapsWithin(0, reachedDepth, holeRuns);
    if (runGaps.length) {
      issues.push({ code: 'run-gap', level: 'blocked', message: `${HANDOVER_RULE_TEXT['run-gap']}：${formatGaps(runGaps)}` });
    }
  }

  const badCapacityBoxes = holeBoxes.filter((box) => !boxCapacityOk(box));
  if (badCapacityBoxes.length) {
    issues.push({
      code: 'box-capacity',
      level: 'blocked',
      message: `${HANDOVER_RULE_TEXT['box-capacity']}：${badCapacityBoxes.map((b) => `${b.boxNo}（${b.fromDepth}~${b.toDepth}m，${b.slots}格×${b.slotLength}m）`).join('、')}`,
    });
  }

  let boxGaps: Array<{ from: number; to: number }> = [];
  if (reachedDepth > 0) {
    boxGaps = gapsWithin(0, reachedDepth, holeBoxes);
    if (boxGaps.length) {
      issues.push({ code: 'box-gap', level: 'blocked', message: `${HANDOVER_RULE_TEXT['box-gap']}：${formatGaps(boxGaps)}` });
    }
  }

  // —— 待补项 ——
  if (lowRuns.length) {
    issues.push({
      code: 'low-recovery',
      level: 'pending',
      message: `${HANDOVER_RULE_TEXT['low-recovery']}：回次 ${lowRuns
        .map((r) => `${r.runNo}（${r.fromDepth}~${r.toDepth}m，${r.recovery}%）`)
        .join('、')}`,
    });
  }

  let lithoGaps: Array<{ from: number; to: number }> = [];
  if (reachedDepth > 0) {
    lithoGaps = gapsWithin(0, reachedDepth, holeLithos);
    if (lithoGaps.length) {
      issues.push({ code: 'litho-gap', level: 'pending', message: `${HANDOVER_RULE_TEXT['litho-gap']}：${formatGaps(lithoGaps)}` });
    }
  }

  const verdict: HandoverVerdict = issues.some((issue) => issue.level === 'blocked')
    ? 'blocked'
    : issues.some((issue) => issue.level === 'pending')
      ? 'pending'
      : 'ready';

  return {
    holeId: hole.id,
    holeNo: hole.holeNo,
    rigNo: hole.rigNo,
    shift: hole.shift,
    reachedDepth,
    runCount: holeRuns.length,
    averageRecovery,
    lowRecoveryRuns: lowRuns.length,
    runGaps,
    lithoGaps,
    boxGaps,
    capacityBoxes: badCapacityBoxes.map((b) => b.boxNo),
    issues,
    verdict,
  };
}

/** 全部钻孔的交接体检清单（结论排序：阻断 → 待补 → 可交接，同结论按孔号） */
export function buildHandoverList(holes: DrillHole[], runs: DrillRun[], boxes: CoreBox[], lithos: LithoLog[]): HandoverCheck[] {
  const verdictWeight: Record<HandoverVerdict, number> = { blocked: 0, pending: 1, ready: 2 };
  return holes
    .map((hole) => buildHandoverCheck(hole, runs, boxes, lithos))
    .sort((a, b) => verdictWeight[a.verdict] - verdictWeight[b.verdict] || a.holeNo.localeCompare(b.holeNo));
}
