import type { DrillHole } from '../types/drill-hole';
import type { DrillRun } from '../types/drill-run';
import type { CoreBox } from '../types/core-box';
import type { LithoLog } from '../types/litho-log';
import type { HandoverIssue, HandoverVerdict, HoleHandover } from '../types/handover';
import { boxCapacityOk, gapsWithin, isAnomaly, reachedDepthOf, recoveryOf, RECOVERY_THRESHOLDS } from './recovery';

/**
 * 交接体检规则版本：判定口径调整时递增。
 * 归档 CSV 与全量备份均携带该版本与逐孔结论，便于交接追溯。
 */
export const HANDOVER_RULE_VERSION = 'v1.0';

/** 规则文案（页面说明与导出口径保持一致） */
export const HANDOVER_RULES: string[] = [
  '阻断：回次未覆盖已钻深度（断档），或箱位不足（已钻岩芯未装箱 / 单箱格位容量不足）',
  `待补：采取率低于 ${RECOVERY_THRESHOLDS.qualified}%（全孔平均或存在异常回次），或岩性编录未覆盖已钻深度`,
  '可交接：无阻断与待补问题',
];

/** 结论展示顺序与配色 */
export const VERDICT_META: Record<HandoverVerdict, { color: string; order: number }> = {
  阻断: { color: 'red', order: 0 },
  待补: { color: 'orange', order: 1 },
  可交接: { color: 'green', order: 2 },
};

export const HANDOVER_VERDICTS: HandoverVerdict[] = ['阻断', '待补', '可交接'];

function formatRanges(ranges: Array<{ from: number; to: number }>): string {
  return ranges.map((range) => `${range.from}~${range.to}m`).join('、');
}

/** 单孔交接体检：回次覆盖 / 箱位 / 采取率 / 岩性覆盖四类检查 */
export function checkHoleHandover(hole: DrillHole, runs: DrillRun[], boxes: CoreBox[], lithos: LithoLog[]): HoleHandover {
  const holeRuns = runs.filter((run) => run.holeId === hole.id);
  const holeBoxes = boxes.filter((box) => box.holeId === hole.id);
  const holeLithos = lithos.filter((log) => log.holeId === hole.id);

  const reachedDepth = Math.max(hole.finalDepth || 0, reachedDepthOf(holeRuns));
  const totalFootage = Number(holeRuns.reduce((sum, run) => sum + run.footage, 0).toFixed(2));
  const totalCore = Number(holeRuns.reduce((sum, run) => sum + run.coreLength, 0).toFixed(2));
  const averageRecovery = recoveryOf(totalCore, totalFootage);
  const anomalyCount = holeRuns.filter((run) => isAnomaly(run.recovery)).length;

  const runGaps = reachedDepth > 0 ? gapsWithin(0, reachedDepth, holeRuns) : [];
  const boxGaps = reachedDepth > 0 ? gapsWithin(0, reachedDepth, holeBoxes) : [];
  const lithoGaps = reachedDepth > 0 ? gapsWithin(0, reachedDepth, holeLithos) : [];

  const issues: HandoverIssue[] = [];

  // 阻断：回次断档、箱位不足
  if (runGaps.length) {
    issues.push({ level: '阻断', category: '回次断档', message: `回次未覆盖已钻深度：${formatRanges(runGaps)} 断档` });
  }
  holeBoxes
    .filter((box) => !boxCapacityOk(box))
    .forEach((box) => {
      issues.push({
        level: '阻断',
        category: '箱位不足',
        message: `箱 ${box.boxNo} 格位容量不足（${box.slots} 格 × ${box.slotLength}m < 区间 ${Number((box.toDepth - box.fromDepth).toFixed(2))}m）`,
      });
    });
  if (boxGaps.length) {
    issues.push({ level: '阻断', category: '箱位不足', message: `已钻岩芯未装箱：${formatRanges(boxGaps)}` });
  }

  // 待补：采取率偏低、岩性空白
  if (totalFootage > 0 && averageRecovery < RECOVERY_THRESHOLDS.qualified) {
    issues.push({
      level: '待补',
      category: '采取率偏低',
      message: `全孔平均采取率 ${averageRecovery}% 低于 ${RECOVERY_THRESHOLDS.qualified}%`,
    });
  }
  if (anomalyCount > 0) {
    issues.push({
      level: '待补',
      category: '采取率偏低',
      message: `${anomalyCount} 个回次采取率低于 ${RECOVERY_THRESHOLDS.qualified}%，质量异常待处理`,
    });
  }
  if (lithoGaps.length) {
    issues.push({ level: '待补', category: '岩性空白', message: `岩性编录未覆盖已钻深度：${formatRanges(lithoGaps)}` });
  }

  const verdict: HandoverVerdict = issues.some((issue) => issue.level === '阻断') ? '阻断' : issues.length ? '待补' : '可交接';

  return {
    hole,
    verdict,
    reachedDepth,
    runCount: holeRuns.length,
    averageRecovery,
    anomalyCount,
    boxCount: holeBoxes.length,
    lithoCount: holeLithos.length,
    runGaps,
    boxGaps,
    lithoGaps,
    issues,
  };
}

/** 全部钻孔的交接体检报告（记录变化后由调用方重新执行，保证结论即时刷新） */
export function buildHandoverReport(holes: DrillHole[], runs: DrillRun[], boxes: CoreBox[], lithos: LithoLog[]): HoleHandover[] {
  return [...holes]
    .sort((a, b) => a.holeNo.localeCompare(b.holeNo))
    .map((hole) => checkHoleHandover(hole, runs, boxes, lithos))
    .sort((a, b) => VERDICT_META[a.verdict].order - VERDICT_META[b.verdict].order || a.hole.holeNo.localeCompare(b.hole.holeNo));
}

/** 归档 CSV 行 */
export type HandoverCsvRow = {
  holeNo: string;
  rigNo: string;
  shift: string;
  verdict: HandoverVerdict;
  reachedDepth: number;
  runCount: number;
  averageRecovery: number;
  anomalyCount: number;
  boxCount: number;
  lithoCount: number;
  runGaps: string;
  boxGaps: string;
  lithoGaps: string;
  issues: string;
  ruleVersion: string;
  checkedAt: string;
};

export const HANDOVER_CSV_COLUMNS: Array<{ key: keyof HandoverCsvRow; title: string }> = [
  { key: 'holeNo', title: '孔号' },
  { key: 'rigNo', title: '钻机' },
  { key: 'shift', title: '班组' },
  { key: 'verdict', title: '交接结论' },
  { key: 'reachedDepth', title: '已钻深度(m)' },
  { key: 'runCount', title: '回次数' },
  { key: 'averageRecovery', title: '平均采取率(%)' },
  { key: 'anomalyCount', title: '异常回次数' },
  { key: 'boxCount', title: '岩芯箱数' },
  { key: 'lithoCount', title: '岩性区间数' },
  { key: 'runGaps', title: '回次断档(m)' },
  { key: 'boxGaps', title: '未装箱(m)' },
  { key: 'lithoGaps', title: '岩性空白(m)' },
  { key: 'issues', title: '问题明细' },
  { key: 'ruleVersion', title: '规则版本' },
  { key: 'checkedAt', title: '体检时间' },
];

/** 报告转归档 CSV 行（每行带规则版本与体检时间） */
export function toHandoverCsvRows(report: HoleHandover[], checkedAt: string): HandoverCsvRow[] {
  return report.map((item) => ({
    holeNo: item.hole.holeNo,
    rigNo: item.hole.rigNo,
    shift: item.hole.shift,
    verdict: item.verdict,
    reachedDepth: item.reachedDepth,
    runCount: item.runCount,
    averageRecovery: item.averageRecovery,
    anomalyCount: item.anomalyCount,
    boxCount: item.boxCount,
    lithoCount: item.lithoCount,
    runGaps: formatRanges(item.runGaps),
    boxGaps: formatRanges(item.boxGaps),
    lithoGaps: formatRanges(item.lithoGaps),
    issues: item.issues.map((issue) => `[${issue.level}]${issue.message}`).join('；') || '无',
    ruleVersion: HANDOVER_RULE_VERSION,
    checkedAt,
  }));
}

/** 备份文件中的逐孔交接结论（导出时即时计算） */
export interface HandoverBackupEntry {
  holeId: string;
  holeNo: string;
  verdict: HandoverVerdict;
  reachedDepth: number;
  averageRecovery: number;
  issues: string[];
}

export function summarizeForBackup(report: HoleHandover[]): HandoverBackupEntry[] {
  return report.map((item) => ({
    holeId: item.hole.id,
    holeNo: item.hole.holeNo,
    verdict: item.verdict,
    reachedDepth: item.reachedDepth,
    averageRecovery: item.averageRecovery,
    issues: item.issues.map((issue) => `[${issue.level}]${issue.message}`),
  }));
}
