import { db, SCHEMA_VERSION } from './db';
import type { HandoverCheck } from '../types/handover';
import { HANDOVER_RULE_VERSION, HANDOVER_VERDICT_TEXT } from './handover';

export interface BackupPayload {
  app: string;
  schemaVersion: number;
  exportedAt: string;
  holes: unknown[];
  runs: unknown[];
  boxes: unknown[];
  lithos: unknown[];
}

/** 汇总全部本地表为 JSON 备份（schema 迁移前先导出） */
export async function buildBackup(): Promise<BackupPayload> {
  const [holes, runs, boxes, lithos] = await Promise.all([
    db.holes.toArray(),
    db.runs.toArray(),
    db.boxes.toArray(),
    db.lithos.toArray(),
  ]);
  return {
    app: 'gbdrillcore',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    holes,
    runs,
    boxes,
    lithos,
  };
}

export async function exportBackupJson(): Promise<string> {
  return JSON.stringify(await buildBackup(), null, 2);
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 导出 CSV（岩芯编目表打印用） */
export function downloadCsv<T extends Record<string, unknown>>(
  filename: string,
  rows: T[],
  columns: Array<{ key: keyof T; title: string }>,
): void {
  const header = columns.map((c) => `"${c.title}"`).join(',');
  const body = rows
    .map((row) => columns.map((c) => `"${String(row[c.key] ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  downloadText(filename, `\ufeff${header}\n${body}`, 'text/csv');
}

/** 交接体检归档 CSV：表头携带规则版本与导出信息，每孔一行含结论与问题明细，便于追溯 */
export function buildHandoverCsv(checks: HandoverCheck[], exportedAt: Date, filterLabel: string): string {
  const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const joinGaps = (gaps: Array<{ from: number; to: number }>) => gaps.map((g) => `${g.from}~${g.to}m`).join('；');
  const joinIssues = (check: HandoverCheck, level: 'blocked' | 'pending') =>
    check.issues
      .filter((issue) => issue.level === level)
      .map((issue) => issue.message)
      .join('；');

  const metaRows = [
    ['交接体检归档', `规则版本 ${HANDOVER_RULE_VERSION}`],
    ['导出时间', exportedAt.toISOString()],
    ['筛选范围', filterLabel],
    ['记录数', String(checks.length)],
  ].map((row) => row.map(quote).join(','));

  const header = [
    '规则版本',
    '孔号',
    '钻机',
    '班组',
    '已钻深度(m)',
    '回次数',
    '平均采取率(%)',
    '低采取率回次数(<75%)',
    '回次断档(m)',
    '箱位未覆盖(m)',
    '容量不足箱号',
    '岩性空白(m)',
    '结论',
    '阻断原因',
    '待补事项',
  ]
    .map(quote)
    .join(',');

  const body = checks.map((check) =>
    [
      HANDOVER_RULE_VERSION,
      check.holeNo,
      check.rigNo,
      check.shift,
      check.reachedDepth,
      check.runCount,
      check.averageRecovery,
      check.lowRecoveryRuns,
      joinGaps(check.runGaps),
      joinGaps(check.boxGaps),
      check.capacityBoxes.join('、'),
      joinGaps(check.lithoGaps),
      HANDOVER_VERDICT_TEXT[check.verdict].label,
      joinIssues(check, 'blocked'),
      joinIssues(check, 'pending'),
    ]
      .map(quote)
      .join(','),
  );

  return `\ufeff${[...metaRows, header, ...body].join('\n')}`;
}
/** 恢复 JSON 备份 */
export async function importBackup(text: string): Promise<{ holes: number; runs: number; boxes: number; lithos: number }> {  const payload = JSON.parse(text) as Partial<BackupPayload>;
  if (!payload || payload.app !== 'gbdrillcore') {
    throw new Error('备份文件格式不匹配（缺少 app=gbdrillcore 标记）');
  }
  const counts = {
    holes: payload.holes?.length ?? 0,
    runs: payload.runs?.length ?? 0,
    boxes: payload.boxes?.length ?? 0,
    lithos: payload.lithos?.length ?? 0,
  };
  await db.transaction('rw', db.holes, db.runs, db.boxes, db.lithos, async () => {
    await Promise.all([db.holes.clear(), db.runs.clear(), db.boxes.clear(), db.lithos.clear()]);
    if (payload.holes?.length) await db.holes.bulkPut(payload.holes as never[]);
    if (payload.runs?.length) await db.runs.bulkPut(payload.runs as never[]);
    if (payload.boxes?.length) await db.boxes.bulkPut(payload.boxes as never[]);
    if (payload.lithos?.length) await db.lithos.bulkPut(payload.lithos as never[]);
  });
  return counts;
}
