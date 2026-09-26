/** 交接体检结论 */
export type HandoverVerdict = 'blocked' | 'pending' | 'ready';

/** 体检问题项编码 */
export type HandoverIssueCode =
  | 'run-gap'
  | 'no-run'
  | 'box-capacity'
  | 'box-gap'
  | 'low-recovery'
  | 'litho-gap';

/** 问题等级：阻断 / 待补 */
export type HandoverIssueLevel = Extract<HandoverVerdict, 'blocked' | 'pending'>;

/** 体检发现的单条问题 */
export interface HandoverIssue {
  code: HandoverIssueCode;
  level: HandoverIssueLevel;
  /** 问题说明（含深度等细节） */
  message: string;
}

/** 单孔交接体检结果 */
export interface HandoverCheck {
  holeId: string;
  holeNo: string;
  rigNo: string;
  shift: string;
  /** 已钻深度（m，回次最大止深度） */
  reachedDepth: number;
  /** 回次数量 */
  runCount: number;
  /** 加权平均采取率（%） */
  averageRecovery: number;
  /** 采取率 < 75% 的回次数量 */
  lowRecoveryRuns: number;
  /** 回次断档区间 */
  runGaps: Array<{ from: number; to: number }>;
  /** 岩性未覆盖区间 */
  lithoGaps: Array<{ from: number; to: number }>;
  /** 箱位（箱容/装箱覆盖）未覆盖区间 */
  boxGaps: Array<{ from: number; to: number }>;
  /** 格位容量不足的箱号 */
  capacityBoxes: string[];
  /** 全部问题（阻断在前） */
  issues: HandoverIssue[];
  /** 结论 */
  verdict: HandoverVerdict;
}
