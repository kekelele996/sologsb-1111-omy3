import type { DrillHole } from './drill-hole';

/** 交接体检结论：阻断（不可随箱交接）/ 待补（补齐后可交接）/ 可交接 */
export type HandoverVerdict = '阻断' | '待补' | '可交接';

/** 问题级别（与结论对应，无「可交接」级问题） */
export type HandoverIssueLevel = '阻断' | '待补';

/** 问题类别 */
export type HandoverIssueCategory = '回次断档' | '箱位不足' | '采取率偏低' | '岩性空白';

/** 交接体检单项问题 */
export interface HandoverIssue {
  level: HandoverIssueLevel;
  category: HandoverIssueCategory;
  /** 问题描述（含深度区间） */
  message: string;
}

/** 单孔交接体检结果 */
export interface HoleHandover {
  hole: DrillHole;
  verdict: HandoverVerdict;
  /** 已钻深度（m）：终孔深度与回次最大止深度取大 */
  reachedDepth: number;
  /** 回次数 */
  runCount: number;
  /** 全孔加权平均采取率（%） */
  averageRecovery: number;
  /** 采取率 < 75% 的异常回次数 */
  anomalyCount: number;
  /** 岩芯箱数 */
  boxCount: number;
  /** 岩性区间数 */
  lithoCount: number;
  /** 回次未覆盖已钻深度的断档区间 */
  runGaps: Array<{ from: number; to: number }>;
  /** 已钻深度内未装箱的区间 */
  boxGaps: Array<{ from: number; to: number }>;
  /** 已钻深度内未编录岩性的空白区间 */
  lithoGaps: Array<{ from: number; to: number }>;
  /** 问题清单（阻断在前） */
  issues: HandoverIssue[];
}
